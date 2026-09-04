import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Alert } from "@/lib/alerts";

/**
 * The unprotected window after the digest is sent (#116).
 *
 * `notification-dispatch.ts` opens with "THE ORDER IS THE DESIGN": the
 * dispatch rows are claimed BEFORE the provider is called, so a crash
 * between sending and recording is a notice that was sent and recorded.
 * That was true of the CLAIMS and false of the MESSAGE. The message row
 * was written first, but its handover event and its `providerMessageId`
 * went into a `$transaction` AFTER `sendEmail` returned. Everything
 * between those two points is a window where the digest HAS reached a
 * real person and the database says otherwise — a row with no events and
 * no provider id, which is indistinguishable from one that never left.
 * `/messages` reads it as "No word back yet" and `reachedProvider` reads
 * it as never-sent, so the owner-only delete guard would let the record of
 * a delivered email be destroyed.
 *
 * These are ORDERING tests. What they assert is which writes have already
 * happened at the moment the provider is reached, and what survives a
 * write that throws — neither of which a return value can show. They are
 * unit tests, run by `pnpm test`, because the property is about the order
 * of calls and not about SQL; `notification-dispatch.dbtest.ts` covers the
 * things that genuinely need Postgres (the unique constraint, the
 * per-user scoping, the release).
 *
 * The fix mirrors `lib/actions/messages.ts`, which had the same hole.
 */

type Row = Record<string, unknown> & { id: string };

/** A Prisma-like LAZY operation. A real `PrismaPromise` does nothing until
 * it is awaited, which is what lets `$transaction([a, b])` be handed two
 * writes that have not run. A fake that ran them on construction would
 * apply the second write of a transaction whose first write threw — which
 * is the exact situation under test, turned into a passing one. */
function op<T>(run: () => T): PromiseLike<T> {
  return {
    then: (onFulfilled, onRejected) =>
      Promise.resolve().then(run).then(onFulfilled, onRejected),
  };
}

/** Supports `field: value` and `field: { in: [...] }`, which is every
 * shape the dispatcher's queries use. Anything else is left out so a test
 * straying past what this covers fails loudly rather than asserting
 * against a fiction. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "in" in value) {
      return (value as { in: unknown[] }).in.includes(row[key]);
    }
    return row[key] === value;
  });
}

/** Just enough of the client for `dispatchAlertDigest`, with the two
 * properties the ordering tests need: lazy operations, and a
 * `$transaction` that actually rolls back. */
class FakeDb {
  private tables = new Map<string, Map<string, Row>>();
  private seq = 0;

  /** Every write, in the order it happened, as `table.operation`. */
  readonly writes: string[] = [];

  /** Set to a `table.operation` string to make that write throw once. */
  failNext: string | null = null;

