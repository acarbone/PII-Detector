# PII Detector PoC — TypeSafe Jev `noul`

> **Status: implemented.** All tasks in [`specs/tasks.md`](specs/tasks.md) are done. The first measured results are in [Results](#results).

## Aim

This proof of concept checks whether **TypeSafe's Jev model** can do one practical job: **decide whether a web-application log line contains Personally Identifiable Information (PII)**.

Regex-based PII scanners find well-formed emails and card numbers. They miss free-text PII, such as a name in a support message, a street address in a URL-encoded query string, or a date of birth in a validation error. They also flag look-alikes such as order numbers, UUIDs and masked values. Jev is a System One model: it returns a calibrated probability instead of generated text. That makes it a good candidate for a fast, typed "does this line contain PII?" judgment that ordinary code can threshold and act on.

The PoC answers three questions:

1. **Quality.** How accurately does Jev separate PII lines from clean lines, measured against a labelled fixture set?
2. **Performance.** How long does it take to analyze a realistic batch of logs, in wall-clock time, per-line latency and throughput, and how many tokens does it cost?
3. **Ergonomics.** How much code does a TypeSafe-based detector need, and how easy is it to tune?

## What the project contains

| Part | Description |
|---|---|
| **Fixtures** (`fixtures/`) | 120 synthetic log lines, as a website would emit them: HTTP access logs, JSON application logs, auth events, checkout and search events, form submissions and error traces. About 40% contain PII, and the rest do not. A separate ground-truth file labels every line. |
| **CLI** (`src/cli.ts`) | Reads a log file, asks Jev a set of `noul` questions for each line, shows live progress, and prints a final report. |
| **Report** | Execution time and throughput, token usage and estimated cost, detection results (flagged and clean counts), accuracy against ground truth (precision, recall and F1), and **every line detected as containing PII**, with its probability and PII categories. |

### PII covered by the fixtures

The fixtures cover more than names. They also include email addresses, phone numbers, postal addresses, dates of birth, national identifiers (for example Swiss AHV/AVS numbers and passport numbers), payment data (IBANs and card numbers), and precise personal details in free text.

The clean lines include deliberate **hard negatives**: order IDs, UUIDs, SKUs, masked or hashed values, and public business addresses. These are there to measure false positives.

All fixture data is **synthetic**. It uses reserved domains (`example.com`), fictional phone ranges and invented people, so no real person's data is in this repository.

## How it works

```
fixtures/web-logs.log ──► CLI ──► for each line (bounded concurrency):
                                     POST /v1/systemone
                                       state:     { log_line }
                                       questions: contains_pii (noul)
                                                  + one noul per PII category
                                     ◄── probabilities
                                  ──► threshold in code ──► progress bar
                                  ──► final report (+ optional JSON / Markdown)
```

- **Primitive:** only `noul` is used. Each question returns `P(yes)` from 0 to 1.
- **Decision rule:** a line is flagged when `contains_pii ≥ threshold`. The default threshold is 0.5, and you can set it with a CLI flag. Per-category nouls are asked in the same request, so they cost almost no extra latency, and they explain *why* a line was flagged.
- **Model:** `jev-latest` by default, which can be pinned (for example `jev-1.13.0`). The report records the model version that answered.

The full design is in [`specs/design.md`](specs/design.md).

## Usage

Requirements: Node.js ≥ 20.12 and a TypeSafe API key.

```bash
npm install
cp .env.dist .env                  # then set TYPESAFE_API_KEY (from https://console.typesafe.ai/)

npm run detect                                        # analyze fixtures/web-logs.log against its labels
npm run detect -- --threshold 0.7 --concurrency 16    # tune decision and throughput
npm run detect -- --input path/to/other.log --no-eval # any log file, no ground truth
npm run detect -- --json reports/run.json --md reports/run.md
npm run detect -- --help
```

| Flag | Default | Meaning |
|---|---|---|
| `--input <path>` | `fixtures/web-logs.log` | Log file to analyze, one event per line |
| `--labels <path>` | `<input>.labels.json` if present | Ground truth used for the accuracy section |
| `--threshold <0..1>` | `0.5` | `contains_pii` probability at or above which a line counts as PII |
| `--concurrency <n>` | `8` | Parallel API requests |
| `--model <name>` | `jev-latest` | TypeSafe model; pin e.g. `jev-1.13.0` |
| `--limit <n>` | all | Analyze only the first n lines |
| `--no-eval` | | Skip the accuracy evaluation |
| `--json <path>` / `--md <path>` | | Also write a JSON / Markdown report |
| `--no-color` | colors on a TTY | Disable ANSI colors (`NO_COLOR` is also respected) |

Progress goes to **stderr** and the report goes to **stdout**, so `npm run -s detect > report.txt` still shows live progress. On a terminal, progress is a bar that redraws in place. When piped or in CI, it prints one line at each 10%.

Exit codes: `0` when the run completes (even if PII is found), `1` on a fatal error (bad flags, missing key, authentication failure), and `2` when some lines failed after retries.

Excerpt of a real run:

```
Analyzing 120 log lines with jev-latest (concurrency 8, threshold 0.50)
[██████████████████████████████] 120/120 100% | 29.1 lines/s | ETA 0s | PII 51 | errors 0

══ Performance ══
  total time   4.12s    throughput 29.1 lines/s
  latency      min 216ms · p50 260ms · p95 327ms · max 403ms
  tokens       87,576 input · 20,520 output · est. cost $0.00368

══ Results ══
  analyzed 120/120 · PII 51 · clean 69 · errors 0 · review 3

══ Accuracy ══
  precision 0.94 · recall 1.00 · F1 0.97 · accuracy 0.97
  confusion    TP 48 · FP 3 · TN 69 · FN 0

══ Lines with PII (51) ══
  #001  0.87  payment_data  {"ts":"2026-09-12T08:00:54Z","level":"ERROR","svc":"payments","msg":"gateway rejected card 4111111111111111 …
  #003  0.97  person_name  {"ts":"2026-09-12T08:01:49Z","level":"INFO","svc":"chatbot","event":"transcript","session":"cb_5512","user_…
  #004  0.97  person_name, email, phone  {"ts":"2026-09-12T08:02:07Z","level":"INFO","svc":"checkout","event":"guest_checkout","guest_email"…
  …
```

The full report also shows the run configuration, the threshold sweep, per-category recall, false positives and negatives, *Review* items (lines where the main answer and the category answers disagree) and errors.

## Tests

```bash
npm test            # offline unit tests (fake fetch, never loads .env)
npm run typecheck
npm run test:live   # opt-in smoke test against the real API (uses .env; skipped without a key)
npm run fixtures:generate   # regenerate the fixture deterministically
```

## Results

First full run: 2026-09-26, `jev-latest` → **`jev-1.13.0`**, all 120 fixture lines, default settings (threshold 0.50, concurrency 8).

| Metric | Result | Target (NFR-05) | |
|---|---|---|---|
| Recall | **1.00** (48/48 PII lines found) | ≥ 0.90 | ✅ |
| Precision | **0.94** (3 false positives) | ≥ 0.85 | ✅ |
| F1 / accuracy | 0.97 / 0.97 | — | |
| Total execution time | **4.1 s** (29 lines/s) | < 30 s | ✅ |
| Per-line latency | min 216 ms · p50 260 ms · p95 327 ms · max 403 ms | — | |
| Tokens | 87,576 input · 20,520 output | — | |
| Estimated cost | ≈ $0.0037 for the run (≈ $0.00003 per line) | — | |

**Threshold sweep** (same run, no extra API calls):

| Threshold | Precision | Recall | F1 | FP | FN |
|---:|---:|---:|---:|---:|---:|
| 0.30 | 0.91 | 1.00 | 0.95 | 5 | 0 |
| **0.50** | **0.94** | **1.00** | **0.97** | 3 | 0 |
| 0.70 | 0.98 | 1.00 | 0.99 | 1 | 0 |

**Per category:** every category question found all of its labelled lines (recall 1.00 for names, emails, phones, addresses, dates of birth, government IDs, payment data and free-text personal details).

**What it got wrong.** All 3 false positives are *masked* values that still look like contact or payment data:

- `customer_email: "j***@e***.com"` (0.63)
- `card_last4: "4242"` (0.68)
- `phone: "+41 ** *** ** 12"` (0.80)

At threshold 0.70, only the masked phone remains. Two other hard negatives, a company VAT number and a business hotline, were correctly classified as clean. Their category questions (`has_government_id`, `has_phone`) fired, and the report lists them under *Review* as disagreements.

**Takeaways**

- Jev handled the cases that regexes miss: PII in URL-encoded query strings and referrers, names in free text and stack traces, a passport MRZ line, and health or family details in support messages.
- The main question plus category questions in one request costs about 730 input tokens per line. Latency stays around 260 ms, because the questions run in parallel.
- If false positives are costly, raise the threshold to 0.7. Recall stays at 1.00 on this fixture. Because every probability is in `--json`, other thresholds can be tried without calling the API again.
- These numbers come from a 120-line synthetic fixture. Validate on real (sanitized) logs before relying on them.

## Repository layout

```
README.md
specs/
  requirements.md           # what: numbered requirements + acceptance criteria
  design.md                 # how: architecture, questions, data formats, report, changelog
  tasks.md                  # implementation plan, each task traced to requirements
fixtures/
  web-logs.log              # 120 raw log lines (input)
  web-logs.labels.json      # ground truth per line (never sent to the model)
scripts/
  generate-fixtures.ts      # deterministic fixture generator
src/
  cli.ts                    # entry point: flags, orchestration, exit codes
  env.ts  config.ts         # .env loading, validated run config
  fixtures.ts               # log line + label loaders
  questions.ts              # the noul question set (single source of truth)
  detector.ts               # one systemOne request per line, thresholding
  pool.ts  progress.ts      # bounded concurrency, live progress on stderr
  metrics.ts                # latency, tokens/cost, confusion matrix, sweep
  report/                   # console, JSON and Markdown renderers
test/                       # unit tests (fake fetch) + opt-in live smoke test
reports/                    # generated reports (git-ignored: they contain PII)
.env.dist                   # versioned template of environment variables
.env                        # your local secrets, e.g. TYPESAFE_API_KEY (git-ignored)
```

## Spec-driven workflow

1. **Requirements** (`specs/requirements.md`): EARS-style requirements with IDs (`REQ-…`).
2. **Design** (`specs/design.md`): the decisions that satisfy each requirement.
3. **Tasks** (`specs/tasks.md`): small, ordered, testable steps that each reference the requirement IDs they fulfil.

The design decisions are recorded in `specs/design.md` §10. Changes made during implementation are logged in its changelog (§11).

## Configuration

The TypeSafe API key is read from a `.env` file at the project root. The file is git-ignored and must never be committed. `.env.dist` is the versioned template:

```bash
cp .env.dist .env   # then fill in TYPESAFE_API_KEY
```

A `TYPESAFE_API_KEY` exported in your shell takes precedence over `.env`.

## Next steps

- **Batch mode (D7):** send N lines per request with one noul per line (`` `lines[i]` ``), and compare cost, latency and accuracy with one line per request.
- **Masked values:** add criteria for masked or partial values to `contains_pii`, since all 3 current false positives are masked values, and measure the effect with the threshold sweep.
- **Non-English logs:** add German, French and Italian free text to the fixture. Jev is strongest in English.
- **Real data:** evaluate on a sanitized sample of real production logs before relying on these numbers.
