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
          // The composite-key form: `{ companyId_caseYear: {...} }`.
          const criteria = Object.values(where)[0] as Record<string, unknown>;
          const found = this.rows(name).find((row) => matches(row, criteria));
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

      findUnique: ({
        where,
        include,
      }: {
        where: { id: string };
        include?: Record<string, boolean>;
      }) =>
        op(() => {
          const row = this.table(name).get(where.id) ?? null;
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
