/**
 * Deterministic generator for fixtures/web-logs.log and fixtures/web-logs.labels.json.
 *
 * All values are synthetic (design §5, REQ-FIX-06): reserved email domains
 * (example.com/.org/.net, shop.example), fictional phone ranges (+44 7700 900xxx,
 * +1 202-555-01xx), published test IBANs / card numbers and invented people.
 *
 * Run: npm run fixtures:generate
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Category, Label } from "../src/types.js";

type Fmt = (t: Date) => string;
type Entry = { render: Fmt; pii: Category[]; note: string; hardNegative?: boolean };

// ---------------------------------------------------------------------------
// Timestamp formats
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
/** Local time is UTC+2 (CEST) for access logs and plain-text logs. */
const local = (t: Date) => new Date(t.getTime() + 2 * 3600_000);
const clf = (t: Date) => {
  const l = local(t);
  return `${pad(l.getUTCDate())}/${MONTHS[l.getUTCMonth()]}/${l.getUTCFullYear()}:${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}:${pad(l.getUTCSeconds())} +0200`;
};
const iso = (t: Date) => t.toISOString().replace(/\.\d{3}Z$/, "Z");
const plain = (t: Date) => {
  const l = local(t);
  return `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())} ${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}:${pad(l.getUTCSeconds())},${pad(t.getUTCMilliseconds(), 3)}`;
};

// ---------------------------------------------------------------------------
// Line builders
// ---------------------------------------------------------------------------

const UA = {
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  bingbot: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  probe: "kube-probe/1.30",
  uptime: "UptimeRobot/2.0",
};
const IPS = ["203.0.113.0", "198.51.100.0", "192.0.2.0"];

const access =
  (ip: string, req: string, status: number, bytes: number, ref: string, ua: string): Fmt =>
  (t) =>
    `${ip} - - [${clf(t)}] "${req} HTTP/1.1" ${status} ${bytes} "${ref}" "${ua}"`;

const json =
  (fields: Record<string, unknown>): Fmt =>
  (t) =>
    JSON.stringify({ ts: iso(t), ...fields });

const text =
  (level: string, logger: string, msg: string): Fmt =>
  (t) =>
    `${plain(t)} ${level.padEnd(5)} [${logger}] ${msg}`;

const pii = (render: Fmt, categories: Category[], note: string): Entry => ({ render, pii: categories, note });
const clean = (render: Fmt, note: string, hardNegative = false): Entry => ({ render, pii: [], note, hardNegative });

// ---------------------------------------------------------------------------
// PII lines (48)
// ---------------------------------------------------------------------------

