/** PII categories used by fixture labels and category questions (design §3, §5.1). */
export const CATEGORIES = [
  "person_name",
  "email",
  "phone",
  "postal_address",
  "date_of_birth",
  "government_id",
  "payment_data",
  "free_text_personal",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Ground-truth label for one log line (fixtures/web-logs.labels.json). Never sent to the model. */
export interface Label {
  line: number;
  contains_pii: boolean;
  categories: Category[];
  note: string;
  hard_negative?: boolean;
}

/** Question ids sent to Jev; all are noul questions (design §3). */
export const CATEGORY_QUESTION = {
  person_name: "has_person_name",
  email: "has_email",
  phone: "has_phone",
  postal_address: "has_postal_address",
  date_of_birth: "has_date_of_birth",
  government_id: "has_government_id",
  payment_data: "has_payment_data",
  free_text_personal: "has_free_text_personal",
} as const satisfies Record<Category, string>;
export type CategoryQuestionId = (typeof CATEGORY_QUESTION)[Category];
export type QuestionId = "contains_pii" | CategoryQuestionId;

/** One input log line, 1-based line number = record id. */
export interface LogLine {
  line: number;
  text: string;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

/** Result of analyzing one log line (design §6). */
export interface LineResult {
  line: number;
  text: string;
  status: "ok" | "error";
  /** Raw noul probabilities per question. */
  probabilities?: Record<QuestionId, number>;
  /** contains_pii >= threshold. */
  isPii?: boolean;
  /** Categories whose noul >= threshold. */
  categories?: Category[];
  /** Primary decision and category answers disagree; worth a human look. */
  review?: boolean;
  /** Wall time of the API call, including SDK retries. */
  latencyMs: number;
  usage?: Usage;
  /** Versioned model id returned by the API. */
  model?: string;
  /** Error message only; never contains headers or the API key. */
  error?: string;
}

/** Validated run configuration. Deliberately has no API key field (REQ-DET-09). */
export interface RunConfig {
  input: string;
  labels: string | null;
  threshold: number;
  concurrency: number;
  model: string;
  limit: number | null;
  evaluate: boolean;
  jsonPath: string | null;
  mdPath: string | null;
  color: boolean;
}
