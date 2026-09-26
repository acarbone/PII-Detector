import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toJson, writeJson, type JsonReport } from "../src/report/json.js";
import { renderMarkdown, writeMarkdown } from "../src/report/markdown.js";
import { QUESTIONS } from "../src/questions.js";
import { sampleReport, TEST_KEY } from "./helpers.js";

const dir = () => mkdtempSync(join(tmpdir(), "pii-rep-"));

describe("JSON report (REQ-REP-05)", () => {
  it("writes every per-line result with all probabilities, latency and status", async () => {
    const path = join(dir(), "nested", "run.json");
    await writeJson(sampleReport(), path);
    const json = JSON.parse(readFileSync(path, "utf8")) as JsonReport;
    expect(json.results).toHaveLength(6);
    expect(json.models_answered).toEqual(["jev-1.13.0"]);
    expect(json.config.threshold).toBe(0.5);
    expect(json.metrics.performance.wallMs).toBe(2345);
    for (const r of json.results) {
      expect(["ok", "error"]).toContain(r.status);
      expect(typeof r.latencyMs).toBe("number");
      if (r.status === "ok") expect(Object.keys(r.probabilities!)).toEqual(Object.keys(QUESTIONS));
    }
    expect(json.results[0]!.expected).toEqual({ contains_pii: true, categories: ["email", "person_name"] });
  });

  it("never contains an API key", () => {
    expect(JSON.stringify(toJson(sampleReport()))).not.toMatch(/apiKey|TYPESAFE_API_KEY|Bearer/);
    expect(JSON.stringify(toJson(sampleReport()))).not.toContain(TEST_KEY);
  });
});

describe("Markdown report (REQ-REP-05)", () => {
  it("contains the console sections with full raw lines", async () => {
    const path = join(dir(), "run.md");
    await writeMarkdown(sampleReport(), path);
    const md = readFileSync(path, "utf8");
    for (const h of ["## Run", "## Performance", "## Results", "## Accuracy", "### Threshold sweep", "## Lines with PII (3)", "## False positives (1)", "## False negatives (1)", "## Errors (1)"]) {
      expect(md).toContain(h);
    }
    expect(md).toContain(`"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6)"`);
    expect(md).toContain("| 0.50 (run) | 0.67 | 0.67 | 0.67 | 1 | 1 |");
  });

  it("matches the reviewed layout", () => {
    expect(renderMarkdown(sampleReport())).toMatchSnapshot();
  });

  it("escapes pipes and backticks in log lines", () => {
    const r = sampleReport();
    r.results[0] = { ...r.results[0]!, text: "a | b `c`" };
    expect(renderMarkdown(r)).toContain("`` a \\| b `c` ``");
  });
});
