/**
 * ── WHY WE ARE NOT BIDDING WORK, WHICH NOTHING RECORDED ──
 *
 * `BidInvitationStatus.DECLINED` has existed since the model was written and is
 * a bare status: no reason, no date. So the app could say a bid was declined and
 * could never answer the question a sub actually asks at the end of a quarter —
 * *why are we turning work down?*
 *
 * The answers are different businesses. Declining eight bids for CAPACITY means
 * hire, or raise prices. Eight for SCOPE means the GCs inviting you have the
 * wrong idea of what you do. Eight for CONTRACT_TERMS means one GC's paper is
 * costing you the relationship. Same count, three different decisions, and
 * before this the count was all there was.
 *
 * ── RECORDING IS ASKED FOR AND NEVER REQUIRED ──
 *
 * A reason could be mandatory on the decline form. It must not be, and the
 * failure mode is specific: forced into a required dropdown to get past a
 * screen, people pick the first option. The data then looks complete and is
 * fiction, which is worse than blank — a blank is visibly missing and a wrong
 * reason gets counted and acted on.
 *
 * So `declineReason` is nullable and `summariseDeclines` reports the unrecorded
 * ones AS THEIR OWN NUMBER rather than dropping them or folding them into
 * OTHER. The same posture as `conceptual-estimate.ts` always returning its
 * sample size, and `bid-outcome.ts` stating how many jobs it excluded: a figure
 * is reported with how much of the data it rests on.
 *
 * ── AND NOTHING HERE IS A VERDICT ──
 *
 * No "you should bid more", no target decline rate, no flag on a GC who gets
 * declined often. The house rule, stated by `bid-responsiveness.ts` of itself
 * and by `indirect-costs.ts`: this product names what is there and leaves the
 * conclusion to the person. A sub declining 60% of invitations may be correctly
 * busy, and an app that nags about it would be wrong most of the time while
 * sounding authoritative.
 */

/** Why a bid was declined. Mirrors `BidDeclineReason` in `estimating.prisma`. */
export type DeclineReason =
  | "CAPACITY"
  | "SCOPE_MISMATCH"
  | "SCHEDULE"
  | "BONDING"
  | "CONTRACT_TERMS"
  | "DRAWINGS_INCOMPLETE"
  | "PRICE_RISK"
  | "RELATIONSHIP"
  | "OTHER";

/**
 * What each reason says, in the estimator's own words.
 *
 * A `Record` over the union rather than a lookup with a fallback, so adding a
 * member to the enum fails the BUILD here instead of rendering a raw
 * `CONTRACT_TERMS` on screen. The same move `bid-recap.ts`'s `MARKUP` makes,
 * and its own comment says that is the entire point of the type.
 */
export const DECLINE_REASONS: Record<DeclineReason, { label: string; hint: string }> = {
  CAPACITY: {
    label: "No capacity",
    hint: "The crew is committed. Bidding it would mean winning work we cannot staff.",
  },
  SCOPE_MISMATCH: {
    label: "Not our scope",
    hint: "The trade scope is not what we do, or is mostly work we would have to sub out.",
  },
  SCHEDULE: {
    label: "Schedule does not work",
    hint: "The dates clash with committed work, or the duration is not buildable.",
  },
  BONDING: {
    label: "Bonding or capital",
    hint: "The bond requirement or the cash flow is beyond what we can carry.",
  },
  CONTRACT_TERMS: {
    label: "Contract terms",
    hint: "Liquidated damages, retainage, pay-when-paid or indemnity we will not sign.",
  },
  DRAWINGS_INCOMPLETE: {
    label: "Drawings too incomplete to price",
    hint: "Not enough information to put a number on it without carrying the risk ourselves.",
  },
  PRICE_RISK: {
    label: "Too risky to price",
    hint: "Volatile material, an unclear existing condition, or a scope that will grow.",
  },
  RELATIONSHIP: {
    label: "Not this GC",
    hint: "Payment history, how the last job went, or how this one is being run.",
  },
  OTHER: {
    label: "Something else",
    hint: "Write it down — a reason nobody can read is a reason nobody can act on.",
  },
};

/** What a reason is called on screen. */
export function declineLabel(reason: DeclineReason): string {
  return DECLINE_REASONS[reason].label;
}

/** A declined bid, as much of one as this module needs. */
export type DeclinedBid = {
  id: string;
  /** Null when nobody recorded why — a first-class case, not a gap to fill. */
  declineReason: DeclineReason | null;
  /** The ESTIMATED value of the work turned down, where one is known. */
  estimatedValue: number | null;
};

