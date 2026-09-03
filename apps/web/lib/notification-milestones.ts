/**
 * Deciding what is worth telling somebody who is not looking at the app,
 * and — the harder half — what we have already told them.
 *
 * Detection is not here and must never be. `lib/alerts.ts` decides what is
 * true, how urgent it is, and who is allowed to see it; this decides only
 * what has already been said. Two modules deciding urgency is two answers
 * to one question, and the one nobody is reading drifts.
 *
 * **THE PROBLEM THIS EXISTS FOR.** A COI expiring in thirty days is still
 * true tomorrow. Notify on the state and you send the same sentence thirty
 * mornings running, and the person learns to filter you — the
 * six-platforms-and-abandon pattern from the research report, self-inflicted.
 * So nothing here notifies on a state. It notifies on a MILESTONE being
 * crossed, once, ever.
 *
 * The milestone is part of the notice's identity, not the date it was sent.
 * That makes a run idempotent by construction: run it twice, run it at 2am
 * and again at 9am, and the second run has nothing to say.
 *
 * **WHY THE ALERT KEY IS NOT ENOUGH BY ITSELF.** An alert key already
 * carries the fact that would change it — `RENEWAL:lic_1:2026-11-30` — so a
 * dispatch recorded against it lapses when the licence is renewed, exactly
 * as a dismissal does. But that key is STABLE as the date approaches. Key a
 * send on it alone and the sixty-day warning goes out and nothing is ever
 * said again, including on the day the licence lapses. The rung is what
 * distinguishes "this is coming" from "this has happened" about one
 * unchanged fact.
 */

import type { Alert } from "@/lib/alerts";

/**
 * The rungs, loosest first.
 *
 * Named, not numeric, and that is the whole trick. **The engine has
 * already applied the right horizon by the time it hands an alert over.**
 * A licence goes DUE_SOON at sixty days because it goes through a state
 * board; a COI goes DUE_SOON at thirty because it is a call to a broker;
 * a backcharge at ten. Reading `severity` picks all of those up for free
 * and stays right when somebody tunes one of them.
 *
 * A numeric ladder here could not be right. `ALERT_HORIZON_DAYS` has no
 * RENEWAL entry at all — renewal horizons are per RENEWAL kind, in
 * `RENEWAL_HORIZON_DAYS`, and `Alert` flattens every one of them to the
 * single kind "RENEWAL". Keying rungs off the alert-kind table looks
 * reasonable and quietly drops the sixty-day licence warning, which is
 * the single most useful notice this feature sends. It is only a missing
 * email, so nothing fails and nobody finds out.
 *
 *   APPROACHING → the engine started calling it due soon
 *   WEEK        → seven days or fewer
 *   DUE         → the date has passed, or is today
 *
 * Three rungs over the life of a document is a system somebody keeps
 * reading; one a fortnight is one they filter.
 */
export const DATED_RUNGS = ["approaching", "week", "due"] as const;

/** What a condition with no deadline fires on. It is not a distance from
 * anything: a job forecast over contract value is true today and will be
 * true tomorrow, and putting it on the dated ladder would manufacture a
 * deadline the data does not have — the objection already written into
 * `AlertSeverity`. Once per key, and the key changes when it changes. */
export const STANDING_RUNG = "standing";

export type Rung = (typeof DATED_RUNGS)[number] | typeof STANDING_RUNG;

/** Seven days, the one number this file owns.
 *
 * It is not a horizon and does not replace one. It is the second look —
 * far enough out that a person can still act within a working week,
 * whatever the thing is. */
export const WEEK_RUNG_DAYS = 7;

/** Identity of one notice: this alert, at this rung.
 *
 * Built on the alert's own key, so everything that key already guarantees
 * comes along — renew the licence and every dispatch recorded against the
 * old date stops applying, with no expiry logic here.
 *
 * NOT the date it was sent. A dispatch keyed on the day would fire again
 * tomorrow, which is the whole failure this file exists to prevent.
 */
export function dispatchKey(alertKey: string, rung: Rung): string {
  return `${alertKey}@${rung}`;
}

export type DueNotice = {
  alert: Alert;
  /** The rung that fired — the tightest one crossed. */
  rung: Rung;
  /**
   * Looser rungs this notice also passes, which must be recorded as spent.
   *
   * A record entered five days before it lapses has crossed APPROACHING
   * and WEEK at once. It should produce ONE notice at WEEK — not two
   * emails in one run, and not a stale "start dealing with this" for
   * something expiring on Friday. Burning the passed rungs is what stops
   * them firing later, one per day, as the date approaches.
   */
  alsoSpent: Rung[];
};

/**
 * What to send now, given what has already been sent.
 *
 * Callers pass the alerts a person can actually SEE and has not silenced —
 * `partitionAlerts(...).visible`, capability-filtered. Neither of those
 * judgements is remade here: emailing somebody an alert they dismissed
 * this morning is precisely the nag, and emailing them one their role
 * hides is a permission hole with a stamp on it.
 *
 * Two properties worth naming because both are ways to be quietly wrong:
 *
 * - **A late-added record still gets a notice.** Enter a COI five days
 *   before expiry and the seven-day warning goes out. Silence — on the
 *   grounds that the looser rungs passed while nobody had told us the
 *   document existed — would be the worst available behaviour, because the
 *   one nobody was watching is the one this is for.
 * - **A dated alert with no days left to count never fires a rung.** See
 *   the guard below; it is load-bearing, not defensive.
 */
