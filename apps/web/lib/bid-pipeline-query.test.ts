import { describe, expect, it, vi } from "vitest";

/**
 * What /pipeline's "by general contractor" section asks the database for.
 *
 * WHY THIS FILE EXISTS. `loadBidPipeline` read EVERY contact on the account
 * with every bid invitation nested under it, and dropped the ones with no
 * invitations in JavaScript afterwards. The page looked identical either
 * way, which is exactly why nothing caught it: a sub's contact book is
 * mostly vendors, suppliers, architects and inspectors, and all of them
 * were being read out of Postgres — on every page load AND on every
 * pursuit save, since a Server Action that revalidates re-renders the whole
 * route from the root (CLAUDE.md, issue #61).
 *
 * A dbtest already proves the OUTPUT leaves those contacts out
 * (bid-pipeline-query.dbtest.ts, "leaves out a contact who has never been
 * invited to bid"). It passed before this change and it passes after, so it
 * cannot tell the two apart — a post-query filter satisfies it exactly as
 * well as a where-clause does. The assertion that can only be true of the
 * where-clause is the ARGUMENT sent to the database, which is what this
 * file reads, the same shape bid-pursuits-query.test.ts uses for the
 * tenant boundary on the link picker.
 *
 * Two assertions, on purpose, because they fail differently:
 *   - the argument narrows to this company AND to contacts that have at
 *     least one invitation;
 *   - the fake honours that where clause, so what comes back is provably
 *     unchanged by the narrowing — same rows, same figures.
 */

type Row = {
  id: string;
  companyId: string;
  name: string;
  bidInvitations: Array<{
    id: string;
    projectName: string;
    status: string;
    dueDate: Date | null;
    bidAmount: number | null;
  }>;
};

const ROWS: Row[] = [
  {
    id: "gc-busy",
    companyId: "company-1",
    name: "Northside Builders",
    bidInvitations: [
      { id: "b1", projectName: "Oak Ave", status: "WON", dueDate: new Date("2026-08-01"), bidAmount: 1000 },
      { id: "b2", projectName: "Elm St", status: "INVITED", dueDate: new Date("2026-10-03"), bidAmount: null },
    ],
  },
  // The reason this file exists: a contact with no bidding relationship at
  // all. It must never be FETCHED, not merely never rendered.
  { id: "vendor-quiet", companyId: "company-1", name: "Acme Drywall Supply", bidInvitations: [] },
  {
    id: "gc-theirs",
    companyId: "company-2",
    name: "SOMEONE ELSE'S GC",
    bidInvitations: [
      { id: "b3", projectName: "THEIR PROJECT", status: "WON", dueDate: null, bidAmount: 9999 },
    ],
  },
];

const calls: Array<{ where?: Record<string, unknown> }> = [];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    contact: {
      findMany: async (args: { where?: Record<string, unknown> }) => {
        calls.push(args);
        const scope = args.where?.companyId;
        const wantsInvited = args.where?.bidInvitations !== undefined;
        return ROWS.filter((row) => (scope === undefined ? true : row.companyId === scope)).filter(
          (row) => (wantsInvited ? row.bidInvitations.length > 0 : true),
        );
      },
    },
  },
}));

describe("loadBidPipeline asks the database for the GCs, not the whole contact book", () => {
  it("narrows to this company and to contacts that have been invited to bid", async () => {
    const { loadBidPipeline } = await import("./bid-pipeline-query");
    calls.length = 0;
    await loadBidPipeline("company-1", "2026-09-22");

    expect(calls).toHaveLength(1);
    expect(calls[0].where?.companyId).toBe("company-1");
    // `{ some: {} }` — has at least one invitation, whatever it says.
    // Written as an equality rather than a truthiness check so replacing it
    // with some narrower predicate is a decision somebody has to make here.
    expect(calls[0].where?.bidInvitations).toEqual({ some: {} });
  });

  it("returns exactly what it returned before the narrowing", async () => {
    const { loadBidPipeline } = await import("./bid-pipeline-query");
    const { rows, live } = await loadBidPipeline("company-1", "2026-09-22");

    expect(rows.map((row) => row.contactId)).toEqual(["gc-busy"]);
    expect(rows[0].record.invited).toBe(2);
    expect(rows[0].record.won).toBe(1);
    expect(rows[0].record.valueWon).toBe(1000);
    expect(live.map((bid) => bid.id)).toEqual(["b2"]);
  });

  it("never reaches another company's bidding relationships", async () => {
    const { loadBidPipeline } = await import("./bid-pipeline-query");
    const shown = JSON.stringify(await loadBidPipeline("company-1", "2026-09-22"));
    expect(shown).not.toContain("gc-theirs");
    expect(shown).not.toContain("SOMEONE ELSE'S GC");
    expect(shown).not.toContain("THEIR PROJECT");
  });
});
