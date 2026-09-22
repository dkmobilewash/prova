import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import * as api from "./api";
import { cacheKeys } from "./cache-keys";
import { cachedRead, withToken } from "./cached-read";
import { useStableGetToken } from "./use-stable-get-token";
import type { Me } from "./types";

/**
 * Who is holding this phone, and what the SERVER says they may do.
 *
 * The phone used to show every screen to everyone. An ACCOUNTING or
 * ESTIMATOR user got the whole foreman app — Create, Camera, punch lists,
 * time — and found out what they were not allowed to do by tapping and
 * getting a 403, which renders as an empty screen with no explanation.
 * That is not a permission bug (the server refused correctly), it is a
 * shell that lies about what it can do.
 *
 * The capabilities come down the wire from `/api/v1/me`, already derived
 * by `capabilitiesFor` on the server, and this phone never re-derives
 * them. A second copy of the mapping in an app-store binary goes stale
 * the day somebody changes a job function, and cannot be corrected
 * without a release.
 *
 * Cached like every other read, because a restricted user in a basement
 * must get the same shell they get with signal — and `undefined` while it
 * loads is deliberately NOT "no": a shell that flickers everything off
 * and back on is worse than one that waits a beat.
 */
export function useMe(): { me: Me | null; loading: boolean } {
  const getToken = useStableGetToken();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        const read = await cachedRead(cacheKeys.me(), withToken(getToken, (token) => api.getMe(token)));
        if (!alive) return;
        if (read.from !== "nothing") setMe(read.value);
        setLoading(false);
      })();
      return () => {
        alive = false;
      };
    }, [getToken]),
  );

  return { me, loading };
}
