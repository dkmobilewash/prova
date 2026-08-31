import {
  RENEWAL_HORIZON_DAYS,
  type Renewal,
  type RenewalKind,
} from "@/lib/compliance-expiry";

/**
 * Deciding what is worth telling somebody, and — the harder half — what we
 * have already told them.
 *
 * The detection problem was solved by `compliance-expiry.ts`: it knows what
 * is expiring and how urgently. Nothing here re-derives that. What this adds
 * is the thing that separates an alert from a nag.
 *
 * **A COI expiring in thirty days is still true tomorrow.** Notify on the
 * state and you send the same sentence thirty mornings running, and the
 * person learns to filter you — which is the 6.3-platforms-and-abandon
 * pattern the competitor research describes, self-inflicted. So nothing here
 * notifies on a state. It notifies on a MILESTONE being crossed, once, ever.
 *
 * The milestone is part of the notice's identity, not the date it was sent.
 * That makes a run idempotent by construction: run it twice, run it at 2am
 * and again at 9am, and the second run has nothing to say.
 */

/** The rungs, per kind, most distant first.
 *
 * Anchored on the kind's own horizon rather than a fixed ladder, because
 * `RENEWAL_HORIZON_DAYS` already encodes the thing that matters: a licence
 * renewal goes through a state board and needs sixty days' warning, a COI is
 * a phone call to a broker. Three rungs and no more —
 *
 *   the horizon  → start dealing with this
 *   seven days   → this is now urgent
 *   zero         → you are non-compliant as of today
 *
 * Deliberately not a rung every fortnight. Three emails over the life of a
 * document is a system somebody keeps reading; eight is one they filter.
 */
export function milestonesFor(kind: RenewalKind): number[] {
  const horizon = RENEWAL_HORIZON_DAYS[kind];
  return [...new Set([horizon, 7, 0])].filter((d) => d >= 0).sort((a, b) => b - a);
}

/** Identity of one notice: this record, at this rung.
 *
 * NOT the date. A dispatch keyed on the day it was sent would fire again
 * tomorrow, which is the whole failure this exists to avoid.
 */
export function dispatchKey(renewalId: string, kind: RenewalKind, milestone: number): string {
  return `${kind}:${renewalId}:${milestone}`;
}

export type DueNotice = {
  renewal: Renewal;
  /** The rung that fired — the tightest one crossed. */
  milestone: number;
  /**
   * Looser rungs this notice also passes, which must be recorded as spent.
   *
   * A record added five days before it lapses has crossed sixty, thirty and
   * seven all at once. It should produce ONE notice at seven — not three
   * emails in one run, and not a stale "expires in 60 days" for something
   * expiring on Friday. Burning the passed rungs is what stops them firing
   * later, one per day, as the date approaches.
   */
  alsoSpent: number[];
};

/**
 * What to send today, given what has already been sent.
 *
 * Two properties worth stating because both are ways to be quietly wrong:
 *
 * - **A late-added record still gets a notice.** Add a COI five days before
 *   expiry and you get the seven-day warning. Silence — on the grounds that
 *   the sixty- and thirty-day rungs passed while nobody had told us the
 *   document existed — would be the worst possible behaviour, because the
 *   whole point is catching the one nobody was watching.
 * - **Undated records never notify.** `renewalAlerts` surfaces them, and it
 *   is right to: a COI with no expiry recorded is a gap worth seeing. But
 *   there is no date to cross a rung, so there is nothing to say TODAY, and
 *   an alert with no date in it is one nobody can act on.
 */
export function noticesDue(
  renewals: Renewal[],
  alreadySent: ReadonlySet<string>,
): DueNotice[] {
  const due: DueNotice[] = [];

  for (const renewal of renewals) {
    // Undated: surfaced by renewalAlerts, never notified. This guard is
    // load-bearing, not defensive — `null <= 0` is TRUE in JavaScript, so
    // without it every undated record would cross the expiry rung and be
    // reported as lapsed. A COI with no date recorded is a gap worth
    // seeing on a page; it is not a document that has expired.
    const days = renewal.daysUntil;
    if (days === null) continue;

    const rungs = milestonesFor(renewal.kind);
    // Crossed means the remaining days have reached or passed the rung.
    // Expired records (negative days) have crossed every rung including 0.
    const crossed = rungs.filter((rung) => days <= rung);
    const unsent = crossed.filter(
      (rung) => !alreadySent.has(dispatchKey(renewal.id, renewal.kind, rung)),
    );
    if (unsent.length === 0) continue;

    // Tightest rung wins: it is the one that describes the situation now.
    // The looser ones are spent so they can never fire behind it.
    const milestone = Math.min(...unsent);
    due.push({
      renewal,
      milestone,
      alsoSpent: unsent.filter((rung) => rung !== milestone),
    });
  }

  // Most urgent first — the order a person should read them in, and the
  // order they would be listed in a digest.
  return due.sort((a, b) => {
    if (a.milestone !== b.milestone) return a.milestone - b.milestone;
    const ad = a.renewal.daysUntil ?? 0;
    const bd = b.renewal.daysUntil ?? 0;
    if (ad !== bd) return ad - bd;
    return a.renewal.title.localeCompare(b.renewal.title);
  });
}

/** Every key a notice consumes — the rung that fired plus the ones it passed.
 * All of them are written together, or none are: a partially recorded notice
 * would fire its unrecorded rungs again tomorrow. */
export function keysConsumed(notice: DueNotice): string[] {
  return [notice.milestone, ...notice.alsoSpent].map((rung) =>
    dispatchKey(notice.renewal.id, notice.renewal.kind, rung),
  );
}

/** How a rung reads to a person. */
export function milestoneLabel(milestone: number): string {
  if (milestone === 0) return "expired";
  return `${milestone} days out`;
}

/** The subject line for a run. Names the count and the worst thing in it,
 * because a subject that just says "Prova alerts" is one people stop
 * opening. */
export function digestSubject(notices: DueNotice[]): string {
  if (notices.length === 0) return "";
  const expired = notices.filter((n) => n.milestone === 0).length;
  const noun = notices.length === 1 ? "item" : "items";
  if (expired > 0) {
    return `${expired} expired, ${notices.length} compliance ${noun} need attention`;
  }
  const soonest = notices[0];
  return notices.length === 1
    ? `${soonest.renewal.title} expires in ${soonest.renewal.daysUntil} days`
    : `${notices.length} compliance ${noun} need attention`;
}
