import { describe, expect, it } from "vitest";
import { runPool } from "../src/pool.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runPool (REQ-DET-06)", () => {
  it("never exceeds the concurrency limit and returns results in input order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const done: number[] = [];
    const items = Array.from({ length: 25 }, (_, i) => i);
    const results = await runPool(
      items,
      4,
      async (n) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep((n * 7) % 11);
        inFlight--;
        return n * 2;
      },
      (_, i) => done.push(i),
    );
    expect(maxInFlight).toBe(4);
    expect(results).toEqual(items.map((n) => n * 2));
    expect(done.sort((a, b) => a - b)).toEqual(items);
  });

  it("handles fewer items than workers and empty input", async () => {
    expect(await runPool([1, 2], 8, async (n) => n)).toEqual([1, 2]);
    expect(await runPool([], 8, async (n) => n)).toEqual([]);
  });

  it("stops starting new work and rethrows the first error", async () => {
    let started = 0;
    const p = runPool(Array.from({ length: 50 }, (_, i) => i), 2, async (n) => {
      started++;
      await sleep(1);
      if (n === 3) throw new Error("boom");
      return n;
    });
    await expect(p).rejects.toThrow("boom");
    expect(started).toBeLessThan(10);
  });

  it("rejects an invalid concurrency", async () => {
    await expect(runPool([1], 0, async (n) => n)).rejects.toThrow(RangeError);
  });
});
