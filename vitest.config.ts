import { defineConfig } from "vitest/config";

// Unit tests must never pick up a real API key (REQ-NFR-02): .env is not loaded here.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
