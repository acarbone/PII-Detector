import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT, main } from "../src/cli.js";
import { MISSING_KEY_MESSAGE } from "../src/config.js";
import type { Label } from "../src/types.js";
import { fakeFetch, TEST_KEY, type Probs } from "./helpers.js";

const fixture = (name: string) => new URL(`../fixtures/${name}`, import.meta.url).pathname;
const logLines = readFileSync(fixture("web-logs.log"), "utf8").split("\n").filter(Boolean);
const labels = JSON.parse(readFileSync(fixture("web-logs.labels.json"), "utf8")) as Label[];
const truth = new Map(logLines.map((text, i) => [text, labels[i]!]));

/** A perfect fake model: answers from the ground truth. */
const oracle = (text: string): Probs => {
  const l = truth.get(text)!;
  return l.contains_pii
    ? { contains_pii: 0.97, ...Object.fromEntries(l.categories.map((c) => [`has_${c}`, 0.9])) }
    : { contains_pii: 0.03 };
};

const sink = (isTTY = false) => {
  const chunks: string[] = [];
  return { chunks, text: () => chunks.join(""), isTTY, columns: 100, write: (c: string) => chunks.push(c) };
};

const run = async (argv: string[], opts: { env?: NodeJS.ProcessEnv; respond?: Parameters<typeof fakeFetch>[0] } = {}) => {
  const stdout = sink();
  const stderr = sink();
  const { fetch, calls } = fakeFetch(opts.respond ?? oracle);
  const code = await main(argv, {
    stdout,
    stderr,
    env: opts.env ?? { TYPESAFE_API_KEY: TEST_KEY },
    envPath: null,
    fetch,
    retry: { maxRetries: 0 },
  });
  return { code, out: stdout.text(), err: stderr.text(), calls };
};

describe("cli (REQ-CLI-01..03, REQ-REP-07)", () => {
  it("prints help", async () => {
    const r = await run(["--help"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("Usage: npm run detect");
    expect(r.calls).toHaveLength(0);
  });

  it("exits 1 with the .env.dist hint when the key is missing", async () => {
    const r = await run([], { env: {} });
    expect(r.code).toBe(EXIT.fatal);
    expect(r.err).toContain(MISSING_KEY_MESSAGE);
    expect(r.calls).toHaveLength(0);
  });

  it("exits 1 on invalid flags", async () => {
    const r = await run(["--threshold", "2"]);
    expect(r.code).toBe(EXIT.fatal);
    expect(r.err).toMatch(/between 0 and 1[\s\S]*--help/);
  });

  it("analyzes the whole fixture with defaults and no arguments", async () => {
    const r = await run([]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.calls).toHaveLength(120);
    expect(r.err).toContain("Analyzing 120 log lines with jev-latest (concurrency 8, threshold 0.50)");
    expect(r.err).toMatch(/120\/120 100% .* PII 48 \| errors 0/);
    // stdout carries only the report (REQ-PRG-03)
    expect(r.out).not.toMatch(/lines\/s \| ETA/);
    expect(r.out).toContain("analyzed 120/120 · PII 48 · clean 72 · errors 0");
    expect(r.out).toContain("precision 1.00 · recall 1.00 · F1 1.00 · accuracy 1.00");
    expect(r.out).toContain("══ Lines with PII (48) ══");
    expect(r.out).not.toContain(TEST_KEY);
    expect(r.err).not.toContain(TEST_KEY);
  });

  it("honours --limit, --no-eval, --model and --concurrency", async () => {
    const r = await run(["--limit", "5", "--no-eval", "--model", "jev-1.13.0", "--concurrency", "2"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.calls).toHaveLength(5);
    expect(r.calls.every((c) => c.body.model === "jev-1.13.0")).toBe(true);
    expect(r.out).not.toContain("══ Accuracy");
  });

  it("writes JSON and Markdown reports", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pii-cli-"));
    const json = join(dir, "reports", "run.json");
    const md = join(dir, "reports", "run.md");
    const r = await run(["--limit", "10", "--json", json, "--md", md]);
    expect(r.code).toBe(EXIT.ok);
    expect(existsSync(json) && existsSync(md)).toBe(true);
    expect(JSON.parse(readFileSync(json, "utf8")).results).toHaveLength(10);
    expect(readFileSync(json, "utf8")).not.toContain(TEST_KEY);
    expect(r.err).toContain(`JSON report written to ${json}`);
  });

  it("exits 2 when some lines errored, and still reports the rest", async () => {
    let n = 0;
    const r = await run(["--limit", "10"], { respond: (t) => (++n % 5 === 0 ? { status: 500 } : oracle(t)) });
    expect(r.code).toBe(EXIT.lineErrors);
    expect(r.out).toContain("errors 2");
    expect(r.out).toContain("══ Errors (2) ══");
  });

  it("exits 1 on an authentication error", async () => {
    const r = await run(["--limit", "10"], { respond: () => ({ status: 401, body: { detail: "invalid api key" } }) });
    expect(r.code).toBe(EXIT.fatal);
    expect(r.err).toMatch(/Error: AuthenticationError/);
  });
});
