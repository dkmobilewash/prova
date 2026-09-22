import { cookies, headers } from "next/headers";
import {
  TIMEZONE_COOKIE,
  resolveViewerTimeZone,
  todayInZone,
} from "@/lib/viewer-timezone";

/** Today, on the calendar of the person this request belongs to.
 *
 * The counterpart to lib/serverToday.ts, and the one to reach for wherever
 * the exact day decides an outcome — which is every alert, because an
 * alert IS a claim about a day. serverToday's own comment already said so:
 * "on anything where the exact day decides an outcome, it is not good
 * enough." Issue #111 item 1 is the list of places that sentence was true
 * about and nobody had acted on.
 *
 * WHERE THE ZONE COMES FROM, worst case first, because the fallbacks are
 * the whole honesty of this:
 *
 *   1. The `prova_tz` cookie — the browser's own IANA zone, written once
 *      by components/TimeZoneCookie.tsx. This is the only source that is
 *      actually right: it is what the reader's machine says, so it
 *      survives a VPN, a corporate proxy and a foreman on a hotspot.
 *   2. `x-vercel-ip-timezone` — Vercel's geo-IP guess, set on every
 *      request in production. It exists to cover the FIRST render of a
 *      brand-new browser, before the cookie has been written. It is a
 *      guess about where an IP address is and will be wrong for anyone on
 *      a VPN, which is why it never outranks the cookie.
 *   3. UTC — no cookie, no header. Exactly what this app did before, so
 *      the floor of this change is the old behaviour and not a new way to
 *      fail. There is no header locally, so a `next dev` server sits here
 *      until the cookie lands.
 *
 * WHAT THIS DOES NOT DO. It does not touch how dates are stored or
 * rendered, both still UTC, and it computes nothing in the browser during
 * render — the zone arrives as request data and the day is worked out on
 * the server, so the markup is the same on both sides and the hydration
 * trap documented on components/localToday.ts does not apply.
 */
export async function viewerTimeZone(): Promise<string> {
  // `cookies()` and `headers()` THROW outside a request scope — they do not
  // return empty. Without this catch the UTC floor described above is not a
  // floor at all: every caller gains a new way to fail that it did not have
  // before, in exactly the contexts that have no reader whose calendar
  // could matter anyway.
  //
  // CI found this rather than any local gate. Two `alerts-query.dbtest.ts`
  // cases went red with `cookies was called outside a request scope`
  // (E251) the moment `severityForKey` started dating dismissals by the
  // viewer — a database test calls the action directly, with no request
  // around it. A scheduled digest and any script would hit the same edge,
  // and none of typecheck, lint, unit tests or build can see it.
  try {
    const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
    return resolveViewerTimeZone([
      cookieStore.get(TIMEZONE_COOKIE)?.value,
      headerList.get("x-vercel-ip-timezone"),
    ]);
  } catch {
    return "UTC";
  }
}

/** The YYYY-MM-DD to hand the alert engine as `todayIso`. */
export async function viewerToday(): Promise<string> {
  return todayInZone(await viewerTimeZone());
}

/** The same day as `viewerToday()`, as the UTC-midnight instant that every
 * dated record in this app is stored at.
 *
 * For the callers that compare against a Date rather than a YYYY-MM-DD —
 * `daysPastDueFor` in lib/cash-flow.ts and the receivables half of
 * lib/today-dashboard.ts, which is all of them today.
 *
 * WHY A HELPER RATHER THAN `new Date()` AT THE CALL SITE, which is what
 * both of those had. `daysPastDueFor` floors the gap between an instant
 * and a UTC-midnight due date, so handing it the current instant makes the
 * answer depend on the time of day: at 17:01 in Los Angeles an invoice due
 * TODAY is 24 hours and one minute past its stored midnight, floors to 1,
 * and reads "1d overdue" on a page an owner uses to decide who to chase.
 * Flooring the instant to ITS OWN UTC midnight does not fix that — that is
 * the same wrong day, just tidier. The day has to come from the reader's
 * calendar, and then the comparison is exact integer days because both
 * sides are midnights.
 *
 * Inherits viewerTimeZone()'s floor: no cookie and no header gives UTC,
 * which is the behaviour these callers already had, and it never throws. */
export async function viewerAsOf(): Promise<Date> {
  return new Date(`${await viewerToday()}T00:00:00.000Z`);
}