const PII_ENTRIES: Entry[] = [
  pii(access(IPS[0]!, "GET /newsletter/confirm?email=anna.muster%40example.com&name=Anna+Muster", 302, 0, "-", UA.mac), ["email", "person_name"], "newsletter confirm, URL-encoded email and name in query"),
  pii(json({ level: "INFO", svc: "checkout", event: "shipping_set", order_id: "ORD-2026-000917", recipient: "Marco Bernasconi", address: "Via Nassa 12, 6900 Lugano" }), ["person_name", "postal_address"], "shipping recipient and address"),
  pii(json({ level: "ERROR", svc: "account", msg: "ValidationError: dob '1987-03-14' invalid for user lukas.meier@example.com" }), ["date_of_birth", "email"], "DOB and email inside validation error"),
  pii(json({ level: "INFO", svc: "support", event: "ticket_opened", ticket_id: "T-58213", message: "Hi, I'm pregnant and need the delivery before the 20th, call me on +44 7700 900123" }), ["free_text_personal", "phone"], "health detail and phone in free text"),
  pii(json({ level: "WARN", svc: "auth", event: "login_failed", username: "sophie.dubois@example.org", reason: "bad_password", attempt: 3 }), ["email"], "email used as username"),
  pii(access(IPS[1]!, "POST /api/account/update", 204, 0, "https://shop.example/profile?phone=%2B12025550143", UA.win), ["phone"], "URL-encoded phone in referrer"),
  pii(json({ level: "INFO", svc: "payments", event: "refund_issued", msg: "refund of CHF 49.90 issued to IBAN CH93 0076 2011 6238 5295 7 for customer Giulia Rossi" }), ["payment_data", "person_name"], "IBAN and customer name"),
  pii(json({ level: "ERROR", svc: "payments", msg: "gateway rejected card 4111111111111111 exp 09/28", order_id: "ORD-2026-000931" }), ["payment_data"], "full card number in error"),
  pii(text("ERROR", "db", `duplicate key value violates unique constraint "users_email_key" DETAIL: Key (email)=(peter.keller@example.net) already exists.`), ["email"], "email in database error"),
  pii(json({ level: "INFO", svc: "kyc", event: "id_verification_submitted", user_id: "u_50117", ahv: "756.1234.5678.97" }), ["government_id"], "Swiss AHV number"),
  pii(json({ level: "INFO", svc: "kyc", event: "document_checked", full_name: "Thomas Brunner", passport_number: "X4821957", nationality: "CH" }), ["government_id", "person_name"], "passport number and name"),
  pii(json({ level: "INFO", svc: "forms", event: "form_submitted", form: "contact", fields: { name: "Chloé Favre", message: "Please call me back at +1 202-555-0187" } }), ["person_name", "phone"], "contact form name and phone"),
  pii(json({ level: "INFO", svc: "search", event: "query", query: "Elena Moretti Bahnhofstrasse 45 Zürich", results: 0 }), ["person_name", "postal_address"], "name and address typed into search"),
  pii(access(IPS[2]!, "GET /orders/track?zip=8001&street=Seefeldstrasse+118&lastname=Huber", 200, 2210, "-", UA.iphone), ["postal_address", "person_name"], "street address and surname in query string"),
  pii(json({ level: "INFO", svc: "account", event: "profile_updated", user_id: "u_77120", changes: { birthdate: "02.11.1990" } }), ["date_of_birth"], "birthdate in profile change"),
  pii(json({ level: "INFO", svc: "chat", event: "message_received", conversation_id: "c_9921", text: "My name is Daniel Schmid and I was just diagnosed with diabetes, can I return the chocolate?" }), ["person_name", "free_text_personal"], "name and health condition in chat"),
  pii(json({ level: "INFO", svc: "mailer", event: "sent", to: "claudia.zimmermann@example.com", template: "order_confirmation", order_id: "ORD-2026-000944" }), ["email"], "personal recipient email"),
  pii(json({ level: "INFO", svc: "checkout", event: "billing_set", order_id: "ORD-2026-000950", billing_address: "Rue du Rhône 8, 1204 Genève" }), ["postal_address"], "billing address"),
  pii(access(IPS[0]!, "GET /api/users/lookup?tel=%2B447700900456", 200, 412, "-", UA.android), ["phone"], "URL-encoded phone in query"),
  pii(json({ level: "INFO", svc: "auth", event: "password_reset_requested", email: "m.bianchi@example.org" }), ["email"], "password reset email"),
  pii(json({ level: "INFO", svc: "payments", event: "sepa_mandate_created", holder: "Jonas Weber", iban: "DE89 3704 0044 0532 0130 00" }), ["payment_data", "person_name"], "SEPA mandate holder and IBAN"),
  pii(text("ERROR", "checkout", "at CheckoutService.validate (checkout.ts:212) customer={name:'Laura Gerber', phone:'+1 202-555-0164'}"), ["person_name", "phone"], "customer object in stack trace"),
  pii(json({ level: "INFO", svc: "kyc", event: "tax_residency_declared", user_id: "u_61302", social_security: "756.3047.5009.62" }), ["government_id"], "AHV as social security number"),
  pii(json({ level: "INFO", svc: "forms", event: "form_submitted", form: "birthday_club", fields: { first_name: "Noah", last_name: "Keller", birthday: "1995-07-21" } }), ["person_name", "date_of_birth"], "birthday club signup"),
  pii(json({ level: "INFO", svc: "support", event: "ticket_opened", ticket_id: "T-58240", message: "I'm moving out because of my divorce, please send my order to Hauptgasse 3, 4500 Solothurn instead" }), ["free_text_personal", "postal_address"], "personal circumstance and new address"),
  pii(json({ level: "INFO", svc: "delivery", event: "courier_note", shipment_id: "SHP-88213", note: "Leave parcel with neighbour Mrs. Andrea Frei, 2nd floor" }), ["person_name"], "third-party name in courier note"),
  pii(access(IPS[1]!, "POST /checkout/pay", 402, 128, "https://shop.example/checkout?cc=5555555555554444", UA.win), ["payment_data"], "card number in referrer"),
  pii(json({ level: "INFO", svc: "auth", event: "account_created", username: "sara.lehmann@example.net", display_name: "Sara Lehmann" }), ["email", "person_name"], "new account email and name"),
  pii(json({ level: "INFO", svc: "kyc", event: "id_upload", document: "identity_card", document_number: "C0482913", dob: "1978-12-02" }), ["government_id", "date_of_birth"], "ID card number and DOB"),
  pii(json({ level: "INFO", svc: "reviews", event: "review_posted", product: "SKU-20417", rating: 5, text: "Great service, fast delivery! - Fabio Conti, Lugano" }), ["person_name"], "signed review"),
  pii(json({ level: "INFO", svc: "support", event: "ticket_opened", ticket_id: "T-58262", email: "r.meyer@example.com", message: "I'm hard of hearing so please only contact me by email, never by phone" }), ["free_text_personal", "email"], "disability detail and email"),
  pii(access(IPS[2]!, "GET /unsubscribe?u=julia.roth%40example.com", 200, 1840, "-", UA.mac), ["email"], "URL-encoded email in unsubscribe link"),
  pii(json({ level: "INFO", svc: "sms", event: "sent", to: "+44 7700 900789", template: "otp_login" }), ["phone"], "SMS recipient number"),
  pii(json({ level: "INFO", svc: "returns", event: "label_created", rma: "RMA-4410", return_label_for: "Martin Bühler, Dorfstrasse 7, 3073 Gümligen" }), ["person_name", "postal_address"], "return label name and address"),
  pii(json({ level: "WARN", svc: "payments", event: "chargeback_opened", msg: "chargeback opened for card 4000 0566 5566 5556 holder Nina Steiner" }), ["payment_data", "person_name"], "card number and holder"),
  pii(json({ level: "INFO", svc: "crm", event: "lead_created", lead_id: "L-3301", source: "callback_widget", phone: "+1 202-555-0110" }), ["phone"], "callback phone number"),
  pii(json({ level: "INFO", svc: "privacy", event: "gdpr_export_requested", request_id: "DSR-0192", requester: "Oliver Huber" }), ["person_name"], "data-subject request name"),
  pii(json({ level: "INFO", svc: "loyalty", event: "profile_completed", member_id: "M-120044", dob: "30/04/1969" }), ["date_of_birth"], "DOB in loyalty profile"),
  pii(access(IPS[0]!, "GET /api/v1/customers/stefan.wyss@example.org/orders", 200, 3921, "-", UA.win), ["email"], "email in REST path"),
  pii(json({ level: "INFO", svc: "delivery", event: "address_validated", shipment_id: "SHP-88240", address: "Avenue de la Gare 21, 1003 Lausanne", valid: true }), ["postal_address"], "delivery address"),
  pii(json({ level: "INFO", svc: "support", event: "ticket_opened", ticket_id: "T-58277", message: "My son Luca is 8 and has a severe nut allergy, is this product safe for him?" }), ["free_text_personal"], "child health information"),
  pii(json({ level: "INFO", svc: "checkout", event: "guest_checkout", guest_email: "emma.fischer@example.com", guest_phone: "+44 7700 900321" }), ["email", "phone"], "guest email and phone"),
  pii(text("WARN", "fraud", "High-risk order ORD-2026-000988 flagged: billing name 'Reto Ammann' does not match card holder"), ["person_name"], "name in fraud warning"),
  pii(json({ level: "DEBUG", svc: "kyc", event: "mrz_parsed", mrz: "P<CHEMUSTER<<HANS<PETER<<<<<<<<<<<<<<<<<<<<<", document_number: "S0019283" }), ["government_id", "person_name"], "passport MRZ with name"),
  pii(access(IPS[1]!, "GET /appointments/book?name=Yasmin+Arnold&phone=%2B12025550199", 200, 5120, "-", UA.iphone), ["person_name", "phone"], "name and phone in booking URL"),
  pii(json({ level: "INFO", svc: "account", event: "address_changed", user_id: "u_40022", new_address: "Kirchweg 5, 8810 Horgen" }), ["postal_address"], "home address change"),
  pii(json({ level: "INFO", svc: "payments", event: "payout_scheduled", seller_id: "S-771", iban: "GB29 NWBK 6016 1331 9268 19" }), ["payment_data"], "payout IBAN"),
  pii(json({ level: "INFO", svc: "chatbot", event: "transcript", session: "cb_5512", user_said: "hi it's Ursula Brandt, my order didn't arrive" }), ["person_name"], "name in chatbot transcript"),
];

