# Design — PII Detection PoC

This design is based on the TypeSafe docs (API v1, JS SDK v0.6, `jev-1.13.0`), read on 2026-09-26. Requirement IDs refer to `requirements.md`.

## 1. Architecture

```
src/
  cli.ts          # arg parsing, orchestration, exit codes           (CLI-*, REP-07)
  env.ts          # loads .env (if present) before anything reads env (NFR-06/07)
  config.ts       # defaults + validated RunConfig                     (CLI-03, DET-08/09)
  fixtures.ts     # read log file + labels, pair by line number        (FIX-07, DET-05)
  questions.ts    # the noul question set (single source of truth)     (DET-01..03)
  detector.ts     # per-line systemOne call, thresholding, timing      (DET-02..07)
  pool.ts         # tiny bounded-concurrency runner (no dep)           (DET-06)
  progress.ts     # TTY bar / non-TTY milestones on stderr             (PRG-*)
  metrics.ts      # latency percentiles, confusion matrix, P/R/F1      (REP-01, REP-04)
  report/
    console.ts    # stdout report                                       (REP-01..04, 06)
    json.ts       # --json writer                                        (REP-05)
    markdown.ts   # --md writer                                          (REP-05)
  types.ts
test/
  fixtures.test.ts  metrics.test.ts  detector.test.ts  progress.test.ts  report.test.ts
  live.smoke.test.ts   # skipped unless TYPESAFE_API_KEY               (NFR-03)
.env.dist             # versioned template                             (NFR-06)
.env                  # local secrets, git-ignored                     (NFR-06)
.gitignore            # node_modules/, reports/, .env                  (NFR-04, NFR-06)
```

Flow: `cli` → load `.env` → load config → load lines (+ labels) → `pool.run(lines, detector.analyze, onDone → progress.tick)` → `metrics` → `report/*` → exit code.

Dependencies: `@typesafe-ai/sdk` (runtime). `typescript`, `tsx` and `vitest` (dev). Argument parsing uses `node:util` `parseArgs`. Progress and colors are hand-rolled (ANSI), so there is no progress-bar dependency. `.env` is loaded with Node's built-in `process.loadEnvFile`, so `dotenv` is not needed.

### 1.1 Configuration and secrets (`.env` / `.env.dist`)

| File | Versioned | Content |
|---|---|---|
| `.env.dist` | **yes** | A template with every supported variable and no real values (below). |
| `.env` | **no** (git-ignored) | A local copy of `.env.dist` with the real API key. It is created by the developer with `cp .env.dist .env`. |

`.env.dist`:
```dotenv
# TypeSafe API key — create one at https://console.typesafe.ai/
TYPESAFE_API_KEY=
```

Loading (`src/env.ts`, called first in `cli.ts`):
1. If `.env` exists at the project root, load it with `process.loadEnvFile(path)`. A missing file (ENOENT) is not an error.
2. Variables already set in the shell win over `.env`. Node does not overwrite existing `process.env` entries, and a T4 unit test will confirm this.
3. `config.ts` reads `TYPESAFE_API_KEY`. If it is empty or missing, the CLI exits with code 1 and prints: `Missing TYPESAFE_API_KEY. Copy .env.dist to .env and set your key (or export it in your shell).`
4. The key is passed explicitly to `new TypeSafeClient({ apiKey, model })`. It is never logged, included in error messages or reports, or written into the JSON `config` block.

`.gitignore` includes `.env` and `.env.*`, but re-includes the template with `!.env.dist`, so that local variants (`.env.local`) are also never committed.

The vitest setup does **not** load `.env`, so unit tests never pick up a real key (NFR-02). The live smoke test loads `.env` explicitly and skips itself when there is no key.

## 2. TypeSafe request shape (one request per line)

```jsonc
POST /v1/systemone
{
  "model": "jev-latest",
  "state": { "log_line": "<raw log line>" },
  "questions": {
    "contains_pii":     { "type": "noul", "instructions": "...", "criteria": { "true": "...", "false": "..." } },
    "has_person_name":  { "type": "noul", "instructions": "..." },
    "has_email":        { ... }, "has_phone": { ... }, "has_postal_address": { ... },
    "has_date_of_birth":{ ... }, "has_government_id": { ... }, "has_payment_data": { ... }
  }
}
```

