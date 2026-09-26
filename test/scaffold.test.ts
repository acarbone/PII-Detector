import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("scaffold", () => {
  it("versions a .env.dist template that declares TYPESAFE_API_KEY with no value", () => {
    const tpl = readFileSync(new URL("../.env.dist", import.meta.url), "utf8");
    expect(tpl).toMatch(/^TYPESAFE_API_KEY=$/m);
  });
});
