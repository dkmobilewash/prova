/**
 * What a bid adds up to, once the alternates, unit prices and allowances are
 * on it.
 *
 * `BidInvitation.bidAmount` is one figure and a GC's bid form almost never
 * asks for one. The three kinds of line this module totals sit in three
 * different places relative to that figure, and the whole file exists because
 * mixing them up produces a number that reads perfectly and is wrong:
 *
 *   ALLOWANCE  — already INSIDE the base bid. Adding it double-counts it.
 *   ALTERNATE  — OUTSIDE the base. Changes the award only if the GC takes it,
 *                and may be a DEDUCT (a negative amount).
 *   UNIT PRICE — not an amount at all. A rate for future change work, with no
 *                quantity. Summing it is meaningless.
 *
 * THE FAILURE THIS GUARDS IS SILENT. A bid that double-counts a $15,000
 * allowance goes out $15,000 high and nothing on the page looks wrong — the
 * allowance is genuinely part of the job, the arithmetic is genuinely
 * addition, and only somebody reconciling against the GC's own form would
 * catch it. So the totals below never take a bare list: each figure names
 * which kinds it drew from, and unit prices have no `amount` column to be
 * picked up by a careless reduce in the first place.
 *
 * Pure. No database, no React.
 */

export type BidLineKind = "ALTERNATE" | "UNIT_PRICE" | "ALLOWANCE";

export type BidLineInput = {
  kind: BidLineKind;
  label: string;
  /** ALTERNATE: signed — negative is a deduct. ALLOWANCE: positive, already
   * inside the base. UNIT_PRICE: null. */
  amount: number | null;
  unit: string | null;
  unitPrice: number | null;
  /** ALTERNATE only. Null means the GC has not said, which is not the same
   * as rejected. */
  accepted: boolean | null;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

const isAlternate = (line: BidLineInput) => line.kind === "ALTERNATE";
const isAllowance = (line: BidLineInput) => line.kind === "ALLOWANCE";

/** Only the lines that carry a usable amount. A kind that should have one and
 * does not is skipped rather than counted as zero — an alternate with no
 * figure is an unfinished thought, and folding it in as nothing would make
 * the total look complete. */
const amountOf = (line: BidLineInput): number | null =>
  typeof line.amount === "number" && Number.isFinite(line.amount) ? line.amount : null;

export type BidTotals = {
  /** The base bid as recorded on the invitation. Null when none was entered. */
  base: number | null;

  /** Allowances carried INSIDE the base. Reported so the estimator can see
   * how much of their own number is undefined scope — NEVER added to it. */
  allowancesCarried: number;
  allowanceCount: number;

  /** Every alternate offered, added up, regardless of acceptance. A deduct
   * pulls this down, which is correct: it is what the alternates are worth in
   * total if the GC takes all of them. */
  alternatesOffered: number;
  alternateCount: number;

  /** Only the alternates the GC has ACCEPTED. */
  alternatesAccepted: number;
  acceptedCount: number;
  /** Alternates the GC has neither accepted nor rejected. Surfaced because an
   * award total computed while these are outstanding is provisional, and the
   * screen should say so rather than look settled. */
  undecidedCount: number;

  /** Base plus accepted alternates — what the job is worth on today's
   * answers. Null without a base, because "the alternates come to $4,000" is
   * not an award. */
  awardedTotal: number | null;

  /** How many unit prices are held. They contribute to NO total here and
   * cannot: they have no amount. Counted so the screen can show they exist. */
  unitPriceCount: number;
};

export function bidTotals(base: number | null, lines: BidLineInput[]): BidTotals {
  const allowances = lines.filter(isAllowance);
  const alternates = lines.filter(isAlternate);
  const unitPrices = lines.filter((line) => line.kind === "UNIT_PRICE");

  const sum = (rows: BidLineInput[]) =>
    round2(rows.reduce((total, line) => total + (amountOf(line) ?? 0), 0));

  const accepted = alternates.filter((line) => line.accepted === true);
  const alternatesAccepted = sum(accepted);

  return {
    base,
    // NOT added to anything. See the header.
    allowancesCarried: sum(allowances),
    allowanceCount: allowances.length,
    alternatesOffered: sum(alternates),
    alternateCount: alternates.length,
    alternatesAccepted,
    acceptedCount: accepted.length,
    undecidedCount: alternates.filter((line) => line.accepted === null).length,
    awardedTotal: base === null ? null : round2(base + alternatesAccepted),
    unitPriceCount: unitPrices.length,
  };
}

/** What is wrong with a line as typed, or null. One place, so the form and
 * the Server Action refuse the same things for the same reasons. */
export function bidLineProblem(line: BidLineInput): string | null {
  if (!line.label.trim()) {
    return "Give this a label — the one the GC's bid form uses, so you can both find it.";
  }

  if (line.kind === "UNIT_PRICE") {
    if (line.unitPrice === null || !Number.isFinite(line.unitPrice)) {
      return "A unit price needs a rate.";
    }
    if (line.unitPrice < 0) {
      return "A unit price cannot be negative — it is a rate, not an adjustment.";
    }
    if (!line.unit?.trim()) {
      return "Say what the rate is per — SF, LF, each — in the words the GC used.";
    }
    // A rate with an amount would be a number nothing can interpret.
    if (line.amount !== null) {
      return "A unit price holds a rate, not a total.";
    }
    return null;
  }

  if (line.amount === null || !Number.isFinite(line.amount)) {
    return line.kind === "ALTERNATE" ? "An alternate needs an amount to add or deduct." : "An allowance needs an amount.";
  }
  if (line.kind === "ALLOWANCE" && line.amount < 0) {
    // A negative allowance is not a thing: an allowance is money set aside
    // inside the bid, and money set aside cannot be negative.
    return "An allowance is money carried inside the bid, so it cannot be negative.";
  }
  if (line.kind === "ALTERNATE" && line.amount === 0) {
    return "An alternate of zero changes nothing — give it an add or a deduct.";
  }
  if (line.unitPrice !== null || line.unit !== null) {
    return "Only a unit price carries a rate.";
  }
  return null;
}

/** How an alternate reads in a sentence: "Alternate 2 — ADD $12,400", or
 * DEDUCT. The direction is stated in words as well as by the sign, because a
 * minus sign in a table is the easiest thing on a bid document to miss. */
export function alternateDirection(amount: number | null): "ADD" | "DEDUCT" | null {
  if (amount === null || !Number.isFinite(amount) || amount === 0) return null;
  return amount > 0 ? "ADD" : "DEDUCT";
}