Rationale:
- **One line per request.** The docs warn that accuracy drops when the state contains irrelevant detail. Putting many lines in one state would also make each answer depend on its neighbours. At 120 lines and concurrency 8, request overhead is small. (Batching is listed as a follow-up experiment in §10.)
- **Named state (`log_line`).** Questions can refer to it as `` `log_line` ``, which keeps the target explicit (docs: "point to the relevant state").
- **Fan-out in one call.** Questions over the same state run in parallel. Adding category nouls "barely changes the response time", and the state is ingested once.
- **Primary question plus categories.** The primary noul makes the decision (DET-04). The category nouls provide the explanation. They are not OR-ed into the decision by default, because that would pile up false positives. The report shows cases where the two disagree (see §6).

## 3. Question set (`src/questions.ts`)

The wording follows the Noul guidance: one condition per question, a high value means yes, the condition is stated literally, and boundary cases go in the criteria.

| id | instructions | criteria (true / false) |
|---|---|---|
| `contains_pii` | "Does `log_line` contain personal information that identifies or could be linked to a specific real person?" | **true:** "The line contains at least one value belonging to a specific individual: their name, email address, phone number, home or delivery address, date of birth, government or passport number, bank account or card number, or other personal details about them, even if URL-encoded or embedded in a URL, header or error message." **false:** "The line contains no value belonging to a specific individual. Internal IDs, order numbers, UUIDs, session tokens, product codes, masked or hashed values, generic company mailboxes (e.g. support@), public business addresses and anonymized IPs are not personal information." |
| `has_person_name` | "Does `log_line` contain the name of a specific person?" | — (the criteria are added only if tests show they help) |
| `has_email` | "Does `log_line` contain an email address belonging to an individual person (not a generic company or role mailbox)?" | — |
| `has_phone` | "Does `log_line` contain a person's phone number?" | — |
| `has_postal_address` | "Does `log_line` contain a person's street, home, billing or delivery address?" | — |
| `has_date_of_birth` | "Does `log_line` contain a person's date of birth?" | — |
| `has_government_id` | "Does `log_line` contain a government-issued identifier such as a social security, AHV/AVS, passport, national ID or tax number?" | — |
| `has_payment_data` | "Does `log_line` contain a full bank account number (IBAN) or payment card number?" | — |

Category threshold: the same `--threshold` is used. The console shows a category only when its noul ≥ threshold. The JSON report always keeps the raw probabilities, so a different threshold can be applied later without re-running inference.

Prompt iteration protocol: if the fixture accuracy misses NFR-05, compare the variants with and without `criteria` for `contains_pii` (the docs recommend testing both). Record the variant that was chosen, and why, in `specs/design.md` §11 (changelog).

## 4. PII policy (default)

| In scope (PII) | Out of scope (not PII by default) |
|---|---|
| Person name (full or first + last) | Internal user IDs / customer numbers (`uid=48213`) |
| Personal email | Order / session / request IDs, UUIDs, JWT-like tokens |
| Phone number | SKUs, coupon codes |
| Home/billing/delivery address | Masked (`+41 ** *** ** 12`) or hashed values |
| Date of birth | Role mailboxes (`support@shop.example`) |
| Government ID (AHV/AVS `756.xxxx.xxxx.xx`, passport) | Public store/business address |
| IBAN / full card number | Anonymized IPs (`203.0.113.0`), user agents |
| Free-text personal details (e.g. a health note in a support message) | City/country alone (`geo=Zurich,CH`) |

**IP addresses are a policy decision** (see §10-D2). Under GDPR and the Swiss nFADP, a full IP address can be personal data. If full IPs counted as PII, almost every access-log line would be positive and the test would lose its meaning. **Default:** the fixture anonymizes client IPs (last octet zeroed, RFC 5737 ranges), and IPs are out of scope.

## 5. Fixtures

### 5.1 Files

- `fixtures/web-logs.log`: 120 raw lines in mixed formats, one event per line. Line numbers (1-based) are the record IDs.
- `fixtures/web-logs.labels.json`:
  ```json
  [{ "line": 7, "contains_pii": true, "categories": ["email", "person_name"], "note": "newsletter signup, name in query" }]
  ```
  `categories` ⊆ `person_name | email | phone | postal_address | date_of_birth | government_id | payment_data | free_text_personal`.
  Hard negatives (REQ-FIX-05) also carry `"hard_negative": true`, so that the validation test can count them.
