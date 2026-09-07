// Shared between the server action that starts the OAuth flow
// (initiateQuickBooksConnect) and the callback route that finishes it
// (app/api/quickbooks/callback), so they stay in sync on the cookie name
// and payload shape.
export const QUICKBOOKS_OAUTH_STATE_COOKIE = "qbo_oauth_state";

/**
 * The cookie carries the CSRF `state` value, plus who STARTED the flow.
 *
 * THE IDENTITY IN HERE IS NOT AUTHORIZATION. This comment used to say it
 * was — "possession of the cookie is itself sufficient authorization, so
 * the callback route needs no separate auth check" — and that sentence was
 * the whole of #136 §2. The cookie is plaintext JSON in the user's own
 * browser. `httpOnly` keeps page JavaScript out of it; it does nothing
 * about the person with devtools open, who can retype `companyId` as
 * somebody else's and leave `state` alone so every check still passes.
 * The callback then bound their QuickBooks realm and tokens to the
 * victim's company.
 *
 * The callback now reads companyId/userId from the authenticated session
 * and compares these to it, refusing on a mismatch. So these two fields
 * are a CROSS-CHECK — they catch a tampered cookie and they catch someone
 * switching accounts mid-flow — and `state` is the only field the route
 * relies on the cookie for.
 *
 * Worth keeping the original reasoning, because it was half right: Intuit's
 * redirect back to us is a third-party-initiated navigation, and making it
 * a middleware-PROTECTED route would bounce an expired token into a
 * re-login detour that drops the in-flight exchange. That is why the route
 * stays out of the protected matcher. It is not a reason it cannot READ a
 * session — clerkMiddleware runs on the path regardless and decorates the
 * request with the auth headers either way.
 */
export interface QuickBooksOAuthCookiePayload {
  state: string;
  companyId: string;
  userId: string;
}

/**
 * What each QuickBooks account mapping is FOR.
 *
 * `QuickBooksAccountMapping.purpose` is a plain `String` in the schema, not
 * an enum, so these are magic strings and the compiler cannot check them.
 * That is not theoretical: on 2026-09-03 the job page looked up
 * `"INVOICE_REVENUE"` — a value that has never existed — and got null. The
 * invoice button then disabled itself with "No QuickBooks account is mapped
 * for invoice revenue" while Settings, reading the same table with the
 * right key, displayed the mapping as present. Both screens were honest and
 * they disagreed, which cost a browser test its second run.
 *
 * Declared here, in a module with no "use server", so the page, the actions
 * and the settings UI all name the same values and a typo is a type error
 * rather than a silent null. Changing a value here is a data migration:
 * existing rows carry the old string.
 */
export const QUICKBOOKS_ACCOUNT_PURPOSES = [
  { value: "INCOME", label: "Invoice revenue", hint: "Where money you bill a GC lands." },
  { value: "LABOR", label: "Labor cost", hint: "Crew wages and burden." },
  { value: "MATERIAL", label: "Material cost", hint: "Board, metal, compound, finishes." },
  { value: "SUBCONTRACTOR", label: "Subcontractor cost", hint: "Lower-tier subs you hire." },
  { value: "OTHER", label: "Other cost", hint: "Equipment, permits, anything else." },
] as const;

/**
 * Every purpose the code may look up — the five Settings offers, plus
 * DEPOSIT.
 *
 * DEPOSIT IS DELIBERATELY NOT IN THE LIST ABOVE, and that asymmetry was
 * found by adding this type rather than by anyone noticing. The payment
 * push reads a DEPOSIT mapping, but Settings renders no control for it, so
 * it can never be set through the app and the lookup always returns null.
 *
 * That is harmless TODAY and by design: `buildPaymentPayload` leaves the
 * deposit account out when there is none, and QuickBooks falls back to
 * Undeposited Funds, which is the honest default rather than a guess about
 * which bank account a cheque went into. Written down because a reader
 * finding a lookup with no way to satisfy it should be told it is on
 * purpose, not left to wonder whether it is this bug again.
 */
export type QuickBooksAccountPurpose =
  | (typeof QUICKBOOKS_ACCOUNT_PURPOSES)[number]["value"]
  | "DEPOSIT";

/** Narrows a literal to a real purpose at compile time. Use it at every
 * lookup so a wrong string cannot reach the database as a silent miss. */
export function accountPurpose(purpose: QuickBooksAccountPurpose): string {
  return purpose;
}
