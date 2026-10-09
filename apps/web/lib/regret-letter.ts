import type { DeclineReason } from "./bid-decline";

/**
 * ── DECLINING WELL, WHICH IS WHAT KEEPS YOU ON THE BID LIST ──
 *
 * A sub who ignores an invitation to bid gets dropped from the GC's list. One
 * who declines politely stays on it. That is the entire business case, and the
 * estimating workflow names it: *"send a polite Regret / Decline to Bid letter
 * to the GC to maintain relationship status"*.
 *
 * `BidInvitationStatus.DECLINED` records the decision and #695 added WHY. This
 * is the outward half: a one-page letter, print-styled HTML and the browser's
 * own Save as PDF, the same mechanism the proposal and the G702/G703 use.
 *
 * ── THE INTERNAL REASON IS NOT THE OUTWARD MESSAGE, AND CONFLATING THEM IS
 *    HOW A RELATIONSHIP GETS DAMAGED ──
 *
 * The reason recorded on a bid is for the sub's own reporting. "We will not
 * sign your indemnity", "we have been paid late by this GC before" and "the
 * drawings were not complete enough to price" are all true, all useful
 * internally, and none of them belong in a letter whose purpose is to be
 * invited again.
 *
 * `proposal/page.tsx` already states this rule for a different document — *"a
 * note on the PRINTED page would be telling a customer our prices may be
 * wrong, which is a different and much worse sentence"* — and it is copied
 * rather than re-argued.
 *
 * ── EXCEPT FOR THREE, WHERE SAYING IT HELPS BOTH SIDES ──
 *
 * `SCOPE_MISMATCH` is the one worth the trouble. A GC inviting a drywall sub to
 * bid a glazing package will keep doing it until somebody says so, and the
 * sentence that stops it is good for both. `CAPACITY` and `SCHEDULE` are
 * neutral facts about the sub's own book that reflect on nobody.
 *
 * The other six are omitted, and the page SAYS so where the sender can see it
 * and the GC cannot. An omission nobody is told about reads as a bug.
 */

/**
 * The sentence a reason contributes to the letter, or null when it stays
 * internal.
 *
 * A `Record` over the whole union rather than a lookup with a fallback, so
 * adding a reason to the enum fails the BUILD here instead of silently
 * defaulting to "say nothing" — which is the safe direction and exactly the
 * reason a new member must be considered rather than inherited.
 */
const SHAREABLE: Record<DeclineReason, string | null> = {
  CAPACITY: "Our crews are committed through this period, so we are not in a position to price it properly.",
  SCHEDULE: "The schedule for this package does not fit alongside work we are already committed to.",
  SCOPE_MISMATCH:
    "This package sits outside the scope we take on. We would welcome an invitation on work in our own trade.",

  // ── THE SIX THAT STAY INTERNAL, each for its own reason ──
  //
  // BONDING: our balance sheet is nobody else's business, and saying it invites
  // being passed over on work we could carry.
  BONDING: null,
  // CONTRACT_TERMS: a refusal to sign is a negotiating position, not a
  // farewell note. Say it in the negotiation, if there is one.
  CONTRACT_TERMS: null,
  // DRAWINGS_INCOMPLETE: true and still a criticism of the GC's architect,
  // delivered at the moment we are asking to be invited again.
  DRAWINGS_INCOMPLETE: null,
  // PRICE_RISK: reads as "we could not work out how to price this", which is
  // the opposite of the impression this letter exists to leave.
  PRICE_RISK: null,
  // RELATIONSHIP: the one reason that must never be printed. It is about this
  // GC, and the letter is addressed to them.
  RELATIONSHIP: null,
  // OTHER: whatever was typed in the note is uncontrolled text and cannot be
  // vetted by this module. The sender can add it themselves.
  OTHER: null,
};

/** The sentence this bid's reason contributes, or null. */
export function shareableSentence(reason: DeclineReason | null): string | null {
  if (reason === null) return null;
  return SHAREABLE[reason];
}

/**
 * Why a recorded reason is NOT in the letter — shown to the SENDER only.
 *
 * Returns null when there is nothing to explain: no reason recorded, or a
 * reason that is in the letter. A sentence on every letter would be noise, and
 * noise on a document somebody is about to send is read past.
 */
export function omissionNote(reason: DeclineReason | null): string | null {
  if (reason === null || SHAREABLE[reason] !== null) return null;
  return (
    "The reason recorded on this bid is deliberately not in the letter. It is " +
    "for your own records, and this document exists to keep you on their bid " +
    "list — add anything you do want said in your own words before you send it."
  );
}

export type RegretLetterFacts = {
  /** The sub — whoever is declining. */
  fromCompany: string;
  /** The GC's company. */
  toCompany: string;
  /** A person there, where one is known. */
  toPerson: string | null;
  projectName: string;
  /** The bid date, as printed. Null when the invitation carried none. */
  dueDate: string | null;
  /** The trade this sub does, in words, for the "invite us for this" line. */
  tradeScope: string | null;
  reason: DeclineReason | null;
};

export type RegretLetter = {
  greeting: string;
  /** The paragraphs, in order. Already decided — the page only renders them. */
  paragraphs: string[];
  signOff: string;
  /** For the sender, never printed. Null when there is nothing to say. */
  senderNote: string | null;
};

/**
 * Compose the letter.
 *
 * Every sentence is decided here rather than in JSX, for the reason
 * `errorBandText` and `evidenceOrder` are pure: the wording of an outward
 * document is a decision, and a decision written inline in a component is one
 * no test can reach.
 *
 * ── WHAT IT ALWAYS SAYS, AND WHY EACH PART IS THERE ──
 *
 *   - that we are not bidding THIS package, named, so it cannot be mistaken
 *     for another one;
 *   - thanks for the invitation, because that is the whole point;
 *   - that we want the next one. A regret letter without that sentence is a
 *     resignation.
 *
 * What it never says: a price, an apology that reads as incompetence, or any
 * commitment about future availability we would have to honour.
 */
export function regretLetter(facts: RegretLetterFacts): RegretLetter {
  const greeting = facts.toPerson ? `Dear ${facts.toPerson},` : `To the estimating team at ${facts.toCompany},`;

  const named = facts.dueDate
    ? `${facts.projectName}, bidding ${facts.dueDate}`
    : facts.projectName;

  const paragraphs: string[] = [
    `Thank you for inviting ${facts.fromCompany} to bid ${named}. ` +
      `After reviewing the documents we have decided not to submit a price on this one.`,
  ];

  const shareable = shareableSentence(facts.reason);
  if (shareable !== null) paragraphs.push(shareable);

  // THE SENTENCE THE LETTER EXISTS FOR. Last, because it is what should be
  // remembered, and specific about the trade where we know it — "keep us in
  // mind" is forgettable and "invite us on metal framing and drywall" is a
  // note somebody can act on.
  paragraphs.push(
    facts.tradeScope
      ? `We would very much like to be included on your next ${facts.tradeScope} package, and we will be ready to price it.`
      : `We would very much like to be included on your next project, and we will be ready to price it.`,
  );

  return {
    greeting,
    paragraphs,
    signOff: `Thank you again for thinking of us.`,
    senderNote: omissionNote(facts.reason),
  };
}
