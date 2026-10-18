import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  contact: { findFirst: vi.fn() },
  bidInvitation: { findMany: vi.fn() },
  job: { findMany: vi.fn() },
}));
vi.mock("@prova/db", () => ({ prisma: db }));

import { gcHistory, similarJobs, withinBand } from "./bidHistory";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

beforeEach(() => {
  vi.clearAllMocks();
  db.contact.findFirst.mockResolvedValue({ id: "gc1", name: "Turner" });
  db.bidInvitation.findMany.mockResolvedValue([]);
  db.job.findMany.mockResolvedValue([]);
});

describe("gcHistory", () => {
  it("counts bids by status and computes win rate over decided bids only, with the ids it counted", async () => {
    db.bidInvitation.findMany.mockResolvedValue([
      { id: "b1", projectName: "A", status: "WON", outcome: { result: "WON", reason: "RELATIONSHIP", note: null, winnerName: null } },
      { id: "b2", projectName: "B", status: "LOST", outcome: { result: "LOST", reason: "PRICE", note: "high", winnerName: "Acme" } },
      { id: "b3", projectName: "C", status: "LOST", outcome: null },
      { id: "b4", projectName: "D", status: "SUBMITTED", outcome: null },
      { id: "b5", projectName: "E", status: "DECLINED", outcome: null },
      { id: "b6", projectName: "F", status: "INVITED", outcome: null },
    ]);
    const h = await gcHistory("c1", "gc1");
    expect(h.bids.won).toEqual(["b1"]);
    expect(h.bids.lost).toEqual(["b2", "b3"]);
    expect(h.bids.submitted).toEqual(["b1", "b2", "b3", "b4"]);
    expect(h.bids.declined).toEqual(["b5"]);
    expect(h.bids.invited).toHaveLength(6);
    // 1 won of 3 decided. Submitted, declined and invited are NOT in the denominator.
    expect(h.bids.winRate).toBeCloseTo(1 / 3);
    expect(h.lostReasons).toEqual([{ bidInvitationId: "b2", projectName: "B", reason: "PRICE", note: "high", winnerName: "Acme" }]);
  });

  it("gives no win rate, no pay figure and a reason when the GC has no history", async () => {
    const h = await gcHistory("c1", "gc1");
    expect(h.bids.winRate).toBeNull();
    expect(h.paySpeed.averageDaysToPay).toBeNull();
    expect(h.paySpeed.reason).toMatch(/No invoices/);
    expect(h.backcharges.count).toBe(0);
  });

  it("measures pay speed with gc-reliability's rules and cites the jobs and invoices", async () => {
    db.job.findMany.mockResolvedValue([
      {
        id: "j1",
        invoices: [
          // Paid in full 30 days after issue, retainage held back — still settled.
          { id: "i1", amount: 1000, retainageWithheld: 100, issuedAt: day("2026-01-01"), dueAt: null, payments: [{ amount: 900, feeAmount: null, receivedAt: day("2026-01-31") }] },
          // Unpaid: not in the timing, not cited.
          { id: "i2", amount: 500, retainageWithheld: null, issuedAt: day("2026-02-01"), dueAt: null, payments: [] },
        ],
        backcharges: [{ id: "bc1", claimedAmount: 2500, status: "RECEIVED", resolvedAmount: null }],
      },
    ]);
    const h = await gcHistory("c1", "gc1");
    expect(h.paySpeed.averageDaysToPay).toBe(30);
    expect(h.paySpeed.settledCount).toBe(1);
    expect(h.paySpeed.invoiceIds).toEqual(["i1"]);
    expect(h.paySpeed.jobIds).toEqual(["j1"]);
    expect(h.backcharges).toMatchObject({ count: 1, claimedTotal: 2500, openCount: 1, ids: ["bc1"], jobIds: ["j1"] });
  });
});

describe("similarJobs", () => {
  it("keeps the same trade within ±50% of the bid amount", async () => {
    db.bidInvitation.findMany.mockResolvedValue(
      [40, 50, 100, 150, 151, null].map((amount, i) => ({
        id: `s${i}`,
        projectName: `P${i}`,
        status: "LOST",
        bidAmount: amount,
        wonJobId: null,
        contact: { name: "GC" },
        outcome: null,
      })),
    );
    const out = await similarJobs("c1", { id: "b", tradeScope: "EIFS", bidAmount: 100 });
    expect(out.basis).toBe("trade and value");
    expect(out.rows.map((r) => r.bidAmount)).toEqual([50, 100, 150]);
  });

  it("says when there is no trade to match on", async () => {
    expect(await similarJobs("c1", { id: "b", tradeScope: null, bidAmount: 100 })).toEqual({ basis: "none", rows: [] });
    expect(db.bidInvitation.findMany).not.toHaveBeenCalled();
  });

  it("matches on trade alone when the bid has no amount", () => {
    expect(withinBand(999, null)).toBe(true);
    expect(withinBand(null, 100)).toBe(false);
  });
});
