import { describe, expect, it } from "vitest";
import { formatDuration, Progress } from "../src/progress.js";

const stream = (isTTY: boolean) => {
  const chunks: string[] = [];
  return { chunks, isTTY, columns: 200, write: (c: string) => chunks.push(c) };
};

describe("Progress (REQ-PRG-01..03)", () => {
  it("prints a line at each 10% milestone when not a TTY", () => {
    const s = stream(false);
    let t = 0;
    const p = new Progress({ total: 20, stream: s, now: () => t });
    for (let i = 0; i < 20; i++) {
      t += 100;
      p.tick({ status: i === 5 ? "error" : "ok", isPii: i % 4 === 0 });
    }
    p.finish();
    expect(s.chunks).toHaveLength(10);
    expect(s.chunks.every((c) => c.endsWith("\n") && !c.includes("\r"))).toBe(true);
    expect(s.chunks[0]).toMatch(/^ 2\/20 {2}10% \| 10\.0 lines\/s \| ETA 2s \| PII 1 \| errors 0\n$/);
    expect(s.chunks.at(-1)).toMatch(/20\/20 100% .* ETA 0s \| PII 5 \| errors 1/);
  });

  it("redraws a bar in place on a TTY, throttled, and ends with a newline", () => {
    const s = stream(true);
    let t = 0;
    const p = new Progress({ total: 10, stream: s, now: () => t, throttleMs: 100 });
    for (let i = 0; i < 10; i++) {
      t += 30;
      p.tick({ status: "ok", isPii: true });
    }
    p.finish();
    const draws = s.chunks.filter((c) => c.startsWith("\r"));
    // initial draw + throttled draws + the final 10/10 draw + finish redraw
    expect(draws.length).toBeLessThan(10);
    expect(draws.at(-1)).toMatch(/\[█{30}\] 10\/10 100% .* PII 10 \| errors 0/);
    expect(s.chunks.at(-1)).toBe("\n");
  });

  it("truncates the TTY line to the terminal width", () => {
    const s = { ...stream(true), columns: 40 };
    new Progress({ total: 5, stream: s }).finish();
    const drawn = s.chunks[0]!.replace("\r", "").replace("\x1b[K", "");
    expect(drawn.length).toBeLessThanOrEqual(39);
  });

  it("writes to stderr by default", () => {
    const p = new Progress({ total: 1 });
    expect((p as unknown as { stream: unknown }).stream).toBe(process.stderr);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0s"],
    [4_400, "4s"],
    [65_000, "1m05s"],
    [3_720_000, "1h02m"],
    [Infinity, "--"],
  ])("%d ms -> %s", (ms, out) => expect(formatDuration(ms)).toBe(out));
});
