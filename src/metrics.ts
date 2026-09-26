import { PRICE_USD_PER_MTOK, SWEEP_THRESHOLDS } from "./config.js";
import { CATEGORIES, CATEGORY_QUESTION, type Category, type Label, type LineResult } from "./types.js";

export interface LatencyStats {
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export interface Performance {
  wallMs: number;
  linesPerSecond: number;
  latency: LatencyStats | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface Counts {
  total: number;
  analyzed: number;
  pii: number;
  clean: number;
  errors: number;
  review: number;
  byCategory: Record<Category, number>;
}

export interface Confusion {
  threshold: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  /** null when the denominator is 0 (shown as n/a). */
  precision: number | null;
  recall: number | null;
  f1: number | null;
  accuracy: number | null;
}

export interface CategoryRecall {
  category: Category;
  labelled: number;
  detected: number;
  recall: number | null;
}

export interface Accuracy {
  evaluated: number;
  atThreshold: Confusion;
  sweep: Confusion[];
  falsePositives: number[];
  falseNegatives: number[];
  perCategory: CategoryRecall[];
}

export interface RunMetrics {
  performance: Performance;
  counts: Counts;
  accuracy: Accuracy | null;
}

/** Nearest-rank percentile over an ascending-sorted array. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export function latencyStats(values: readonly number[]): LatencyStats | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return {
    min: s[0]!,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    max: s.at(-1)!,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
}

const ratio = (num: number, den: number) => (den === 0 ? null : num / den);

export function confusion(
  results: readonly LineResult[],
  labels: ReadonlyMap<number, Label>,
  threshold: number,
): Confusion {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const r of results) {
    const label = labels.get(r.line);
    if (r.status !== "ok" || !label || !r.probabilities) continue;
    const predicted = r.probabilities.contains_pii >= threshold;
    if (predicted && label.contains_pii) tp++;
    else if (predicted) fp++;
    else if (label.contains_pii) fn++;
    else tn++;
  }
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = precision === null || recall === null || precision + recall === 0 ? null : (2 * precision * recall) / (precision + recall);
  return { threshold, tp, fp, tn, fn, precision, recall, f1, accuracy: ratio(tp + tn, tp + fp + tn + fn) };
}

export function accuracy(results: readonly LineResult[], labels: ReadonlyMap<number, Label>, threshold: number): Accuracy {
  const scored = results.filter((r) => r.status === "ok" && r.probabilities && labels.has(r.line));
  const falsePositives: number[] = [];
  const falseNegatives: number[] = [];
  for (const r of scored) {
    const predicted = r.probabilities!.contains_pii >= threshold;
    const actual = labels.get(r.line)!.contains_pii;
    if (predicted && !actual) falsePositives.push(r.line);
    if (!predicted && actual) falseNegatives.push(r.line);
  }
  const sweepThresholds = [...new Set<number>([...SWEEP_THRESHOLDS, threshold])].sort((a, b) => a - b);
  const perCategory = CATEGORIES.map((category): CategoryRecall => {
    const withCategory = scored.filter((r) => labels.get(r.line)!.categories.includes(category));
    const detected = withCategory.filter((r) => r.probabilities![CATEGORY_QUESTION[category]] >= threshold).length;
    return { category, labelled: withCategory.length, detected, recall: ratio(detected, withCategory.length) };
  });
  return {
    evaluated: scored.length,
    atThreshold: confusion(results, labels, threshold),
    sweep: sweepThresholds.map((t) => confusion(results, labels, t)),
    falsePositives,
    falseNegatives,
    perCategory,
  };
}

export function counts(results: readonly LineResult[]): Counts {
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  let pii = 0, clean = 0, errors = 0, review = 0;
  for (const r of results) {
    if (r.status === "error") {
      errors++;
      continue;
    }
    if (r.isPii) pii++;
    else clean++;
    if (r.review) review++;
    if (r.isPii) for (const c of r.categories ?? []) byCategory[c]++;
  }
  return { total: results.length, analyzed: pii + clean, pii, clean, errors, review, byCategory };
}

export function performanceOf(results: readonly LineResult[], wallMs: number): Performance {
  const ok = results.filter((r) => r.status === "ok");
  const inputTokens = ok.reduce((a, r) => a + (r.usage?.input_tokens ?? 0), 0);
  const outputTokens = ok.reduce((a, r) => a + (r.usage?.output_tokens ?? 0), 0);
  return {
    wallMs,
    linesPerSecond: wallMs > 0 ? results.length / (wallMs / 1000) : 0,
    latency: latencyStats(ok.map((r) => r.latencyMs)),
    inputTokens,
    outputTokens,
    estimatedCostUsd: (inputTokens / 1e6) * PRICE_USD_PER_MTOK,
  };
}

export function summarize(
  results: readonly LineResult[],
  wallMs: number,
  labels: ReadonlyMap<number, Label> | null,
  threshold: number,
): RunMetrics {
  return {
    performance: performanceOf(results, wallMs),
    counts: counts(results),
    accuracy: labels ? accuracy(results, labels, threshold) : null,
  };
}
