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
