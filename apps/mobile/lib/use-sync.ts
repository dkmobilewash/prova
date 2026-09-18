import { useCallback, useEffect, useState } from "react";
import { clearRefused, flushQueue, listRefused, pendingCount, type RefusedOp } from "./sync-queue";
import { useStableGetToken } from "./use-stable-get-token";

/** The shared offline plumbing for a screen that queues writes: flush the
 * queue, report how many writes are still pending, and hand `sync` back so
 * a create can enqueue-then-flush. `refresh` is the screen's own list
 * reload, called after a flush so optimistic local rows are replaced by the
 * server's. */
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

  const sync = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      await flushQueue(token);
    } catch {
      // 401 or offline — leave queued, retry later.
    }
    setPending(await pendingCount());
    setRefused(await listRefused());
    await refresh();
  }, [getToken, refresh]);

  const dismissRefused = useCallback(async () => {
    await clearRefused();
    setRefused([]);
  }, []);

  return { pending, sync, refused, dismissRefused };
}
