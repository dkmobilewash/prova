import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { tokenOrNull } from "./clerk-token";
import { clearRefused, flushQueue, listRefused, pendingCount, retryRefused, type RefusedOp } from "./sync-queue";
import { syncOnce } from "./sync-order";
import { reconcileReminder } from "./unsent-reminder";
import { useStableGetToken } from "./use-stable-get-token";

/** The shared offline plumbing for a screen that queues writes: flush the
 * queue, report how many writes are still pending, and hand `sync` back so
 * a create can enqueue-then-flush. `refresh` is the screen's own list
 * reload, called after a flush so optimistic local rows are replaced by the
 * server's.
 *
 * IT ALSO FLUSHES WHEN THE SCREEN IS SHOWN, and when the app comes back
 * from the background. Until then a queued write was only ever retried by
 * SAVING SOMETHING ELSE — a photo taken with no signal sat in the queue,
 * said "Syncing…", and stayed there through any number of visits to the
 * screen. Coming back into range is exactly when the queue should drain.
 * Found clicking #354 on the phone. */
export function useSync(refresh: () => Promise<void>) {
  const getToken = useStableGetToken();
  const [pending, setPending] = useState(0);
  // Writes the server refused for good (see flushQueue) — shown so a saved-
  // looking entry that never landed is not a silent loss.
  const [refused, setRefused] = useState<RefusedOp[]>([]);

  useEffect(() => {
    pendingCount().then(setPending);
    listRefused().then(setRefused);
  }, []);

  const sync = useCallback(
    () =>
      syncOnce({
        // THE READ NEVER WAITS ON THE WRITE — see lib/sync-order.ts. This
        // used to be `await getToken()`, then `await flushQueue(token)`,
        // and only then the screen's own list. With no signal that put
        // every queue-backed screen behind a token fetch and a queue
        // flush aimed at a server that was not answering, so the punch
        // list, field reports, time, photos, materials, safety and T&M
        // showed nothing and no "no connection" note, while Home and the
        // read-only screens showed both.
        refresh,
        counters: async () => {
          const pending = await pendingCount();
          setPending(pending);
          setRefused(await listRefused());
          // The end-of-day reminder tracks the queue rather than a clock:
          // scheduled the moment something is held, cancelled the moment
          // the last write goes up. A reminder that fires on an empty
          // queue is one people learn to ignore.
          void reconcileReminder(pending);
        },
        flush: async () => {
          // An empty queue costs nothing: no token, no network, no wait.
          const before = await pendingCount();
          if (before === 0) return false;
          const token = await tokenOrNull(getToken);
          if (!token) return false;
          try {
            await flushQueue(token);
          } catch {
            // 401 or offline — leave queued, retry later.
          }
          return (await pendingCount()) !== before;
        },
      }),
    [getToken, refresh],
  );

  // `sync` is re-created on every render (it closes over `refresh`), so the
  // focus effect reads it through a ref rather than re-firing each time.
  const latestSync = useRef(sync);
  useEffect(() => {
    latestSync.current = sync;
  });

  useFocusEffect(
    useCallback(() => {
      void latestSync.current();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void latestSync.current();
      });
      return () => subscription.remove();
    }, []),
  );

  const dismissRefused = useCallback(async () => {
    await clearRefused();
    setRefused([]);
  }, []);

  /** Puts the refused writes back on the queue and flushes. */
  const retrySetAside = useCallback(async () => {
    await retryRefused();
    setRefused([]);
    await latestSync.current();
  }, []);

  return { pending, sync, refused, dismissRefused, retrySetAside };
}
