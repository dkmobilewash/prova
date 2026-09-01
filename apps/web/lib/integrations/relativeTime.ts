/**
 * "3 minutes ago" for a sync timestamp.
 *
 * A sync time is one of the few things in this app that IS an instant
 * rather than a calendar date, so it does not go through the UTC-midnight
 * rule the rest of the codebase follows for dates. "Last synced 14 August"
 * answers a question nobody asked; what an owner wants to know is whether
 * it happened recently enough to trust the numbers on the other pages.
 *
 * Pure and takes `now` as an argument so it can be tested without freezing
 * the clock, and so a server render and a test agree by construction.
 */

/**
 * Each unit carries the count at which it rolls up to the next one, and the
 * roll-up is decided AFTER rounding.
 *
 * That ordering is the whole trick. Comparing the raw seconds against a
 * fixed boundary instead lets a value round up into its own ceiling and
 * print it: at 59 minutes 59 seconds, "is this under an hour?" is true, and
 * rounding then yields "60 minutes ago". Deciding on the rounded value
 * cannot produce that, because the number that gets printed is the same
 * number that was tested.
 */
const UNITS = [
  { size: 60, rollUpAt: 60, one: "minute", many: "minutes" },
  { size: 3600, rollUpAt: 24, one: "hour", many: "hours" },
  { size: 86400, rollUpAt: 14, one: "day", many: "days" },
  { size: 7 * 86400, rollUpAt: 9, one: "week", many: "weeks" },
  { size: 30 * 86400, rollUpAt: 24, one: "month", many: "months" },
] as const;

export function relativeTime(when: Date, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - when.getTime()) / 1000);

  // A clock skew between the database and the app can put a "last synced"
  // stamp slightly in the future. "in 4 seconds" reads as a bug; this is
  // close enough to now to say so. It also guarantees everything below
  // rounds to at least 1, so no unit can ever print "0 minutes ago".
  if (seconds < 45) return "just now";

  for (const unit of UNITS) {
    const value = Math.round(seconds / unit.size);
    if (value < unit.rollUpAt) return `${value} ${value === 1 ? unit.one : unit.many} ago`;
  }

  const years = Math.round(seconds / (365 * 86400));
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}
