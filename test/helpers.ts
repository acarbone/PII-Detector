import { QUESTIONS } from "../src/questions.js";
import type { QuestionId } from "../src/types.js";

export const TEST_KEY = "ts_test_secret_key_123";

export type Probs = Partial<Record<QuestionId, number>>;

/** Full probability map with defaults of 0.01 for unspecified questions. */
export const probs = (p: Probs = {}): Record<QuestionId, number> =>
  Object.fromEntries((Object.keys(QUESTIONS) as QuestionId[]).map((id) => [id, p[id] ?? 0.01])) as Record<QuestionId, number>;

export interface Captured {
  url: string;
  headers: Record<string, string>;
  body: { model: string; state: unknown; questions: Record<string, unknown> };
}

/**
 * Fake fetch for the TypeSafe API: `respond` maps the request's log line to either
 * probabilities or an HTTP error status.
 */
export function fakeFetch(respond: (logLine: string) => Probs | { status: number; body?: unknown }) {
  const calls: Captured[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as Captured["body"];
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body });
    const logLine = (body.state as { log_line: string }).log_line;
    const r = respond(logLine);
    if ("status" in r && typeof r.status === "number") {
      return new Response(JSON.stringify(r.body ?? { detail: "error" }), {
        status: r.status,
        headers: { "content-type": "application/json" },
      });
    }
    const p = probs(r as Probs);
    return new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: Object.fromEntries(Object.entries(p).map(([id, noul]) => [id, { type: "noul", noul }])),
        usage: { input_tokens: 300, output_tokens: 40 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { fetch, calls };
}
