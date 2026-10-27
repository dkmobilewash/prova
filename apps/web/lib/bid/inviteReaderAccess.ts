/**
 * WHETHER "FILL THE FORM FROM IT" CAN READ A PASTED INVITE, decided on the
 * server before the Log-a-bid form is drawn — the same arrangement as the job
 * screen's ask box (`lib/bid/guide/askAccess.ts`), for the same reason: a box
 * that looks live and fails after somebody has pasted a whole email into it is
 * worse than a sentence saying so up front.
 *
 * WHY IT EXISTS (contractor walk, 2026-10-27). In CI, with no model key, the
 * reader claimed a question from the allowance, called the model, failed, and
 * said "That invitation couldn't be read. It is recorded as a failed question
 * on this month's allowance — the account owner can see it on Settings →
 * Assistant." Nothing was wrong with the invitation, and nothing should have
 * been charged: the server has no assistant. The ask box on the same server
 * already said "Asking isn't set up on this server yet."
 *
 * Pure and client-safe: `LogBidForm` imports the type and the sentence, and
 * `readBidInvitationText` returns the same sentence if pressed anyway (a key
 * removed after the page loaded), BEFORE it claims anything.
 */

export type InviteReaderAccess = { available: true } | { available: false; reason: string };

/** The server has no model key: nothing to read with, and nothing to charge. */
export const INVITE_READ_NOT_CONFIGURED =
  "Reading invites needs the assistant, which isn't set up on this server yet. Type the invitation in below instead.";

/** The company's own AI switch said no: its sentence, plus the way forward. */
export function inviteReadSwitchedOff(refusal: string): string {
  return `${refusal} You can still type the invitation in yourself.`;
}

export function inviteReaderAccess(facts: {
  /** `anthropicIsConfigured()` — the server has a model key at all. */
  configured: boolean;
  /** `aiFeatureRefusal(settings, "BID_RESEARCH")` — the switch the reader runs behind — or null. */
  refusal: string | null;
}): InviteReaderAccess {
  if (!facts.configured) return { available: false, reason: INVITE_READ_NOT_CONFIGURED };
  if (facts.refusal) return { available: false, reason: inviteReadSwitchedOff(facts.refusal) };
  return { available: true };
}
