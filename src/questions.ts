import { noul, type NoulQuestion } from "@typesafe-ai/sdk";
import { CATEGORY_QUESTION, type Category, type CategoryQuestionId, type QuestionId } from "./types.js";

/**
 * The noul question set (design §3) — the single source of truth for what Jev is asked.
 * Every question points at the named state field `log_line` and is phrased so that a
 * high value means "yes, PII is present".
 */

/** Primary decision question (REQ-DET-02). Thresholded in code (REQ-DET-04). */
export const CONTAINS_PII = noul(
  "Does `log_line` contain personal information that identifies or could be linked to a specific real person?",
  {
    true:
      "The line contains at least one value belonging to a specific individual: their name, email address, " +
      "phone number, home or delivery address, date of birth, government or passport number, bank account or " +
      "card number, or other personal details about them, even if URL-encoded or embedded in a URL, header or " +
      "error message.",
    false:
      "The line contains no value belonging to a specific individual. Internal IDs, order numbers, UUIDs, " +
      "session tokens, product codes, masked or hashed values, generic company mailboxes (e.g. support@), " +
      "public business addresses and anonymized IPs are not personal information.",
  },
);

/** One noul per PII category, asked in the same request to explain detections (REQ-DET-03). */
export const CATEGORY_QUESTIONS: Record<CategoryQuestionId, NoulQuestion> = {
  [CATEGORY_QUESTION.person_name]: noul("Does `log_line` contain the name of a specific person?"),
  [CATEGORY_QUESTION.email]: noul(
    "Does `log_line` contain an email address belonging to an individual person (not a generic company or role mailbox)?",
  ),
  [CATEGORY_QUESTION.phone]: noul("Does `log_line` contain a person's phone number?"),
  [CATEGORY_QUESTION.postal_address]: noul(
    "Does `log_line` contain a person's street, home, billing or delivery address?",
  ),
  [CATEGORY_QUESTION.date_of_birth]: noul("Does `log_line` contain a person's date of birth?"),
  [CATEGORY_QUESTION.government_id]: noul(
    "Does `log_line` contain a government-issued identifier such as a social security, AHV/AVS, passport, national ID or tax number?",
  ),
  [CATEGORY_QUESTION.payment_data]: noul(
    "Does `log_line` contain a full bank account number (IBAN) or payment card number?",
  ),
  [CATEGORY_QUESTION.free_text_personal]: noul(
    "Does `log_line` contain free-text personal details about a specific person, such as their health, family situation, disability or other private circumstances?",
  ),
};

/** Full question map sent with every request. */
export const QUESTIONS = { contains_pii: CONTAINS_PII, ...CATEGORY_QUESTIONS } satisfies Record<QuestionId, NoulQuestion>;

/** Reverse lookup: question id -> category. */
export const QUESTION_CATEGORY = Object.fromEntries(
  Object.entries(CATEGORY_QUESTION).map(([category, id]) => [id, category]),
) as Record<CategoryQuestionId, Category>;
