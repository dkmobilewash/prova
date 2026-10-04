/**
 * IS THE PRICE ON THIS PROPOSAL THE PRICE THE RECAP PRODUCED?
 *
 * ── THE DEFECT, FOUND BY AUDITING THE ESTIMATING WORKFLOW 2026-10-02 ──
 *
 * `/jobs/[id]/proposal` is the GC-facing document: scope, a schedule of
 * values, a total, and the exclusions `proposals.prisma` calls *"the spine of a
 * sub's bid"*. Its total is `Σ (quantity × unitPrice)` over the job's live line
 * items, and **the page reads `JobBidRecap` nowhere at all** — verified by grep,
 * zero references.
 *
 * So a bid can carry a fully configured recap — markup per cost type,
 * escalation, material tax, overhead, profit, bond, contingency — and the
 * document that goes to the general contractor shows **none of it**, unless
 * somebody remembered to press "Apply to line prices" on the estimate tab
 * first. Nothing on the page said so. `FEATURE-AUDIT.md` concedes the same gap
 * in one clause — *"Still not yet: the GC-facing proposal printing the
 * marked-up total"* — which undersells it: the risk is not a missing feature,
 * it is a number a customer acts on being quietly low.
 *
 * ── WHY THIS DOES NOT PRINT THE RECAP TOTAL INSTEAD, WHICH WAS THE FIRST IDEA ──
 *
 * Because the schedule of values is a TABLE OF LINE PRICES a GC will add up.
 * Substituting a different grand total under it produces a document that does
 * not reconcile with itself — and a GC who adds the column and gets a different
 * answer has found a reason to distrust every other number on the page. That is
 * worse than the defect.
 *
 * The recap's own applier already does the right thing: `spreadToLines` raises
 * each line's `unitPrice` pro-rata by extended cost, largest-remainder-first for
 * the cents, so the lines and the total move together and keep adding up. The
 * document should print what that produced — or say it has not run.
 *
 * So this module invents no figure. It answers one question, and the page shows
 * a sentence. That is `bid-recap.ts`'s own rule applied one surface further on:
 * *"the thing that cannot be computed is named on screen instead of invented."*
 *
 * ── AND IT CATCHES THE SECOND CASE, WHICH IS THE EASIER ONE TO MISS ──
 *
 * Applying the recap and THEN editing a line is ordinary estimating. The moment
 * it happens, the printed prices are part marked-up and part not, and
 * `appliedAt` is still set — so a check that only asked "has it ever been
 * applied" would call that document current. `appliedTotal` is what makes the
 * difference visible: it records what was written, so a line sum that no longer
 * equals it means the lines moved afterwards.
 *
 * Pure, and in `lib/` rather than in the page, for the reason `sheetIndex.ts`
 * gives: the unit suite runs in `environment: "node"` and cannot render a
 * component, so logic that lives in a page is logic no test can reach.
 */

/** What the recap holds, structurally — so this module needs no Prisma import. */
export type RecapState = {
  /** What the rates would ADD to the direct cost, in dollars, computed live by
   *  `bidRecap()`. Zero means the rates are set to nothing and the lines are
   *  already the whole bid. */
  addedTotal: number;
  /** When the recap was last written into line prices, or null. */
  appliedAt: Date | null;
  /** The bid total at the moment it was applied, or null. */
  appliedTotal: number | null;
};

export type ProposalPriceState =
  /** No recap rates would add anything, so the line prices ARE the bid. */
  | { kind: "NO_RECAP" }
  /** Rates would add money and have never reached the line prices. */
  | { kind: "NEVER_APPLIED"; addedTotal: number }
  /** Applied, then the lines moved. Part marked-up, part not. */
  | { kind: "STALE"; appliedTotal: number; lineTotal: number }
  /** The printed prices are what the recap produced. */
  | { kind: "CURRENT" };

/**
 * Cents, because the comparison is money.
 *
 * `spreadToLines` distributes the spread largest-remainder-first, so the line
 * sum it produces is exact to the cent by construction rather than approximately
 * equal. A tolerance here would be inventing slack the applier does not need,
 * and it would hide exactly the small edit this check exists to catch — a
 * one-cent quantity change is still a change.
 */
function cents(value: number): number {
  return Math.round(value * 100);
}

/**
 * Whether the proposal's printed prices reflect the recap.
 *
 * `lineTotal` is the document's own figure — `Σ (quantity × unitPrice)` over the
 * live lines — passed in rather than recomputed, so the thing being checked is
 * the number actually on the page.
 */
export function proposalPriceState(recap: RecapState | null, lineTotal: number): ProposalPriceState {
  // No recap row, or rates that add nothing: the lines are the whole bid and
  // there is nothing to warn about. `bid-recap.prisma`'s rule is that a null
  // rate means "not applied" rather than zero, so a bid deliberately carrying
  // no markup is a real and complete state, not an unfinished one.
  if (recap === null || recap.addedTotal <= 0) return { kind: "NO_RECAP" };

  if (recap.appliedAt === null || recap.appliedTotal === null) {
    return { kind: "NEVER_APPLIED", addedTotal: recap.addedTotal };
  }

  if (cents(recap.appliedTotal) !== cents(lineTotal)) {
    return { kind: "STALE", appliedTotal: recap.appliedTotal, lineTotal };
  }

  return { kind: "CURRENT" };
}

/**
 * The sentence shown on screen and NEVER printed.
 *
 * Addressed to the person about to send the document, names the surface that
 * fixes it, and says what is at stake in money rather than in jargon — the
 * house style for a refusal, and the reason `bid-responsiveness.ts` returns
 * sentences rather than codes.
 *
 * Returns null for the two states that need no sentence, so the caller renders
 * nothing rather than an empty box.
 */
export function proposalPriceWarning(state: ProposalPriceState): string | null {
  if (state.kind === "NO_RECAP" || state.kind === "CURRENT") return null;
  if (state.kind === "NEVER_APPLIED") {
    return (
      `These prices do not include your markup. This job's bid recap would add ` +
      `${state.addedTotal.toLocaleString("en-US", { style: "currency", currency: "USD" })}, and it has ` +
      `never been written into the line prices. Open the estimate tab and press "Apply to line prices" ` +
      `before you send this.`
    );
  }
  return (
    `These prices are part marked-up and part not. The recap was applied at ` +
    `${state.appliedTotal.toLocaleString("en-US", { style: "currency", currency: "USD" })} and these lines now ` +
    `come to ${state.lineTotal.toLocaleString("en-US", { style: "currency", currency: "USD" })}, so a line has ` +
    `changed since. Re-apply the recap on the estimate tab before you send this.`
  );
}
