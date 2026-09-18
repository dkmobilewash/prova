import { describe, expect, it, vi } from "vitest";

/**
 * The tenant boundary on the "link this pursuit to an invitation" picker.
 *
 * WHY THIS FILE EXISTS: the branch that built pursuits reported 20 of 20
 * mutations caught, and a 21st survived review — deleting `companyId` from
 * `loadLinkableInvitations`' where clause passed ALL 3,823 tests. Nothing
 * guarded it. The link ACTION refuses another company's invitation, so the
 * leak could never have written anything — but the picker would have
 * LISTED another company's bids, with their project names, GCs and due
 * dates, in a dropdown on /pipeline. A read leak is still a leak.
 *
 * Two assertions, on purpose, because they fail differently:
 *   - the ARGUMENT sent to the database carries this company's id — the
 *     same shape page-context-query uses, since a seeded test alone would
 *     pass equally against a post-query filter someone could later delete;
 *   - the fake honours the where clause across two companies, so what comes
 *     back is provably only this company's rows.
 */

const ROWS = [
  { id: "inv-mine", companyId: "company-1", projectName: "Riverside", pursuit: null, dueDate: null, contact: { name: "Turner" }, createdAt: new Date("2026-09-10") },
  { id: "inv-theirs", companyId: "company-2", projectName: "SOMEONE ELSE'S BID", pursuit: null, dueDate: null, contact: { name: "Skanska" }, createdAt: new Date("2026-09-11") },
];

const calls: Array<{ where?: Record<string, unknown> }> = [];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    bidInvitation: {
      findMany: async (args: { where?: Record<string, unknown> }) => {
        calls.push(args);
        const scope = args.where?.companyId;
        return ROWS.filter((row) => (scope === undefined ? true : row.companyId === scope));
      },
    },
  },
}));

describe("loadLinkableInvitations stays inside the company", () => {
  it("sends this company's id to the database", async () => {
    const { loadLinkableInvitations } = await import("./bid-pursuits-query");
    calls.length = 0;
    await loadLinkableInvitations("company-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].where?.companyId).toBe("company-1");
  });

  it("never offers another company's invitation to link", async () => {
    const { loadLinkableInvitations } = await import("./bid-pursuits-query");
    const offered = await loadLinkableInvitations("company-1");
    const ids = JSON.stringify(offered);
    expect(ids).toContain("inv-mine");
    expect(ids).not.toContain("inv-theirs");
    expect(ids).not.toContain("SOMEONE ELSE'S BID");
  });
});
