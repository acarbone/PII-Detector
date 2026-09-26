import { describe, expect, it } from "vitest";
import { loadDotEnv } from "../src/env.js";
import { createClient, createDetector } from "../src/detector.js";
import { DEFAULT_MODEL } from "../src/config.js";

// Live smoke test against the real TypeSafe API (REQ-NFR-03).
// Run with `npm run test:live`; reads the key from .env or the shell and skips without one.
loadDotEnv();
const apiKey = process.env.TYPESAFE_API_KEY?.trim() ?? "";

describe.skipIf(!apiKey)("live TypeSafe API", () => {
  const client = createClient({ apiKey, model: DEFAULT_MODEL });
  const analyze = createDetector({ client, model: DEFAULT_MODEL, threshold: 0.5, apiKey });

  it("flags an obvious PII line and explains it", async () => {
    const r = await analyze({
      line: 1,
      text: '{"level":"INFO","svc":"checkout","event":"guest_checkout","guest_email":"emma.fischer@example.com","guest_phone":"+44 7700 900321"}',
    });
    expect(r.status, r.error).toBe("ok");
    expect(r.model).toMatch(/^jev-/);
    expect(r.isPii).toBe(true);
    expect(r.categories).toEqual(expect.arrayContaining(["email", "phone"]));
    expect(r.usage!.input_tokens).toBeGreaterThan(0);
  });

  it("leaves routine traffic clean", async () => {
    const r = await analyze({ line: 2, text: '10.0.4.0 - - [12/Sep/2026:10:02:13 +0200] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.30"' });
    expect(r.status, r.error).toBe("ok");
    expect(r.isPii).toBe(false);
  });

  it("leaves a role mailbox clean", async () => {
    const r = await analyze({ line: 3, text: '{"level":"INFO","svc":"mailer","event":"sent","to":"support@shop.example","template":"daily_digest"}' });
    expect(r.status, r.error).toBe("ok");
    expect(r.isPii).toBe(false);
  });
});
