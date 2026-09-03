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
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return resolveViewerTimeZone([
    cookieStore.get(TIMEZONE_COOKIE)?.value,
    headerList.get("x-vercel-ip-timezone"),
  ]);
}

/** The YYYY-MM-DD to hand the alert engine as `todayIso`. */
export async function viewerToday(): Promise<string> {
  return todayInZone(await viewerTimeZone());
}