// ---------------------------------------------------------------------------
// Clean lines: hard negatives (19)
// ---------------------------------------------------------------------------

const HARD_NEGATIVES: Entry[] = [
  clean(json({ level: "WARN", svc: "payments", msg: "card declined", card_last4: "4242", order_id: "ORD-2026-000914" }), "last 4 card digits only", true),
  clean(json({ level: "INFO", svc: "mailer", event: "sent", to: "support@shop.example", template: "daily_digest" }), "role mailbox", true),
  clean(json({ level: "INFO", svc: "auth", event: "login_success", user_id: "u_48213", mfa: true }), "internal user id", true),
  clean(json({ level: "INFO", svc: "checkout", event: "receipt_sent", customer_email: "j***@e***.com", order_id: "ORD-2026-000921" }), "masked email", true),
  clean(json({ level: "INFO", svc: "account", event: "phone_verified", phone: "+41 ** *** ** 12", user_id: "u_50117" }), "masked phone", true),
  clean(json({ level: "INFO", svc: "analytics", event: "identify", user_hash: "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" }), "hashed identifier", true),
  clean(json({ level: "INFO", svc: "stores", event: "store_viewed", store: "Shop Example Zürich HB", address: "Bahnhofplatz 1, 8001 Zürich", opening: "08:00-21:00" }), "public store address", true),
  clean(json({ level: "INFO", svc: "api", event: "request", request_id: "3f1c9a7e-2b4d-4e8f-9a61-0c5d7b2e8f14", route: "/api/cart", status: 200, duration_ms: 42 }), "UUID request id", true),
  clean(json({ level: "INFO", svc: "checkout", event: "coupon_applied", code: "WELCOME-2026", discount_pct: 10, cart_id: "cart_8812" }), "coupon code", true),
  clean(json({ level: "DEBUG", svc: "auth", event: "token_issued", session_id: "sess_7Hq2kLx9Pz", jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1XzQ4MjEzIn0.c2lnbmF0dXJl", expires_in: 3600 }), "session token / JWT", true),
  clean(json({ level: "INFO", svc: "geo", event: "locale_resolved", geo: "Zurich,CH", lang: "de", currency: "CHF" }), "city and country only", true),
  clean(json({ level: "INFO", svc: "mailer", event: "sent", from: "noreply@shop.example", to: "orders@shop.example", template: "ops_summary" }), "system mailboxes", true),
  clean(json({ level: "INFO", svc: "payments", event: "iban_checked", iban_country: "CH", iban_valid: true, user_id: "u_61302" }), "IBAN metadata without number", true),
  clean(json({ level: "INFO", svc: "account", event: "age_verified", dob_verified: true, age_bracket: "25-34" }), "age bracket, no DOB", true),
  clean(json({ level: "ERROR", svc: "pricing", msg: "NullPointerException in PriceService.compute at line 88 for sku=SKU-10023" }), "stack trace without personal data", true),
  clean(json({ level: "INFO", svc: "invoicing", event: "invoice_rendered", seller_vat: "CHE-123.456.789 MWST", invoice_id: "INV-2026-04410" }), "company VAT/UID number", true),
  clean(json({ level: "INFO", svc: "experiments", event: "assigned", experiment: "checkout_v2", variant: "B", anonymous_id: "anon_a1b2c3d4e5" }), "anonymous id", true),
  clean(json({ level: "INFO", svc: "cms", event: "banner_rendered", banner: "help", text: "Questions? Call our hotline 0800 123 456 (Mon-Fri 8-18)" }), "business hotline number", true),
  clean(json({ level: "INFO", svc: "shipping", event: "rate_quoted", destination_postcode: "8001", country: "CH", carrier: "post", price_chf: 8.5 }), "postcode only", true),
];

// ---------------------------------------------------------------------------
// Clean lines: routine traffic and business events (53)
// ---------------------------------------------------------------------------

const ROUTINE: Entry[] = [
  clean(access(IPS[0]!, "GET /products/sku-44821", 200, 5312, "-", UA.mac), "product page"),
  clean(access(IPS[1]!, "GET /static/js/app.3f9c1.js", 200, 184233, "https://shop.example/", UA.win), "static asset"),
  clean(access(IPS[2]!, "GET /static/css/main.b71e2.css", 200, 40211, "https://shop.example/", UA.iphone), "static asset"),
  clean(access(IPS[0]!, "GET /favicon.ico", 200, 1150, "-", UA.android), "favicon"),
  clean(access("10.0.4.0", "GET /healthz", 200, 2, "-", UA.probe), "health check"),
  clean(access("10.0.4.0", "GET /readyz", 200, 2, "-", UA.probe), "readiness probe"),
  clean(access(IPS[1]!, "GET /robots.txt", 200, 312, "-", UA.googlebot), "bot"),
  clean(access(IPS[2]!, "GET /sitemap.xml", 200, 20455, "-", UA.bingbot), "bot"),
  clean(access(IPS[0]!, "GET /category/chocolate?sort=price_asc&page=2", 200, 18321, "https://shop.example/category/chocolate", UA.mac), "category listing"),
  clean(access(IPS[1]!, "GET /category/cheese", 200, 21007, "https://www.google.com/", UA.win), "category listing"),
  clean(access(IPS[2]!, "GET /products/sku-10023", 200, 6120, "https://shop.example/category/cheese", UA.android), "product page"),
  clean(access(IPS[0]!, "GET /img/products/sku-10023-800w.webp", 200, 58211, "https://shop.example/products/sku-10023", UA.android), "image"),
  clean(access(IPS[1]!, "GET /products/sku-99999", 404, 812, "-", UA.win), "404"),
  clean(access(IPS[2]!, "POST /api/cart/items", 201, 96, "https://shop.example/products/sku-44821", UA.mac), "add to cart"),
  clean(access(IPS[0]!, "GET /cart", 200, 7342, "https://shop.example/products/sku-44821", UA.mac), "cart page"),
  clean(access(IPS[1]!, "GET /checkout", 200, 9120, "https://shop.example/cart", UA.win), "checkout page"),
  clean(access(IPS[2]!, "GET /api/shipping/options?country=CH", 200, 640, "https://shop.example/checkout", UA.iphone), "shipping options"),
  clean(access("192.0.2.0", "GET /", 200, 32110, "-", UA.uptime), "uptime monitor"),
  clean(access(IPS[0]!, "GET /search?q=swiss+chocolate+gift+box", 200, 14002, "https://shop.example/", UA.mac), "product search"),
  clean(access(IPS[1]!, "GET /blog/fondue-recipes", 200, 22190, "https://www.google.com/", UA.win), "blog page"),
  clean(access(IPS[2]!, "GET /wp-login.php", 404, 812, "-", "python-requests/2.32.3"), "scanner 404"),
  clean(access(IPS[0]!, "POST /api/v1/events", 202, 0, "https://shop.example/", UA.android), "analytics beacon"),
  clean(access(IPS[1]!, "GET /api/v1/products?ids=SKU-10023,SKU-44821,SKU-20417", 200, 3380, "https://shop.example/cart", UA.win), "product batch api"),
  clean(access(IPS[2]!, "GET /account/orders", 302, 0, "https://shop.example/", UA.iphone), "redirect to login"),
  clean(json({ level: "INFO", svc: "cart", event: "item_added", cart_id: "cart_8812", sku: "SKU-44821", qty: 2, price_chf: 24.9 }), "cart event"),
  clean(json({ level: "INFO", svc: "cart", event: "item_removed", cart_id: "cart_8812", sku: "SKU-20417", qty: 1 }), "cart event"),
  clean(json({ level: "INFO", svc: "checkout", event: "order_created", order_id: "ORD-2026-000913", items: 3, total_chf: 129.9 }), "order created"),
  clean(json({ level: "INFO", svc: "checkout", event: "payment_method_selected", order_id: "ORD-2026-000913", method: "twint" }), "payment method"),
  clean(json({ level: "INFO", svc: "payments", event: "authorized", order_id: "ORD-2026-000913", amount_chf: 129.9, psp_ref: "psp_71cQ9s" }), "payment authorized"),
  clean(json({ level: "INFO", svc: "fulfilment", event: "picked", order_id: "ORD-2026-000913", warehouse: "WH-ZH-02", items: 3 }), "fulfilment"),
  clean(json({ level: "INFO", svc: "fulfilment", event: "shipped", order_id: "ORD-2026-000913", carrier: "post", tracking: "99.60.123456.78901234" }), "shipment"),
  clean(json({ level: "INFO", svc: "search", event: "query", query: "dark chocolate 70%", results: 38, latency_ms: 21 }), "product search"),
  clean(json({ level: "INFO", svc: "search", event: "query", query: "gruyère aop 1kg", results: 4, latency_ms: 17 }), "product search"),
  clean(json({ level: "INFO", svc: "search", event: "no_results", query: "lactose free fondue", suggestions: 2 }), "product search"),
  clean(json({ level: "INFO", svc: "analytics", event: "page_view", path: "/category/chocolate", anonymous_id: "anon_77ab01", duration_ms: 5400 }), "page view"),
  clean(json({ level: "INFO", svc: "analytics", event: "click", element: "add_to_cart", path: "/products/sku-44821", anonymous_id: "anon_77ab01" }), "click event"),
  clean(json({ level: "INFO", svc: "recommendations", event: "served", model: "als-v3", sku: "SKU-44821", slots: 6 }), "recommendations"),
  clean(json({ level: "INFO", svc: "inventory", event: "stock_updated", sku: "SKU-10023", warehouse: "WH-ZH-02", qty: 118 }), "inventory"),
  clean(json({ level: "WARN", svc: "inventory", event: "low_stock", sku: "SKU-20417", qty: 3, threshold: 5 }), "inventory warning"),
  clean(json({ level: "INFO", svc: "cache", event: "purge", keys: 412, reason: "price_update" }), "cache purge"),
  clean(json({ level: "INFO", svc: "scheduler", event: "job_finished", job: "sitemap_rebuild", duration_ms: 8120, status: "ok" }), "cron job"),
  clean(json({ level: "INFO", svc: "deploy", event: "release", version: "2026.09.12-1", commit: "a41c9e2", env: "production" }), "deployment"),
  clean(json({ level: "WARN", svc: "api", event: "rate_limited", route: "/api/v1/products", client: "anon_ff0192", limit: "100/min" }), "rate limit"),
  clean(json({ level: "ERROR", svc: "payments", msg: "PSP timeout after 10000ms", order_id: "ORD-2026-000935", retry: 1 }), "payment error without PII"),
  clean(json({ level: "INFO", svc: "auth", event: "logout", user_id: "u_77120", session_id: "sess_Qm81xT0aLr" }), "logout"),
  clean(json({ level: "INFO", svc: "auth", event: "mfa_challenge_sent", user_id: "u_40022", channel: "totp" }), "mfa"),
  clean(json({ level: "INFO", svc: "support", event: "ticket_status_changed", ticket_id: "T-58213", from: "open", to: "pending", agent_id: "agent_17" }), "support status change"),
  clean(json({ level: "INFO", svc: "support", event: "ticket_opened", ticket_id: "T-58290", message: "The checkout button stays greyed out on Safari 17 after applying a coupon" }), "support ticket without PII"),
  clean(json({ level: "INFO", svc: "reviews", event: "review_posted", product: "SKU-44821", rating: 4, text: "Rich flavour, a bit too sweet for my taste." }), "anonymous review"),
  clean(text("INFO", "http", "server listening on :8080 (workers=4, keepalive=65s)"), "service start"),
  clean(text("WARN", "db", "slow query 1840ms: SELECT * FROM orders WHERE status = $1 AND created_at > $2"), "slow query"),
  clean(text("INFO", "queue", "consumer email-dispatch processed 250 messages in 3.2s (lag=0)"), "queue stats"),
  clean(text("ERROR", "cdn", "origin fetch failed for /img/products/sku-30112-800w.webp: 503 Service Unavailable"), "cdn error"),
];

// ---------------------------------------------------------------------------
// Assemble: seeded shuffle, monotonic timestamps
// ---------------------------------------------------------------------------

/** mulberry32: tiny seeded PRNG so the fixture is reproducible. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function buildFixture(seed = 20260912): { lines: string[]; labels: Label[] } {
  const rand = rng(seed);
  const entries = [...PII_ENTRIES, ...HARD_NEGATIVES, ...ROUTINE];
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [entries[i], entries[j]] = [entries[j]!, entries[i]!];
  }
  let t = Date.UTC(2026, 8, 12, 8, 0, 0); // 10:00 local (CEST)
  const lines: string[] = [];
  const labels: Label[] = [];
  entries.forEach((e, idx) => {
    t += 5_000 + Math.floor(rand() * 55_000) + Math.floor(rand() * 1000);
    lines.push(e.render(new Date(t)));
    labels.push({
      line: idx + 1,
      contains_pii: e.pii.length > 0,
      categories: e.pii,
      note: e.note,
      ...(e.hardNegative ? { hard_negative: true } : {}),
    });
  });
  return { lines, labels };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { lines, labels } = buildFixture();
  const dir = new URL("../fixtures/", import.meta.url);
  writeFileSync(new URL("web-logs.log", dir), lines.join("\n") + "\n");
  writeFileSync(new URL("web-logs.labels.json", dir), JSON.stringify(labels, null, 2) + "\n");
  const pos = labels.filter((l) => l.contains_pii).length;
  console.log(`wrote ${lines.length} lines (${pos} PII, ${lines.length - pos} clean)`);
}
