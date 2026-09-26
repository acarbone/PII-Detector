import { describe, expect, it } from "vitest";
import { renderConsole } from "../src/report/console.js";
import { truncate } from "../src/report/format.js";
import { sampleReport } from "./helpers.js";

describe("console report (REQ-REP-01..04, REQ-REP-06)", () => {
  const plain = renderConsole(sampleReport(), { color: false, width: 120 });

  it("matches the reviewed layout", () => {
    expect(plain).toMatchSnapshot();
  });

  it("has all sections in order", () => {
    const order = ["Run", "Performance", "Results", "Accuracy", "Lines with PII", "False positives", "False negatives", "Review", "Errors"];
    const positions = order.map((s) => plain.indexOf(`══ ${s}`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("lists every flagged line with probability and categories", () => {
    expect(plain).toMatch(/#001 {2}0\.99 {2}person_name, email {2}GET \/newsletter/);
    expect(plain).toMatch(/#003 {2}0\.62 {2}postal_address/);
    expect(plain).toMatch(/#005 {2}0\.88 {2}- {2}\{"level"/);
  });

  it("reports performance, results and accuracy figures", () => {
    expect(plain).toContain("total time   2.35s");
    expect(plain).toContain("min 380ms · p50 540ms · p95 700ms · max 700ms");
    expect(plain).toContain("2,100 input · 225 output");
    expect(plain).toContain("analyzed 5/6 · PII 3 · clean 2 · errors 1 · review 2");
    expect(plain).toContain("precision 0.67 · recall 0.67 · F1 0.67 · accuracy 0.60");
    expect(plain).toContain("TP 2 · FP 1 · TN 1 · FN 1");
    expect(plain).toMatch(/0\.30 +0\.75 +1\.00 +0\.86/);
    expect(plain).toMatch(/person_name +2 +2 +1\.00/);
    expect(plain).toContain("model        jev-latest → jev-1.13.0");
  });

  it("truncates raw lines to the terminal width but not when width is unknown", () => {
    const narrow = renderConsole(sampleReport(), { color: false, width: 80 });
    for (const l of narrow.split("\n")) expect(l.length).toBeLessThanOrEqual(80);
    expect(narrow).toContain("…");
    const full = renderConsole(sampleReport(), { color: false, width: null });
    expect(full).toContain(`"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6)"`);
  });

  it("uses ANSI colors only when enabled", () => {
    expect(plain).not.toContain("\x1b[");
    expect(renderConsole(sampleReport(), { color: true, width: 120 })).toContain("\x1b[");
  });

  it("omits accuracy sections when evaluation is off", () => {
    const out = renderConsole(sampleReport({ evaluate: false, labels: null }), { color: false, width: 120 });
    expect(out).not.toContain("══ Accuracy");
    expect(out).not.toContain("False negatives");
    expect(out).toContain("(evaluation off)");
  });
});

describe("truncate", () => {
  it.each([
    ["abcdef", 10, "abcdef"],
    ["abcdef", 4, "abc…"],
    ["abcdef", null, "abcdef"],
  ] as const)("%s/%s", (s, max, out) => expect(truncate(s, max)).toBe(out));
});
