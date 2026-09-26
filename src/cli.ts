import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { ConfigError, HELP, parseConfig, resolveApiKey } from "./config.js";
import { createClient, createDetector, FatalApiError, type ClientOptions } from "./detector.js";
import { loadDotEnv } from "./env.js";
import { loadLabels, loadLogLines } from "./fixtures.js";
import { summarize } from "./metrics.js";
import { runPool } from "./pool.js";
import { Progress, type ProgressStream } from "./progress.js";
import { renderConsole } from "./report/console.js";
import { writeJson } from "./report/json.js";
import { writeMarkdown } from "./report/markdown.js";
import { modelsAnswered, type Report } from "./report/model.js";

/** Exit codes (REQ-REP-07). */
export const EXIT = { ok: 0, fatal: 1, lineErrors: 2 } as const;

export interface CliIO {
  stdout: ProgressStream;
  stderr: ProgressStream;
  env: NodeJS.ProcessEnv;
  /** Path of the .env file to load; undefined = project-root .env, null = do not load. */
  envPath?: string | null;
  /** Injected in tests. */
  fetch?: ClientOptions["fetch"];
  retry?: ClientOptions["retry"];
}

const defaultIO = (): CliIO => ({ stdout: process.stdout, stderr: process.stderr, env: process.env });

export async function main(argv: string[], io: CliIO = defaultIO()): Promise<number> {
  const err = (msg: string) => io.stderr.write(`${msg}\n`);
  try {
    if (io.envPath !== null) loadDotEnv(io.envPath ?? undefined);

    const config = parseConfig(argv, { isTTY: Boolean(io.stdout.isTTY) });
    if (config === null) {
      io.stdout.write(`${HELP}\n`);
      return EXIT.ok;
    }
    const apiKey = resolveApiKey(io.env);

    const lines = await loadLogLines(config.input, config.limit);
    if (lines.length === 0) throw new ConfigError(`No log lines found in ${config.input}.`);
    const labels = config.evaluate && config.labels ? await loadLabels(config.labels) : null;

    const client = createClient({ apiKey, model: config.model, fetch: io.fetch, retry: io.retry });
    const analyze = createDetector({ client, model: config.model, threshold: config.threshold, apiKey });

    err(
      `Analyzing ${lines.length} log lines with ${config.model} ` +
        `(concurrency ${config.concurrency}, threshold ${config.threshold.toFixed(2)})`,
    );
    const progress = new Progress({ total: lines.length, stream: io.stderr });
    const started = performance.now();
    let results;
    try {
      results = await runPool(lines, config.concurrency, analyze, (r) => progress.tick(r));
    } finally {
      progress.finish();
    }
    const wallMs = performance.now() - started;

    const report: Report = {
      generatedAt: new Date().toISOString(),
      config,
      modelsAnswered: modelsAnswered(results),
      results,
      metrics: summarize(results, wallMs, labels, config.threshold),
      labels,
    };

    io.stdout.write(
      renderConsole(report, { color: config.color, width: io.stdout.isTTY ? (io.stdout.columns ?? 120) : null }),
    );
    if (config.jsonPath) {
      await writeJson(report, config.jsonPath);
      err(`JSON report written to ${config.jsonPath}`);
    }
    if (config.mdPath) {
      await writeMarkdown(report, config.mdPath);
      err(`Markdown report written to ${config.mdPath}`);
    }
    return report.metrics.counts.errors > 0 ? EXIT.lineErrors : EXIT.ok;
  } catch (e) {
    if (e instanceof ConfigError || e instanceof FatalApiError) {
      err(`Error: ${e.message}`);
      if (e instanceof ConfigError && !e.message.startsWith("Missing TYPESAFE_API_KEY")) err("Run with --help for usage.");
    } else {
      err(`Fatal error: ${e instanceof Error ? e.message : String(e)}`);
    }
    return EXIT.fatal;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
