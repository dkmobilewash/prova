"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { TIMEZONE_COOKIE } from "@/lib/viewer-timezone";

/**
 * Tells the server which calendar the person reading is actually on.
 *
 * Issue #111 item 1: the alert engine decided what day it was from the
 * server's UTC clock, so west of UTC it called tomorrow "today" every
 * evening. The server cannot know a zone it is never told, and asking the
 * browser during render is the hydration trap that components/localToday.ts
 * exists to warn about — so the browser writes its zone once, as a cookie,
 * and lib/viewerToday.ts reads it back on the next server render.
 *
 * RENDERS NOTHING, DELIBERATELY. There is no markup to disagree about, so
 * this cannot break hydration however wrong the server's guess was: the
 * work happens in an effect, after the page has already matched.
 *
 * THE REFRESH, and why it cannot loop. The render that mounted this
 * component was built without the cookie, so on the very first visit from
 * a new browser the dates on screen are the UTC ones. router.refresh()
 * re-runs the server components with the cookie in place and corrects
 * them. It fires at most once per page load — a ref guards the effect, and
 * refresh does not remount client components — and only after reading the
 * cookie back, so a browser that refuses cookies gets no refresh at all
 * rather than a loop.
 *
 * WHAT IT IS NOT. Not a preference and not a setting: a person's zone is
 * where they are sitting, and a foreman who drives to a job one state over
 * should get that state's calendar without editing anything. If it ever
 * needs to become a setting, that is a User column, a migration, and a
 * conversation — this is not that.
 */
export function TimeZoneCookie() {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    let zone: string | undefined;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    // Anything with a separator in it would be a second cookie attribute
    // rather than part of the value. Real IANA names never contain one.
    if (!zone || !/^[A-Za-z0-9_+/-]{1,64}$/.test(zone)) return;

    const read = () =>
      document.cookie
        .split("; ")
        .find((entry) => entry.startsWith(`${TIMEZONE_COOKIE}=`))
        ?.slice(TIMEZONE_COOKIE.length + 1);

    if (read() === zone) return;

    // A year, so this is written once and not on every visit. Lax rather
    // than Strict: the cookie has to be present on the top-level
    // navigation back from Clerk's hosted sign-in, or the first page after
    // signing in is the one that gets the dates wrong.
    document.cookie = `${TIMEZONE_COOKIE}=${zone}; path=/; max-age=31536000; samesite=lax`;

    // Only refresh if it actually stuck. Without this check, a browser
    // blocking cookies would refresh once on every page load forever.
    if (read() === zone) router.refresh();
  }, [router]);

  return null;
}
