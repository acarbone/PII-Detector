import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { RunConfig } from "./types.js";

export const DEFAULT_INPUT = fileURLToPath(new URL("../fixtures/web-logs.log", import.meta.url));
export const DEFAULT_MODEL = "jev-latest";
export const DEFAULT_THRESHOLD = 0.5;
export const DEFAULT_CONCURRENCY = 8;
/** Thresholds for the precision/recall sweep (REQ-REP-08). */
export const SWEEP_THRESHOLDS = [0.3, 0.5, 0.7] as const;
/** jev-1.13 input price in USD per million tokens; output tokens are free (design §8). */
export const PRICE_USD_PER_MTOK = 0.042;

export const MISSING_KEY_MESSAGE =
  "Missing TYPESAFE_API_KEY. Copy .env.dist to .env and set your key (or export it in your shell).";

export class ConfigError extends Error {
  override name = "ConfigError";
}

export const HELP = `Usage: npm run detect -- [options]

Detect PII in log lines with TypeSafe Jev noul questions.

Options:
  --input <path>         Log file to analyze (default: fixtures/web-logs.log)
  --labels <path>        Ground-truth labels JSON (default: <input>.labels.json if present)
  --threshold <0..1>     Probability at or above which a line is PII (default: ${DEFAULT_THRESHOLD})
  --concurrency <n>      Parallel API requests (default: ${DEFAULT_CONCURRENCY})
  --model <name>         TypeSafe model (default: ${DEFAULT_MODEL})
  --limit <n>            Analyze only the first n lines
  --no-eval              Skip the accuracy evaluation against labels
  --json <path>          Write a machine-readable JSON report
  --md <path>            Write a Markdown report
  --no-color             Disable ANSI colors
  -h, --help             Show this help

The API key is read from TYPESAFE_API_KEY (.env at the project root, or the shell).`;

/** `foo.log` -> `foo.labels.json`. */
export const labelsPathFor = (input: string) => input.replace(/(\.[^./\\]+)?$/, ".labels.json");

const num = (name: string, raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n)) throw new ConfigError(`--${name} must be a number, got "${raw}".`);
  return n;
};

const positiveInt = (name: string, raw: string | undefined): number | undefined => {
  const n = num(name, raw);
  if (n !== undefined && (!Number.isInteger(n) || n < 1)) {
    throw new ConfigError(`--${name} must be an integer >= 1, got ${raw}.`);
  }
  return n;
};

/** Parses and validates CLI flags (REQ-CLI-02/03). Returns null when --help was requested. */
export function parseConfig(argv: string[], opts: { isTTY?: boolean } = {}): RunConfig | null {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      allowNegative: true,
      options: {
        input: { type: "string" },
        labels: { type: "string" },
        threshold: { type: "string" },
        concurrency: { type: "string" },
        model: { type: "string" },
        limit: { type: "string" },
        eval: { type: "boolean", default: true },
        json: { type: "string" },
        md: { type: "string" },
        color: { type: "boolean" },
        help: { type: "boolean", short: "h", default: false },
      },
    }));
  } catch (err) {
    throw new ConfigError((err as Error).message);
  }
  if (values.help) return null;

  const threshold = num("threshold", values.threshold) ?? DEFAULT_THRESHOLD;
  if (threshold < 0 || threshold > 1) throw new ConfigError(`--threshold must be between 0 and 1, got ${threshold}.`);

  const input = values.input ?? DEFAULT_INPUT;
  if (!existsSync(input)) throw new ConfigError(`Input file not found: ${input}`);

  let labels: string | null = null;
  if (values.eval) {
    if (values.labels !== undefined) {
      if (!existsSync(values.labels)) throw new ConfigError(`Labels file not found: ${values.labels}`);
      labels = values.labels;
    } else if (existsSync(labelsPathFor(input))) {
      labels = labelsPathFor(input);
    }
  }

  const model = values.model ?? DEFAULT_MODEL;
  if (model.trim() === "") throw new ConfigError("--model must not be empty.");

  return {
    input,
    labels,
    threshold,
    concurrency: positiveInt("concurrency", values.concurrency) ?? DEFAULT_CONCURRENCY,
    model,
    limit: positiveInt("limit", values.limit) ?? null,
    evaluate: values.eval && labels !== null,
    jsonPath: values.json ?? null,
    mdPath: values.md ?? null,
    color: values.color ?? ((opts.isTTY ?? false) && !process.env.NO_COLOR),
  };
}

/** Reads the API key from the environment (REQ-DET-09, REQ-NFR-07). */
export function resolveApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.TYPESAFE_API_KEY?.trim();
  if (!key) throw new ConfigError(MISSING_KEY_MESSAGE);
  return key;
}
