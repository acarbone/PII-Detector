import type { RunMetrics } from "../metrics.js";
import type { Label, LineResult, RunConfig } from "../types.js";

/** Everything a report renderer needs; built once in cli.ts. */
export interface Report {
  generatedAt: string;
  config: RunConfig;
  /** Versioned model ids that actually answered (REQ-DET-08). */
  modelsAnswered: string[];
  results: LineResult[];
  metrics: RunMetrics;
  labels: ReadonlyMap<number, Label> | null;
}

export const modelsAnswered = (results: readonly LineResult[]) =>
  [...new Set(results.flatMap((r) => (r.model ? [r.model] : [])))].sort();

export const flagged = (r: Report) => r.results.filter((x) => x.status === "ok" && x.isPii);
export const reviewItems = (r: Report) => r.results.filter((x) => x.status === "ok" && x.review);
export const errored = (r: Report) => r.results.filter((x) => x.status === "error");
export const byLine = (r: Report) => new Map(r.results.map((x) => [x.line, x]));
