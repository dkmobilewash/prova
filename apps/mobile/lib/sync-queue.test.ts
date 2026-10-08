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
  deletePunchListItem: async (_jobId: string, itemId: string) => {
    sent.push(`delete:${itemId}`);
    if (failNext) failNext();
  },
}));

const { enqueue, flushQueue, pendingCount, listRefused, listQueued, removeQueued, sendNow, MAX_ATTEMPTS } =
  await import("./sync-queue");

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

describe("two taps on the same item", () => {
  it("sends both, in order — a tick and an untick are two facts, not one", async () => {
    // Ticked then unticked, which is what a thumb does on a small row. The
    // queue must not collapse them: the server has to see the same sequence
    // the person performed, or the final state is a coin toss decided by
    // which write happened to survive.
    await enqueue({ type: "punch-list:status", jobId: "job_1", itemId: "item_9", status: "READY_FOR_REVIEW" });
    await enqueue({ type: "punch-list:status", jobId: "job_1", itemId: "item_9", status: "OPEN" });

    await flushQueue("token");

    expect(sent).toEqual(["status:item_9:READY_FOR_REVIEW", "status:item_9:OPEN"]);
    expect(await pendingCount()).toBe(0);
  });

  it("sends both even when the second tap lands mid-flush", async () => {
    await enqueue({ type: "punch-list:create", jobId: "job_1", clientOperationId: "op_1", description: "Grid" });
    duringSend = async () => {
      await enqueue({ type: "punch-list:status", jobId: "job_1", itemId: "item_9", status: "READY_FOR_REVIEW" });
      await enqueue({ type: "punch-list:status", jobId: "job_1", itemId: "item_9", status: "OPEN" });
    };

    await flushQueue("token");
    await flushQueue("token");

    expect(sent).toEqual([
      "create:Grid",
      "status:item_9:READY_FOR_REVIEW",
      "status:item_9:OPEN",
    ]);
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

/**
 * GAP 6, the head-of-line block. Written from the audit's own words:
 * "One op that fails permanently blocks every write queued behind it,
 * forever… The teardown's OFF-32 is written against exactly this: never
 * drop time, and never let it be blocked behind something else."
 *
 * Half of it was already fixed when #382 added the refused list: a 4xx
 * the server will give again is set aside and the drain continues. The
 * half that was still live is the one below — a write the SERVER answers
 * with a 500, over and over. That hit `break`, so a day of time could sit
 * behind a photo the server would not take, with no attempt count, no
 * backoff, no way to see it and no way to remove it.
 */
describe("one write the server keeps refusing", () => {
  it("does not hold the writes queued behind it", async () => {
    await enqueue({ type: "punch-list:create", jobId: "job_1", clientOperationId: "op_bad", description: "Bad one" });
    await enqueue({ type: "punch-list:status", jobId: "job_1", itemId: "item_9", status: "READY_FOR_REVIEW" });

    // ONLY the first write 500s; the second is perfectly sendable, which
    // is the whole question — does the queue ever get to it.
    failNext = () => {
      failNext = null;
      throw new FakeApiError("Something went wrong", 500);
    };

    await flushQueue("token");

    // THE POINT: the good write went up on the same pass.
    expect(sent).toEqual(["create:Bad one", "status:item_9:READY_FOR_REVIEW"]);
    expect(await pendingCount()).toBe(1);
  });

  it("backs off rather than hammering the radio, and says what happened", async () => {
    await enqueue({ type: "punch-list:status", jobId: "job_1", itemId: "item_9", status: "READY_FOR_REVIEW" });
    failNext = () => {
      throw new FakeApiError("Something went wrong", 500);
    };
    await flushQueue("token");

    const [queued] = await listQueued();
    expect(queued.attempts).toBe(1);
    expect(queued.lastError).toBe("Something went wrong");
    expect(Date.parse(queued.nextTryAt!)).toBeGreaterThan(Date.now());

    // A second flush inside the backoff window does not send it again.
    sent.length = 0;
    await flushQueue("token");
    expect(sent).toEqual([]);
  });

  it("sets it aside after five server refusals, with what the server said", async () => {
    await enqueue({ type: "punch-list:status", jobId: "job_1", itemId: "item_9", status: "READY_FOR_REVIEW" });

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await sendNow(); // clear the backoff, as the outbox's button does
      failNext = () => {
        throw new FakeApiError("Something went wrong", 500);
      };
      await flushQueue("token");
    }

    expect(await pendingCount()).toBe(0);
    const [refused] = await listRefused();
    expect(refused.error).toBe("Something went wrong (tried 5 times)");
    expect(refused.status).toBe(500);
  });

  it("does not count a basement as an attempt", async () => {
    // A phone carried through a job with no signal must not arrive with
    // its writes in "needs attention" for never having reached anybody.
    await enqueue({ type: "punch-list:status", jobId: "job_1", itemId: "item_9", status: "READY_FOR_REVIEW" });

    for (let pass = 0; pass < MAX_ATTEMPTS + 3; pass++) {
      failNext = () => {
        throw new TypeError("Network request failed");
      };
      await flushQueue("token");
    }

    expect(await pendingCount()).toBe(1);
    expect(await listRefused()).toEqual([]);
    expect((await listQueued())[0].attempts).toBe(0);
  });

  it("can be taken off the queue by hand, which nothing could do before", async () => {
    await enqueue({ type: "punch-list:create", jobId: "job_1", clientOperationId: "op_1", description: "Bad one" });
    const [queued] = await listQueued();
    await removeQueued(queued.opId);
    expect(await pendingCount()).toBe(0);
  });
});

/**
 * REMOVING an item (#592). The phone could add a punch item and had no way
 * to take one off, so a typo was permanent — the row's only action cycled
 * it between three states forever.
 *
 * A delete is the first op in this queue whose correctness depends on what
 * ELSE is queued, which is why these tests are about pairs rather than
 * about one write going up.
 */
describe("a punch item removed", () => {
  it("goes up once, and the queue is empty afterwards", async () => {
    await enqueue({ type: "punch-list:delete", jobId: "job_1", itemId: "item_9" });

    await flushQueue("token");

    expect(sent).toEqual(["delete:item_9"]);
    expect(await pendingCount()).toBe(0);
    expect(await listRefused()).toEqual([]);
  });

  it("cancels the create it undoes, and NEITHER is ever sent", async () => {
    // Typed wrong, removed two taps later, both with no signal — the whole
    // of #592's story. The create is still sitting in the queue, so the row
    // has no server id and the only id the screen can be holding is the
    // create's own clientOperationId.
    await enqueue({ type: "punch-list:create", jobId: "job_1", clientOperationId: "op_typo", description: "Girdx" });
    await enqueue({ type: "punch-list:delete", jobId: "job_1", itemId: "op_typo" });

    await flushQueue("token");

    // Sending the create and then the delete would also end up correct.
    // Sending only the delete would not: it names a record that has never
    // existed, the server answers 404, that reads as "already gone" — and
    // the create in front of it then makes the row for real.
    expect(sent, "a write went up for an item that never left this phone").toEqual([]);
    expect(await pendingCount()).toBe(0);
    expect(await listRefused()).toEqual([]);
  });

  it("drops a status change queued for the item it removes", async () => {
    // Ticked, then removed. Without this the tick survives the delete, and
    // because the drain SKIPS a write that is backing off it can arrive
    // after the row is gone — "needs attention", about an item the person
    // deliberately deleted.
    await enqueue({ type: "punch-list:status", jobId: "job_1", itemId: "item_9", status: "READY_FOR_REVIEW" });
    await enqueue({ type: "punch-list:delete", jobId: "job_1", itemId: "item_9" });

    await flushQueue("token");

    expect(sent).toEqual(["delete:item_9"]);
    expect(await pendingCount()).toBe(0);
    expect(await listRefused()).toEqual([]);
  });

  it("leaves another item's writes alone", async () => {
    // The pairing is by id, and the cheapest way for it to be wrong is to
    // be too eager: a delete must not swallow the queue around it.
    await enqueue({ type: "punch-list:create", jobId: "job_1", clientOperationId: "op_other", description: "Grid" });
    await enqueue({ type: "punch-list:status", jobId: "job_1", itemId: "item_8", status: "READY_FOR_REVIEW" });
    await enqueue({ type: "punch-list:delete", jobId: "job_1", itemId: "item_9" });

    await flushQueue("token");

    expect(sent).toEqual(["create:Grid", "status:item_8:READY_FOR_REVIEW", "delete:item_9"]);
    expect(await pendingCount()).toBe(0);
  });

  it("treats an item already gone as DONE rather than as a refusal", async () => {
    // The ordinary replay: the delete went up, the answer never came back,
    // the phone asks again. A 404 is a final refusal by status
    // (`isFinalRefusal`), so without the queue reading it as success this
    // write lands in "needs attention" telling somebody their deletion was
    // not saved — about the one request whose goal has demonstrably been
    // met.
    await enqueue({ type: "punch-list:delete", jobId: "job_1", itemId: "item_9" });
    failNext = () => {
      throw new FakeApiError("Punch list item not found", 404);
    };

    await flushQueue("token");

    expect(await pendingCount()).toBe(0);
    expect(await listRefused(), "a delete whose row is already gone was set aside").toEqual([]);
  });

  it("still sets aside the refusal that matters: not the owner", async () => {
    // The other half of the 404 rule. Removing an item is owner-only on the
    // server, in parity with the web, so a crew member's queued delete comes
    // back 403 — and that one has to be SHOWN, with the server's own
    // sentence, because it is the only way they learn to ask the owner.
    await enqueue({ type: "punch-list:delete", jobId: "job_1", itemId: "item_9" });
    failNext = () => {
      throw new FakeApiError("Only the account owner can remove a punch list item", 403);
    };

    await flushQueue("token");

    expect(await pendingCount()).toBe(0);
    const [refused] = await listRefused();
    expect(refused.error).toBe("Only the account owner can remove a punch list item");
    expect(refused.status).toBe(403);
  });

  it("keeps a delete the network never carried", async () => {
    await enqueue({ type: "punch-list:delete", jobId: "job_1", itemId: "item_9" });
    failNext = () => {
      throw new TypeError("Network request failed");
    };

    await flushQueue("token");

    expect(await pendingCount()).toBe(1);
    expect(await listRefused()).toEqual([]);
  });
});
