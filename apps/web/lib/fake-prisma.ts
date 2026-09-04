/**
 * A minimal in-memory stand-in for the Prisma client, for tests that are
 * about the ORDER of writes rather than about SQL.
 *
 * The two defects in #111 this exists for are both ordering defects: an
 * email recorded after the provider was called instead of before, and a
 * case number issued before anything checked whether the case was already
 * filed. Neither is visible in a return value, and neither needs Postgres
 * to demonstrate — but both need two properties a naive fake does not
 * have, and without them the tests pass against the broken code:
 *
 * 1. **Operations are LAZY.** A real `PrismaPromise` does nothing until it
 *    is awaited, which is what lets `$transaction([a, b])` receive two
 *    unstarted writes. A fake whose methods ran on construction would
 *    apply the second write of a transaction whose first write threw —
 *    turning the exact situation under test into a passing one.
 * 2. **`$transaction` ROLLS BACK.** Same reason. `update` replaces the
 *    stored object rather than mutating it, so a shallow copy of the maps
 *    is a real snapshot to restore from.
 *
 * Deliberately not a general Prisma emulator. It supports the handful of
 * calls the two actions under test make, and anything else is left off so
 * that a test straying outside that fails loudly instead of quietly
 * asserting against a fiction.
 */

export type Row = Record<string, unknown> & { id: string };

/** A Prisma-like lazy operation: `run` fires when the result is awaited. */
function op<T>(run: () => T): PromiseLike<T> {
  return {
    then: (onFulfilled, onRejected) =>
      Promise.resolve().then(run).then(onFulfilled, onRejected),
  };
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    const actual = row[key];
    if (value instanceof Date && actual instanceof Date) {
      return value.getTime() === actual.getTime();
    }
    return actual === value;
  });
}

/**
 * The columns a `where` actually constrains.
 *
 * Prisma spells a COMPOSITE unique key as a single nested object —
 * `{ companyId_caseYear: { companyId, caseYear } }` — and a single-column
 * one flat: `{ email: "…" }`. Both reach here, so unwrap the nested form
 * and pass the flat one straight through. Reading `Object.values(where)[0]`
 * unconditionally, as `upsert` once did, turns `{ companyId: "co_1" }`
 * into the STRING "co_1", and matching against a string compares its
 * character indices — which finds nothing, forever.
 */
function criteria(where: Record<string, unknown>): Record<string, unknown> {
  const values = Object.values(where);
  const onlyValue = values.length === 1 ? values[0] : null;
  if (onlyValue && typeof onlyValue === "object" && !(onlyValue instanceof Date)) {
    return onlyValue as Record<string, unknown>;
  }
  return where;
}

export class FakeDb {
  /** Table name -> rows by id. */
  private tables = new Map<string, Map<string, Row>>();
  private seq = 0;

  /** Columns a real insert would fill in that `data` leaves out.
   *
   * Worth the eight lines: an omitted nullable column came back as
   * `undefined` here where Postgres returns `null`, and
   * `reachedProvider`'s first test is `providerMessageId !== null` — so a
   * message that never reached the provider read as one that had, and a
   * test asserting it could be deleted failed for a reason that was about
   * this file rather than about the code under test. */
  private columnDefaults = new Map<string, Record<string, unknown>>();

  defaults(name: string, values: Record<string, unknown>) {
    this.columnDefaults.set(name, values);
    return this;
  }

  /** Every write, in the order it actually happened, as `table.operation`.
   * The ordering assertions read this. */
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

  seed(name: string, row: Row): Row {
    this.table(name).set(row.id, row);
    return row;
  }

  private note(what: string) {
    this.writes.push(what);
    if (this.failNext === what) {
      this.failNext = null;
      throw new Error(`simulated database failure: ${what}`);
    }
  }