export type DeclineGroup = {
  reason: DeclineReason;
  label: string;
  count: number;
  /** Total estimated value, and how many of the group carried one. A sum over
   *  three of eight bids is not the value of eight. */
  value: number;
  valuedCount: number;
};

export type DeclineSummary = {
  total: number;
  groups: DeclineGroup[];
  /**
   * Declines with no reason recorded. Reported as its own number and never
   * folded into OTHER — "nobody wrote it down" and "the estimator chose
   * Something else" are different facts, and merging them would make the data
   * look more complete than it is.
   */
  unrecorded: number;
  /** The one sentence to put beside the list, or null when there is nothing
   *  to summarise. */
  headline: string | null;
};

/**
 * Summarise a set of declined bids by reason.
 *
 * Groups are ordered by COUNT and not by value, because the question is what
 * keeps happening. One large job turned down for bonding is an event; five
 * small ones turned down for capacity is a business problem, and ordering by
 * value would print the event first.
 */
export function summariseDeclines(declines: readonly DeclinedBid[]): DeclineSummary {
  const byReason = new Map<DeclineReason, DeclineGroup>();
  let unrecorded = 0;
  for (const bid of declines) {
    if (bid.declineReason === null) {
      unrecorded += 1;
      continue;
    }
    const existing = byReason.get(bid.declineReason) ?? {
      reason: bid.declineReason,
      label: declineLabel(bid.declineReason),
      count: 0,
      value: 0,
      valuedCount: 0,
    };
    existing.count += 1;
    if (bid.estimatedValue !== null && Number.isFinite(bid.estimatedValue)) {
      existing.value += bid.estimatedValue;
      existing.valuedCount += 1;
    }
    byReason.set(bid.declineReason, existing);
  }

  const groups = [...byReason.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
  const total = declines.length;

  return {
    total,
    groups,
    unrecorded,
    headline: headlineFor(total, groups, unrecorded),
  };
}

/**
 * The sentence beside the list.
 *
 * It states the commonest reason and NOTHING about whether that is good. It
 * also always says how many had no reason recorded, when any did — a summary
 * that silently rests on half the data is the shape this file exists to avoid.
 */
function headlineFor(total: number, groups: readonly DeclineGroup[], unrecorded: number): string | null {
  if (total === 0) return null;
  const bids = `${total} ${total === 1 ? "bid" : "bids"}`;
  if (groups.length === 0) {
    return `${bids} declined, with no reason recorded on any of them.`;
  }
  const top = groups[0];
  const most =
    groups.length === 1
      ? `all for ${top.label.toLowerCase()}`
      : `most often for ${top.label.toLowerCase()} (${top.count} of ${total})`;
  const missing = unrecorded > 0 ? ` ${unrecorded} had no reason recorded.` : "";
  return `${bids} declined, ${most}.${missing}`;
}

/**
 * What the three decline columns become for a given status.
 *
 * ── A DECISION, NOT PLUMBING, WHICH IS WHY IT IS NOT INLINE IN THE ACTION ──
 *
 * Moving a bid OFF `DECLINED` clears all three. A bid re-opened because the GC
 * extended the date must not keep "declined for capacity on the 3rd" hanging
 * off it: read later that is the decision that stands, and it is the decision
 * that was reversed. The schema deliberately has no check constraint doing
 * this — a constraint would make the re-open fail to save instead — so the rule
 * lives in code, and a rule written inline in an action is one no test can
 * reach. Same reason `errorBandText` and `evidenceOrder` are pure.
 *
 * `declinedOn` defaults to NOW only when the caller supplies nothing. A decline
 * is nearly always recorded the day it is decided, and the form carries the
 * field so a decision made last week can say so — this app's rule is that
 * dates which matter are entered, and the default is a convenience rather than
 * a stamp.
 */
export function declineFieldsFor(input: {
  status: string;
  reason: DeclineReason | null;
  note: string | null;
  on: Date | null;
}): { declineReason: DeclineReason | null; declineNote: string | null; declinedOn: Date | null } {
  if (input.status !== "DECLINED") {
    return { declineReason: null, declineNote: null, declinedOn: null };
  }
  return {
    declineReason: input.reason,
    declineNote: input.note,
    declinedOn: input.on ?? new Date(),
  };
}
