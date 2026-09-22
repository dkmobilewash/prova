import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WHO THE OFFICE CAN LOG HOURS FOR.
 *
 * `TimeEntry` has named either a `User` or a `CrewMember` since #292 — the
 * XOR check in that migration enforces exactly one — and the phone's API has
 * written both ever since. `logTimeEntry` did not. It read `employeeUserId`
 * and looked the id up in `User`, so the one screen where hours are typed
 * with a keyboard offered only people who had completed a Clerk sign-up.
 *
 * The consequence is the shape this repo keeps paying for: nothing was
 * broken, nothing threw, every test was green, and a union drywall sub's
 * thirty field workers simply could not be selected in the office — the
 * place a certified payroll actually gets typed up.
 *
 * Two things here are easy to get wrong in a way that still looks right,
 * and each has its own test:
 *
 *   - the duplicate guard. `employeeUserId` is NULL on a crew entry, and
 *     `{ employeeUserId: null }` matches every crew row on the job. Two
 *     crew members with the same eight hours on the same cost code —
 *     which is what a crew sheet IS — would have had the second refused.
 *   - the legacy field name. The Ask assistant's direct command posts
 *     `employeeUserId`, so dropping it would break a path with no form.
 */

type Row = Record<string, unknown> & { id: string };

const state = vi.hoisted(() => ({
  tables: new Map<string, Row[]>(),
  seq: 0,
  context: {
    id: "user_ana",
    role: "OWNER" as string,
    jobFunction: null as string | null,
    company: { id: "co_A" },
  },
}));

function table(name: string): Row[] {
  let rows = state.tables.get(name);
  if (!rows) {
    rows = [];
    state.tables.set(name, rows);
  }
  return rows;
}

/** Equality on every key, plus the `gte` the duplicate guard uses on
 *  `createdAt`. Anything else throws rather than being ignored — a `where`
 *  key this fake silently dropped would make the guard look broader than it
 *  is, which is the opposite of what these tests are measuring. */
function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function matches(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      const clause = value as Record<string, unknown>;
      const keys = Object.keys(clause);
      if (keys.length === 1 && keys[0] === "gte") {
        return (row[key] as Date).getTime() >= (clause.gte as Date).getTime();
      }
      throw new Error(`unfaked where clause on ${key}: ${JSON.stringify(clause)}`);
    }
    return same(row[key], value);
  });
}

const prisma: Record<string, unknown> = new Proxy(
  {},
  {
    get: (_target, property) => {
      if (property === "then" || typeof property === "symbol") return undefined;
      const name = String(property);
      return {
        findUnique: async ({ where }: { where: Record<string, unknown> }) =>
          table(name).find((row) => matches(row, where)) ?? null,
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          table(name).find((row) => matches(row, where)) ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `${name}_${++state.seq}`, createdAt: new Date(), ...data } as Row;
          table(name).push(row);
          return row;
        },
      };
    },
  },
);

vi.mock("@prova/db", () => ({ prisma, Prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => state.context }));
// A signed day locks its hours; none of these days is signed. The lock has
// its own tests (lib/timesheet-signoff).
vi.mock("@/lib/timesheet-signoff", () => ({
  liveSignoff: async () => null,
  isDayLockError: () => false,
  lockedDayMessage: () => "locked",
}));

const { logTimeEntry } = await import("./labor");

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

const entries = () => table("timeEntry");

beforeEach(() => {
  state.tables = new Map();
  state.seq = 0;
  state.context.role = "OWNER";
  state.context.jobFunction = null;

  table("job").push({ id: "job_river", companyId: "co_A" });
  table("user").push({ id: "user_ana", companyId: "co_A", name: "Ana Reyes" });
  table("crewMember").push({ id: "luis", companyId: "co_A", archivedAt: null });
  table("crewMember").push({ id: "tino", companyId: "co_A", archivedAt: null });
  table("crewMember").push({ id: "gone", companyId: "co_A", archivedAt: new Date() });
  // Another company's, so "this company's" has something to fail against.
  table("crewMember").push({ id: "theirs", companyId: "co_B", archivedAt: null });
});

