import { describe, expect, it } from "vitest";
import { classify, createClient, createDetector, FatalApiError } from "../src/detector.js";
import { QUESTIONS } from "../src/questions.js";
import { fakeFetch, probs, TEST_KEY } from "./helpers.js";

const setup = (respond: Parameters<typeof fakeFetch>[0], threshold = 0.5) => {
  const { fetch, calls } = fakeFetch(respond);
  const client = createClient({ apiKey: TEST_KEY, model: "jev-latest", fetch, retry: { maxRetries: 0 } });
  return { analyze: createDetector({ client, model: "jev-latest", threshold, apiKey: TEST_KEY }), calls };
};

describe("classify (REQ-DET-04, D3)", () => {
  it("flags at or above the threshold", () => {
    expect(classify(probs({ contains_pii: 0.5 }), 0.5).isPii).toBe(true);
    expect(classify(probs({ contains_pii: 0.49 }), 0.5).isPii).toBe(false);
  });

  it("decides on the primary noul only; categories explain", () => {
    const c = classify(probs({ contains_pii: 0.2, has_email: 0.9 }), 0.5);
    expect(c.isPii).toBe(false);
    expect(c.categories).toEqual(["email"]);
    expect(c.review).toBe(true);
  });

  it("marks review when PII has no category", () => {
    expect(classify(probs({ contains_pii: 0.9 }), 0.5)).toEqual({ isPii: true, categories: [], review: true });
  });

  it("no review when primary and categories agree", () => {
    expect(classify(probs({ contains_pii: 0.95, has_phone: 0.9, has_person_name: 0.8 }), 0.5)).toEqual({
      isPii: true,
      categories: ["person_name", "phone"],
      review: false,
    });
  });
});

describe("detector (REQ-DET-02..07, 09)", () => {
  it("sends one request with only the log line as named state and all noul questions", async () => {
    const { analyze, calls } = setup(() => ({ contains_pii: 0.97, has_email: 0.95 }));
    const r = await analyze({ line: 7, text: "GET /?email=a%40example.com" });
    expect(calls).toHaveLength(1);
    const { url, body, headers } = calls[0]!;
    expect(url).toMatch(/\/v1\/systemone$/);
    expect(body.state).toEqual({ log_line: "GET /?email=a%40example.com" });
    expect(body.model).toBe("jev-latest");
    expect(Object.keys(body.questions)).toEqual(Object.keys(QUESTIONS));
    expect(Object.values(body.questions).every((q) => (q as { type: string }).type === "noul")).toBe(true);
    expect(JSON.stringify(body)).not.toContain(TEST_KEY);
    expect(headers.authorization).toBe(`Bearer ${TEST_KEY}`);

    expect(r).toMatchObject({
      line: 7,
      status: "ok",
      isPii: true,
      categories: ["email"],
      review: false,
      model: "jev-1.13.0",
      usage: { input_tokens: 300, output_tokens: 40 },
    });
    expect(r.probabilities?.contains_pii).toBe(0.97);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("marks a failed line as error and never leaks the key", async () => {
    const { analyze } = setup(() => ({ status: 422, body: { detail: `bad request for ${TEST_KEY}` } }));
    const r = await analyze({ line: 3, text: "x" });
    expect(r.status).toBe("error");
    expect(r.isPii).toBeUndefined();
    expect(r.error).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain(TEST_KEY);
  });

  it("marks a server error as error after retries (SDK)", async () => {
    const { analyze } = setup(() => ({ status: 500 }));
    expect((await analyze({ line: 1, text: "x" })).status).toBe("error");
  });

  it("aborts the run on an authentication error", async () => {
    const { analyze } = setup(() => ({ status: 401, body: { detail: "invalid key" } }));
    await expect(analyze({ line: 1, text: "x" })).rejects.toBeInstanceOf(FatalApiError);
  });
});
