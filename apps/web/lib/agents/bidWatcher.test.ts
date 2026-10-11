import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bid watcher over fixture bids, addenda and pursuits, driven through
 * the real runAgent / addFinding spine with prisma mocked. The finding store
 * is an in-memory map keyed like the real @@unique([companyId, dedupeKey]),
 * so the second-run dedupe is the real code path, not a stub saying "seen".
 */

const db = vi.hoisted(() => ({
  companyAgentSettings: { findUnique: vi.fn() },
  askUsage: { findMany: vi.fn() },
  agentRun: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  agentFinding: { create: vi.fn(), findUnique: vi.fn() },
  bidInvitation: { findMany: vi.fn() },
  bidAddendum: { findMany: vi.fn() },
  bidPursuit: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
}));
const gate = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock("@prova/db", () => ({ prisma: db, Prisma: {} }));
vi.mock("@/lib/ai/settings", () => ({ aiGate: gate }));
vi.mock("@/lib/ask/usage", () => ({ recordAskUsage: vi.fn() }));
vi.mock("@/lib/push", () => ({ pushToUser: push }));

import "./all";
import { runAgent } from "./run";
import { watcherFindings } from "./bidWatcher";

const NOW = new Date("2026-10-12T12:23:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const gc = { contactId: "gc1", contact: { name: "Northside Builders" } };

const NEW_BID = { id: "bNew", projectName: "Oak Ave", dueDate: day("2026-10-30"), status: "INVITED", ...gc };
const DUE_SOON = { id: "bSoon", projectName: "Maple School", dueDate: day("2026-10-14"), ...gc };
const PAST_DUE = { id: "bPast", projectName: "Hillcrest Clinic", dueDate: day("2026-10-09"), ...gc };
const addendum = (id: string, over: Record<string, unknown>) => ({
  id,
  reference: id.toUpperCase(),
  issuedOn: day("2026-10-08"),
  acknowledgedOn: null,
  createdAt: day("2026-10-01"),
  bidInvitation: DUE_SOON,
  _count: { readings: 0, decisions: 0 },
  ...over,
});
const ADDENDA = [
  addendum("a1", {}), // unread → flag
  addendum("a2", { createdAt: new Date("2026-10-12T09:00:00Z"), _count: { readings: 1, decisions: 0 } }), // new, read → info
  addendum("a3", { acknowledgedOn: day("2026-10-02"), createdAt: day("2026-09-20") }), // old, acknowledged → nothing
];
const PURSUIT = { id: "p1", projectName: "Riverside Library", expectedBidDate: day("2026-10-15"), expectedGcs: "Ridge Co" };

let store: Map<string, Record<string, unknown>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  store = new Map();
  gate.mockResolvedValue({ ok: true, model: "claude-opus-5" });
  db.companyAgentSettings.findUnique.mockResolvedValue(null);
  db.askUsage.findMany.mockResolvedValue([]);
  db.agentRun.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "run1", ...data }));
  db.agentRun.update.mockResolvedValue({});
  db.agentRun.findFirst.mockResolvedValue(null);
  db.agentFinding.findUnique.mockImplementation(
    async ({ where }: { where: { companyId_dedupeKey: { companyId: string; dedupeKey: string } } }) => {
      const k = where.companyId_dedupeKey;
      return store.has(`${k.companyId}|${k.dedupeKey}`) ? { id: "x" } : null;
    },
  );
  db.agentFinding.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    store.set(`${data.companyId}|${data.dedupeKey}`, data);
    return { id: `f${store.size}` };
  });
  db.bidInvitation.findMany.mockImplementation(async ({ where }: { where: { createdAt?: unknown } }) =>
    where.createdAt ? [NEW_BID] : [PAST_DUE, DUE_SOON],
  );
  db.bidAddendum.findMany.mockResolvedValue(ADDENDA);
  db.bidPursuit.findMany.mockResolvedValue([PURSUIT]);
  db.user.findMany.mockResolvedValue([{ id: "owner1" }]);
  push.mockResolvedValue("sent");
});

afterEach(() => vi.useRealTimers());

