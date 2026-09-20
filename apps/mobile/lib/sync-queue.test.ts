import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The queue that holds a write until there is signal to send it.
 *
 * WHY THIS FILE EXISTS. On 2026-09-20 a punch item was marked ready on a
 * real phone in Airplane Mode; the screen showed "Pending sync: 1", and
 * when the radio came back the write was gone — the server never received
 * it and no refusal was ever shown. The phone had no tests at all, which
 * is why a queue whose whole job is not losing things had never once been
 * asked to prove it.
 *
 * Both defects reproduced below are RACES, and neither needs a device:
 *
 *   1. `flushQueue` read the queue, sent what it found, then wrote back
 *      `ops.slice(done)` — its own stale snapshot. Anything enqueued while
 *      it was in flight was inside the part it overwrote, so a tap during a
 *      flush was silently deleted.
 *   2. Nothing stopped two flushes running at once (the screen flushes on
 *      focus, on foreground, and after each create), so the same op was
 *      sent twice. The server logged the second as a 500 —
 *      `P2002: Unique constraint failed on (companyId, clientOperationId)`,
 *      the idempotency key colliding with its own first insert.
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

/** Every call the queue makes, and a hook so a test can act DURING one. */
const sent: string[] = [];
let duringSend: null | (() => Promise<void>) = null;
let failNext: null | (() => never) = null;

class FakeApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

vi.mock("./api", () => ({
  ApiError: FakeApiError,
  createPunchListItem: async (jobId: string, input: { description: string }) => {
    sent.push(`create:${input.description}`);
    if (duringSend) {
      const run = duringSend;
      duringSend = null;
      await run();
    }
    if (failNext) failNext();
    return {};
  },
  setPunchListItemStatus: async (_jobId: string, itemId: string, status: string) => {
    sent.push(`status:${itemId}:${status}`);
    if (failNext) failNext();
    return {};
  },
}));

const { enqueue, flushQueue, pendingCount, listRefused } = await import("./sync-queue");

beforeEach(() => {
  store.clear();
  sent.length = 0;
  duringSend = null;
  failNext = null;
});

describe("a write added while a flush is in flight", () => {
  it("is still there afterwards — the tap in the basement that was lost", async () => {
    await enqueue({ type: "punch-list:create", jobId: "job_1", clientOperationId: "op_1", description: "Grid" });

    // The foreman ticks an item WHILE the queue is draining. This is not a
    // rare interleaving: the screen flushes on focus and on foreground, so
    // a flush is usually in flight exactly when somebody is tapping.
    duringSend = async () => {
      await enqueue({ type: "punch-list:status", jobId: "job_1", itemId: "item_9", status: "READY_FOR_REVIEW" });
    };

    await flushQueue("token");

    // The create went up. The status change must still be queued, not
    // deleted by the flush writing back the queue it read a moment ago.
    expect(sent).toEqual(["create:Grid"]);
    expect(await pendingCount()).toBe(1);

    await flushQueue("token");
    expect(sent).toEqual(["create:Grid", "status:item_9:READY_FOR_REVIEW"]);
    expect(await pendingCount()).toBe(0);
  });
});

describe("two flushes at once", () => {
  it("sends each write exactly once", async () => {
    await enqueue({ type: "punch-list:create", jobId: "job_1", clientOperationId: "op_1", description: "Grid" });

    // The shape that produced the 500 on production: focus and foreground
    // both firing, each reading the same queue before either had written
    // back. The server's idempotency check is a read followed by an insert,
    // so two callers both miss and both insert.
    await Promise.all([flushQueue("token"), flushQueue("token")]);

    expect(sent).toEqual(["create:Grid"]);
    expect(await pendingCount()).toBe(0);
  });
});

describe("what the queue does with a failure", () => {
  it("keeps a write the network never carried", async () => {
    await enqueue({ type: "punch-list:status", jobId: "job_1", itemId: "item_9", status: "READY_FOR_REVIEW" });
    failNext = () => {
      throw new TypeError("Network request failed");
    };

    await flushQueue("token");

    expect(await pendingCount()).toBe(1);
    expect(await listRefused()).toEqual([]);
  });

  it("sets aside a write the server refused for good, and says so", async () => {
    await enqueue({ type: "punch-list:status", jobId: "job_1", itemId: "item_9", status: "READY_FOR_REVIEW" });
    failNext = () => {
      throw new FakeApiError("Punch list item not found", 400);
    };

    await flushQueue("token");

    expect(await pendingCount()).toBe(0);
    const refused = await listRefused();
    expect(refused).toHaveLength(1);
    expect(refused[0].error).toBe("Punch list item not found");
  });
});
