import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  bidInvitation: { findFirst: vi.fn() },
  bidAddendum: { findMany: vi.fn() },
  agentFinding: { findMany: vi.fn() },
  aiRecommendation: { findFirst: vi.fn(), findMany: vi.fn() },
  agentRun: { findMany: vi.fn() },
  bidOutcome: { findMany: vi.fn() },
}));
vi.mock("@prova/db", () => ({ prisma: db, Prisma: {} }));
vi.mock("@/lib/ai/settings", () => ({ aiGate: vi.fn() }));
vi.mock("@/lib/ask/usage", () => ({ recordAskUsage: vi.fn() }));

import { loadBidWorkspace } from "./bidWorkspace";
import { listRecommendations, recommendationActivity } from "./recommendations-query";

const at = (iso: string) => new Date(iso);

beforeEach(() => {
  vi.clearAllMocks();
  db.bidAddendum.findMany.mockResolvedValue([]);
  db.agentFinding.findMany.mockResolvedValue([]);
  db.aiRecommendation.findFirst.mockResolvedValue(null);
  db.agentRun.findMany.mockResolvedValue([]);
});

describe("loadBidWorkspace", () => {
  it("is null for a bid on another account", async () => {
    db.bidInvitation.findFirst.mockResolvedValue(null);
    expect(await loadBidWorkspace("bid1", "c1")).toBeNull();
    expect(db.bidInvitation.findFirst.mock.calls[0][0].where).toEqual({ id: "bid1", companyId: "c1" });
  });

  it("splits findings by agent, counts open addendum items, and keeps the newest run per agent", async () => {
    db.bidInvitation.findFirst.mockResolvedValue({
      id: "bid1",
      projectName: "Riverside",
      contactId: "gc1",
      dueDate: null,
      status: "INVITED",
      bidAmount: "125000.00",
      tradeScope: "EIFS",
      contact: { name: "Turner" },
      outcome: null,
      bidProjectId: "p1",
    });
    // The PROJECT's addenda, whichever GC's invitation each was filed under.
    db.bidAddendum.findMany.mockResolvedValue([
      { id: "a1", reference: "1", issuedOn: null, readings: [], decisions: [] },
      { id: "a2", reference: "2", issuedOn: null, readings: [{ items: [{ reference: "A-201" }, { reference: "A-202" }] }], decisions: [{ normalisedReference: "a201" }] },
    ]);
    const finding = (id: string, agent: string) => ({ id, agent, kind: "k", severity: "info", title: "t", body: "b", sources: [{ label: "x", recordId: "y" }], fixHref: null, bidInvitationId: "bid1", createdAt: at("2026-10-10"), dismissedAt: null, runId: "r" });
    db.agentFinding.findMany.mockResolvedValue([finding("f1", "BID_RESEARCH"), finding("f2", "ESTIMATE_CHECK")]);
    db.agentRun.findMany.mockResolvedValue([
      { agent: "BID_RESEARCH", finishedAt: at("2026-10-10T02:00:00Z"), status: "DONE" },
      { agent: "BID_RESEARCH", finishedAt: at("2026-10-09T02:00:00Z"), status: "FAILED" },
    ]);
    const ws = (await loadBidWorkspace("bid1", "c1"))!;
    expect(ws.bid).toMatchObject({ gcName: "Turner", bidAmount: 125000 });
    expect(ws.research.map((f) => f.id)).toEqual(["f1"]);
    expect(ws.estimateCheck.map((f) => f.id)).toEqual(["f2"]);
    expect(ws.research[0]!.bidProjectName).toBe("Riverside");
    expect(ws.addenda.map((a) => [a.read, a.openDecisions])).toEqual([[false, 0], [true, 1]]);
    expect(ws.lastRuns).toEqual([{ agent: "BID_RESEARCH", finishedAt: at("2026-10-10T02:00:00Z"), status: "DONE" }]);
    expect(ws.subject).toEqual({ type: "BidInvitation", id: "bid1" });
    // Asked by PROJECT, inside the company, never by the invitation alone.
    expect(db.bidAddendum.findMany.mock.calls[0][0].where).toEqual({
      companyId: "c1",
      OR: [{ bidProjectId: { in: ["p1"] } }, { bidProjectId: null, bidInvitationId: { in: ["bid1"] } }],
    });
  });
});

describe("recommendation reads", () => {
  it("lists open ones by score, and merges outcomes into the activity feed newest first", async () => {
    db.aiRecommendation.findMany.mockResolvedValue([
      { id: "r1", title: "Chase", reason: "late", status: "open", href: "/x", updatedAt: at("2026-10-09") },
    ]);
    db.bidOutcome.findMany.mockResolvedValue([
      { id: "o1", result: "LOST", reason: "PRICE", winnerName: "Acme", updatedAt: at("2026-10-10"), bidInvitationId: "bid1", bidInvitation: { projectName: "Riverside" } },
    ]);
    const feed = await recommendationActivity("c1");
    expect(feed.map((i) => i.id)).toEqual(["o1", "r1"]);
    expect(feed[0]).toMatchObject({ kind: "outcome", title: "Riverside: lost", detail: "Reason: price. Went to Acme.", href: "/ai/bids/bid1" });

    db.aiRecommendation.findMany.mockResolvedValue([]);
    await listRecommendations("c1");
    expect(db.aiRecommendation.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { companyId: "c1", status: "open" } }));
  });
});
