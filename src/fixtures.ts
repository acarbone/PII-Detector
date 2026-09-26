import { readFile } from "node:fs/promises";
import { CATEGORIES, type Label, type LogLine } from "./types.js";

/**
 * Reads a log file into numbered lines. Line numbers are 1-based positions in
 * the file, so they still match the labels when blank lines are skipped.
 */
export async function loadLogLines(path: string, limit: number | null = null): Promise<LogLine[]> {
  const raw = await readFile(path, "utf8");
  const lines: LogLine[] = [];
  for (const [i, text] of raw.split(/\r?\n/).entries()) {
    if (text.trim() === "") continue;
    lines.push({ line: i + 1, text });
    if (limit !== null && lines.length >= limit) break;
  }
  return lines;
}

/** Reads ground-truth labels keyed by line number (REQ-FIX-07). */
export async function loadLabels(path: string): Promise<Map<number, Label>> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`Labels file ${path} must contain a JSON array.`);
  const labels = new Map<number, Label>();
  for (const item of parsed as Label[]) {
    if (!Number.isInteger(item?.line) || typeof item.contains_pii !== "boolean" || !Array.isArray(item.categories)) {
      throw new Error(`Invalid label in ${path}: ${JSON.stringify(item)}`);
    }
    for (const c of item.categories) {
      if (!(CATEGORIES as readonly string[]).includes(c)) throw new Error(`Unknown category "${c}" in ${path}, line ${item.line}.`);
    }
    if (labels.has(item.line)) throw new Error(`Duplicate label for line ${item.line} in ${path}.`);
    labels.set(item.line, item);
  }
  return labels;
}