const written = () => [...store.values()];
const byKind = (kind: string) => written().filter((f) => f.kind === kind);

describe("the bid watcher", () => {
  it("makes one finding of each kind, with the right severity, sources and dedupe key", async () => {
    const out = await runAgent({ companyId: "c1", agent: "BID_WATCHER", trigger: "cron" });
    expect(out).toMatchObject({ ran: true });

    expect(byKind("new_invitation")).toEqual([
      expect.objectContaining({ severity: "info", bidInvitationId: "bNew", dedupeKey: "new_invitation:bNew", fixHref: "/bids#bNew" }),
    ]);
    expect(byKind("due_soon")).toEqual([
      expect.objectContaining({ severity: "warn", dedupeKey: "due_soon:bSoon:2026-10-14", title: "Due in 2 days: Maple School" }),
    ]);
    expect(byKind("past_due")).toEqual([
      expect.objectContaining({ severity: "flag", dedupeKey: "past_due:bPast:2026-10-09" }),
    ]);
    expect(byKind("unread_addendum")).toEqual([
      expect.objectContaining({ severity: "flag", dedupeKey: "unread_addendum:a1" }),
    ]);
    expect(byKind("new_addendum")).toEqual([expect.objectContaining({ severity: "info", dedupeKey: "new_addendum:a2" })]);
    expect(byKind("pursuit_due_soon")).toEqual([
      expect.objectContaining({ severity: "warn", dedupeKey: "pursuit_due_soon:p1:2026-10-15", fixHref: "/pipeline" }),
    ]);
    // a3 is old and acknowledged: nothing to say.
    expect(written().some((f) => String(f.dedupeKey).includes("a3"))).toBe(false);
    expect(written()).toHaveLength(6);

    // Every finding cites a record a person can open.
    for (const f of written()) {
      const sources = f.sources as { recordId?: string; href?: string }[];
      expect(sources.length).toBeGreaterThan(0);
      expect(sources.every((s) => s.recordId && s.href)).toBe(true);
    }
    expect((byKind("unread_addendum")[0].sources as { recordType: string }[])[0].recordType).toBe("BidAddendum");

    // The run row says what it saw.
    expect(db.agentRun.update.mock.calls[0]![0].data).toMatchObject({
      status: "DONE",
      summary:
        "1 bid due in the next 5 days, 1 past due, 1 unread addendum, 1 new addendum, 1 new invitation, 1 pursuit expected to bid soon.",
    });
  });

  it("asks for due dates only up to today + dueSoonDays, and for new rows only since the last run", async () => {
    db.agentRun.findFirst.mockResolvedValue({ startedAt: new Date("2026-10-11T12:23:00Z") });
    await watcherFindings("c1", 3, new Date("2026-10-11T12:23:00Z"), NOW);
    const calls = db.bidInvitation.findMany.mock.calls.map((c) => c[0].where);
    expect(calls).toContainEqual(
      expect.objectContaining({ status: "INVITED", dueDate: { not: null, lte: day("2026-10-15") } }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        createdAt: { gte: new Date("2026-10-11T12:23:00Z") },
        // Decided or past-due bids are never "new invitations".
        status: "INVITED",
        OR: [{ dueDate: null }, { dueDate: { gte: day("2026-10-12") } }],
      }),
    );
  });

  it("says nothing new on a second run over the same data, and pushes nobody twice", async () => {
    await runAgent({ companyId: "c1", agent: "BID_WATCHER", trigger: "cron" });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]![1]).toBe("4 things on your bids need a look");
    const creates = db.agentFinding.create.mock.calls.length;

    db.agentRun.findFirst.mockResolvedValue({ startedAt: NOW });
    const second = await runAgent({ companyId: "c1", agent: "BID_WATCHER", trigger: "cron" });
    expect(second).toMatchObject({ ran: true });
    expect(db.agentFinding.create.mock.calls.length).toBe(creates);
    expect(push).toHaveBeenCalledTimes(1);
    expect(db.agentRun.update.mock.calls[1]![0].data.summary).toMatch(/\(0 new findings\)\.$/);
  });

  it("a moved due date is a new finding", async () => {
    await runAgent({ companyId: "c1", agent: "BID_WATCHER", trigger: "cron" });
    db.bidInvitation.findMany.mockImplementation(async ({ where }: { where: { createdAt?: unknown } }) =>
      where.createdAt ? [] : [{ ...DUE_SOON, dueDate: day("2026-10-16") }],
    );
    await runAgent({ companyId: "c1", agent: "BID_WATCHER", trigger: "cron" });
    expect(byKind("due_soon").map((f) => f.dedupeKey)).toEqual([
      "due_soon:bSoon:2026-10-14",
      "due_soon:bSoon:2026-10-16",
    ]);
  });

  it("a company over its spend cap gets a PAUSED_CAP run row and no findings", async () => {
    db.companyAgentSettings.findUnique.mockResolvedValue({
      watcherEnabled: true,
      researchOnNewBid: true,
      checkerBeforeSend: true,
      recommendationsEnabled: true,
      dueSoonDays: 5,
      monthlySpendCapUsd: "1.00",
      notifyUserIds: [],
    });
    db.askUsage.findMany.mockResolvedValue([
      {
        model: "claude-opus-5",
        createdAt: new Date("2026-10-05T00:00:00Z"),
        inputTokens: 0,
        outputTokens: 100_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        webSearches: 0,
      },
    ]);
    const out = await runAgent({ companyId: "c1", agent: "BID_WATCHER", trigger: "cron" });
    expect(out).toMatchObject({ ran: false, status: "PAUSED_CAP" });
    expect(db.agentRun.create.mock.calls[0]![0].data).toMatchObject({ status: "PAUSED_CAP", agent: "BID_WATCHER" });
    expect(db.agentRun.create.mock.calls[0]![0].data.note).toMatch(/^Paused: .*cap/);
    expect(db.agentFinding.create).not.toHaveBeenCalled();
    expect(db.bidInvitation.findMany).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("pushes owners by default, and never for info-only findings", async () => {
    await runAgent({ companyId: "c1", agent: "BID_WATCHER", trigger: "cron" });
    expect(db.user.findMany.mock.calls[0]![0].where).toEqual({ companyId: "c1", role: "OWNER" });
    store.clear();
    push.mockClear();
    db.bidInvitation.findMany.mockImplementation(async ({ where }: { where: { createdAt?: unknown } }) =>
      where.createdAt ? [NEW_BID] : [],
    );
    db.bidAddendum.findMany.mockResolvedValue([]);
    db.bidPursuit.findMany.mockResolvedValue([]);
    await runAgent({ companyId: "c1", agent: "BID_WATCHER", trigger: "cron" });
    expect(written()).toHaveLength(1);
    expect(push).not.toHaveBeenCalled(); // a new invitation is info only
  });

  it("pushes the chosen people, filtered to this company", async () => {
    db.companyAgentSettings.findUnique.mockResolvedValue({
      watcherEnabled: true,
      researchOnNewBid: true,
      checkerBeforeSend: true,
      recommendationsEnabled: true,
      dueSoonDays: 5,
      monthlySpendCapUsd: null,
      notifyUserIds: ["u2"],
    });
    db.bidInvitation.findMany.mockImplementation(async ({ where }: { where: { createdAt?: unknown } }) =>
      where.createdAt ? [] : [DUE_SOON],
    );
    db.bidAddendum.findMany.mockResolvedValue([]);
    db.bidPursuit.findMany.mockResolvedValue([]);
    db.user.findMany.mockResolvedValue([{ id: "u2" }]);
    await runAgent({ companyId: "c1", agent: "BID_WATCHER", trigger: "cron" });
    expect(db.user.findMany.mock.calls[0]![0].where).toEqual({ companyId: "c1", id: { in: ["u2"] } });
    expect(push).toHaveBeenCalledWith("u2", "Due in 2 days: Maple School", expect.stringContaining("Maple School"));
  });

  it("a push failure does not fail the run", async () => {
    push.mockRejectedValue(new Error("expo down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runAgent({ companyId: "c1", agent: "BID_WATCHER", trigger: "cron" })).toMatchObject({ ran: true });
    spy.mockRestore();
  });
});
