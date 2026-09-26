import { fileURLToPath } from "node:url";

/** Project-root .env, independent of the current working directory. */
export const DEFAULT_ENV_PATH = fileURLToPath(new URL("../.env", import.meta.url));

/**
 * Loads `.env` into process.env if the file exists (REQ-NFR-06/07).
 * A missing file is not an error. Variables already set in the shell win:
 * Node's loadEnvFile never overwrites existing process.env entries.
 * Returns whether a file was loaded.
 */
export function loadDotEnv(path: string = DEFAULT_ENV_PATH): boolean {
  try {
    process.loadEnvFile(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
