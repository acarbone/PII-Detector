import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConfigError,
  DEFAULT_CONCURRENCY,
  DEFAULT_INPUT,
  DEFAULT_MODEL,
  DEFAULT_THRESHOLD,
  labelsPathFor,
  parseConfig,
} from "../src/config.js";

describe("parseConfig (REQ-CLI-01..03)", () => {
  it("defaults to the fixture and its labels", () => {
    const c = parseConfig([])!;
    expect(c.input).toBe(DEFAULT_INPUT);
    expect(c.labels).toBe(labelsPathFor(DEFAULT_INPUT));
    expect(c).toMatchObject({
      threshold: DEFAULT_THRESHOLD,
      concurrency: DEFAULT_CONCURRENCY,
      model: DEFAULT_MODEL,
      limit: null,
      evaluate: true,
      jsonPath: null,
      mdPath: null,
    });
  });

  it("never stores the API key in the config", () => {
    expect(Object.keys(parseConfig([])!)).not.toContain("apiKey");
  });

  it("parses all flags", () => {
    const c = parseConfig([
      "--threshold", "0.7", "--concurrency", "16", "--model", "jev-1.13.0", "--limit", "10",
      "--json", "r.json", "--md", "r.md", "--no-color",
    ])!;
    expect(c).toMatchObject({ threshold: 0.7, concurrency: 16, model: "jev-1.13.0", limit: 10, jsonPath: "r.json", mdPath: "r.md", color: false });
  });

  it("returns null for --help", () => {
    expect(parseConfig(["--help"])).toBeNull();
    expect(parseConfig(["-h"])).toBeNull();
  });

  it("--no-eval disables evaluation and labels", () => {
    const c = parseConfig(["--no-eval"])!;
    expect(c.evaluate).toBe(false);
    expect(c.labels).toBeNull();
  });

  it("disables evaluation for an input without a labels file", () => {
    const dir = mkdtempSync(join(tmpdir(), "pii-cfg-"));
    const input = join(dir, "other.log");
    writeFileSync(input, "hello\n");
    const c = parseConfig(["--input", input])!;
    expect(c.labels).toBeNull();
    expect(c.evaluate).toBe(false);
  });

  it.each([
    [["--threshold", "1.5"], /between 0 and 1/],
    [["--threshold=-0.1"], /between 0 and 1/],
    [["--threshold", "abc"], /must be a number/],
    [["--concurrency", "0"], /integer >= 1/],
    [["--concurrency", "2.5"], /integer >= 1/],
    [["--limit", "0"], /integer >= 1/],
    [["--input", "/no/such/file.log"], /Input file not found/],
    [["--labels", "/no/such/labels.json"], /Labels file not found/],
    [["--bogus"], /Unknown option/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseConfig(argv as string[])).toThrow(ConfigError);
    expect(() => parseConfig(argv as string[])).toThrow(message);
  });

  it("maps foo.log to foo.labels.json", () => {
    expect(labelsPathFor("/a/web-logs.log")).toBe("/a/web-logs.labels.json");
    expect(labelsPathFor("/a/noext")).toBe("/a/noext.labels.json");
  });
});
