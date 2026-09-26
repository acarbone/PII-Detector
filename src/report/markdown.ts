import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LineResult } from "../types.js";
import { fmtInt, fmtMs, fmtProb, fmtRatio, fmtUsd } from "./format.js";
import { byLine, errored, flagged, reviewItems, type Report } from "./model.js";

/** Inline code span that survives backticks and table pipes. */
const code = (s: string) => {
  const escaped = s.replace(/\|/g, "\\|");
  return escaped.includes("`") ? `\`\` ${escaped} \`\`` : `\`${escaped}\``;
};
const cell = (s: string) => s.replace(/\|/g, "\\|");

/** Markdown version of the console report, with raw lines in full (REQ-REP-05). */
export function renderMarkdown(report: Report): string {
  const { config, metrics } = report;
  const { performance: perf, counts, accuracy } = metrics;
  const out: string[] = [];
  const lineTable = (rows: LineResult[], extraHeader: string, extra: (r: LineResult) => string) => {
    if (rows.length === 0) return out.push("None.", "");
    out.push(`| Line | P(PII) | ${extraHeader} | Log line |`, "|---:|---:|---|---|");
    for (const r of rows) out.push(`| ${r.line} | ${fmtProb(r.probabilities?.contains_pii)} | ${cell(extra(r))} | ${code(r.text)} |`);
    out.push("");
  };

  out.push("# PII detection report", "");
  out.push("## Run", "", "| | |", "|---|---|");
  out.push(
    `| Input | ${code(config.input)} |`,
    `| Labels | ${config.evaluate && config.labels ? code(config.labels) : "evaluation off"} |`,
    `| Model | ${code(config.model)} → ${report.modelsAnswered.map(code).join(", ") || "n/a"} |`,
    `| Threshold | ${config.threshold.toFixed(2)} |`,
    `| Concurrency | ${config.concurrency} |`,
    ...(config.limit ? [`| Limit | ${config.limit} |`] : []),
    `| Generated | ${report.generatedAt} |`,
    "",
  );

  out.push("## Performance", "", "| Metric | Value |", "|---|---|");
  out.push(
    `| Total execution time | ${fmtMs(perf.wallMs)} |`,
    `| Throughput | ${perf.linesPerSecond.toFixed(1)} lines/s |`,
    ...(perf.latency
      ? [
          `| Latency min / p50 / p95 / max | ${fmtMs(perf.latency.min)} / ${fmtMs(perf.latency.p50)} / ${fmtMs(perf.latency.p95)} / ${fmtMs(perf.latency.max)} |`,
        ]
      : ["| Latency | n/a |"]),
    `| Tokens (input / output) | ${fmtInt(perf.inputTokens)} / ${fmtInt(perf.outputTokens)} |`,
    `| Estimated cost | ${fmtUsd(perf.estimatedCostUsd)} |`,
    "",
  );

  out.push("## Results", "", "| Analyzed | PII | Clean | Errors | Review |", "|---:|---:|---:|---:|---:|");
  out.push(`| ${counts.analyzed}/${counts.total} | ${counts.pii} | ${counts.clean} | ${counts.errors} | ${counts.review} |`, "");
  const cats = Object.entries(counts.byCategory).filter(([, v]) => v > 0);
  if (cats.length) {
    out.push("| Category (flagged lines) | Lines |", "|---|---:|", ...cats.map(([c, v]) => `| ${c} | ${v} |`), "");
  }

  if (accuracy) {
    const a = accuracy.atThreshold;
    out.push("## Accuracy", "", `Evaluated ${accuracy.evaluated} labelled lines at threshold ${a.threshold.toFixed(2)}.`, "");
    out.push(
      "| Precision | Recall | F1 | Accuracy | TP | FP | TN | FN |",
      "|---:|---:|---:|---:|---:|---:|---:|---:|",
      `| ${fmtRatio(a.precision)} | ${fmtRatio(a.recall)} | ${fmtRatio(a.f1)} | ${fmtRatio(a.accuracy)} | ${a.tp} | ${a.fp} | ${a.tn} | ${a.fn} |`,
      "",
      "### Threshold sweep",
      "",
      "| Threshold | Precision | Recall | F1 | FP | FN |",
      "|---:|---:|---:|---:|---:|---:|",
      ...accuracy.sweep.map(
        (s) =>
          `| ${s.threshold.toFixed(2)}${s.threshold === config.threshold ? " (run)" : ""} | ${fmtRatio(s.precision)} | ${fmtRatio(s.recall)} | ${fmtRatio(s.f1)} | ${s.fp} | ${s.fn} |`,
      ),
      "",
      "### Per-category recall",
      "",
      "| Category | Labelled | Detected | Recall |",
      "|---|---:|---:|---:|",
      ...accuracy.perCategory
        .filter((c) => c.labelled > 0)
        .map((c) => `| ${c.category} | ${c.labelled} | ${c.detected} | ${fmtRatio(c.recall)} |`),
      "",
    );
  }

  const pii = flagged(report);
  out.push(`## Lines with PII (${pii.length})`, "");
  lineTable(pii, "Categories", (r) => (r.categories ?? []).join(", ") || "-");

  if (accuracy) {
    const lines = byLine(report);
    out.push(`## False positives (${accuracy.falsePositives.length})`, "");
    lineTable(accuracy.falsePositives.map((l) => lines.get(l)!), "Label note", (r) => report.labels?.get(r.line)?.note ?? "");
    out.push(`## False negatives (${accuracy.falseNegatives.length})`, "");
    lineTable(accuracy.falseNegatives.map((l) => lines.get(l)!), "Expected categories", (r) =>
      report.labels?.get(r.line)?.categories.join(", ") ?? "",
    );
  }

  const review = reviewItems(report);
  if (review.length) {
    out.push(`## Review: primary and category answers disagree (${review.length})`, "");
    lineTable(review, "Disagreement", (r) => (r.isPii ? "PII, no category" : `clean, but ${r.categories?.join(", ")}`));
  }

  const errs = errored(report);
  if (errs.length) {
    out.push(`## Errors (${errs.length})`, "", "| Line | Error |", "|---:|---|");
    for (const r of errs) out.push(`| ${r.line} | ${cell(r.error ?? "unknown error")} |`);
    out.push("");
  }
  return out.join("\n");
}

export async function writeMarkdown(report: Report, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderMarkdown(report));
}
