import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  companyAgentSettings: { findUnique: vi.fn() },
  askUsage: { findMany: vi.fn() },
  agentRun: { create: vi.fn(), update: vi.fn() },
  agentFinding: { create: vi.fn(), findUnique: vi.fn() },
}));
const gate = vi.hoisted(() => vi.fn());

vi.mock("@prova/db", () => ({ prisma: db, Prisma: {} }));
vi.mock("@/lib/ai/settings", () => ({ aiGate: gate }));
vi.mock("@/lib/ask/usage", () => ({ recordAskUsage: vi.fn() }));

import { addFinding, agentAllowed, sourcesAreCited } from "./core";
import { AGENT_RUNNERS, runAgent } from "./run";

const usageRow = (outputTokens: number) => ({
  model: "claude-opus-5",
  createdAt: new Date("2026-10-05T00:00:00Z"),
  inputTokens: 0,
  outputTokens,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  webSearches: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  gate.mockResolvedValue({ ok: true, model: "claude-opus-5" });
  db.companyAgentSettings.findUnique.mockResolvedValue(null);
  db.askUsage.findMany.mockResolvedValue([]);
  db.agentRun.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "run1", ...data }));
  db.agentRun.update.mockResolvedValue({});
  db.agentFinding.create.mockResolvedValue({ id: "f1" });
  db.agentFinding.findUnique.mockResolvedValue(null);
});

describe("agentAllowed", () => {
  it("passes with defaults and no cap", async () => {
    expect(await agentAllowed("c1", "BID_WATCHER")).toMatchObject({ ok: true, model: "claude-opus-5" });
  });

  it("is SKIPPED when the company AI switch refuses", async () => {
    gate.mockResolvedValue({ ok: false, error: "AI is off for this company." });
    expect(await agentAllowed("c1", "BID_WATCHER")).toEqual({ ok: false, status: "SKIPPED", note: "AI is off for this company." });
  });

  it("is SKIPPED when the per-agent switch is off", async () => {
    db.companyAgentSettings.findUnique.mockResolvedValue({
      watcherEnabled: false,
      researchOnNewBid: true,
      checkerBeforeSend: true,
      recommendationsEnabled: true,
      dueSoonDays: 5,
      monthlySpendCapUsd: null,
      notifyUserIds: [],
    });
    expect(await agentAllowed("c1", "BID_WATCHER")).toMatchObject({ ok: false, status: "SKIPPED" });
    expect(await agentAllowed("c1", "BID_RESEARCH")).toMatchObject({ ok: true });
  });

  it("is PAUSED_CAP once this month's agent spend reaches the cap, and the note carries both figures", async () => {
    db.companyAgentSettings.findUnique.mockResolvedValue({
      watcherEnabled: true,
      researchOnNewBid: true,
      checkerBeforeSend: true,
      recommendationsEnabled: true,
      dueSoonDays: 5,
      monthlySpendCapUsd: "1.00",
      notifyUserIds: [],
    });
    // 100k output tokens on Opus is well over a dollar at any published rate.
    db.askUsage.findMany.mockResolvedValue([usageRow(100_000)]);
    const result = await agentAllowed("c1", "RECOMMENDATIONS");
    expect(result).toMatchObject({ ok: false, status: "PAUSED_CAP" });
    if (result.ok) throw new Error("unreachable");
    expect(result.note).toMatch(/cap of \$1\.00/);
    // It asked the ledger for THIS feature only — Ask questions are not agent spend.
    expect(db.askUsage.findMany.mock.calls[0]![0].where.feature).toBe("ai-agents");
  });
});

describe("findings", () => {
  it("refuses an uncited finding", () => {
    expect(sourcesAreCited([])).toBe(false);
    expect(sourcesAreCited([{ label: "GC history" }])).toBe(false);
    expect(sourcesAreCited([{ label: "Bid #12", href: "/bids#12" }])).toBe(true);
  });

  it("throws rather than writing a finding with no source", async () => {
    await expect(
      addFinding({ id: "run1", companyId: "c1", agent: "BID_WATCHER" }, {
        kind: "due_soon",
        severity: "warn",
        title: "t",
        body: "b",
        sources: [],
      }),
    ).rejects.toThrow(/no usable source/);
    expect(db.agentFinding.create).not.toHaveBeenCalled();
  });

  it("skips a finding whose dedupeKey was already written", async () => {
    db.agentFinding.findUnique.mockResolvedValue({ id: "old" });
    const result = await addFinding({ id: "run1", companyId: "c1", agent: "BID_WATCHER" }, {
      kind: "due_soon",
      severity: "warn",
      title: "t",
      body: "b",
      sources: [{ label: "Bid", recordType: "BidInvitation", recordId: "b1" }],
      dedupeKey: "due_soon:b1:2026-10-17",
    });
    expect(result).toBeNull();
    expect(db.agentFinding.create).not.toHaveBeenCalled();
  });
});

describe("runAgent", () => {
  it("records a skipped run with the reason instead of running", async () => {
    gate.mockResolvedValue({ ok: false, error: "AI is off." });
    const out = await runAgent({ companyId: "c1", agent: "BID_WATCHER", trigger: "cron" });
    expect(out).toMatchObject({ ran: false, status: "SKIPPED", note: "AI is off." });
    expect(db.agentRun.create.mock.calls[0]![0].data).toMatchObject({ status: "SKIPPED", note: "AI is off." });
  });

  it("fails loudly on a kind with no runner", async () => {
    const out = await runAgent({ companyId: "c1", agent: "ESTIMATE_CHECK", trigger: "manual" });
    expect(out).toMatchObject({ ran: false, status: "FAILED" });
    expect(db.agentRun.update.mock.calls[0]![0].data).toMatchObject({ status: "FAILED" });
  });

  it("stamps DONE with the runner's summary, and FAILED with a thrown message", async () => {
    AGENT_RUNNERS.BID_WATCHER = async () => ({ summary: "2 bids due this week" });
    expect(await runAgent({ companyId: "c1", agent: "BID_WATCHER", trigger: "cron" })).toMatchObject({
      ran: true,
      summary: "2 bids due this week",
    });
    expect(db.agentRun.update.mock.calls[0]![0].data).toMatchObject({ status: "DONE", summary: "2 bids due this week" });

    AGENT_RUNNERS.BID_WATCHER = async () => {
      throw new Error("boom");
    };
    expect(await runAgent({ companyId: "c1", agent: "BID_WATCHER", trigger: "cron" })).toMatchObject({
      ran: false,
      status: "FAILED",
      note: "boom",
    });
    delete AGENT_RUNNERS.BID_WATCHER;
  });
});
