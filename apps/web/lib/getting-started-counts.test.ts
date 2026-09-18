import { describe, expect, it, vi } from "vitest";

/**
 * The loader behind the getting-started card, against a fake database that
 * holds TWO companies and actually applies the where clause.
 *
 * A fake that returns a fixed number whatever it is asked would pass with
 * the `companyId` filter deleted. This one counts rows that match the
 * clause, so a missing filter counts the other company's rows and the
 * assertions below go red. The other company is deliberately the busy one:
 * a new account must not see its boxes ticked by somebody else's jobs.
 */

type Row = Record<string, unknown>;

const { tables, calls } = vi.hoisted(() => {
  const mine = "co-new";
  const theirs = "co-busy";
  const many = (companyId: string, n: number, extra: Row = {}) =>
    Array.from({ length: n }, (_, i) => ({ id: `${companyId}-${i}`, companyId, ...extra }));

  const tables: Record<string, Row[]> = {
    job: [...many(theirs, 4)],
    user: [...many(mine, 1), ...many(theirs, 6)],
    invite: [...many(theirs, 2)],
    crewMember: [
      ...many(mine, 1, { archivedAt: new Date("2026-01-01T00:00:00Z") }),
      ...many(theirs, 3, { archivedAt: null }),
    ],
    crewScheduleDay: [...many(theirs, 9)],
    dailyFieldReport: [...many(theirs, 5)],
    jobMedia: [...many(theirs, 7)],
    quickBooksConnection: [...many(theirs, 1)],
  };
  return { tables, calls: [] as { model: string; method: string }[] };
});

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

vi.mock("@prova/db", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, model: string) {
        return new Proxy(
          {},
          {
            get(_t, method: string) {
              return async (args: { where?: Row } = {}) => {
                calls.push({ model, method });
                if (method !== "count") throw new Error(`${model}.${method} is not a count`);
                const rows = tables[model];
                if (!rows) throw new Error(`no fake table for ${model}`);
                return rows.filter((row) => matches(row, args.where)).length;
              };
            },
          },
        );
      },
    },
  ),
}));

const { loadGettingStartedCounts } = await import("./getting-started-counts");

describe("loadGettingStartedCounts", () => {
  it("counts only the asked-for company's rows", async () => {
    expect(await loadGettingStartedCounts("co-new")).toEqual({
      jobs: 0,
      users: 1,
      pendingInvites: 0,
      // Its one crew record is archived.
      crewMembers: 0,
      scheduleDays: 0,
      fieldReports: 0,
      jobMedia: 0,
      quickBooksConnections: 0,
    });
  });

  it("and the other company sees its own", async () => {
    expect(await loadGettingStartedCounts("co-busy")).toEqual({
      jobs: 4,
      users: 6,
      pendingInvites: 2,
      crewMembers: 3,
      scheduleDays: 9,
      fieldReports: 5,
      jobMedia: 7,
      quickBooksConnections: 1,
    });
  });

  it("asks only for counts, one per model", async () => {
    calls.length = 0;
    await loadGettingStartedCounts("co-new");
    expect(calls.every((call) => call.method === "count")).toBe(true);
    expect(calls.map((call) => call.model).sort()).toEqual(Object.keys(tables).sort());
  });
});
