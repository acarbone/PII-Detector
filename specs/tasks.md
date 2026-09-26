# Implementation Tasks — PII Detection PoC

These tasks are ordered and small, and each one can be verified on its own. **None of them start until the specs are approved.** Each task lists the requirements it fulfils and its "done when" check.

| # | Task | Requirements | Done when |
|---|---|---|---|
| T1 | **Scaffold**: `package.json` (`engines.node` ≥ 20.12, `"type": "module"`, scripts `detect`, `test`, `typecheck`), strict `tsconfig.json`, `vitest`, `tsx`, `@typesafe-ai/sdk`, `.gitignore` (`node_modules/`, `reports/`, `.env`, `.env.*`, `!.env.dist`), and a versioned `.env.dist` template with `TYPESAFE_API_KEY=` (design §1.1) | NFR-01, NFR-04, NFR-06, DET-09 | `npm run typecheck` and `npm test` pass on the empty project; `git check-ignore .env` matches and `git check-ignore .env.dist` does not |
| T2 | **Fixtures**: write `fixtures/web-logs.log` (120 lines) and `fixtures/web-logs.labels.json` following design §5 (distribution, hard positives and negatives, synthetic values only) | FIX-01..07 | The file exists; every line has exactly one label |
| T3 | **Fixture validation test** (`test/fixtures.test.ts`) | FIX-08, FIX-06 | The test passes; it fails if a label is removed or the ratio drifts |
| T4 | **Env and config**: `env.ts` (optional `.env` load via `process.loadEnvFile`, shell variables take precedence), `types.ts`, `config.ts` (defaults, flag validation, price constant, key from env with the `.env.dist` hint when missing) | CLI-02, CLI-03, DET-08, DET-09, NFR-06, NFR-07 | `env.test.ts` and the config validation tests pass |
| T5 | **Fixture loader** (`fixtures.ts`): reads lines (skipping blanks), 1-based numbering, optional labels, `--limit` | CLI-01, FIX-07 | Unit test on a small temp file |
| T6 | **Question set** (`questions.ts`): the 9 nouls from design §3 (primary + 8 categories), built with the SDK `noul()` helper | DET-01..03 | A snapshot test of the question payload |
| T7 | **Detector** (`detector.ts`): one `systemOne` call per line, `state: { log_line }`, timing, thresholding, categories, disagreement flag, error capture | DET-02..05, DET-07 | `detector.test.ts` with a fake `fetch` covering the ok, error and no-key-leak paths |
| T8 | **Pool** (`pool.ts`): bounded concurrency with a completion callback | DET-06 | Test: max in-flight ≤ N; all results are returned in index order |
| T9 | **Progress** (`progress.ts`): TTY bar and non-TTY milestones on stderr | PRG-01..03 | `progress.test.ts` passes |
| T10 | **Metrics** (`metrics.ts`): latency percentiles, tokens and cost, confusion matrix, P/R/F1/accuracy, multi-threshold table, per-category recall | REP-01, REP-02, REP-04, REP-08 | `metrics.test.ts` passes, including the zero-denominator cases |
| T11 | **Console report** (`report/console.ts`): the sections in design §8, lines truncated to the terminal width, color that can be turned off | REP-01..04, REP-06 | Snapshot test passes |
| T12 | **JSON and Markdown reports** | REP-05 | Files are written; the JSON is valid against the `LineResult` type |
| T13 | **CLI wiring** (`cli.ts`): `parseArgs`, `--help`, orchestration, exit codes 0/1/2 | CLI-01..03, REP-07 | `npm run detect -- --help` works, and a missing key exits with 1 and the "copy .env.dist to .env" message |
| T14 | **Live smoke test** (`test/smoke.live.test.ts`, 3 lines, run with `npm run test:live`, skipped when there is no key) | NFR-03 | The test passes with a key and is skipped without one |
| T15 | **First real run and evaluation**: run on all 120 lines, record the metrics in the README "Results" section, and compare against NFR-05. If a target is missed, apply the prompt-iteration protocol (design §3) and log the result in the design changelog | NFR-05 | The README has the measured numbers and the model version |
| T16 | **README update**: move from "planned usage" to real usage, add a results table and next steps (batch-mode experiment D7, non-English logs) | — | The README matches the behavior |

## Traceability check

Every REQ ID in `requirements.md` appears in at least one task above:
FIX-01..08 → T2, T3 · DET-01..09 → T1, T4, T6, T7, T8 · PRG-01..03 → T9 · REP-01..08 → T10–T13 · CLI-01..03 → T4, T5, T13 · NFR-01..07 → T1, T4, T14, T15.
