import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/expo";
import * as api from "./api";
import { cacheKeys } from "./cache-keys";
import { cachedRead, staleNote, withToken } from "./cached-read";
import { tokenOrNull } from "./clerk-token";
import { syncOnce } from "./sync-order";
import { getClientId } from "./client-id";
import { uuid } from "./id";
import { saveQueued, type SaveResult } from "./save-queued";
import { flushQueue, pendingCount } from "./sync-queue";
import { useStableGetToken } from "./use-stable-get-token";
import type { FieldReportFields, FieldReportRow } from "./types";

/** A job's field reports with offline writes: an optimistic local row is
 * shown immediately, the write is queued in AsyncStorage, and `sync` drains
 * the queue against the API. Re-fetching the list after a flush replaces
 * optimistic rows with the server's. */
export function useFieldReports(jobId: string) {
  const { isSignedIn } = useAuth();
  const getToken = useStableGetToken();
  const [reports, setReports] = useState<FieldReportRow[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The line saying these came off the phone, or null when fresh;
   * "nothing" when there was no signal and nothing cached. */
  const [offline, setOffline] = useState<string | "nothing" | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Yesterday's report is what somebody checks before writing today's,
      // and with no signal this list was empty with an error over it.
      const result = await cachedRead(
        cacheKeys.reports(jobId),
        withToken(getToken, (token) => api.listFieldReports(jobId, token)),
      );
      setError(null);
      if (result.from === "nothing") {
        setOffline("nothing");
        return;
      }
      setReports(result.value);
      setOffline(staleNote(result));
    } finally {
      setLoading(false);
    }
  }, [getToken, jobId]);

  const sync = useCallback(
    () =>
      // Same rule as useSync, same scar: the read never waits on the
      // write (lib/sync-order.ts). Offline this screen showed neither the
      // reports it had cached nor the note saying they were cached,
      // because both were behind a queue flush.
      syncOnce({
        refresh,
        counters: async () => setPending(await pendingCount()),
        flush: async () => {
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

  useEffect(() => {
    if (isSignedIn) {
      pendingCount().then(setPending);
      refresh();
    }
  }, [isSignedIn, refresh]);

  const create = useCallback(
    async (fields: FieldReportFields & { reportDate: string }): Promise<SaveResult> => {
      const clientId = await getClientId();
      const clientOperationId = uuid();
      const clientUpdatedAt = new Date().toISOString();
      const optimistic: FieldReportRow = {
        id: `local-${uuid()}`,
        jobId,
        reportDate: fields.reportDate,
        crewPresent: fields.crewPresent,
        workPerformed: fields.workPerformed,
        weather: fields.weather,
        delays: fields.delays,
        filedByUserId: null,
        clientId,
        clientUpdatedAt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setReports((prev) => [optimistic, ...prev]);
      const saved = await saveQueued({
        type: "field-report:create",
        jobId,
        reportDate: fields.reportDate,
        clientOperationId,
        clientId,
        clientUpdatedAt,
        fields: {
          workPerformed: fields.workPerformed,
          crewPresent: fields.crewPresent,
          weather: fields.weather,
          delays: fields.delays,
        },
      });
      if (!saved.ok) {
        // TAKE THE OPTIMISTIC ROW BACK OFF. It was a promise that this
        // report is on its way, and nothing was queued — leaving it up is
        // a filed report on screen that no drain will ever send.
        setReports((prev) => prev.filter((r) => r.id !== optimistic.id));
        setError(saved.error);
        return saved;
      }
      setError(null);
      await sync();
      return saved;
    },
    [jobId, sync],
  );

  const update = useCallback(
    async (reportId: string, fields: FieldReportFields): Promise<SaveResult> => {
      const clientId = await getClientId();
      const clientUpdatedAt = new Date().toISOString();
      /**
       * The row as it was, captured INSIDE the optimistic update rather than
       * from `reports`.
       *
       * Reading `reports.find(...)` was wrong twice. It is the array from the
       * render this callback was built in, and it was read AFTER
       * `await getClientId()` — so a refresh landing in that window made the
       * rollback restore a row the server had already replaced. And when the
       * id was not in that stale snapshot, `if (before)` skipped the rollback
       * entirely: an error on screen with the edit still sitting under it,
       * looking saved. The updater below sees the CURRENT array, by
       * definition, and cannot miss a row that is really there.
       */
      let before: FieldReportRow | undefined;
      setReports((prev) =>
        prev.map((r) => {
          if (r.id !== reportId) return r;
          before = r;
          return { ...r, ...fields, clientUpdatedAt };
        }),
      );
      const saved = await saveQueued({
        type: "field-report:update",
        reportId,
        clientId,
        clientUpdatedAt,
        fields,
      });
      if (!saved.ok) {
        // Put the row back as it was: the edit above is on screen and
        // nowhere else. `before` is set by the updater above whenever the row
        // existed; if it did not exist there is no edit on screen to undo.
        setReports((prev) =>
          prev.map((r) => (r.id === reportId && before ? before : r)),
        );
        setError(saved.error);
        return saved;
      }
      setError(null);
      await sync();
      return saved;
    },
    [sync],
  );

  // `setError` is returned because the reports SCREEN queues its own
  // writes too (a delay is not a report), and one error line on that
  // screen should say whichever of the two failed.
  return { reports, pending, loading, error, setError, offline, refresh, create, update, sync };
}
