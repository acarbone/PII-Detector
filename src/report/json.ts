import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunMetrics } from "../metrics.js";
import type { Category, LineResult, RunConfig } from "../types.js";
import type { Report } from "./model.js";

export interface JsonLineResult extends LineResult {
  /** Ground truth, when labels were used. */
  expected?: { contains_pii: boolean; categories: Category[] };
}

export interface JsonReport {
  generated_at: string;
  config: RunConfig;
  models_answered: string[];
  metrics: RunMetrics;
  results: JsonLineResult[];
}

/** Machine-readable report with every per-line result (REQ-REP-05). Contains no API key. */
export function toJson(report: Report): JsonReport {
  return {
    generated_at: report.generatedAt,
    config: report.config,
    models_answered: report.modelsAnswered,
    metrics: report.metrics,
    results: report.results.map((r) => {
      const label = report.labels?.get(r.line);
      return label ? { ...r, expected: { contains_pii: label.contains_pii, categories: label.categories } } : r;
    }),
  };
}

export async function writeJson(report: Report, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(toJson(report), null, 2) + "\n");
}
