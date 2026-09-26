# Requirements — PII Detection PoC

Requirements use the EARS style ("The system shall…", "When…, the system shall…"). Every requirement has an ID that `design.md` and `tasks.md` refer to.

## 1. Scope and definitions

- **Log line**: one line of `fixtures/web-logs.log` (or of a user-supplied file). Blank lines are ignored.
- **PII**: information that identifies, or can reasonably be linked to, a specific natural person. It is either a direct identifier or contact data (see REQ-FIX-03). The default policy is in `design.md` §4.
- **Detector**: the CLI that classifies each log line as `pii` or `clean` using TypeSafe Jev `noul` questions.

## 2. Fixtures (FIX)

| ID | Requirement |
|---|---|
| REQ-FIX-01 | The project shall include a fixture file with **at least 100** (target: 120) log lines that look like traffic from a public e-commerce website. |
| REQ-FIX-02 | The fixture shall mix at least 6 log formats: HTTP access log (combined format), JSON application log, authentication/audit events, checkout/payment events, search/analytics events, form-submission events, and error/stack-trace lines. |
| REQ-FIX-03 | Between 30% and 50% of lines shall contain PII. Together they shall cover all of these categories: **person name, email, phone number, postal address, date of birth, national/government ID, payment data (IBAN/card), and free-text personal details**. Each category shall appear in at least 3 lines. |
| REQ-FIX-04 | PII lines shall include **hard positives**: PII inside URL query strings (including URL-encoded), inside referrer headers, inside free-text messages, inside stack traces, and lines with more than one PII category. |
| REQ-FIX-05 | Clean lines shall include **hard negatives** (at least 15 lines): order/session IDs, UUIDs, SKUs, masked values (`j***@e***.com`), hashed identifiers, public business/store addresses, generic role mailboxes such as `support@shop.example`, and health-check/bot traffic. |
| REQ-FIX-06 | All fixture data shall be synthetic. It shall use reserved or fictional values (`example.com`/`.example` domains, fictional phone numbers, invented names, test IBANs/card numbers) so that no real person is represented. |
| REQ-FIX-07 | The project shall include a ground-truth file that labels every line with `contains_pii` and its PII `categories`. The ground truth shall never be sent to the model. |
| REQ-FIX-08 | An automated test shall validate the fixture against REQ-FIX-01, -03, -05 and -07 (line count, PII ratio, category coverage, and one label per line). |

## 3. Detection (DET)

| ID | Requirement |
|---|---|
| REQ-DET-01 | The detector shall use the TypeSafe System One API with **only the `noul` primitive**. |
| REQ-DET-02 | For each log line, the detector shall ask a primary `noul` question: "does this line contain PII?". |
| REQ-DET-03 | The detector shall also ask one `noul` per PII category **in the same request** as the primary question, so that the report can explain each detection. |
| REQ-DET-04 | The system shall flag a line as `pii` when the primary probability is at or above a configurable threshold (default `0.5`). Thresholding shall happen in code, not in the prompt. |
| REQ-DET-05 | The system shall send only the log line, as named state, to the model. It shall not send labels, line numbers or other lines. |
| REQ-DET-06 | The system shall process lines concurrently, with a configurable concurrency limit (default `8`), and shall stay within the API rate limits (1,200 req/min). |
| REQ-DET-07 | When a request fails after the SDK's retries, the system shall mark that line as `error`, continue with the other lines, and report the error. |
| REQ-DET-08 | The model shall be configurable (default `jev-latest`). The system shall record the versioned model ID returned by the API. |
| REQ-DET-09 | The API key shall be read from `TYPESAFE_API_KEY`, which is loaded from the project's `.env` file (see REQ-NFR-06). It shall never be printed, logged or written to reports. |

## 4. Progress (PRG)

