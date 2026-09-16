import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/expo";
import { flushQueue, pendingCount } from "./sync-queue";

/** The shared offline plumbing for a screen that queues writes: flush the
 * queue, report how many writes are still pending, and hand `sync` back so
 * a create can enqueue-then-flush. `refresh` is the screen's own list
 * reload, called after a flush so optimistic local rows are replaced by the
 * server's. */
export function useSync(refresh: () => Promise<void>) {
  const { getToken } = useAuth();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    pendingCount().then(setPending);
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
    await refresh();
  }, [getToken, refresh]);

  return { pending, sync };
}
