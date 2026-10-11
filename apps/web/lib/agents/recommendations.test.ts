import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  bidInvitation: { findMany: vi.fn() },
  contact: { findFirst: vi.fn() },
  job: { findMany: vi.fn() },
  jobLineItem: { findMany: vi.fn() },
  aiRecommendation: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@prova/db", () => ({ prisma: db, Prisma: {} }));
vi.mock("@/lib/ai/settings", () => ({ aiGate: vi.fn() }));
vi.mock("@/lib/ask/usage", () => ({ recordAskUsage: vi.fn() }));
vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-10-11" }));

import { bidOrPass, runRecommendations, saveRecommendations, type DraftRecommendation } from "./recommendations";
import type { GcHistory } from "./bidHistory";
import type { AgentContext } from "./run";

const history = (over: Partial<{ won: number; lost: number; days: number | null; settled: number; bc: number; open: number }> = {}): GcHistory => {
  const o = { won: 0, lost: 0, days: null, settled: 0, bc: 0, open: 0, ...over };
  const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`);
  return {
    contact: { id: "gc1", name: "Turner" },
    bids: {
      invited: [],
      submitted: [],
      won: ids(o.won, "w"),
      lost: ids(o.lost, "l"),
      declined: [],
      winRate: o.won + o.lost === 0 ? null : o.won / (o.won + o.lost),
    },
    paySpeed: { averageDaysToPay: o.days, settledCount: o.settled, reason: null, invoiceIds: [], jobIds: [] },
    backcharges: { count: o.bc, claimedTotal: o.bc * 1000, openCount: o.open, openClaimed: o.open * 1000, ids: [], jobIds: [] },
    lostReasons: [],
  };
};

describe("bidOrPass", () => {
  it("names every factor with its number", () => {
    const r = bidOrPass(history({ won: 2, lost: 2, days: 40, settled: 4, bc: 1 }), 1);
    expect(r.reason).toBe("Win rate 50% (2 of 4), pays in about 40 days, 1 backcharge ($1,000 claimed), 1 other invited bid due within a week of it.");
    // 50 + (0.5 - 0.3) * 100 + 10 = 80
    expect(r.score).toBe(80);
    expect(r.confidence).toBe("high");
  });

  it("says there is no history rather than scoring a made-up one", () => {
    const r = bidOrPass(history(), null);
    expect(r.reason).toBe("No decided bids with this GC yet, no pay history, no backcharges, no due date to weigh workload against.");
    expect(r.score).toBe(50);
    expect(r.confidence).toBe("low");
  });

  it("pushes down for a slow payer, open backcharges and a crowded fortnight", () => {
    const r = bidOrPass(history({ won: 0, lost: 4, days: 95, settled: 3, bc: 3, open: 1 }), 6);
    // 50 - 30 - 25 - 20 - 20 = -45 -> clamped 0
    expect(r.score).toBe(0);
  });
});

describe("saveRecommendations", () => {
  const draft = (subjectId: string): DraftRecommendation => ({
    kind: "overdue_chase",
    subjectType: "Invoice",
    subjectId,
    title: "t",
    reason: "r",
    confidence: "high",
    score: 50,
    href: "/x",
    sources: [{ label: "Invoice", recordId: subjectId }],
  });

  beforeEach(() => vi.clearAllMocks());

  it("creates new, reopens an engine-closed row, leaves a person's dismissal alone, and closes what no longer qualifies", async () => {
    db.aiRecommendation.findMany.mockResolvedValue([
      { id: "r-engine", kind: "overdue_chase", subjectType: "Invoice", subjectId: "i2", status: "done", resolvedByUserId: null },
      { id: "r-person", kind: "overdue_chase", subjectType: "Invoice", subjectId: "i3", status: "dismissed", resolvedByUserId: "u1" },
      { id: "r-stale", kind: "overdue_chase", subjectType: "Invoice", subjectId: "i9", status: "open", resolvedByUserId: null },
    ]);
    const out = await saveRecommendations("c1", [draft("i1"), draft("i2"), draft("i3")]);
    expect(db.aiRecommendation.create).toHaveBeenCalledTimes(1);
    expect(db.aiRecommendation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r-engine" }, data: expect.objectContaining({ status: "open" }) }));
    const personUpdate = db.aiRecommendation.update.mock.calls.find((c) => c[0].where.id === "r-person")![0];
    expect(personUpdate.data.status).toBeUndefined();
    expect(db.aiRecommendation.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["r-stale"] } }, data: expect.objectContaining({ status: "done" }) });
    expect(out).toEqual({ opened: 2, closed: 1, total: 3 });
  });
});

describe("the RECOMMENDATIONS runner", () => {
  const ctx = { companyId: "c1", run: { id: "run1", companyId: "c1", agent: "RECOMMENDATIONS" } } as AgentContext;
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  beforeEach(() => {
    vi.clearAllMocks();
    db.aiRecommendation.findMany.mockResolvedValue([]);
    db.contact.findFirst.mockResolvedValue({ id: "gc1", name: "Turner" });
  });

  it("raises bid_or_pass, overdue_chase and releasable_retainage from fixtures, each with sources", async () => {
    db.bidInvitation.findMany
      // INVITED bids
      .mockResolvedValueOnce([{ id: "bid1", projectName: "Riverside", contactId: "gc1", dueDate: day("2026-10-20"), wonJobId: null, contact: { name: "Turner" } }])
      // gcHistory's bids for Turner
      .mockResolvedValueOnce([{ id: "bid1", projectName: "Riverside", status: "INVITED", outcome: null }]);
    db.job.findMany
      // gcHistory's jobs for Turner
      .mockResolvedValueOnce([])
      // money jobs
      .mockResolvedValueOnce([
        {
          id: "job1",
          name: "Cedar Park",
          substantialCompletionDate: day("2026-06-30"),
          contact: { name: "Halvorsen", paymentTermsDays: 30 },
          invoices: [
            // Due 2026-09-10, unpaid -> 31 days past due.
            { id: "inv1", number: 4, amount: 10000, issuedAt: day("2026-08-11"), dueAt: day("2026-09-10"), retainageWithheld: 1000, payments: [] },
          ],
          retainageReleases: [],
          closeoutSubmissions: [],
        },
      ]);
    const out = await runRecommendations(ctx);
    const created = db.aiRecommendation.create.mock.calls.map((c) => c[0].data);
    expect(created.map((r) => r.kind).sort()).toEqual(["bid_or_pass", "overdue_chase", "releasable_retainage"]);
    for (const r of created) expect((r.sources as unknown[]).length).toBeGreaterThan(0);
    const chase = created.find((r) => r.kind === "overdue_chase")!;
    expect(chase.reason).toBe("$9,000 is 31 days past due (retainage not counted).");
    expect(chase.subjectId).toBe("inv1");
    const retainage = created.find((r) => r.kind === "releasable_retainage")!;
    expect(retainage.confidence).toBe("medium");
    expect(out.summary).toBe("3 recommendations current, 3 new, 0 no longer apply.");
  });
});
