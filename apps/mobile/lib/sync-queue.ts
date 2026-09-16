import AsyncStorage from "@react-native-async-storage/async-storage";
import * as api from "./api";
import type { FieldReportFields } from "./types";

const KEY = "prova.field-report-queue";

type CreateOp = {
  type: "create";
  localId: string;
  jobId: string;
  reportDate: string;
  clientOperationId: string;
  clientId: string;
  clientUpdatedAt: string;
  fields: FieldReportFields;
};

type UpdateOp = {
  type: "update";
  reportId: string;
  clientId: string;
  clientUpdatedAt: string;
  fields: FieldReportFields;
};

export type PendingOp = CreateOp | UpdateOp;

async function read(): Promise<PendingOp[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PendingOp[];
  } catch {
    return [];
  }
}

async function write(ops: PendingOp[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(ops));
}

export async function enqueue(op: PendingOp): Promise<void> {
  const ops = await read();
  ops.push(op);
  await write(ops);
}

export async function pendingCount(): Promise<number> {
  return (await read()).length;
}

/** Drains the queue in order. A create reuses its clientOperationId, so a
 * retried POST replays idempotently; an update carries clientUpdatedAt, so
 * the server's last-write-wins drops a stale edit. On a 401 it throws
 * (caller re-auths, queue left intact); on any other error it stops and
 * leaves the rest queued for the next attempt. */
export async function flushQueue(token: string): Promise<void> {
  const ops = await read();
  let flushed = 0;
  for (const op of ops) {
    try {
      await runOp(op, token);
      flushed++;
    } catch (error) {
      if (error instanceof api.ApiError && error.status === 401) throw error;
      break;
    }
  }
  if (flushed > 0) await write(ops.slice(flushed));
}

async function runOp(op: PendingOp, token: string): Promise<void> {
  if (op.type === "create") {
    await api.createFieldReport(
      {
        jobId: op.jobId,
        reportDate: op.reportDate,
        ...op.fields,
        clientId: op.clientId,
        clientOperationId: op.clientOperationId,
        clientUpdatedAt: op.clientUpdatedAt,
      },
      token,
    );
  } else {
    await api.updateFieldReport(
      op.reportId,
      { ...op.fields, clientId: op.clientId, clientUpdatedAt: op.clientUpdatedAt },
      token,
    );
  }
}
