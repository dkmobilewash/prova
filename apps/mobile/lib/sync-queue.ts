import AsyncStorage from "@react-native-async-storage/async-storage";
import * as api from "./api";
import type { FieldReportFields } from "./types";

const KEY = "prova.field-queue";
const REFUSED_KEY = "prova.field-queue.refused";
/** Only the most recent refusals are kept; this is a note to the user, not
 * an archive. */
const REFUSED_LIMIT = 20;

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
      clockStartedAt?: string;
      clockEndedAt?: string;
      clockBreakMinutes?: number;
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
    }
  | {
      type: "ticket:create";
      jobId: string;
      clientOperationId: string;
      workDate: string;
      workDescription: string;
      signerName: string;
      signaturePath?: string;
    }
  | ({
      type: "delay:create";
      jobId: string;
      clientOperationId: string;
    } & Omit<api.CreateDelayInput, "clientOperationId">)
  | {
      type: "signoff:create";
      jobId: string;
      clientOperationId: string;
      date: string;
      signerName: string;
      signaturePath: string;
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

/** The idempotency keys of every write still waiting to go up. A screen that
 * shows a just-saved row before the server has it keeps the row while its key
 * is here, and drops it once the key is gone — sent (the server's copy
 * replaces it) or set aside as refused (the refused banner says why). */
export async function queuedOperationIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const op of await read()) if ("clientOperationId" in op) ids.add(op.clientOperationId);
  return ids;
}

/** A write the server refused for good — kept so the screen can say what
 * was not saved and why, instead of it vanishing. */
export type RefusedOp = { op: PendingOp; error: string; status: number; at: string };

export async function listRefused(): Promise<RefusedOp[]> {
  const raw = await AsyncStorage.getItem(REFUSED_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as RefusedOp[];
  } catch {
    return [];
  }
}

export async function clearRefused(): Promise<void> {
  await AsyncStorage.removeItem(REFUSED_KEY);
}

async function recordRefused(refused: RefusedOp[]): Promise<void> {
  if (refused.length === 0) return;
  const all = [...(await listRefused()), ...refused].slice(-REFUSED_LIMIT);
  await AsyncStorage.setItem(REFUSED_KEY, JSON.stringify(all));
}

/** A refusal retrying cannot fix: the server read the request and said no
 * (a signed day, an archived crew member, a bad figure). 401 is a sign-in
 * problem, 408 and 429 are "try later", and 5xx is the server's — those stay
 * queued. */
export function isFinalRefusal(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

/** Drains the queue in order. Every create carries a clientOperationId, so
 * a retried POST replays idempotently; the field-report update carries
 * clientUpdatedAt, so last-write-wins drops a stale edit.
 *
 * On a 401 it throws (caller re-auths, queue left intact). On a FINAL
 * refusal — a 4xx the server will give again however often it is asked,
 * like a day that is already signed — the write is taken off the queue and
 * recorded in the refused list, so it cannot hold every later write behind
 * it forever. On anything else (offline, 5xx) it stops and leaves the rest
 * queued for the next attempt. */
export async function flushQueue(token: string): Promise<void> {
  const ops = await read();
  let done = 0;
  const refused: RefusedOp[] = [];
  for (const op of ops) {
    try {
      await runOp(op, token);
      done++;
    } catch (error) {
      if (error instanceof api.ApiError && error.status === 401) {
        await recordRefused(refused);
        if (done > 0) await write(ops.slice(done));
        throw error;
      }
      if (error instanceof api.ApiError && isFinalRefusal(error.status)) {
        refused.push({ op, error: error.message, status: error.status, at: new Date().toISOString() });
        done++;
        continue;
      }
      break;
    }
  }
  await recordRefused(refused);
  if (done > 0) await write(ops.slice(done));
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
          clockStartedAt: op.clockStartedAt,
          clockEndedAt: op.clockEndedAt,
          clockBreakMinutes: op.clockBreakMinutes,
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
    case "ticket:create":
      await api.createTmTicket(
        op.jobId,
        {
          workDate: op.workDate,
          workDescription: op.workDescription,
          signerName: op.signerName,
          signaturePath: op.signaturePath,
          clientOperationId: op.clientOperationId,
        },
        token,
      );
      return;
    case "delay:create": {
      const { type: _type, jobId, ...input } = op;
      await api.createDelay(jobId, input, token);
      return;
    }
    case "signoff:create":
      await api.createSignoff(
        op.jobId,
        {
          date: op.date,
          signerName: op.signerName,
          signaturePath: op.signaturePath,
          clientOperationId: op.clientOperationId,
        },
        token,
      );
      return;
  }
}