  private table(name: string): Map<string, Row> {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = new Map();
      this.tables.set(name, rows);
    }
    return rows;
  }

  rows(name: string): Row[] {
    return [...this.table(name).values()];
  }

  private note(what: string) {
    this.writes.push(what);
    if (this.failNext === what) {
      this.failNext = null;
      throw new Error(`simulated database failure: ${what}`);
    }
  }

  private model(name: string) {
    return {
      create: ({ data }: { data: Record<string, unknown> }) =>
        op(() => {
          this.note(`${name}.create`);
          const row = { id: `${name}_${++this.seq}`, ...data } as Row;
          this.table(name).set(row.id, row);
          return row;
        }),

      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) =>
        op(() => {
          this.note(`${name}.update`);
          const existing = this.table(name).get(where.id);
          if (!existing) throw new Error(`${name} ${where.id} not found`);
          // Replaced, never mutated, so the transaction snapshot is real.
          const next = { ...existing, ...data } as Row;
          this.table(name).set(next.id, next);
          return next;
        }),

      delete: ({ where }: { where: { id: string } }) =>
        op(() => {
          this.note(`${name}.delete`);
          const existing = this.table(name).get(where.id);
          if (!existing) throw new Error(`${name} ${where.id} not found`);
          this.table(name).delete(where.id);
          return existing;
        }),

      findMany: ({ where }: { where?: Record<string, unknown> } = {}) =>
        op(() =>
          where
            ? this.rows(name).filter((row) => matches(row, where))
            : this.rows(name),
        ),

      updateMany: ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) =>
        op(() => {
          this.note(`${name}.updateMany`);
          let count = 0;
          for (const row of this.rows(name)) {
            if (!matches(row, where)) continue;
            this.table(name).set(row.id, { ...row, ...data } as Row);
            count += 1;
          }
          return { count };
        }),

      deleteMany: ({ where }: { where: Record<string, unknown> }) =>
        op(() => {
          this.note(`${name}.deleteMany`);
          let count = 0;
          for (const row of this.rows(name)) {
            if (!matches(row, where)) continue;
            this.table(name).delete(row.id);
            count += 1;
          }
          return { count };
        }),

      /** `skipDuplicates` against the real `(userId, dispatchKey)` unique
       * constraint — the lock the whole claim mechanism rests on. */
      createManyAndReturn: ({ data }: { data: Record<string, unknown>[] }) =>
        op(() => {
          this.note(`${name}.createManyAndReturn`);
          const created: Row[] = [];
          for (const item of data) {
            const clash = this.rows(name).some(
              (row) =>
                row.userId === item.userId &&
                row.dispatchKey === item.dispatchKey,
            );
            if (clash) continue;
            const row = {
              id: `${name}_${++this.seq}`,
              messageId: null,
              ...item,
            } as Row;
            this.table(name).set(row.id, row);
            created.push(row);
          }
          return created;
        }),
    };
  }

  private async transaction(operations: PromiseLike<unknown>[]) {
    const snapshot = new Map(
      [...this.tables].map(([name, rows]) => [name, new Map(rows)] as const),
    );
    try {
      const results: unknown[] = [];
      // Sequential on purpose: `Promise.all` would start the second write
      // even when the first has already thrown.
      for (const operation of operations) results.push(await operation);
      return results;
    } catch (err) {
      this.tables = snapshot;
      throw err;
    }
  }

  client() {
    return new Proxy(
      {},
      {
        // Arrow, so `this` stays the FakeDb.
        get: (_target, property) => {
          if (property === "$transaction")
            return (operations: PromiseLike<unknown>[]) =>
              this.transaction(operations);
          return this.model(String(property));
        },
      },
    ) as never;
  }
}

let db = new FakeDb();

const sendEmail = vi.fn();
const visible: Alert[] = [];

vi.mock("@prova/db", () => ({
  get prisma() {
    return db.client();
  },
}));

vi.mock("@prova/integrations", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  readEmailConfig: () => ({
    provider: "resend",
    apiKey: "test",
    from: "notifications@send.example.test",
    webhookSecret: null,
  }),
  emailSetupProblem: () => null,
}));

vi.mock("@/lib/alerts-query", () => ({
  loadAlerts: async () => ({ visible, dismissed: [] }),
}));

const { dispatchAlertDigest } = await import("./notification-dispatch");

const recipient = {
  id: "user_1",
  companyId: "co_1",
  email: "owner@sub.example",
  name: "Dana Ruiz",
  role: "OWNER",
  jobFunction: null as string | null,
};

const TODAY = "2026-09-03";

/** A licence a week out: DUE_SOON, so it crosses `approaching` and `week`
 * and there is something to send. */
const lapsing: Alert = {
  key: "RENEWAL:lic_1:2026-09-10",
  kind: "RENEWAL",
  severity: "DUE_SOON",
  title: "State contractor licence",
  detail: "Expires in 7 days",
  href: "/compliance",
  dueOn: "2026-09-10",
  daysUntil: 7,
  amount: null,
};

const accepted = {
  ok: true as const,
  providerMessageId: "prov_1",
  from: "notifications@send.example.test",
};

function dispatch() {
  return dispatchAlertDigest(recipient, TODAY, "https://app.example.test");
}

function eventTypes() {
  return db.rows("outboundMessageEvent").map((event) => event.type);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = new FakeDb();
  visible.length = 0;
  visible.push(lapsing);
});

