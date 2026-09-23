/** The date on the PHONE'S calendar, not UTC's.
 *
 * Dates are stored and rendered at UTC midnight, which is right — but
 * deciding what day it *is* in UTC is wrong for anyone west of it. The
 * web has carried `components/localToday.ts` for exactly this reason
 * since a foreman filing an incident at the end of a shift dated it a
 * day late.
 *
 * The phone had no such helper, and the schedule screen paid for it on a
 * device on 2026-09-20: at 18:03 in Albuquerque the UTC date is already
 * the 21st, so TODAY was drawn as "2026-09-20 · past" and — worse — the
 * server marked it as a past day with no hours against it and the screen
 * said "No hours logged". That is the accusation the future-day rule
 * exists to prevent, pointed at a day that was still being worked.
 *
 * So the phone decides what day it is, and tells the server.
 */
export function localToday(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "Sep 1" — the quiet form for a job's date range. Null in, null out:
 * a job with no dates simply shows no range. */
export function shortDay(iso: string | null): string | null {
  if (!iso) return null;
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return null;
  return `${MONTHS[m - 1].slice(0, 3)} ${d}`;
}
