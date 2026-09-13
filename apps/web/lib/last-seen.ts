/**
 * Usage visibility: when was this person last actually here.
 *
 * Five design partners get logins, and the one who quietly stops signing
 * in is invisible until somebody notices on a weekly call — which is after
 * the decision to leave has already been made. `User.lastSeenAt` is the
 * smallest honest instrument for that: one nullable timestamp, written by
 * `recordLastSeen` (lib/last-seen-stamp.ts) from inside
 * `requireCompanyContext`, read by the operator-only page at
 * /internal/usage.
 *
 * TWO HALVES, AND THE SPLIT IS THE POINT.
 *
 * `lastSeenAt` is a recorded FACT — an authenticated request happened at
 * this instant. It is not derived from anything and nothing else in the
 * schema implies it, which is why storing it does not break CLAUDE.md's
 * derived-state rule.
 *
 * "Active" and "quiet" are DERIVED, and this file is where they are
 * derived — at read time, from the timestamp and the clock, every render.
 * Nothing stores an `isActive` flag, because the day after it is written
 * it disagrees with the column it came from and there is no event that
 * would correct it. Same rule as every expiry in this schema (licences,
 * insurance, bonds, MSAs): store the date, compute the state.
 *
 * Pure on purpose — no prisma, no request, no React — so the throttle
 * boundary and the status bands can be pinned in lib/last-seen.test.ts
 * without a database. The one function that writes lives in its own
 * module for exactly that reason.
 */

/**
 * How stale the stored value must be before another write is worth it.
 *
 * `requireCompanyContext` runs on EVERY authenticated request, and one
 * page load is many requests (the layout, the page, each Server Action,
 * every RSC navigation). Writing on each one would put a database write
 * behind every render in the app, on the pooled Neon endpoint with
 * `connection_limit=5`, to record something nobody reads at finer than
 * daily resolution.
 *
 * 15 minutes, chosen against what the number is FOR rather than by feel:
 *
 *   - the question is "is this person still logging in", asked by a human
 *     looking at a list once a day or once a week. A value accurate to
 *     within a quarter of an hour is far finer than that question needs;
 *   - it bounds the cost at 4 writes per person per hour of continuous
 *     use, instead of one per request — call it three orders of magnitude
 *     for an active session;
 *   - it is shorter than a sitting, so a person who opens the app, works
 *     for an hour and leaves still has a timestamp from near the END of
 *     that hour rather than the start. A one-per-day throttle would lose
 *     that and nobody would notice it had.
 *
 * A caller may pass its own interval; the test does, so the boundary is
 * proved rather than approximated by waiting.
 */
export const LAST_SEEN_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Is it time to write a new `lastSeenAt` for this person?
 *
 * Null means nobody has ever recorded one — the state every existing row
 * is in the moment the migration lands, since the column is nullable with
 * no backfill — and that stamps immediately.
 *
 * A stored value in the FUTURE also stamps. Elapsed time is negative
 * there, so the obvious `elapsed >= interval` says "not yet" and keeps
 * saying it until real time catches up, which for a badly skewed clock is
 * never: the one row that is definitely wrong would be the one row that
 * never gets corrected.
 */
export function shouldStampLastSeen(
  stored: Date | null | undefined,
  now: Date,
  intervalMs: number = LAST_SEEN_INTERVAL_MS,
): boolean {
  if (!stored) return true;
  const elapsed = now.getTime() - stored.getTime();
  if (elapsed < 0) return true;
  return elapsed >= intervalMs;
}

/** Seen within this many days and the account is being used. */
export const ACTIVE_WITHIN_DAYS = 7;
/** Past this many days, nobody has opened the product in over a fortnight. */
export const QUIET_AFTER_DAYS = 14;

/**
 * The four answers, and why it is four rather than two.
 *
 * A plain active/inactive split puts the person last seen nine days ago
 * on whichever side the threshold happens to fall, and that person is the
 * entire reason this exists — the ones who churn go quiet first, so the
 * middle band IS the signal. NEVER is kept separate from QUIET for the
 * same reason in the other direction: "no request has ever been recorded"
 * and "has not been back in three weeks" are different conversations, and
 * collapsing them would hide a login that was never used at all.
 *
 * Exported as a list because the page iterates it to build its summary
 * counts; a status the page never counts reads exactly like a count of
 * zero.
 */
export const USAGE_STATUSES = ["NEVER", "QUIET", "SLIPPING", "ACTIVE"] as const;

export type UsageStatus = (typeof USAGE_STATUSES)[number];

/** Whole days elapsed since the instant, floored, never negative.
 *
 * Elapsed time rather than calendar days: `lastSeenAt` is a real moment,
 * not one of this schema's UTC-midnight date columns, so 23 hours ago is
 * still 0 days ago to the person reading it. A future timestamp clamps to
 * 0 rather than reporting a negative age. */
export function daysSinceSeen(lastSeenAt: Date, now: Date): number {
  const elapsed = now.getTime() - lastSeenAt.getTime();
  if (elapsed <= 0) return 0;
  return Math.floor(elapsed / (24 * 60 * 60 * 1000));
}

/** The age in words, for the line the operator actually reads.
 *
 * Here rather than in the page because "today" / "yesterday" / "N days
 * ago" is where a hand-written ternary gets the 0/1 boundary wrong, and a
 * page component is the one place in this app nothing can test it. */
export function describeSeenAge(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** Derived, every render, from the column and the clock. Never stored. */
export function usageStatus(lastSeenAt: Date | null, now: Date): UsageStatus {
  if (!lastSeenAt) return "NEVER";
  const days = daysSinceSeen(lastSeenAt, now);
  if (days < ACTIVE_WITHIN_DAYS) return "ACTIVE";
  if (days < QUIET_AFTER_DAYS) return "SLIPPING";
  return "QUIET";
}

/** What each status is called on screen, and what it actually means —
 * written as a sentence because "Never" is the one an operator will
 * misread as churn when it may only mean the column is younger than the
 * account. */
export const USAGE_STATUS_LABEL: Record<UsageStatus, string> = {
  ACTIVE: "Active",
  SLIPPING: "Going quiet",
  QUIET: "Quiet",
  NEVER: "Never seen",
};

/** Ordering for the operator page: the rows worth a phone call first.
 * Lower sorts higher. Derived like everything else here. */
export const USAGE_STATUS_CONCERN: Record<UsageStatus, number> = {
  NEVER: 0,
  QUIET: 1,
  SLIPPING: 2,
  ACTIVE: 3,
};
