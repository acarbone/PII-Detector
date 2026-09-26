import { performance } from "node:perf_hooks";
import {
  AuthenticationError,
  PermissionDeniedError,
  TypeSafeClient,
  type TypeSafeClientConfig,
} from "@typesafe-ai/sdk";
import { QUESTIONS } from "./questions.js";
import { CATEGORY_QUESTION, CATEGORIES, type Category, type LineResult, type LogLine, type QuestionId } from "./types.js";

/** An error that must stop the whole run (e.g. an invalid API key), not just one line. */
export class FatalApiError extends Error {
  override name = "FatalApiError";
}

export interface ClientOptions {
  apiKey: string;
  model: string;
  /** Injected in tests; defaults to global fetch. */
  fetch?: TypeSafeClientConfig["fetch"];
  retry?: TypeSafeClientConfig["retry"];
}

export function createClient({ apiKey, model, fetch, retry }: ClientOptions): TypeSafeClient {
  return new TypeSafeClient({
    apiKey,
    defaultModel: model,
    // Request bodies contain the (PII) log lines; keep SDK logging quiet so nothing
    // leaks to the terminal and the progress bar stays intact.
    logLevel: "off",
    ...(fetch ? { fetch } : {}),
    ...(retry ? { retry } : {}),
  });
}

export interface Classification {
  isPii: boolean;
  categories: Category[];
  review: boolean;
}

/**
 * Applies the decision rule in code (REQ-DET-04, design D3): the primary noul decides;
 * category nouls only explain. `review` marks disagreement between the two.
 */
export function classify(probabilities: Record<QuestionId, number>, threshold: number): Classification {
  const isPii = probabilities.contains_pii >= threshold;
  const categories = CATEGORIES.filter((c) => probabilities[CATEGORY_QUESTION[c]] >= threshold);
  return { isPii, categories, review: isPii !== categories.length > 0 };
}

const redact = (message: string, secret: string) => (secret ? message.split(secret).join("***") : message);

export interface DetectorOptions {
  client: TypeSafeClient;
  model: string;
  threshold: number;
  /** Only used to scrub error messages (REQ-DET-09). */
  apiKey: string;
}

/** Returns a function that analyzes one log line with a single systemOne request. */
export function createDetector({ client, model, threshold, apiKey }: DetectorOptions) {
  return async function analyze({ line, text }: LogLine): Promise<LineResult> {
    const started = performance.now();
    try {
      const res = await client.systemOne({
        model,
        // Only the line itself, as named state (REQ-DET-05).
        state: { log_line: text },
        questions: QUESTIONS,
      });
      const latencyMs = performance.now() - started;
      const probabilities = Object.fromEntries(
        (Object.keys(QUESTIONS) as QuestionId[]).map((id) => [id, res.answers[id].noul]),
      ) as Record<QuestionId, number>;
      return {
        line,
        text,
        status: "ok",
        probabilities,
        ...classify(probabilities, threshold),
        latencyMs,
        usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
        model: res.model,
      };
    } catch (err) {
      const message = redact(err instanceof Error ? `${err.name}: ${err.message}` : String(err), apiKey);
      if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
        throw new FatalApiError(message);
      }
      return { line, text, status: "error", latencyMs: performance.now() - started, error: message };
    }
  };
}
