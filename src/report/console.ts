import { flagged, byLine, errored, reviewItems, type Report } from "./model.js";
import { fmtInt, fmtMs, fmtProb, fmtRatio, fmtUsd, lineNo, palette, truncate } from "./format.js";
import type { LineResult } from "../types.js";

export interface ConsoleOptions {
  color: boolean;
  /** Terminal width for truncating raw lines; null = do not truncate (e.g. piped output). */
  width: number | null;
}

/** Renders the end-of-run report for stdout (REQ-REP-01..04, REQ-REP-06). */
export function renderConsole(report: Report, { color, width }: ConsoleOptions): string {
  const p = palette(color);
  const { config, metrics } = report;
  const { performance: perf, counts, accuracy } = metrics;
  const out: string[] = [];
  const section = (title: string) => out.push("", p.bold(p.cyan(`══ ${title} ══`)));
  const nw = String(Math.max(0, ...report.results.map((r) => r.line))).length;
  const n = (line: number) => lineNo(line, Math.max(3, nw));

  /** `  #007  0.99  email, name   <raw line>` truncated to the terminal width. */
  const row = (r: LineResult, extra = "") => {
    const head = `  ${n(r.line)}  ${fmtProb(r.probabilities?.contains_pii)}  ${extra}`;
    const room = width === null ? null : Math.max(20, width - head.length - 1);
    return `${p.bold(head)}${truncate(r.text, room)}`;
  };

  section("Run");
  out.push(
    `  input        ${config.input}`,
    `  labels       ${config.evaluate && config.labels ? config.labels : "(evaluation off)"}`,
    `  model        ${config.model} → ${report.modelsAnswered.join(", ") || "n/a"}`,
    `  threshold    ${config.threshold.toFixed(2)}    concurrency ${config.concurrency}${config.limit ? `    limit ${config.limit}` : ""}`,
    `  generated    ${report.generatedAt}`,
  );

  section("Performance");
  out.push(
    `  total time   ${fmtMs(perf.wallMs)}    throughput ${perf.linesPerSecond.toFixed(1)} lines/s`,
    perf.latency
      ? `  latency      min ${fmtMs(perf.latency.min)} · p50 ${fmtMs(perf.latency.p50)} · p95 ${fmtMs(perf.latency.p95)} · max ${fmtMs(perf.latency.max)}`
      : `  latency      n/a`,
    `  tokens       ${fmtInt(perf.inputTokens)} input · ${fmtInt(perf.outputTokens)} output · est. cost ${fmtUsd(perf.estimatedCostUsd)}`,
  );

  section("Results");
  out.push(
    `  analyzed ${counts.analyzed}/${counts.total} · ${p.red(`PII ${counts.pii}`)} · ${p.green(`clean ${counts.clean}`)} · ` +
      `${counts.errors ? p.yellow(`errors ${counts.errors}`) : "errors 0"} · review ${counts.review}`,
  );
  const cats = Object.entries(counts.byCategory).filter(([, v]) => v > 0);
  if (cats.length) out.push(`  categories   ${cats.map(([c, v]) => `${c} ${v}`).join(" · ")}`);

  if (accuracy) {
    const a = accuracy.atThreshold;
    section("Accuracy");
    out.push(
      `  evaluated ${accuracy.evaluated} labelled lines at threshold ${a.threshold.toFixed(2)}`,
      `  precision ${fmtRatio(a.precision)} · recall ${fmtRatio(a.recall)} · F1 ${fmtRatio(a.f1)} · accuracy ${fmtRatio(a.accuracy)}`,
      `  confusion    TP ${a.tp} · FP ${a.fp} · TN ${a.tn} · FN ${a.fn}`,
      "",
      `  threshold  precision  recall   F1     FP  FN`,
      ...accuracy.sweep.map(
        (s) =>
          `  ${s.threshold.toFixed(2).padEnd(9)}  ${fmtRatio(s.precision).padEnd(9)}  ${fmtRatio(s.recall).padEnd(7)}  ${fmtRatio(s.f1).padEnd(5)}  ${String(s.fp).padStart(2)}  ${String(s.fn).padStart(2)}` +
          (s.threshold === config.threshold ? p.dim("  ← run") : ""),
      ),
      "",
      `  category             labelled  detected  recall   (category noul ≥ threshold)`,
      ...accuracy.perCategory
        .filter((c) => c.labelled > 0)
        .map(
          (c) =>
            `  ${c.category.padEnd(19)}  ${String(c.labelled).padStart(8)}  ${String(c.detected).padStart(8)}  ${fmtRatio(c.recall)}`,
        ),
    );
  }

  const pii = flagged(report);
  section(`Lines with PII (${pii.length})`);
  if (pii.length === 0) out.push("  none");
  for (const r of pii) out.push(row(r, `${(r.categories ?? []).join(", ") || "-"}  `));

  if (accuracy) {
    const lines = byLine(report);
    section(`False positives (${accuracy.falsePositives.length})`);
    if (accuracy.falsePositives.length === 0) out.push("  none");
    for (const l of accuracy.falsePositives) out.push(row(lines.get(l)!, `${report.labels?.get(l)?.note ?? ""}  `));
    section(`False negatives (${accuracy.falseNegatives.length})`);
    if (accuracy.falseNegatives.length === 0) out.push("  none");
    for (const l of accuracy.falseNegatives) {
      out.push(row(lines.get(l)!, `expected ${report.labels?.get(l)?.categories.join(", ") ?? "?"}  `));
    }
  }

  const review = reviewItems(report);
  if (review.length) {
    section(`Review: primary and category answers disagree (${review.length})`);
    for (const r of review) out.push(row(r, `${r.isPii ? "PII, no category" : `clean, but ${r.categories?.join(", ")}`}  `));
  }

  const errs = errored(report);
  if (errs.length) {
    section(`Errors (${errs.length})`);
    for (const r of errs) out.push(`  ${n(r.line)}  ${p.yellow(r.error ?? "unknown error")}`);
  }

  out.push("");
  return out.join("\n");
}
