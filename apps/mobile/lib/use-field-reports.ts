import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/expo";
import * as api from "./api";
import { cacheKeys } from "./cache-keys";
import { cachedRead, staleNote, withToken } from "./cached-read";
import { tokenOrNull } from "./clerk-token";
import { getClientId } from "./client-id";
import { uuid } from "./id";
import { enqueue, flushQueue, pendingCount } from "./sync-queue";
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

  const sync = useCallback(async () => {
    // Bounded — see lib/clerk-token.ts. The refresh below is what shows
    // the cached reports, and it waits for this line.
    const token = await tokenOrNull(getToken);
    if (token) {
      try {
        await flushQueue(token);
      } catch {
        // 401 or offline — leave queued, retry later.
      }
    }
    // Refreshed with or without a token: offline that means re-reading
    // the cache, which is the whole point of having one.
    setPending(await pendingCount());
    await refresh();
  }, [getToken, refresh]);

  useEffect(() => {
    if (isSignedIn) {
      pendingCount().then(setPending);
      refresh();
    }
  }, [isSignedIn, refresh]);

  const create = useCallback(
    async (fields: FieldReportFields & { reportDate: string }) => {
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
      await enqueue({
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
      await sync();
    },
    [jobId, sync],
  );

  const update = useCallback(
    async (reportId: string, fields: FieldReportFields) => {
      const clientId = await getClientId();
      const clientUpdatedAt = new Date().toISOString();
      setReports((prev) =>
        prev.map((r) => (r.id === reportId ? { ...r, ...fields, clientUpdatedAt } : r)),
      );
      await enqueue({ type: "field-report:update", reportId, clientId, clientUpdatedAt, fields });
      await sync();
    },
    [sync],
  );

  return { reports, pending, loading, error, offline, refresh, create, update, sync };
}
