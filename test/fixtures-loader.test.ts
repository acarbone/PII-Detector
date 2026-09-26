import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLabels, loadLogLines } from "../src/fixtures.js";

const tmp = (name: string, content: string) => {
  const path = join(mkdtempSync(join(tmpdir(), "pii-fx-")), name);
  writeFileSync(path, content);
  return path;
};

describe("loadLogLines (REQ-CLI-01)", () => {
  const file = tmp("a.log", "first\n\n  \nsecond\r\nthird\n");

  it("numbers lines 1-based by file position and skips blanks", async () => {
    expect(await loadLogLines(file)).toEqual([
      { line: 1, text: "first" },
      { line: 4, text: "second" },
      { line: 5, text: "third" },
    ]);
  });

  it("honours --limit", async () => {
    expect((await loadLogLines(file, 2)).map((l) => l.line)).toEqual([1, 4]);
  });
});

describe("loadLabels (REQ-FIX-07)", () => {
  it("indexes labels by line number", async () => {
    const path = tmp("l.json", JSON.stringify([{ line: 2, contains_pii: true, categories: ["email"], note: "" }]));
    const labels = await loadLabels(path);
    expect(labels.get(2)?.categories).toEqual(["email"]);
  });

  it.each([
    ["{}", /JSON array/],
    [JSON.stringify([{ line: 1, contains_pii: "yes", categories: [] }]), /Invalid label/],
    [JSON.stringify([{ line: 1, contains_pii: true, categories: ["shoe_size"] }]), /Unknown category/],
    [JSON.stringify([{ line: 1, contains_pii: false, categories: [] }, { line: 1, contains_pii: false, categories: [] }]), /Duplicate/],
  ])("rejects malformed labels %s", async (content, message) => {
    await expect(loadLabels(tmp("bad.json", content))).rejects.toThrow(message);
  });

  it("loads the real fixture labels", async () => {
    const labels = await loadLabels(new URL("../fixtures/web-logs.labels.json", import.meta.url).pathname);
    expect(labels.size).toBe(120);
  });
});