describe("dispatchAlertDigest records the handover before the provider is called", () => {
  it("has written the message AND its handover event by the time sendEmail runs", async () => {
    let writesAtSend: string[] = [];
    sendEmail.mockImplementation(async () => {
      writesAtSend = [...db.writes];
      return accepted;
    });

    await expect(dispatch()).resolves.toMatchObject({ ok: true, sent: true });

    // Not "the message row" — a row with NO EVENTS is exactly what reads
    // as a send that never left, both on /messages and to the delete
    // guard. The event is the half that was missing.
    expect(writesAtSend).toContain("outboundMessage.create");
    expect(writesAtSend).toContain("outboundMessageEvent.create");
  });

  it("keeps the evidence when the write after a successful send fails", async () => {
    sendEmail.mockImplementation(async () => {
      // Everything past this point is a database the process may lose.
      db.failNext = "outboundMessage.update";
      return accepted;
    });

    // It must NOT throw. Production redacts a thrown Server Action
    // message, so `sendMyAlertDigest` would render an opaque failure for a
    // digest that went out, and the obvious next move is to click again.
    const outcome = await dispatch();
    expect(outcome.ok).toBe(false);

    // The email reached a person, so the record that it did has to
    // survive: one QUEUED event, still attached to the message.
    expect(eventTypes()).toEqual(["QUEUED"]);
    expect(db.rows("outboundMessage")).toHaveLength(1);

    // And the milestones stay spent. The notice was delivered; re-arming
    // it here would send the same licence warning twice.
    expect(db.rows("notificationDispatch")).toHaveLength(2);
  });
});

describe("dispatchAlertDigest gives the handover back only when nothing was sent", () => {
  it("swaps the claim for FAILED when the provider provably never took it", async () => {
    sendEmail.mockResolvedValue({
      ok: false,
      error: "Couldn't reach the email provider: fetch failed",
      configured: true,
    });

    const outcome = await dispatch();
    expect(outcome).toMatchObject({ ok: false, claimed: 0 });

    // Exactly one event, and it says what happened. A QUEUED left behind
    // beside it would be one handover reported as two, and would make the
    // row undeletable evidence of an email that does not exist.
    expect(eventTypes()).toEqual(["FAILED"]);

    // The milestone that FIRED is handed back, so the next run says it
    // again. The looser rung it burned on the way past is not: the retry
    // re-fires `week` with `approaching` already in the ledger, and
    // releasing a row this call did not link is how one run deletes
    // another's claim. Pinned in both directions in the dbtest.
    expect(db.rows("notificationDispatch").map((row) => row.rung)).toEqual([
      "approaching",
    ]);
  });

  it("never leaves a message with neither the claim nor the failure", async () => {
    sendEmail.mockImplementation(async () => {
      // Armed HERE, not before the call, so it hits the swap's create and
      // not the handover's — the handover is written before the provider
      // is reached, which is the point of the fix.
      //
      // The swap is a delete and a create. Losing the claim without
      // recording the failure is the same hole as #116, pointing the other
      // way — so the two go together or neither does.
      db.failNext = "outboundMessageEvent.create";
      return {
        ok: false,
        error: "Couldn't reach the email provider: fetch failed",
        configured: true,
      };
    });

    await expect(dispatch()).rejects.toThrow(/simulated database failure/);
    expect(eventTypes()).toEqual(["QUEUED"]);
  });

  it("keeps the claim, and does not double-report it, when the provider took it", async () => {
    sendEmail.mockResolvedValue({
      ok: false,
      error: "The provider accepted this but returned no message id",
      configured: true,
      // The one failure that keeps its claim: the mail has almost
      // certainly gone, and a duplicate compliance warning is worse than a
      // late one.
      mayHaveSent: true,
    });

    const outcome = await dispatch();
    expect(outcome).toMatchObject({ ok: false, claimed: 1 });

    // ONE event. The handover was already recorded before the send; a
    // second QUEUED written here would report one send as two.
    expect(eventTypes()).toEqual(["QUEUED"]);
    const [event] = db.rows("outboundMessageEvent");
    expect(String(event.detail)).toContain("returned no message id");

    // The claims stand, so nothing re-sends it.
    expect(db.rows("notificationDispatch")).toHaveLength(2);
  });
});
