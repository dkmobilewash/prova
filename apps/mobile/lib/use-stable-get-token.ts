import { useAuth } from "@clerk/expo";
import { useCallback, useEffect, useRef } from "react";

/**
 * `getToken`, with an identity that never changes.
 *
 * @clerk/expo's `useAuth()` hands back a NEW `getToken` function on every
 * render — `dist/hooks/useAuth.js` wraps Clerk's stable one in an unmemoized
 * arrow. So any hook that lists `getToken` as a dependency re-runs on every
 * render, and one that sets state in response never stops: the Jobs tab's
 * effect called setJobs, re-rendered, got a new getToken, and fetched again.
 * On 2026-09-18 that sent GET /api/v1/jobs to production ~1.4 times a second
 * for as long as the app was open — against a 5-connection database pool —
 * and a job page on the web stopped loading until the app was closed.
 *
 * Use this in place of `useAuth().getToken` wherever the function ends up in
 * a dependency array. It always calls the latest `getToken`.
 */
export function useStableGetToken(): () => Promise<string | null> {
  const { getToken } = useAuth();
  const latest = useRef(getToken);
  useEffect(() => {
    latest.current = getToken;
  });
  return useCallback(() => latest.current(), []);
}
