import AsyncStorage from "@react-native-async-storage/async-storage";
import * as api from "./api";
import type { FieldReportFields } from "./types";

const KEY = "prova.field-queue";

// One variant per create, carrying everything the dispatcher needs to replay
// it. `clientOperationId` is the idempotency key: a retried POST with the
// same key replays instead of duplicating (the server dedupes on it).
export type CreateOp =
  | {
      type: "field-report:create";
      jobId: string;
      reportDate: string;
      clientOperationId: string;
      clientId: string;
      clientUpdatedAt: string;
      fields: FieldReportFields;
    }
  | {
      type: "time:create";
      jobId: string;
      clientOperationId: string;
      date: string;
      hours: string;
      payType: string;
      note?: string;
      crewMemberId?: string;
      lineItemId?: string;
      craftClassificationId?: string;
    }
  | {
      type: "material:create";
      jobId: string;
      clientOperationId: string;
      description: string;
      orderedOn: string;
      promisedFor?: string;
      vendorId: string;
      vendorReference?: string;
      notes?: string;
    }
  | {
      type: "toolbox-talk:create";
      jobId: string;
      clientOperationId: string;
      topic: string;
      heldOn: string;
      presenter?: string;
      attendees?: string;
      notes?: string;
    }
  | {
      type: "incident:create";
      jobId: string;
      clientOperationId: string;
      employeeName: string;
      description: string;
      occurredAt: string;
      classification: string;
      outcome: string;
    }
  | {
      type: "punch-list:create";
      jobId: string;
      clientOperationId: string;
      description: string;
    };

export type UpdateOp = {
  type: "field-report:update";
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

/** Drains the queue in order. Every create carries a clientOperationId, so
 * a retried POST replays idempotently; the field-report update carries
 * clientUpdatedAt, so last-write-wins drops a stale edit. On a 401 it throws
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
  switch (op.type) {
    case "field-report:create":
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
      return;
    case "field-report:update":
      await api.updateFieldReport(op.reportId, { ...op.fields, clientId: op.clientId, clientUpdatedAt: op.clientUpdatedAt }, token);
      return;
    case "time:create":
      await api.createTimeEntry(
        op.jobId,
        {
          date: op.date,
          hours: op.hours,
          payType: op.payType,
          note: op.note,
          clientOperationId: op.clientOperationId,
          crewMemberId: op.crewMemberId,
          lineItemId: op.lineItemId,
          craftClassificationId: op.craftClassificationId,
        },
        token,
      );
      return;
    case "material:create":
      await api.createMaterialOrder(
        op.jobId,
        {
          description: op.description,
          orderedOn: op.orderedOn,
          promisedFor: op.promisedFor,
          vendorId: op.vendorId,
          vendorReference: op.vendorReference,
          notes: op.notes,
          clientOperationId: op.clientOperationId,
        },
        token,
      );
      return;
    case "toolbox-talk:create":
      await api.createToolboxTalk(
        op.jobId,
        {
          topic: op.topic,
          heldOn: op.heldOn,
          presenter: op.presenter,
          attendees: op.attendees,
          notes: op.notes,
          clientOperationId: op.clientOperationId,
        },
        token,
      );
      return;
    case "incident:create":
      await api.createIncident(
        op.jobId,
        {
          employeeName: op.employeeName,
          description: op.description,
          occurredAt: op.occurredAt,
          classification: op.classification,
          outcome: op.outcome,
          clientOperationId: op.clientOperationId,
        },
        token,
      );
      return;
    case "punch-list:create":
      await api.createPunchListItem(op.jobId, { description: op.description, clientOperationId: op.clientOperationId }, token);
      return;
  }
}
