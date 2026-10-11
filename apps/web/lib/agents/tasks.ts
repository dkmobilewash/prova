import type { AgentRunStatus } from "@prova/db";
import { agentLabel } from "./core";
import { listRunningNow, listRuns, type AgentRunRow } from "./queries";

/**
 * "What is running" — the agent runs behind the top bar's Tasks item and the
 * home page's Running now card. Built from the same two loaders /ai reads
 * (listRunningNow, listRuns), turned into plain, JSON-safe rows so the same
 * shape serves the layout's props and GET /api/agents/tasks.
 *
 * A run older than STALLED_AFTER_MS that still says RUNNING is not running:
 * the process that wrote the row died (a timeout or a deploy) before
 * finishing it. Derived on read, never stored — the row stays as it is, and
 * the list says "Stopped responding" instead of spinning on every page
 * forever. Every agent route caps itself well under this (/api/agents/run's
 * maxDuration is 60s; a Server Action is capped by the platform at minutes).
 */
export const STALLED_AFTER_MS = 15 * 60_000;

/** How many finished runs the list shows under the running ones. */
export const RECENT_TASKS = 5;

export type TaskStatus = AgentRunStatus | "STALLED";

export type TaskRow = {
  id: string;
  /** "Bid research", "The bid watcher"… (agentLabel). */
  agent: string;
  /** The bid it is about, when it is about one. */
  subject: string | null;
  /** What it did or is doing — the run's summary, else its note (the
   * failure reason, or why it was paused or skipped). */
  detail: string | null;
  status: TaskStatus;
  /** ISO strings, so the row is the same in props and in JSON. */
  startedAt: string;
  finishedAt: string | null;
  /** The bid's AI workspace when the run is about a bid, else the timeline. */
  href: string;
};

export type TaskList = { running: TaskRow[]; recent: TaskRow[] };

export const EMPTY_TASKS: TaskList = { running: [], recent: [] };

function toRow(run: AgentRunRow, status: TaskStatus): TaskRow {
  return {
    id: run.id,
    agent: agentLabel(run.agent),
    subject: run.bidProjectName,
    detail: run.summary ?? run.note,
    status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    href: run.bidInvitationId ? `/ai/bids/${run.bidInvitationId}` : "/ai/activity",
  };
}

/** Pure: the two loaders' rows → running (newest first) and the latest
 * finished ones, a stalled run counted with the finished. */
export function toTaskList(running: AgentRunRow[], recent: AgentRunRow[], now: Date): TaskList {
  const live = running.filter((r) => now.getTime() - r.startedAt.getTime() < STALLED_AFTER_MS);
  const liveIds = new Set(live.map((r) => r.id));
  const ended = [...running, ...recent]
    .filter((r, i, all) => !liveIds.has(r.id) && all.findIndex((x) => x.id === r.id) === i)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, RECENT_TASKS)
    .map((r) => toRow(r, r.status === "RUNNING" ? "STALLED" : r.status));
  return { running: live.map((r) => toRow(r, "RUNNING")), recent: ended };
}

export async function loadTaskList(companyId: string, now: Date = new Date()): Promise<TaskList> {
  const [running, recent] = await Promise.all([
    listRunningNow(companyId),
    // listRuns returns running rows too; a few extra so they do not crowd
    // the finished ones out.
    listRuns(companyId, { limit: RECENT_TASKS * 2 }),
  ]);
  return toTaskList(running, recent, now);
}
