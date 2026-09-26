# PII Detector PoC — TypeSafe Jev `noul`

> **Status: design review (round 1 decisions applied).** This repository currently contains only the README and the specs in [`specs/`](specs/). Nothing is implemented yet; the implementation starts once the specs are approved.

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

## Planned usage

> These commands will work once the tasks in `specs/tasks.md` are implemented.

```bash
npm install
cp .env.dist .env                  # then set TYPESAFE_API_KEY (from https://console.typesafe.ai/)

npm run detect                                        # analyze fixtures/web-logs.log
npm run detect -- --threshold 0.7 --concurrency 16    # tune decision and throughput
npm run detect -- --input path/to/other.log --no-eval # any log file, no ground truth
npm run detect -- --json reports/run.json --md reports/run.md
```

Sample of the planned output:

```
Analyzing 120 log lines with jev-latest (concurrency 8, threshold 0.50)
[████████████████████░░░░░░░░░░]  82/120  68% | 9.4 lines/s | ETA 4s | PII 33 | errors 0
...
══ Performance ══  total 12.8s · 9.4 lines/s · latency p50 610ms / p95 1.21s · 41,230 input tokens (~$0.0017)
══ Results ══      120 analyzed · 47 PII · 73 clean · 0 errors
══ Accuracy ══     precision 0.96 · recall 0.94 · F1 0.95 · FP 2 · FN 3
══ Lines with PII ══
  #007  0.99  email, name   2026-09-12T10:04:11Z INFO  POST /newsletter/subscribe email=anna.muster@example.com ...
  ...
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

## Repository layout (target)

```
README.md
specs/
  requirements.md   # what: numbered requirements + acceptance criteria
  design.md         # how: architecture, questions, data formats, report
  tasks.md          # implementation plan, each task traced to requirements
fixtures/
  web-logs.log              # 120 raw log lines (input)
  web-logs.labels.json      # ground truth per line (never sent to the model)
src/                        # CLI, detector, progress, report, metrics
test/                       # unit tests (mocked API) + fixture validation
reports/                    # generated reports (git-ignored)
.env.dist                   # versioned template of environment variables
.env                        # your local secrets, e.g. TYPESAFE_API_KEY (git-ignored)
```

## Spec-driven workflow

1. **Requirements** (`specs/requirements.md`): EARS-style requirements with IDs (`REQ-…`).
2. **Design** (`specs/design.md`): the decisions that satisfy each requirement.
3. **Tasks** (`specs/tasks.md`): small, ordered, testable steps that each reference the requirement IDs they fulfil.

The design decisions are recorded in `specs/design.md` §10. Implementation starts once the specs are approved.

## Configuration

The TypeSafe API key is read from a `.env` file at the project root. The file is git-ignored and must never be committed. `.env.dist` is the versioned template:

```bash
cp .env.dist .env   # then fill in TYPESAFE_API_KEY
```

A `TYPESAFE_API_KEY` exported in your shell takes precedence over `.env`.
