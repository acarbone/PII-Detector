import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDotEnv } from "../src/env.js";
import { ConfigError, MISSING_KEY_MESSAGE, resolveApiKey } from "../src/config.js";

const VARS = ["PII_TEST_FROM_FILE", "PII_TEST_SHELL_WINS"];
afterEach(() => {
  for (const v of VARS) delete process.env[v];
});

const envFile = (content: string) => {
  const path = join(mkdtempSync(join(tmpdir(), "pii-env-")), ".env");
  writeFileSync(path, content);
  return path;
};

describe("loadDotEnv (REQ-NFR-06/07)", () => {
  it("loads variables from .env when the file exists", () => {
    expect(loadDotEnv(envFile("PII_TEST_FROM_FILE=hello\n"))).toBe(true);
    expect(process.env.PII_TEST_FROM_FILE).toBe("hello");
  });

  it("treats a missing .env as not an error", () => {
    expect(loadDotEnv(join(tmpdir(), "definitely-missing", ".env"))).toBe(false);
  });

  it("lets a variable already set in the shell take precedence", () => {
    process.env.PII_TEST_SHELL_WINS = "shell";
    loadDotEnv(envFile("PII_TEST_SHELL_WINS=file\n"));
    expect(process.env.PII_TEST_SHELL_WINS).toBe("shell");
  });
});

describe("resolveApiKey (REQ-DET-09, REQ-NFR-07)", () => {
  it("returns the key from the environment", () => {
    expect(resolveApiKey({ TYPESAFE_API_KEY: " ts_key " })).toBe("ts_key");
  });

  it.each([{}, { TYPESAFE_API_KEY: "" }, { TYPESAFE_API_KEY: "   " }])(
    "throws the .env.dist hint when the key is missing: %o",
    (env) => {
      expect(() => resolveApiKey(env)).toThrow(ConfigError);
      expect(() => resolveApiKey(env)).toThrow(MISSING_KEY_MESSAGE);
    },
  );
});
