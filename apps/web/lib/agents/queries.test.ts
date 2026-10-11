import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  agentRun: { findMany: vi.fn(), findFirst: vi.fn() },
  agentFinding: { findMany: vi.fn(), count: vi.fn() },
  bidInvitation: { count: vi.fn(), findMany: vi.fn() },
  bidAddendum: { count: vi.fn() },
}));
vi.mock("@prova/db", () => ({ prisma: db }));
vi.mock("@/lib/ai/settings", () => ({ aiGate: vi.fn() }));
vi.mock("@/lib/ask/usage", () => ({ recordAskUsage: vi.fn() }));

import {
  WATCHER_CRON_PATH,
  WATCHER_CRON_SCHEDULE,
  WATCHER_SCHEDULE_LABEL,
  agentActivity,
  listFindings,
  scheduleLabel,
  watchingSummary,
} from "./queries";

const run = (id: string, at: string, over: Record<string, unknown> = {}) => ({
  id,
  agent: "BID_WATCHER",
  status: "DONE",
  trigger: "cron",
  startedAt: new Date(at),
  finishedAt: new Date(at),
  summary: "1 past due.",
  note: null,
  bidInvitationId: null,
  bidInvitation: null,
  requestedByUser: null,
  _count: { findings: 1 },
  ...over,
});
const finding = (id: string, at: string, over: Record<string, unknown> = {}) => ({
  id,
  companyId: "c1",
  runId: "r1",
  agent: "BID_WATCHER",
  bidInvitationId: "b1",
  bidInvitation: { projectName: "Maple School" },
  kind: "due_soon",
  severity: "warn",
  title: "Due tomorrow: Maple School",
  body: "b",
  sources: [{ label: "Maple School", href: "/bids#b1", recordId: "b1" }],
  fixHref: "/bids#b1",
  dedupeKey: "k",
  dismissedAt: null,
  createdAt: new Date(at),
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("the schedule", () => {
  it("is the one vercel.json actually runs", () => {
    const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    expect(vercel.crons).toContainEqual({ path: WATCHER_CRON_PATH, schedule: WATCHER_CRON_SCHEDULE });
  });

  it("reads as words", () => {
    expect(scheduleLabel(WATCHER_CRON_SCHEDULE)).toBe("Daily at 12:23 UTC");
    expect(WATCHER_SCHEDULE_LABEL).toBe("Daily at 12:23 UTC");
    expect(scheduleLabel("5 4 * * 1")).toBe("On schedule 5 4 * * 1 (UTC)");
  });
});

describe("listFindings", () => {
  it("hides dismissed by default, parses sources, and never trusts an unknown severity", async () => {
    db.agentFinding.findMany.mockResolvedValue([
      finding("f1", "2026-10-12T12:00:00Z", { severity: "weird", sources: [{ label: "ok", recordId: "x" }, 7, null] }),
    ]);
    const [row] = await listFindings("c1");
    expect(db.agentFinding.findMany.mock.calls[0]![0].where).toMatchObject({ companyId: "c1", dismissedAt: null });
    expect(row).toMatchObject({ severity: "info", bidProjectName: "Maple School", sources: [{ label: "ok", recordId: "x" }] });
  });
});

describe("watchingSummary", () => {
  it("counts this company's open bids, the week ahead, unread addenda and the last run", async () => {
    db.bidInvitation.count.mockResolvedValue(7);
    db.bidInvitation.findMany.mockResolvedValue([
      { id: "b1", projectName: "Maple School", dueDate: new Date("2026-10-14T00:00:00Z"), contact: { name: "Northside" } },
    ]);
    db.bidAddendum.count.mockResolvedValue(2);
    db.agentRun.findFirst.mockResolvedValue({ startedAt: new Date("2026-10-12T12:23:00Z"), finishedAt: new Date("2026-10-12T12:23:04Z") });
    const s = await watchingSummary("c1", new Date("2026-10-12T15:00:00Z"));
    expect(s).toEqual({
      openBids: 7,
      dueThisWeek: [{ id: "b1", projectName: "Maple School", dueDate: new Date("2026-10-14T00:00:00Z"), gcName: "Northside" }],
      unreadAddenda: 2,
      lastRunAt: new Date("2026-10-12T12:23:04Z"),
      nextRunLabel: "Daily at 12:23 UTC",
    });
    expect(db.bidInvitation.findMany.mock.calls[0]![0].where.dueDate).toEqual({
      gte: new Date("2026-10-12T00:00:00Z"),
      lte: new Date("2026-10-18T00:00:00Z"),
    });
    expect(db.bidAddendum.count.mock.calls[0]![0].where).toMatchObject({ companyId: "c1", acknowledgedOn: null });
  });
});

describe("agentActivity", () => {
  it("merges runs and findings newest first, capped at the limit", async () => {
    db.agentRun.findMany.mockResolvedValue([
      run("r2", "2026-10-12T12:23:00Z"),
      run("r1", "2026-10-11T12:23:00Z", { status: "PAUSED_CAP", summary: null, note: "Paused: cap" }),
    ]);
    db.agentFinding.findMany.mockResolvedValue([finding("f1", "2026-10-12T12:23:01Z")]);
    const items = await agentActivity("c1", { limit: 2 });
    expect(items.map((i) => [i.kind, i.id])).toEqual([
      ["finding", "f1"],
      ["run", "r2"],
    ]);
    expect(items[1]).toMatchObject({ title: "The bid watcher ran", detail: "1 past due." });
    const all = await agentActivity("c1");
    expect(all[2]).toMatchObject({ title: "The bid watcher was paused", detail: "Paused: cap" });
  });
});
