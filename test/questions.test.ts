import { describe, expect, it } from "vitest";
import { QUESTION_CATEGORY, QUESTIONS } from "../src/questions.js";
import { CATEGORIES, CATEGORY_QUESTION } from "../src/types.js";

describe("question set (REQ-DET-01..03)", () => {
  it("uses only noul questions", () => {
    for (const q of Object.values(QUESTIONS)) expect(q.type).toBe("noul");
  });

  it("has the primary question plus one question per category", () => {
    expect(Object.keys(QUESTIONS)).toEqual(["contains_pii", ...CATEGORIES.map((c) => CATEGORY_QUESTION[c])]);
    for (const c of CATEGORIES) expect(QUESTION_CATEGORY[CATEGORY_QUESTION[c]]).toBe(c);
  });

  it("points every question at the named state field", () => {
    for (const q of Object.values(QUESTIONS)) expect(q.instructions).toContain("`log_line`");
  });

  it("matches the reviewed payload", () => {
    expect(QUESTIONS).toMatchSnapshot();
  });
});
