import { describe, expect, it, vi } from "vitest";

/**
 * Issue #103, finding 4: with no status filter and `orderBy: { dueDate:
 * "asc" }`, the old handler had nothing capping the query itself — the cap
 * lives one layer up, in `forModel`'s generic 40-row truncation — but the
 * ORDER meant that cap always dropped the newest rows first. A company
 * whose bidding history is mostly decided (WON/LOST) and has a handful of
 * still-open invitations would see those open ones sorted to the back and
 * truncated away, answering "which bids are outstanding?" with 40 decided
 * bids and nothing INVITED.
 *
 * This fixture is deliberately small (not 41 rows) because the fix does
 * not depend on the row count to prove: outstanding-first ordering and an
 * explicit `status` filter are both visible on three rows. `dueDate: asc`
 * on the raw data would put the decided 2020 bid before the still-open
 * 2026 one; the fix must put the open one first regardless.
 */

const BIDS = [
  {
    projectName: "Old Warehouse (decided)",
    status: "WON",
    dueDate: new Date("2020-01-01T00:00:00.000Z"),
    tradeScope: "FRAMING",
    notes: null,
    contact: { name: "Acme GC" },
  },
  {
    projectName: "Riverside Medical (still open)",
    status: "INVITED",
    dueDate: new Date("2026-10-01T00:00:00.000Z"),
    tradeScope: "DRYWALL",
    notes: null,
    contact: { name: "Beacon GC" },
  },
  {
    projectName: "Old Mill (decided)",
    status: "LOST",
    dueDate: new Date("2021-01-01T00:00:00.000Z"),
    tradeScope: "EIFS",
    notes: null,
    contact: { name: "Coastal GC" },
  },
];

vi.mock("@prova/db", () => ({
  prisma: {
    bidInvitation: {
      findMany: vi.fn(async ({ where }: { where: { status?: { in: string[] } } }) =>
        where?.status ? BIDS.filter((b) => where.status!.in.includes(b.status)) : BIDS,
      ),
    },
  },
}));

async function askBidStatus(status?: string) {
  const { runTool } = await import("./handlers");
  return runTool(
    { companyId: "company-1", principal: { role: "OWNER", jobFunction: null } },
    "bid_status",
    { status },
  );
}

describe("bid_status truncation and filtering", () => {
  it("sorts the outstanding bid first by default, ahead of older due dates", async () => {
    const result = await askBidStatus();
    const projects = (result.data as Array<{ project: string }>).map((row) => row.project);
    expect(projects[0]).toBe("Riverside Medical (still open)");
  });

  it("carries the true outstanding count regardless of how the list is ordered or capped", async () => {
    const result = await askBidStatus();
    expect(result.summary).toEqual({ totalBidCount: 3, outstandingBidCount: 1 });
  });

  it("answers only outstanding bids when asked for exactly that", async () => {
    const result = await askBidStatus("OUTSTANDING");
    const rows = result.data as Array<{ project: string; status: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("INVITED");
  });

  it("says none are outstanding rather than reporting an empty list ambiguously", async () => {
    vi.mocked((await import("@prova/db")).prisma.bidInvitation.findMany).mockResolvedValueOnce([]);
    const result = await askBidStatus("OUTSTANDING");
    expect(result.unavailable).toBe("No bid invitations are outstanding.");
  });
});
