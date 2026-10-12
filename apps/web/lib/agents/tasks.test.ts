import { describe, expect, it, vi } from "vitest";

vi.mock("@prova/db", () => ({ prisma: {} }));

const { toTaskList, STALLED_AFTER_MS, RECENT_TASKS } = await import("./tasks");
type Run = Parameters<typeof toTaskList>[0][number];

const NOW = new Date("2026-10-11T15:00:00.000Z");
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function run(id: string, over: Partial<Run> = {}): Run {
  return {
    id,
    agent: "BID_WATCHER",
    status: "DONE",
    trigger: "cron",
    startedAt: minAgo(10),
    finishedAt: minAgo(9),
    summary: null,
    note: null,
    bidInvitationId: null,
    bidProjectName: null,
    requestedByName: null,
    findingCount: 0,
    ...over,
  };
}

describe("toTaskList", () => {
  it("lists running runs as running, labelled, linked to the bid's workspace", () => {
    const live = run("r1", { status: "RUNNING", agent: "BID_RESEARCH", startedAt: minAgo(2), finishedAt: null, bidInvitationId: "bid-9", bidProjectName: "Northgate", summary: "Reading" });
    const list = toTaskList([live], [live], NOW);
    expect(list.running).toEqual([
      {
        id: "r1",
        agent: "Bid research",
        subject: "Northgate",
        detail: "Reading",
        status: "RUNNING",
        startedAt: minAgo(2).toISOString(),
        finishedAt: null,
        href: "/ai/bids/bid-9",
        kind: "BID_RESEARCH",
        bidInvitationId: "bid-9",
      },
    ]);
    // Running is shown once, not again under Finished.
    expect(list.recent).toEqual([]);
  });

  it("says why a run ended: the note stands in for a missing summary, and a run with no bid links to the timeline", () => {
    const failed = run("f1", { status: "FAILED", note: "Model call timed out" });
    const [row] = toTaskList([], [failed], NOW).recent;
    expect(row).toMatchObject({ status: "FAILED", detail: "Model call timed out", href: "/ai/activity" });
  });

  it("does not spin forever on a run whose process died: past the limit it is STALLED, under Finished", () => {
    const justInside = run("ok", { status: "RUNNING", finishedAt: null, startedAt: new Date(NOW.getTime() - STALLED_AFTER_MS + 1000) });
    const dead = run("dead", { status: "RUNNING", finishedAt: null, startedAt: new Date(NOW.getTime() - STALLED_AFTER_MS - 1000) });
    const list = toTaskList([justInside, dead], [justInside, dead], NOW);
    expect(list.running.map((r) => r.id)).toEqual(["ok"]);
    expect(list.recent.map((r) => [r.id, r.status])).toEqual([["dead", "STALLED"]]);
  });

  it(`keeps the newest ${RECENT_TASKS} finished, newest first`, () => {
    const finished = Array.from({ length: RECENT_TASKS + 3 }, (_, i) => run(`d${i}`, { startedAt: minAgo(100 - i) }));
    const list = toTaskList([], finished, NOW);
    expect(list.recent).toHaveLength(RECENT_TASKS);
    expect(list.recent[0]!.id).toBe(`d${RECENT_TASKS + 2}`);
  });
});