- `scripts/generate-fixtures.ts` (`npm run fixtures:generate`) builds both files deterministically: a seeded shuffle and monotonic timestamps. The generated files are committed; the script exists so the fixture can be reproduced or extended.

### 5.2 Distribution (target)

| Bucket | Lines |
|---|---|
| **PII lines** | **48 (40%)** |
| — person name | ≥ 10 |
| — email | ≥ 10 |
| — phone | ≥ 6 |
| — postal address | ≥ 6 |
| — date of birth | ≥ 4 |
| — government ID | ≥ 4 |
| — payment data (IBAN/card) | ≥ 4 |
| — free-text personal | ≥ 4 |
| — multiple categories on one line | ≥ 10 (these overlap with the rows above) |
| **Clean lines** | **72 (60%)** |
| — routine traffic (static assets, product pages, health checks, bots) | ~40 |
| — business events without PII (cart, checkout with IDs only, search for products) | ~15 |
| — hard negatives (REQ-FIX-05) | ≥ 17 |

Lines are shuffled so that PII lines are not clustered. The timestamps are monotonic, on a single day (2026-09-12), for realism.

### 5.3 Illustrative lines (final fixture will be generated in task T2)

```
203.0.113.0 - - [12/Sep/2026:10:02:13 +0200] "GET /products/sku-44821 HTTP/1.1" 200 5312 "-" "Mozilla/5.0 (Macintosh...)"
203.0.113.0 - - [12/Sep/2026:10:04:11 +0200] "GET /newsletter/confirm?email=anna.muster%40example.com&name=Anna+Muster HTTP/1.1" 302 0 "-" "Mozilla/5.0"
{"ts":"2026-09-12T10:05:40Z","level":"INFO","svc":"checkout","event":"order_created","order_id":"ORD-2026-000913","items":3,"total_chf":129.90}
{"ts":"2026-09-12T10:06:02Z","level":"INFO","svc":"checkout","event":"shipping_set","address":"Via Nassa 12, 6900 Lugano","recipient":"Marco Bernasconi"}
{"ts":"2026-09-12T10:07:19Z","level":"WARN","svc":"payments","msg":"card declined","card_last4":"4242","order_id":"ORD-2026-000914"}
{"ts":"2026-09-12T10:08:55Z","level":"ERROR","svc":"account","msg":"ValidationError: dob '1987-03-14' invalid for user lukas.meier@example.com"}
{"ts":"2026-09-12T10:09:30Z","level":"INFO","svc":"support","event":"ticket_opened","message":"Hi, I'm pregnant and need the delivery before the 20th, call me on 079 555 01 23"}
{"ts":"2026-09-12T10:11:02Z","level":"INFO","svc":"auth","event":"login_success","user_id":"u_48213","mfa":true}
{"ts":"2026-09-12T10:12:47Z","level":"INFO","svc":"mailer","event":"sent","to":"support@shop.example","template":"daily_digest"}
```

(`card_last4` alone is a hard negative. `Via Nassa 12` + a recipient name is a positive.)

## 6. Detector (`src/detector.ts`)

```ts
type LineResult = {
  line: number; text: string;
  status: "ok" | "error";
  probabilities?: Record<QuestionId, number>;   // raw noul values
  isPii?: boolean;                              // contains_pii >= threshold
  categories?: Category[];                      // category nouls >= threshold
  latencyMs: number;                            // wall time of the systemOne call (incl. SDK retries)
  usage?: { input_tokens: number; output_tokens: number };
  model?: string;                               // versioned id from response
  error?: string;                               // message only, never headers/key
};
```

- The client is `new TypeSafeClient({ apiKey, model })`, with the key coming from §1.1. The SDK default retry policy handles 429/529 with backoff (DET-07).
- Timing uses `performance.now()` around each call. The run timer starts after the input has loaded and stops after the last result, before rendering the report.
- **Disagreement flag:** `isPii === false` while some category noul ≥ threshold, or `isPii === true` while no category noul ≥ threshold. These are listed in the report as "review" items, because they are useful for tuning prompts.

