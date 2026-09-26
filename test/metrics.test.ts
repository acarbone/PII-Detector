import { describe, expect, it } from "vitest";
import { classify } from "../src/detector.js";
import { accuracy, confusion, counts, latencyStats, percentile, performanceOf, summarize } from "../src/metrics.js";
import type { Category, Label, LineResult } from "../src/types.js";
import { probs, type Probs } from "./helpers.js";

const ok = (line: number, p: Probs, latencyMs = 100, threshold = 0.5): LineResult => {
  const probabilities = probs(p);
  return {
    line,
    text: `line ${line}`,
    status: "ok",
    probabilities,
    ...classify(probabilities, threshold),
    latencyMs,
    usage: { input_tokens: 1000, output_tokens: 50 },
    model: "jev-1.13.0",
  };
};
const err = (line: number): LineResult => ({ line, text: `line ${line}`, status: "error", latencyMs: 5, error: "boom" });
const label = (line: number, categories: Category[] = []): Label => ({ line, contains_pii: categories.length > 0, categories, note: "" });
const labelMap = (...ls: Label[]) => new Map(ls.map((l) => [l.line, l]));

describe("percentiles (REQ-REP-01)", () => {
  it("uses nearest rank", () => {
    const s = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(s, 50)).toBe(10);
    expect(percentile(s, 95)).toBe(19);
    expect(percentile(s, 100)).toBe(20);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNaN();
  });

  it("computes latency stats and returns null without data", () => {
    expect(latencyStats([300, 100, 200])).toEqual({ min: 100, p50: 200, p95: 300, max: 300, mean: 200 });
    expect(latencyStats([])).toBeNull();
  });
});

describe("performance (REQ-REP-01)", () => {
  it("sums tokens of ok lines, estimates cost and throughput", () => {
    const p = performanceOf([ok(1, {}), ok(2, {}), err(3)], 1500);
    expect(p.inputTokens).toBe(2000);
    expect(p.outputTokens).toBe(100);
    expect(p.estimatedCostUsd).toBeCloseTo((2000 / 1e6) * 0.042, 12);
    expect(p.linesPerSecond).toBeCloseTo(2);
    expect(p.latency?.max).toBe(100);
  });

  it("handles zero wall time", () => {
    expect(performanceOf([], 0).linesPerSecond).toBe(0);
  });
});

describe("counts (REQ-REP-02)", () => {
  it("counts PII, clean, errors, review and categories of flagged lines", () => {
    const c = counts([
      ok(1, { contains_pii: 0.9, has_email: 0.9, has_person_name: 0.8 }),
      ok(2, { contains_pii: 0.9 }),
      ok(3, { contains_pii: 0.1, has_phone: 0.7 }),
      err(4),
    ]);
    expect(c).toMatchObject({ total: 4, analyzed: 3, pii: 2, clean: 1, errors: 1, review: 2 });
    expect(c.byCategory.email).toBe(1);
    expect(c.byCategory.person_name).toBe(1);
    expect(c.byCategory.phone).toBe(0); // line 3 not flagged
  });
});

describe("confusion and accuracy (REQ-REP-04, REQ-REP-08)", () => {
  const results = [
    ok(1, { contains_pii: 0.95, has_email: 0.9 }), // TP
    ok(2, { contains_pii: 0.6 }), // FP at 0.5, TN at 0.7
    ok(3, { contains_pii: 0.4, has_phone: 0.2 }), // FN at 0.5, TP at 0.3
    ok(4, { contains_pii: 0.05 }), // TN
    err(5), // excluded
    ok(6, { contains_pii: 0.9 }), // unlabelled -> excluded
  ];
  const labels = labelMap(label(1, ["email"]), label(2), label(3, ["phone"]), label(4), label(5, ["email"]));

  it("computes the confusion matrix and ratios", () => {
    expect(confusion(results, labels, 0.5)).toEqual({
      threshold: 0.5, tp: 1, fp: 1, tn: 1, fn: 1, precision: 0.5, recall: 0.5, f1: 0.5, accuracy: 0.5,
    });
  });

  it("returns null ratios for zero denominators", () => {
    const c = confusion([ok(4, { contains_pii: 0.05 })], labels, 0.5);
    expect(c).toMatchObject({ tp: 0, fp: 0, tn: 1, fn: 0, precision: null, recall: null, f1: null, accuracy: 1 });
    expect(confusion([], labels, 0.5).accuracy).toBeNull();
  });

  it("sweeps 0.3/0.5/0.7 plus the run threshold and lists FP/FN", () => {
    const a = accuracy(results, labels, 0.6);
    expect(a.evaluated).toBe(4);
    expect(a.sweep.map((s) => s.threshold)).toEqual([0.3, 0.5, 0.6, 0.7]);
    expect(a.sweep[0]).toMatchObject({ tp: 2, fp: 1, fn: 0 });
    expect(a.sweep[3]).toMatchObject({ tp: 1, fp: 0, fn: 1 });
    expect(a.falsePositives).toEqual([2]);
    expect(a.falseNegatives).toEqual([3]);
    expect(accuracy(results, labels, 0.5).sweep).toHaveLength(3);
  });

  it("computes per-category recall on labelled lines", () => {
    const a = accuracy(results, labels, 0.5);
    const email = a.perCategory.find((c) => c.category === "email")!;
    const phone = a.perCategory.find((c) => c.category === "phone")!;
    const dob = a.perCategory.find((c) => c.category === "date_of_birth")!;
    expect(email).toEqual({ category: "email", labelled: 1, detected: 1, recall: 1 });
    expect(phone).toEqual({ category: "phone", labelled: 1, detected: 0, recall: 0 });
    expect(dob.recall).toBeNull();
  });

  it("summarize omits accuracy without labels", () => {
    expect(summarize(results, 1000, null, 0.5).accuracy).toBeNull();
    expect(summarize(results, 1000, labels, 0.5).accuracy).not.toBeNull();
  });
});