  /** The client surface the actions call. `tx` inside an interactive
   * transaction is this same object, which is what Prisma does too. */
  model(name: string) {
    return {
      create: ({ data }: { data: Record<string, unknown> }) =>
        op(() => {
          this.note(`${name}.create`);
          const row = {
            id: `${name}_${++this.seq}`,
            ...(this.columnDefaults.get(name) ?? {}),
            ...data,
          } as Row;
          this.table(name).set(row.id, row);
          return row;
        }),

      /**
       * `where` may name a COMPOSITE unique key, not only `id`.
       *
       * Same trap `findUnique` and `upsert` already document, and it bites
       * harder here: this used to index the id map with `where.id`
       * unconditionally, so `update({ where: { companyId_entityType_entityId:
       * {…} } })` did `Map.get(undefined)`, missed, and THREW "undefined not
       * found". A caller with that update inside a try then took its error
       * branch — so a test could watch a QuickBooks push report "couldn't
       * read the invoice back" and be looking at this fake, not the action.
       */
      update: ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) =>
        op(() => {
          this.note(`${name}.update`);
          const existing =
            typeof where.id === "string"
              ? this.table(name).get(where.id)
              : this.rows(name).find((row) => matches(row, criteria(where)));
          if (!existing) throw new Error(`${name} ${JSON.stringify(where)} not found`);
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

      /**
       * Deletes every row matching a NON-unique `where`, and returns the
       * count the way Prisma does.
       *
       * Here because the QuickBooks recovery path clears a link with
       * `deleteMany` rather than `delete` — deliberately, so a link that is
       * already gone is not an exception. A test of that path has to be
       * able to watch the row disappear, and watching it NOT disappear is
       * the more important half: clearing a link is the one recovery in
       * this codebase that makes the next push a CREATE.
       */
      deleteMany: ({ where }: { where?: Record<string, unknown> } = {}) =>
        op(() => {
          this.note(`${name}.deleteMany`);
          const doomed = where
            ? this.rows(name).filter((row) => matches(row, where))
            : this.rows(name);
          for (const row of doomed) this.table(name).delete(row.id);
          return { count: doomed.length };
        }),

      upsert: ({
        where,
        create,
        update,
      }: {
        where: Record<string, unknown>;
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) =>
        op(() => {
          this.note(`${name}.upsert`);
          const found = this.rows(name).find((row) => matches(row, criteria(where)));
          if (!found) {
            const row = { id: `${name}_${++this.seq}`, ...create } as Row;
            this.table(name).set(row.id, row);
            return row;
          }
          const next = { ...found } as Row;
          for (const [key, value] of Object.entries(update)) {
            // `{ increment: n }`, the only atomic op these actions use.
            if (
              value &&
              typeof value === "object" &&
              "increment" in (value as Record<string, unknown>)
            ) {
              const by = (value as { increment: number }).increment;
              next[key] = ((next[key] as number) ?? 0) + by;
            } else {
              next[key] = value;
            }
          }
          this.table(name).set(next.id, next);
          return next;
        }),

      /**
       * `where` may name ANY unique column, not just `id`.
       *
       * This used to index the id map with `where.id` unconditionally, so
       * `findUnique({ where: { email } })` did `Map.get(undefined)` and
       * returned null — SILENTLY, and null is a perfectly ordinary answer
       * for a unique lookup. requireCompanyContext looks a pending invite
       * up by email, so under the old fake that lookup always missed and
       * the code under test took the create-your-own-company branch
       * instead. A test written to pin the invite path would then have
       * been green about a path it never entered.
       */
      findUnique: ({
        where,
        include,
      }: {
        where: Record<string, unknown>;
        include?: Record<string, boolean>;
      }) =>
        op(() => {
          const row =
            typeof where.id === "string"
              ? (this.table(name).get(where.id) ?? null)
              : (this.rows(name).find((candidate) => matches(candidate, criteria(where))) ??
                null);
          return row ? this.withIncludes(row, include) : null;
        }),

      findFirst: ({ where }: { where: Record<string, unknown> }) =>
        op(() => this.rows(name).find((row) => matches(row, where)) ?? null),

      findMany: ({ where }: { where?: Record<string, unknown> } = {}) =>
        op(() =>
          where ? this.rows(name).filter((row) => matches(row, where)) : this.rows(name),
        ),
    };
  }

  /** Only the relation these tests need: a message's events. */
  private withIncludes(row: Row, include?: Record<string, boolean>): Row {
    if (!include?.events) return row;
    return {
      ...row,
      events: this.rows("outboundMessageEvent").filter(
        (event) => event.messageId === row.id,
      ),
    };
  }

  private snapshot() {
    return new Map(
      [...this.tables].map(([name, rows]) => [name, new Map(rows)] as const),
    );
  }

  private restore(snapshot: Map<string, Map<string, Row>>) {
    this.tables = snapshot;
  }

  async transaction(arg: unknown): Promise<unknown> {
    const snapshot = this.snapshot();
    try {
      if (typeof arg === "function") {
        return await (arg as (tx: unknown) => Promise<unknown>)(this.client());
      }
      const results: unknown[] = [];
      // Sequential on purpose: `Promise.all` would start the second write
      // even when the first has already thrown.
      for (const operation of arg as PromiseLike<unknown>[]) {
        results.push(await operation);
      }
      return results;
    } catch (err) {
      this.restore(snapshot);
      throw err;
    }
  }

  /** The object the action sees as `prisma`. */
  client() {
    return new Proxy(
      {},
      {
        // Arrow rather than a method: `this` has to stay the FakeDb.
        get: (_target, property) => {
          if (property === "$transaction") return (arg: unknown) => this.transaction(arg);
          return this.model(String(property));
        },
      },
    ) as never;
  }
}
