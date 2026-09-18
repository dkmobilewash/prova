/**
 * "Hide this" on the getting-started card, remembered per browser.
 *
 * A cookie rather than a column because it is a UI preference about one
 * card, not a fact about the business — no migration, and nothing for the
 * derived steps to disagree with. It is read on the SERVER, in the
 * dashboard page, so the decision to render the card is made once, before
 * any markup exists; the browser never reads it during render, so the
 * server and client markup cannot disagree about it.
 *
 * The value is the company id rather than a bare "1", so hiding the card
 * for one account does not hide it for a different account signed in on
 * the same browser later.
 *
 * Not a "use server" module: those may only export async functions, and
 * this exports a constant.
 */
export const GETTING_STARTED_HIDDEN_COOKIE = "prova_getting_started_hidden";

/** A year. Long enough that "hide" means hide; a cleared browser shows it
 * again, which is harmless — the steps are derived, so they are still
 * right. */
export const GETTING_STARTED_HIDDEN_MAX_AGE = 60 * 60 * 24 * 365;

export function isGettingStartedHidden(cookieValue: string | undefined, companyId: string): boolean {
  return cookieValue !== undefined && cookieValue === companyId;
}