Concurrency (`src/pool.ts`): a worker pool of N async workers that pull from a shared index, with results stored by line index. Order of completion does not matter. Rate check: 8 workers × ~1 req/s ≈ 480 req/min, which is below the 1,200 limit.

## 7. Progress (`src/progress.ts`)

- TTY: `\r` redraw, throttled to ≤ 10 fps:
  `[██████████░░░░░░░░░░]  62/120  52% | 9.1 lines/s | ETA 6s | PII 24 | errors 0`
- Non-TTY: a line at each 10% milestone and at completion.
- Throughput = completed / elapsed. ETA = remaining / throughput. All of it is written to stderr (PRG-03).

## 8. Metrics and report

- **Latency percentiles:** nearest-rank over the latencies of `ok` lines.
- **Cost estimate:** `input_tokens / 1e6 × $0.042` (the jev-1.13 price; output tokens are free). The price is a constant in `config.ts` and is labelled "estimate" in the report.
- **Accuracy** (only for lines with status `ok` that have a label): TP/FP/TN/FN on `contains_pii`. precision = TP/(TP+FP), recall = TP/(TP+FN), F1, accuracy. A value is shown as `n/a` when its denominator is 0. **Per-category recall** is shown as a secondary table, as information only.
- **Console sections, in order:** Run config → Performance → Results → Accuracy → Lines with PII (sorted by line number, with probability and categories) → False positives / False negatives → Review (disagreements) → Errors.
- **JSON** (`--json`): `{ config, model_answered, timing, usage, results: LineResult[], metrics }`.
- **Markdown** (`--md`): the same sections as the console, with the lines in code spans.

## 9. Testing strategy

| Test | Covers |
|---|---|
| `fixtures.test.ts`: count ≥ 100, PII ratio 30–50%, each category ≥ 3, hard negatives ≥ 15, one label per line, labels ⊆ allowed set, only reserved email domains | FIX-01,03,05,06,07,08 |
| `metrics.test.ts`: percentiles, confusion matrix, zero-denominator handling | REP-01, REP-04 |
| `detector.test.ts`: uses an injected fake `fetch`; checks thresholding, category mapping, error path, that state contains only `log_line`, and that the API key never appears in the result | DET-02..05, 07, 09 |
| `progress.test.ts`: TTY vs non-TTY output, milestones | PRG-* |
| `report.test.ts`: snapshot of the console/Markdown output on a synthetic result set, and exit codes | REP-*, CLI-* |
| `env.test.ts`: `.env` is loaded when present; a missing `.env` is not an error; a shell variable takes precedence; a missing key gives exit 1 with the `.env.dist` hint | NFR-06, NFR-07 |
| `live.smoke.test.ts`: 3 lines against the real API, reading the key from `.env` or the shell (skipped when there is no key) | NFR-03 |

## 10. Decisions (resolved at review, 2026-09-26)

| # | Decision | Outcome |
|---|---|---|
| D1 | Language/stack | **TypeScript + `@typesafe-ai/sdk`** (Node ≥ 20.12). |
| D2 | Are full IP addresses PII? | **No.** Fixture IPs are anonymized, and IPs are out of scope (§4). |
| D3 | Decision rule | **Primary `contains_pii` noul only.** Category nouls are for explanation only. |
| D4 | Default threshold | **0.5.** Precision/recall are also reported at 0.3/0.5/0.7 from the same run (REQ-REP-08). |
| D5 | Fixture language | **English logs, with Swiss-style names and addresses (DE/FR/IT).** |
| D6 | Success targets (NFR-05) | **Recall ≥ 0.90, precision ≥ 0.85, < 30 s for 120 lines.** |
| D7 | Batch mode (N lines per request) | **Out of scope for v1.** It is listed in the README as a next step. |
| D8 | Secrets handling | **The API key lives in a git-ignored `.env`. A versioned `.env.dist` is the template** (§1.1, REQ-NFR-06/07). |

## 11. Changelog

- 2026-09-26: initial design for review.
- 2026-09-26: review round 1. D1–D7 accepted as proposed. Added D8: `.env` / `.env.dist` secrets handling (§1.1, `env.ts`, `env.test.ts`), and raised the Node minimum to 20.12.
- 2026-09-26: T2. Added the optional `hard_negative` label field and the fixture generator script (§5.1).
