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

import { classify } from "../src/detector.js";
import { summarize } from "../src/metrics.js";
import { modelsAnswered, type Report } from "../src/report/model.js";
import type { Category, Label, LineResult, RunConfig } from "../src/types.js";

export const okResult = (line: number, text: string, p: Probs, latencyMs = 500, threshold = 0.5): LineResult => {
  const probabilities = probs(p);
  return {
    line,
    text,
    status: "ok",
    probabilities,
    ...classify(probabilities, threshold),
    latencyMs,
    usage: { input_tokens: 420, output_tokens: 45 },
    model: "jev-1.13.0",
  };
};

export const errorResult = (line: number, text: string): LineResult => ({
  line,
  text,
  status: "error",
  latencyMs: 12,
  error: "InternalServerError: 500 upstream failure",
});

export const label = (line: number, categories: Category[] = [], note = ""): Label => ({
  line,
  contains_pii: categories.length > 0,
  categories,
  note,
});

export const testConfig = (over: Partial<RunConfig> = {}): RunConfig => ({
  input: "fixtures/web-logs.log",
  labels: "fixtures/web-logs.labels.json",
  threshold: 0.5,
  concurrency: 8,
  model: "jev-latest",
  limit: null,
  evaluate: true,
  jsonPath: null,
  mdPath: null,
  color: false,
  ...over,
});

/** A small deterministic report covering every section: TP, FP, FN, TN, review, error. */
export function sampleReport(over: Partial<RunConfig> = {}): Report {
  const results = [
    okResult(1, `GET /newsletter/confirm?email=anna.muster%40example.com&name=Anna+Muster HTTP/1.1" 302 0 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6)"`, { contains_pii: 0.99, has_email: 0.98, has_person_name: 0.93 }, 420),
    okResult(2, `{"level":"INFO","svc":"auth","event":"login_success","user_id":"u_48213"}`, { contains_pii: 0.04 }, 380),
    okResult(3, `{"level":"INFO","svc":"stores","address":"Bahnhofplatz 1, 8001 Zürich"}`, { contains_pii: 0.62, has_postal_address: 0.55 }, 610),
    okResult(4, `{"level":"INFO","svc":"reviews","text":"Great service! - Fabio Conti, Lugano"}`, { contains_pii: 0.41, has_person_name: 0.66 }, 540),
    okResult(5, `{"level":"INFO","svc":"loyalty","dob":"30/04/1969"}`, { contains_pii: 0.88 }, 700),
    errorResult(6, `{"level":"INFO","svc":"cart","event":"item_added"}`),
  ];
  const labels = new Map(
    [
      label(1, ["email", "person_name"], "newsletter"),
      label(2, [], "internal user id"),
      label(3, [], "public store address"),
      label(4, ["person_name"], "signed review"),
      label(5, ["date_of_birth"], "dob"),
      label(6, []),
    ].map((l) => [l.line, l]),
  );
  const config = testConfig(over);
  return {
    generatedAt: "2026-09-26T16:00:00.000Z",
    config,
    modelsAnswered: modelsAnswered(results),
    results,
    metrics: summarize(results, 2345, config.evaluate ? labels : null, config.threshold),
    labels: config.evaluate ? labels : null,
  };
}
