import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/expo";
import * as api from "./api";
import { getClientId } from "./client-id";
import { uuid } from "./id";
import { enqueue, flushQueue, pendingCount } from "./sync-queue";
import type { FieldReportFields, FieldReportRow } from "./types";

/** A job's field reports with offline writes: an optimistic local row is
 * shown immediately, the write is queued in AsyncStorage, and `sync` drains
 * the queue against the API. Re-fetching the list after a flush replaces
 * optimistic rows with the server's. */
export function useFieldReports(jobId: string) {
  const { getToken, isSignedIn } = useAuth();
  const [reports, setReports] = useState<FieldReportRow[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setLoading(true);
    try {
      setReports(await api.listFieldReports(jobId, token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [getToken, jobId]);

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
        type: "create",
        localId: optimistic.id,
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
      await enqueue({ type: "update", reportId, clientId, clientUpdatedAt, fields });
      await sync();
    },
    [sync],
  );

  return { reports, pending, loading, error, refresh, create, update, sync };
}
