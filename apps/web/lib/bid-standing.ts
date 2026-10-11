/**
 * ── WHAT EACH LIVE BID NEEDS FROM SOMEBODY TODAY ──
 *
 * `/pipeline` has counted overdue bids since it was built:
 *
 *     overdue: dueDate !== null && dueDate < today      // bid-pipeline-query.ts
 *
 * **There is no status in that line**, and `live` holds both `INVITED` and
 * `SUBMITTED`. So a bid that was submitted on time and is waiting on the GC —
 * the normal state of every bid anybody has ever sent — counts as overdue from
 * the day after the deadline, forever.
 *
 * A desk with ten bids out for award reads *"10 past the date they asked for"*
 * in red. Nothing is wrong with any of them. And the one bid that was never
 * submitted at all is in there too, indistinguishable.
 *
 * That is the shape `addenda-overlap.ts` names in its own words — *"a warning
 * that is almost always uninformative, which is a warning nobody reads"* — and
 * `takeoff-currency.ts` refuses same-day supersession for the same reason:
 * *"calling that superseded would cry wolf on every plan."*
 *
 * ── THE FOUR STATES, AND WHY EACH IS SEPARATE ──
 *
 *   DUE_SOON   invited, deadline within a few days, nothing sent. The only one
 *              that can still be acted on. Once it is overdue the work is
 *              already wasted, so this is the warning that is worth anything.
 *   MISSED     invited, past the deadline, never submitted and never declined.
 *              Either the bid was missed, or it went out and nobody recorded
 *              it — both want somebody today, for different reasons.
 *   COLD       submitted, long past the deadline, no outcome recorded. Step 9's
 *              follow-up: the GC has been sitting on it, or it was awarded and
 *              nobody told us.
 *   FINE       everything else, including a bid submitted last week whose date
 *              has just passed. Silence is the right answer there.
 *
 * ── NO SCHEMA CHANGE, AND ONE CONSEQUENCE OF THAT ──
 *
 * `BidInvitation` records no `submittedAt`, so "how long has this been out"
 * is measured from the DUE DATE rather than from the day it was sent. That is
 * sound for `COLD` — a bid due eight weeks ago has been with the GC roughly
 * that long — and it is the reason `COLD` needs a generous threshold rather
 * than a tight one.
 */

export type Standing = "DUE_SOON" | "MISSED" | "COLD" | "FINE";

/** A live bid, as `/pipeline` already holds it. */
export type StandingBid = {
  id: string;
  projectName: string;
  contactName: string;
  status: "INVITED" | "SUBMITTED";
  dueDate: string | null;
};

/**
 * How close is close enough to act on.
 *
 * Three days rather than one: a bid wants a day of work and a day to review,
 * and a warning that arrives the morning it is due is a warning about
 * something already lost.
 */
export const DUE_SOON_DAYS = 3;

/**
 * How long a submitted bid waits before it is worth chasing.
 *
 * Six weeks. GCs routinely take four to eight on a public job, so anything
 * tighter chases bids that are proceeding normally — which is the failure this
 * whole file is a correction for, reintroduced one threshold along.
 */
export const COLD_DAYS = 42;

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Null if either is
 *  unusable — a date nobody set is not a date in the past. */
export function daysUntil(from: string, to: string | null): number | null {
  if (!to) return null;
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export type BidStanding = {
  bid: StandingBid;
  standing: Standing;
  /** Days until the deadline; negative once it has passed. Null when undated. */
  days: number | null;
};

export function bidStanding(bid: StandingBid, today: string): BidStanding {
  const days = daysUntil(today, bid.dueDate);

  // AN UNDATED BID IS NOT A LATE ONE. Nothing can be said about a deadline
  // nobody recorded, and inventing one in either direction is worse than
  // silence: "fine" hides a bid due tomorrow, "missed" cries wolf on a bid
  // that was entered five minutes ago.
  if (days === null) return { bid, standing: "FINE", days: null };

  if (bid.status === "INVITED") {
    if (days < 0) return { bid, standing: "MISSED", days };
    if (days <= DUE_SOON_DAYS) return { bid, standing: "DUE_SOON", days };
    return { bid, standing: "FINE", days };
  }

  // SUBMITTED. Past its date is the NORMAL state — that is the whole point of
  // this file — so only a long wait says anything.
  if (days <= -COLD_DAYS) return { bid, standing: "COLD", days };
  return { bid, standing: "FINE", days };
}

export type StandingSummary = {
  dueSoon: BidStanding[];
  missed: BidStanding[];
  cold: BidStanding[];
};

/** Every live bid sorted into what it needs, soonest deadline first. */
export function bidStandings(bids: readonly StandingBid[], today: string): StandingSummary {
  const all = bids.map((bid) => bidStanding(bid, today)).sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  return {
    dueSoon: all.filter((one) => one.standing === "DUE_SOON"),
    missed: all.filter((one) => one.standing === "MISSED"),
    cold: all.filter((one) => one.standing === "COLD"),
  };
}

const when = (days: number): string => {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  if (days === -1) return "yesterday";
  return `${Math.abs(days)} days ago`;
};

const name = (one: BidStanding): string => `${one.bid.projectName} (${one.bid.contactName})`;

const list = (items: BidStanding[], limit = 3): string => {
  const names = items.slice(0, limit).map(name);
  const rest = items.length - names.length;
  return rest > 0 ? `${names.join(", ")} and ${rest} more` : names.join(", ");
};

/**
 * One line per thing that wants doing, or an empty list.
 *
 * SEPARATE SENTENCES rather than one count, because the three mean different
 * things and want different people: a bid due tomorrow wants an estimator this
 * afternoon, a missed one wants somebody to find out what happened, and a cold
 * one wants a phone call to the GC. Rolling them into "6 bids need attention"
 * is the number nobody reads, one level up from the one this replaces.
 */
export function standingLines(summary: StandingSummary): string[] {
  const lines: string[] = [];

  if (summary.dueSoon.length > 0) {
    const soonest = summary.dueSoon[0];
    lines.push(
      `${summary.dueSoon.length} bid${summary.dueSoon.length === 1 ? "" : "s"} not sent yet, the first due ${when(
        soonest.days ?? 0,
      )}: ${list(summary.dueSoon)}.`,
    );
  }

  if (summary.missed.length > 0) {
    lines.push(
      `${summary.missed.length} past the deadline and never sent: ${list(summary.missed)}. Either ${
        summary.missed.length === 1 ? "it was" : "they were"
      } missed, or ${summary.missed.length === 1 ? "it" : "they"} went out and nobody recorded it.`,
    );
  }

  if (summary.cold.length > 0) {
    const oldest = summary.cold[summary.cold.length - 1];
    lines.push(
      `${summary.cold.length} submitted with no answer, the oldest due ${when(oldest.days ?? 0)}: ${list(
        summary.cold,
      )}. Worth a call.`,
    );
  }

  return lines;
}
