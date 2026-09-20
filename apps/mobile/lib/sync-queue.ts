import AsyncStorage from "@react-native-async-storage/async-storage";
import * as api from "./api";
import { uuid } from "./id";
import { discardQueuedPhoto, queuedPhotoExists, uploadQueuedPhoto } from "./photo-store";
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
      area?: string;
    }
  | {
      /** Marking an item fixed, or taking that back.
       *
       * This used to be a direct API call from the screen, which is why
       * closing an item with no signal failed with an error and left the
       * box unticked — the one thing a punch list has to survive is a
       * basement. Replaying it is safe without any idempotency key of its
       * own: setting a status twice lands on the same row, unlike a create.
       */
      type: "punch-list:status";
      jobId: string;
      itemId: string;
      status: "OPEN" | "READY_FOR_REVIEW";
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
  | {
      type: "media:create";
      jobId: string;
      clientOperationId: string;
      /** The stamped photo, kept in the app's document directory until it
       * goes up (lib/photo-store.ts). */
      fileUri: string;
      fileName: string;
      mimeType: string;
      capturedAt: string;
      capturedLatitude?: number;
      capturedLongitude?: number;
      capturedAccuracyMeters?: number;
      caption?: string;
      tagIds?: string[];
      dailyFieldReportId?: string;
      punchListItemId?: string;
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

/** A queued write and its own local id.
 *
 * The id is not the idempotency key — `clientOperationId` is that, and it
 * is what the SERVER dedupes on. `opId` is how this device tells one
 * QUEUE ENTRY from another, which is what a flush needs to take exactly
 * the writes it sent off the queue and leave everything else alone. A
 * status change carries no clientOperationId at all (setting a status
 * twice lands on the same row), so identity could not be borrowed from it.
 */
export type QueuedOp = PendingOp & { opId: string };

async function read(): Promise<QueuedOp[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const ops = JSON.parse(raw) as (PendingOp & { opId?: string })[];
    // A queue written by a build that predates `opId` — give each entry one
    // so the rest of this file can rely on identity. Deterministic within
    // this snapshot; `ensureIds` persists them before anything is sent.
    return ops.map((op, index) => ({ ...op, opId: op.opId ?? `legacy-${index}` }) as QueuedOp);
  } catch {
    return [];
  }
}

async function write(ops: QueuedOp[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(ops));
}

/** Persists ids for anything queued by an older build, once, before a
 * flush starts reasoning about which entry is which. */
async function ensureIds(): Promise<void> {
  const ops = await read();
  if (!ops.some((op) => op.opId.startsWith("legacy-"))) return;
  await write(ops.map((op) => (op.opId.startsWith("legacy-") ? { ...op, opId: uuid() } : op)));
}

export async function enqueue(op: PendingOp): Promise<void> {
  const ops = await read();
  ops.push({ ...op, opId: uuid() } as QueuedOp);
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

/** Throws the refused writes away — the person has read why and chosen to
 * let them go. A kept photo file goes with them; nothing else references it. */
export async function clearRefused(): Promise<void> {
  for (const { op } of await listRefused()) {
    if (op.type === "media:create") discardQueuedPhoto(op.fileUri);
  }
  await AsyncStorage.removeItem(REFUSED_KEY);
}

/** Puts the refused writes back on the queue, for when the reason has been
 * dealt with — the day reopened, or a build that no longer sends a photo
 * too large for the server to take. A photo whose file is gone cannot be
 * retried and is dropped. Returns how many went back on. */
export async function retryRefused(): Promise<number> {
  const refused = await listRefused();
  const retryable = refused.filter((r) => r.op.type !== "media:create" || queuedPhotoExists(r.op.fileUri));
  // A fresh `opId` per entry: it is going back on the queue as a new entry,
  // and the one it had was consumed by the flush that set it aside.
  if (retryable.length > 0) {
    await write([...(await read()), ...retryable.map((r) => ({ ...r.op, opId: uuid() }) as QueuedOp)]);
  }
  await AsyncStorage.removeItem(REFUSED_KEY);
  return retryable.length;
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

/** ONE flush at a time, and callers that arrive mid-flush ride the one
 * already running rather than starting a second.
 *
 * Two flushes used to be ordinary: the screen flushes when it gains focus,
 * when the app comes back to the foreground, and after every create, so
 * two of those landing together sent the same write twice. Production
 * logged the second as a 500 — `P2002` on `(companyId, clientOperationId)`
 * — because the server's idempotency check is a read followed by an
 * insert, and both callers passed the read before either inserted.
 *
 * A caller that arrives while a flush is in flight also sets `again`, so
 * whatever it queued is not left sitting until the next focus event. */
let inFlight: Promise<void> | null = null;
let again = false;

/** Bounded so a queue that cannot drain — no signal, a 5xx — cannot spin
 * the radio in a loop. Anything left waits for the next focus or
 * foreground, which is seconds away in practice. */
const MAX_PASSES = 3;

export async function flushQueue(token: string): Promise<void> {
  if (inFlight) {
    again = true;
    return inFlight;
  }
  inFlight = (async () => {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      again = false;
      await drain(token);
      if (!again || (await pendingCount()) === 0) return;
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
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
 * queued for the next attempt.
 *
 * WHAT IT TAKES OFF THE QUEUE IS THE WRITES IT ACTUALLY HANDLED, BY ID.
 * It used to write back `ops.slice(done)` — the snapshot it read when it
 * started, minus what it had sent. Anything enqueued while it was in
 * flight was inside the part that got overwritten, so a tap during a flush
 * was deleted without ever being sent and without any refusal to show for
 * it. That is how a punch item marked ready in Airplane Mode on
 * 2026-09-20 disappeared: "Pending sync: 1" one moment, nothing the next,
 * and the server had never heard of it. */
async function drain(token: string): Promise<void> {
  await ensureIds();
  const ops = await read();
  const handled = new Set<string>();
  const refused: RefusedOp[] = [];
  for (const op of ops) {
    try {
      await runOp(op, token);
      handled.add(op.opId);
    } catch (error) {
      if (error instanceof api.ApiError && error.status === 401) {
        await recordRefused(refused);
        await removeHandled(handled);
        throw error;
      }
      if (error instanceof api.ApiError && isFinalRefusal(error.status)) {
        // The photo file is KEPT. A refusal here is the server saying no to
        // this request, not proof the picture is worthless — a too-large
        // upload (413) or a day that got signed are both things somebody
        // can put right, and the photograph may be the only copy: a camera
        // shot taken in the app is not in the camera roll. The refused list
        // is capped, so the disk this holds is bounded.
        refused.push({ op, error: error.message, status: error.status, at: new Date().toISOString() });
        handled.add(op.opId);
        continue;
      }
      break;
    }
  }
  await recordRefused(refused);
  await removeHandled(handled);
}

/** Takes exactly the handled writes off the CURRENT queue, re-read rather
 * than remembered, so a write added while this flush was running survives
 * it. */
async function removeHandled(handled: Set<string>): Promise<void> {
  if (handled.size === 0) return;
  const current = await read();
  await write(current.filter((op) => !handled.has(op.opId)));
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
      await api.createPunchListItem(
        op.jobId,
        { description: op.description, area: op.area, clientOperationId: op.clientOperationId },
        token,
      );
      return;
    case "punch-list:status":
      await api.setPunchListItemStatus(op.jobId, op.itemId, op.status, token);
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
    case "media:create": {
      // The file the system cleared out from under us: nothing to upload
      // and nothing a retry can fix, so let it be set aside like a refusal.
      if (!queuedPhotoExists(op.fileUri)) {
        throw new api.ApiError("The photo file is no longer on this phone", 410);
      }
      const parameters: Record<string, string> = {
        capturedAt: op.capturedAt,
        clientOperationId: op.clientOperationId,
      };
      if (op.caption) parameters.caption = op.caption;
      if (op.capturedLatitude !== undefined) parameters.capturedLatitude = String(op.capturedLatitude);
      if (op.capturedLongitude !== undefined) parameters.capturedLongitude = String(op.capturedLongitude);
      if (op.capturedAccuracyMeters !== undefined) {
        parameters.capturedAccuracyMeters = String(op.capturedAccuracyMeters);
      }
      if (op.dailyFieldReportId) parameters.dailyFieldReportId = op.dailyFieldReportId;
      if (op.punchListItemId) parameters.punchListItemId = op.punchListItemId;
      // One value per field in a native multipart upload, so several tags
      // travel comma-separated; the route splits them.
      if (op.tagIds?.length) parameters.tagIds = op.tagIds.join(",");
      const result = await uploadQueuedPhoto(
        op.fileUri,
        api.mediaUploadUrl(op.jobId),
        token,
        op.mimeType,
        parameters,
      );
      if (result.status >= 400) {
        let message = `Upload failed (${result.status})`;
        try {
          message = (JSON.parse(result.body) as { error?: string }).error ?? message;
        } catch {
          // A non-JSON body (a proxy error page): keep the status sentence.
        }
        throw new api.ApiError(message, result.status);
      }
      discardQueuedPhoto(op.fileUri);
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