export function noticesDue(
  alerts: Alert[],
  alreadySent: ReadonlySet<string>,
): DueNotice[] {
  const due: DueNotice[] = [];

  for (const alert of alerts) {
    const crossed = crossedRungs(alert);
    const unsent = crossed.filter(
      (rung) => !alreadySent.has(dispatchKey(alert.key, rung)),
    );
    if (unsent.length === 0) continue;

    // Tightest rung wins: it is the one that describes the situation now.
    // The looser ones are spent so they can never fire behind it.
    const rung = tightest(unsent);
    due.push({ alert, rung, alsoSpent: unsent.filter((r) => r !== rung) });
  }

  return due.sort(mostUrgentFirst);
}

/** Which rungs this alert has reached, tightest last.
 *
 * A standing condition has exactly one and reaches it immediately. A dated
 * one has reached every rung at or above its remaining days — an expired
 * record (negative days) has crossed all of them, including zero.
 */
function crossedRungs(alert: Alert): Rung[] {
  if (alert.dueOn === null) return [STANDING_RUNG];

  // `null <= 0` is TRUE in JavaScript, so an alert carrying a date but no
  // computed distance would cross the DUE rung and be reported as lapsed.
  // The two fields are set independently and this costs nothing to check.
  const days = alert.daysUntil;
  if (days === null) return [];

  const crossed: Rung[] = [];
  // The engine's own judgement, per kind. A dated alert it still calls
  // STANDING is outside its horizon and has reached nothing yet.
  if (alert.severity === "DUE_SOON" || alert.severity === "OVERDUE")
    crossed.push("approaching");
  if (days <= WEEK_RUNG_DAYS) crossed.push("week");
  if (days <= 0) crossed.push("due");
  return crossed;
}

/** Tightest = furthest along the ladder. A standing rung is alone in its
 * list, so there is nothing to compare it against. */
function tightest(rungs: Rung[]): Rung {
  for (const rung of [...DATED_RUNGS].reverse()) {
    if (rungs.includes(rung)) return rung;
  }
  return STANDING_RUNG;
}

/** The order a person should read them in, and the order a digest lists
 * them. Deadlines before standing conditions; nearest deadline first;
 * money as the tiebreak, then title so the order is total and a run
 * cannot reorder itself between two identical inputs. */
function mostUrgentFirst(a: DueNotice, b: DueNotice): number {
  const aStanding = a.rung === STANDING_RUNG;
  const bStanding = b.rung === STANDING_RUNG;
  if (aStanding !== bStanding) return aStanding ? 1 : -1;

  if (!aStanding && !bStanding) {
    // Later on the ladder is more urgent, so the ladder order is reversed.
    const rank = (rung: Rung) =>
      -DATED_RUNGS.indexOf(rung as (typeof DATED_RUNGS)[number]);
    if (a.rung !== b.rung) return rank(a.rung) - rank(b.rung);
    const ad = a.alert.daysUntil ?? 0;
    const bd = b.alert.daysUntil ?? 0;
    if (ad !== bd) return ad - bd;
  }

  const amountDiff = (b.alert.amount ?? 0) - (a.alert.amount ?? 0);
  if (amountDiff !== 0) return amountDiff;
  return a.alert.title.localeCompare(b.alert.title);
}

/** Every rung a notice consumes, each paired with its own key — the rung
 * that fired plus the ones it passed. All of them are written together, or
 * none are: a partially recorded notice fires its unrecorded rungs again
 * tomorrow.
 *
 * The PAIR is what callers need, not the keys alone. `NotificationDispatch`
 * stores the rung in its own column so that "why did this person get this
 * email" is answerable with a query instead of by parsing a composite
 * string, and a caller that has only the keys has to either parse them back
 * apart or write one rung across all of them. The second is what happened:
 * every burned rung was recorded under the rung that FIRED, so a row keyed
 * `…@approaching` claimed to be a `week`. Nothing sent wrong — `dispatchKey`
 * is the only column matched on — but the column that exists to explain the
 * ledger disagreed with the ledger.
 */
export function consumed(
  notice: DueNotice,
): { dispatchKey: string; rung: Rung }[] {
  return [notice.rung, ...notice.alsoSpent].map((rung) => ({
    dispatchKey: dispatchKey(notice.alert.key, rung),
    rung,
  }));
}

/** The keys alone, for callers that match on them and record nothing. */
export function keysConsumed(notice: DueNotice): string[] {
  return consumed(notice).map((row) => row.dispatchKey);
}

/**
 * Splits notices by whether THIS run won every key they consume.
 *
 * Lives here rather than with the dispatcher because it is pure and it is
 * about the keys a notice consumes, which is this module's subject. The
 * dispatcher supplies the set of keys its own insert actually created.
 *
 * **Winning the rung that fired is not enough.** Two concurrent runs for
 * one person need not compute the same notices — a rung boundary crossed
 * between their two reads is enough for one to see `approaching` and the
 * other `approaching` + `week`. The second wins only `week`, and if that
 * counted as ownership both runs send, and one licence produces two emails
 * seconds apart. Losing ANY key a notice consumes means another run is
 * speaking about that alert right now, so this run says nothing about it.
 *
 * The notices in `theirs` must have the keys this run won for them RELEASED
 * by the caller. Left claimed, a rung would be burnt with no email behind
 * it: the tighter, newer thing to say spent by a run that stayed silent,
 * and nothing would ever say it.
 */
export function partitionOwned(
  notices: DueNotice[],
  won: ReadonlySet<string>,
): { ours: DueNotice[]; theirs: DueNotice[] } {
  const ours: DueNotice[] = [];
  const theirs: DueNotice[] = [];
  for (const notice of notices) {
    const mine = consumed(notice).every((row) => won.has(row.dispatchKey));
    (mine ? ours : theirs).push(notice);
  }
  return { ours, theirs };
}
