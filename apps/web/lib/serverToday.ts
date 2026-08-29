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
 */
export function serverToday() {
  return new Date().toISOString().slice(0, 10);
}
