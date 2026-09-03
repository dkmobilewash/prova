/** Today's date on the UTC calendar, for server-rendered markup.
 *
 * Deliberately NOT components/localToday.ts. That one answers "what day is
 * it where the user is", which is the right question for a date input a
 * foreman is about to fill in — and the wrong one here, because calling it
 * during a server render produces markup the client then disagrees with and
 * hydration breaks. Every date in this app is stored at UTC midnight and
 * rendered in UTC, so a UTC "today" is also the value that compares
 * correctly against them.
 *
 * The cost is real and worth stating: for a few hours each day this is a
 * day ahead of the user's own calendar, so a renewal can read "due in 6
 * days" when their calendar would say 7. On a 30- and 60-day horizon that
 * is noise. On anything where the exact day decides an outcome, it is not
 * good enough — use a date the user entered.
 *
 * CORRECTION, issue #111 item 1. One sentence above is wrong and has been
 * left standing so the mistake is legible: a UTC "today" is NOT "the value
 * that compares correctly" against these dates. The stored values are
 * plain calendar days — the UTC midnight is how a date with no time gets
 * into Postgres, not a claim about a moment — so the day that compares
 * correctly is the day on the READER'S calendar. There is now a helper
 * that knows it, without the hydration problem: lib/viewerToday.ts, which
 * takes the zone off a cookie the browser writes.
 *
 * So the "exact day decides an outcome" paragraph now has a second answer.
 * Use viewerToday() there. The alert engine, where the exact day decides
 * whether something reads as OVERDUE, has moved to it. The callers still
 * on this function are 30- and 60-day renewal horizons on /dashboard,
 * /compliance, /settings and /contacts/[id], where a day either way is the
 * noise this comment already described — moving them is a change worth
 * making deliberately, not a change worth making by sweep.
 */
export function serverToday() {
  return new Date().toISOString().slice(0, 10);
}
