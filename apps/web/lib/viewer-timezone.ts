/** Which calendar day it is for the person looking at the screen.
 *
 * WHY THIS IS NOT lib/serverToday.ts, and why that file's argument was
 * half right. Every date in this app is stored at UTC midnight and
 * rendered in UTC — but those values are PLAIN CALENDAR DAYS, not
 * instants. "2026-09-04" on a follow-up means the fourth of September
 * wherever you are standing; the UTC midnight is only how a date with no
 * time gets into Postgres. So the day to compare one against is the day on
 * the reader's own wall calendar, and deciding that from the server's UTC
 * clock is a bug, not a consistency:
 *
 *   at 18:00 Tuesday in Los Angeles the UTC date is already Wednesday, so
 *   a follow-up due Wednesday reads "Due today" and one due Tuesday flips
 *   to OVERDUE with the bell counting it — every evening, for two to eight
 *   hours depending on the season.
 *
 * That is issue #111 item 1. Nothing here changes how a date is STORED or
 * RENDERED; it changes only what "today" is measured against, which is the
 * one place UTC was never the right answer.
 *
 * WHY NOT components/localToday.ts. That one asks the BROWSER, during
 * render, and its own comment says why it may only be called from a
 * component mounted by a user action: server-rendered markup built from it
 * disagrees with the client's and hydration breaks. The alert list is
 * server-rendered, so the zone has to reach the server as data instead —
 * see lib/viewerToday.ts for where it comes from.
 *
 * Pure and Intl-only, so it is testable without a request, a browser or a
 * database — the same split as compliance-expiry.ts (decides) versus
 * renewals.ts (fetches).
 */

/** Where the browser's own IANA zone is parked for the server to read.
 *
 * A cookie rather than a stored column: there is no timezone field on User
 * or Company, adding one is a migration and a schema conversation, and a
 * person's zone is a property of where they are sitting right now rather
 * than of their account — a foreman who flies to a job in another state
 * should get that state's calendar without editing a setting.
 */
export const TIMEZONE_COOKIE = "prova_tz";

/**
 * Is this a zone the runtime actually knows?
 *
 * The value arrives on a cookie, which the caller controls, so it is
 * untrusted input. Intl is the only authority on what is a real zone and
 * it throws on anything that is not — which is exactly the check, rather
 * than a regex that would have to be kept in step with the tz database.
 */
export function isSupportedTimeZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The first candidate that is a real zone, or UTC.
 *
 * UTC last on purpose: it is what this app did before, so an unknown zone
 * degrades to the old behaviour rather than to a new failure. A thrown
 * error here would take out the alert list and the top-bar bell on every
 * page, over a cookie.
 */
export function resolveViewerTimeZone(
  candidates: readonly (string | null | undefined)[],
): string {
  for (const candidate of candidates) {
    if (isSupportedTimeZone(candidate)) return candidate;
  }
  return "UTC";
}

/**
 * The calendar day in `zone`, as the YYYY-MM-DD string everything else
 * here compares against.
 *
 * Built from formatToParts rather than a locale that happens to format
 * this way, because the output is compared as a STRING — `daysUntil` and
 * every `date <= todayIso` in lib/alerts.ts depend on it being
 * zero-padded and in that order, and a locale's formatting is not a
 * contract.
 */
export function todayInZone(zone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
