import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildFixture } from "../scripts/generate-fixtures.js";
import { CATEGORIES, type Label } from "../src/types.js";

const read = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const lines = read("web-logs.log").split("\n").filter((l) => l.trim() !== "");
const labels = JSON.parse(read("web-logs.labels.json")) as Label[];

describe("fixture: web-logs", () => {
  it("has at least 100 log lines (REQ-FIX-01)", () => {
    expect(lines.length).toBeGreaterThanOrEqual(100);
  });

  it("has exactly one label per line, numbered 1..N (REQ-FIX-07)", () => {
    expect(labels.map((l) => l.line)).toEqual(lines.map((_, i) => i + 1));
  });

  it("uses only known categories, consistent with contains_pii", () => {
    for (const l of labels) {
      for (const c of l.categories) expect(CATEGORIES).toContain(c);
      expect(l.contains_pii).toBe(l.categories.length > 0);
      if (l.hard_negative) expect(l.contains_pii).toBe(false);
    }
  });

  it("has 30–50% PII lines (REQ-FIX-03)", () => {
    const ratio = labels.filter((l) => l.contains_pii).length / labels.length;
    expect(ratio).toBeGreaterThanOrEqual(0.3);
    expect(ratio).toBeLessThanOrEqual(0.5);
  });

  it("covers every PII category at least 3 times (REQ-FIX-03)", () => {
    for (const c of CATEGORIES) {
      const n = labels.filter((l) => l.categories.includes(c)).length;
      expect(n, c).toBeGreaterThanOrEqual(3);
    }
  });

  it("has lines with more than one PII category (REQ-FIX-04)", () => {
    expect(labels.filter((l) => l.categories.length > 1).length).toBeGreaterThanOrEqual(10);
  });

  it("has at least 15 hard negatives (REQ-FIX-05)", () => {
    expect(labels.filter((l) => l.hard_negative).length).toBeGreaterThanOrEqual(15);
  });

  it("mixes at least 6 log formats (REQ-FIX-02)", () => {
    const kinds = new Set<string>();
    for (const line of lines) {
      if (/^\S+ - - \[/.test(line)) kinds.add("access");
      else if (line.startsWith("{")) kinds.add(`json:${(JSON.parse(line) as { svc: string }).svc}`);
      else kinds.add("text");
    }
    expect(kinds.has("access")).toBe(true);
    expect(kinds.has("text")).toBe(true);
    for (const svc of ["auth", "checkout", "payments", "search", "forms"]) expect(kinds).toContain(`json:${svc}`);
  });

  it("uses only reserved email domains and anonymized IPs (REQ-FIX-06, design §4)", () => {
    const emailRe = /[\w.+-]+(?:@|%40)([\w-]+(?:\.[\w-]+)+)/g;
    for (const line of lines) {
      for (const m of line.matchAll(emailRe)) {
        expect(m[1], line).toMatch(/(^|\.)(example\.(com|org|net)|shop\.example)$/);
      }
      const ip = /^(\d+\.\d+\.\d+\.\d+) - - /.exec(line)?.[1];
      if (ip) expect(ip.endsWith(".0"), line).toBe(true);
    }
  });

  it("matches the deterministic generator output", () => {
    const built = buildFixture();
    expect(built.lines).toEqual(lines);
    expect(built.labels).toEqual(labels);
  });
});
