import { readSupportAddress } from "@/lib/help-config";

/**
 * WHERE A CONTRACTOR SENDS THE DRAWING SET — and therefore whether the free
 * read is open at all.
 *
 * Read through one function so THE PAGE CAN NEVER OFFER A PATH THE ACTION
 * THEN REFUSES. That is `helpChannelFromEnv`'s own reason, in
 * `lib/help-config.ts`, and it is the right shape here for a sharper reason:
 * this form's whole promise is that we will read a file they send us. With no
 * address to send it to, a form that takes their name is worse than a page
 * that says "not open yet" — it collects a lead against a promise nothing can
 * keep, and the contractor sits waiting for an email that is waiting for them.
 *
 * So `/wall-takeoff` renders the offer as CLOSED when this is null, and
 * `requestDrawingSetRead` refuses independently rather than trusting that the
 * page checked. Two reads of one function, which is cheap, versus a lead
 * created by a POST that skipped the page.
 *
 * `SUPPORT_EMAIL` rather than a new variable: it is already the address a
 * person reaches us on, already validated with the same permissive check
 * every outbound address in this app goes through, and one fewer thing to set
 * before this page works. `readSupportAddress` returns null for a TYPO as
 * well as for an unset value, which is the case that matters — a dead
 * `mailto:` on a public page looks exactly like a working one.
 */
export function offerIntakeAddress(): string | null {
  return readSupportAddress(process.env);
}

export function offerIsOpen(): boolean {
  return offerIntakeAddress() !== null;
}