| ID | Requirement |
|---|---|
| REQ-PRG-01 | While analysis runs, the CLI shall show progress: lines completed out of total, percentage, throughput (lines/s), ETA, the running count of PII detections, and the running count of errors. |
| REQ-PRG-02 | When stderr is a TTY, progress shall be a single in-place progress bar. When it is not a TTY (CI, pipes), the CLI shall print a plain progress line at every 10% instead. |
| REQ-PRG-03 | Progress output shall go to **stderr**, so that stdout carries only the report and can be redirected. |

## 5. Report (REP)

| ID | Requirement |
|---|---|
| REQ-REP-01 | At the end of the run, the CLI shall print a **performance** section with: total wall-clock execution time, throughput (lines/s), per-line API latency (min, p50, p95, max), total input/output tokens, and estimated cost. |
| REQ-REP-02 | The CLI shall print a **results** section with: lines analyzed, lines with PII, clean lines, errored lines, and a count per PII category. |
| REQ-REP-03 | The CLI shall print a **"Lines with PII"** section that lists every flagged line with its line number, primary probability, detected categories, and the raw line (truncated to the terminal width; shown in full in the JSON/Markdown reports). |
| REQ-REP-04 | When ground truth is available and `--no-eval` is not set, the CLI shall print an **accuracy** section with: confusion matrix (TP/FP/TN/FN), precision, recall, F1 and accuracy. It shall also list the false positives and false negatives. |
| REQ-REP-05 | When `--json <path>` is given, the CLI shall write a machine-readable report with every per-line result (probabilities for all questions, latency, status). When `--md <path>` is given, it shall write a Markdown version of the console report. |
| REQ-REP-06 | The report shall include the run configuration: model (requested and answered), threshold, concurrency, input file, and timestamp. |
| REQ-REP-07 | The CLI shall exit with code `0` on a completed run (even with PII found), `1` on a fatal error (for example a missing API key or unreadable input), and `2` when some lines errored. |
| REQ-REP-08 | When ground truth is available, the accuracy section shall also show precision, recall and F1 at the thresholds 0.3, 0.5 and 0.7. These are computed from the same probabilities, with no extra API calls. |

## 6. CLI (CLI)

| ID | Requirement |
|---|---|
| REQ-CLI-01 | The CLI shall run with `npm run detect` and with no arguments. It shall default to `fixtures/web-logs.log` and its labels file. |
| REQ-CLI-02 | The CLI shall support these flags: `--input`, `--labels`, `--threshold`, `--concurrency`, `--model`, `--limit <n>` (analyze only the first n lines), `--no-eval`, `--json`, `--md`, `--no-color`, `--help`. |
| REQ-CLI-03 | The CLI shall validate flags (threshold in [0,1], concurrency ≥ 1) and fail fast with a clear message. |

## 7. Non-functional (NFR)

| ID | Requirement |
|---|---|
| REQ-NFR-01 | Stack: Node.js ≥ 20.12 (for the built-in `process.loadEnvFile`), TypeScript (strict), and the official `@typesafe-ai/sdk`. Keep dependencies to a minimum. |
| REQ-NFR-02 | Unit tests shall run **without network or API key**, using a mocked `fetch` or client. |
| REQ-NFR-03 | An optional live smoke test shall run only when `TYPESAFE_API_KEY` is set. |
| REQ-NFR-04 | Generated reports (`reports/`) shall be git-ignored, because they contain (synthetic) PII. |
| REQ-NFR-05 | **PoC success target** (confirmed at review, 2026-09-26): recall ≥ 0.90 and precision ≥ 0.85 on the fixture at the default threshold, and full-run wall-clock time < 30 s for 120 lines at the default concurrency. |
| REQ-NFR-06 | Secrets shall be configured through a `.env` file at the project root. The repository shall version a `.env.dist` template that lists every supported variable with an empty or placeholder value. `.env` shall be git-ignored and never committed. |
| REQ-NFR-07 | When `.env` is missing, the CLI shall still run if `TYPESAFE_API_KEY` is set in the shell environment. When the key is missing from both, the CLI shall exit with code `1` and tell the user to copy `.env.dist` to `.env` and fill in the key. A variable already set in the shell shall take precedence over the value in `.env`. |
