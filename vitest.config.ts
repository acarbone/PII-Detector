import { defineConfig } from "vitest/config";

// Unit tests must never pick up a real API key or hit the network (REQ-NFR-02):
// .env is not loaded here, and live tests (*.live.test.ts) only run via `npm run test:live`.
const live = process.env.PII_LIVE_TESTS === "1";

export default defineConfig({
  test: {
    include: live ? ["test/**/*.live.test.ts"] : ["test/**/*.test.ts"],
    exclude: live ? [] : ["test/**/*.live.test.ts", "node_modules/**"],
    environment: "node",
    testTimeout: 60_000,
  },
});
