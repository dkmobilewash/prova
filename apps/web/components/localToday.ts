/** The date on the USER'S calendar, not the server's.
 *
 * Dates are stored and rendered at UTC midnight, which is right. But
 * deciding what day it *is* in UTC is wrong for anyone west of it: at
 * 17:00 in Los Angeles the UTC date is already tomorrow, so a date input
 * defaulted from the server would pre-fill tomorrow and a foreman filing
 * an incident at the end of a shift would date it a day late — or, on
 * 31 December, into the wrong year, which on a safety log also picks the
 * wrong case-number series.
 *
 * Safe to call during render ONLY in components that are mounted by a
 * user action (collapsed forms opened by a click), never in markup that
 * is server-rendered, or the two disagree and hydration breaks.
 */
export function localToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