describe("logging hours from the web", () => {
  it("logs a crew member with no login, as a crew entry and not a user one", async () => {
    expect(
      await logTimeEntry("job_river", form({ worker: "crew:luis", date: "2026-09-14", hours: "8" })),
    ).toEqual({ ok: true });
    expect(entries()).toHaveLength(1);
    // The XOR the database enforces: one set, the other null. A row with
    // both, or with neither, is refused by a CHECK constraint this fake
    // cannot see — so the assertion is on the shape, both halves.
    expect(entries()[0]).toMatchObject({ crewMemberId: "luis", employeeUserId: null });
  });

  it("still logs a teammate who does sign in", async () => {
    expect(
      await logTimeEntry("job_river", form({ worker: "user:user_ana", date: "2026-09-14", hours: "8" })),
    ).toEqual({ ok: true });
    expect(entries()[0]).toMatchObject({ employeeUserId: "user_ana", crewMemberId: null });
  });

  it("still accepts the old field name the assistant posts", async () => {
    // lib/ask/commands/labor.ts builds its FormData with `employeeUserId`.
    // Dropping it would break a path that has no form to notice.
    expect(
      await logTimeEntry("job_river", form({ employeeUserId: "user_ana", date: "2026-09-14", hours: "8" })),
    ).toEqual({ ok: true });
    expect(entries()[0]).toMatchObject({ employeeUserId: "user_ana", crewMemberId: null });
  });

  it("refuses an archived crew member with a sentence, not a digest", async () => {
    // Reachable in the ordinary way: the dropdown was rendered before
    // somebody else archived them. Returned rather than thrown, because
    // production redacts a thrown Server Action message.
    expect(
      await logTimeEntry("job_river", form({ worker: "crew:gone", date: "2026-09-14", hours: "8" })),
    ).toEqual({ ok: false, error: expect.stringContaining("archived") });
    expect(entries()).toHaveLength(0);
  });

  it("will not log hours against another company's crew member", async () => {
    await expect(
      logTimeEntry("job_river", form({ worker: "crew:theirs", date: "2026-09-14", hours: "8" })),
    ).rejects.toThrow(/not found/);
    expect(entries()).toHaveLength(0);
  });

  it("refuses a value that names no table rather than guessing", async () => {
    await expect(
      logTimeEntry("job_river", form({ worker: "luis", date: "2026-09-14", hours: "8" })),
    ).rejects.toThrow(/not found/);
    expect(entries()).toHaveLength(0);
  });
});

describe("the duplicate guard, with crew in the mix", () => {
  const day = { date: "2026-09-14", hours: "8" };

  it("still refuses the same crew member's identical entry submitted twice", async () => {
    expect(await logTimeEntry("job_river", form({ worker: "crew:luis", ...day }))).toEqual({ ok: true });
    expect(await logTimeEntry("job_river", form({ worker: "crew:luis", ...day }))).toEqual({
      ok: false,
      error: expect.stringContaining("moments ago"),
    });
    expect(entries()).toHaveLength(1);
  });

  /**
   * THE ONE THAT WOULD HAVE SHIPPED BROKEN. On a crew entry
   * `employeeUserId` is null, and a `where` naming only that column matches
   * EVERY crew row on the job. Eight carpenters with the same eight hours on
   * the same cost code is not a double-click, it is a crew sheet — and all
   * but the first would have been refused as a repeat of somebody else.
   */
  it("does not mistake a second crew member for a repeat of the first", async () => {
    expect(await logTimeEntry("job_river", form({ worker: "crew:luis", ...day }))).toEqual({ ok: true });
    expect(await logTimeEntry("job_river", form({ worker: "crew:tino", ...day }))).toEqual({ ok: true });
    expect(entries()).toHaveLength(2);
    expect(entries().map((e) => e.crewMemberId)).toEqual(["luis", "tino"]);
  });

  it("does not mistake a crew member for the teammate logged the same way", async () => {
    expect(await logTimeEntry("job_river", form({ worker: "user:user_ana", ...day }))).toEqual({ ok: true });
    expect(await logTimeEntry("job_river", form({ worker: "crew:luis", ...day }))).toEqual({ ok: true });
    expect(entries()).toHaveLength(2);
  });
});
