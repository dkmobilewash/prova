import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeOp } from "./outbox";
import type { PendingOp } from "./sync-queue";

/**
 * A PIN PUT ON A DRAWING WITH NO SIGNAL.
 *
 * A plan sheet is what somebody walks the building with, and that walk happens
 * in a basement, a stairwell, or the middle of a slab. So the one thing this
 * op must do is survive having nowhere to send itself — the same defect
 * `sync-queue.test.ts` was written for after a punch item marked ready in
 * Airplane Mode vanished on a real phone.
 *
 * The case worth the file is the second one: **`jobId` must not reach the
 * server.** It is carried on the op purely so the outbox can say which job a
 * waiting note belongs to, and `createSheetPin` has no such parameter — a
 * version that spread the whole op into the request would typecheck, flush
 * green, and quietly post a field the route ignores today and might not
 * tomorrow.
 */

const store = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: async (k: string) => {
      store.delete(k);
    },
  },
}));

vi.mock("./photo-store", () => ({
  discardQueuedPhoto: () => {},
  queuedPhotoExists: () => true,
  uploadQueuedPhoto: async () => ({ status: 201, body: "{}" }),
}));

const sent: unknown[] = [];
let failNext: null | (() => never) = null;

// Defined INSIDE the factory: `vi.mock` is hoisted above everything else in
// the file, so a class declared at module scope is not initialised yet when it
// runs.
vi.mock("./api", () => {
  class FakeApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError: FakeApiError,
    createSheetPin: async (input: unknown) => {
      sent.push(input);
      if (failNext) failNext();
      return { id: "pin_1" };
    },
  };
});

const { enqueue, flushQueue, pendingCount, listQueued } = await import("./sync-queue");

const PIN: PendingOp = {
  type: "sheet-pin:create",
  jobId: "job_1",
  pageId: "pg_1",
  clientOperationId: "op_1",
  // A D-size sheet: y runs 0..0.714, so 0.35 is mid-page and 0.9 would be off
  // the bottom. The route refuses the second; the queue carries whatever it is
  // given, which is why the screen checks before queueing.
  x: 0.5,
  y: 0.35,
  kind: "NOTE",
  note: "Hold this wall for the owner's millwork",
};

beforeEach(() => {
  store.clear();
  sent.length = 0;
  failNext = null;
});

describe("a pin waits for signal and then goes", () => {
  it("is still there after being queued with nothing to send it to", async () => {
    await enqueue(PIN);
    expect(await pendingCount()).toBe(1);
    expect(sent, "it was sent instead of queued").toHaveLength(0);
  });

  it("sends exactly the fields the route takes, with the idempotency key", async () => {
    await enqueue(PIN);
    await flushQueue("token");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      pageId: "pg_1",
      x: 0.5,
      y: 0.35,
      kind: "NOTE",
      note: "Hold this wall for the owner's millwork",
      clientOperationId: "op_1",
    });
  });

  it("DOES NOT send jobId — it is outbox wording, not input", async () => {
    // The page already determines the job on the server. This is the assertion
    // a `...op` spread would fail, and nothing else here would notice.
    await enqueue(PIN);
    await flushQueue("token");
    expect(Object.keys(sent[0] as object)).not.toContain("jobId");
    expect(Object.keys(sent[0] as object)).not.toContain("type");
  });

  it("leaves the queue empty once it lands", async () => {
    await enqueue(PIN);
    await flushQueue("token");
    expect(await pendingCount()).toBe(0);
  });

  it("KEEPS the pin when the send fails, rather than dropping it", async () => {
    // The whole defect this queue exists for: a write that vanished with no
    // refusal shown. A 500 may pass later, so it stays.
    //
    // THE FIRST ASSERTION IS THE ONE THAT MAKES THE REST MEAN ANYTHING. A
    // mutation run caught this: without it, "still queued" passed on a run
    // where the send was never attempted at all, which is the same number for
    // the opposite reason. Nothing is ever dropped from a flush that did not
    // happen.
    failNext = () => {
      const error = new Error("Internal error") as Error & { status: number };
      error.status = 500;
      throw error;
    };
    await enqueue(PIN);
    await flushQueue("token");
    expect(sent, "the flush never reached the route, so this proves nothing").toHaveLength(1);
    expect(await pendingCount(), "the pin was dropped on a retryable failure").toBe(1);
    const [held] = await listQueued();
    expect(held).toMatchObject({ type: "sheet-pin:create", pageId: "pg_1" });
  });
});

describe("what the outbox says it is holding", () => {
  it("leads with what the person wrote, because that is what tells two apart", () => {
    const { title, detail } = describeOp(PIN, { job_1: "Tower B" });
    expect(title).toBe("Hold this wall for the owner's millwork");
    expect(detail).toContain("Tower B");
  });

  it("names the kind when a pin has no words of its own", () => {
    // A photo pin's words live on the server. "A mark on a drawing" with no
    // further detail is a line a foreman cannot act on, so it says which kind.
    const photo = { ...PIN, kind: "PHOTO" as const, note: undefined, mediaId: "m_1" };
    expect(describeOp(photo, {}).title).toMatch(/photo/i);
    const punch = { ...PIN, kind: "PUNCH" as const, note: undefined, punchItemId: "pi_1" };
    expect(describeOp(punch, {}).title).toMatch(/punch/i);
  });

  it("still names the job when the phone has no name for it", () => {
    expect(describeOp(PIN, {}).detail.length).toBeGreaterThan(10);
  });
});
