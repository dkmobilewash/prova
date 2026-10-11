import { prisma, type AgentKind, type AgentRunStatus, type Prisma } from "@prova/db";
import { agentLabel, type FindingSource } from "./core";

/**
 * The reads behind /ai: runs, findings, what the watcher is watching, and a
 * merged timeline. Plain Prisma, every one company-scoped. Writes live in
 * lib/actions/agentFindings.ts and agentSettings.ts.
 */

/** The watcher's cron, exactly as vercel.json has it — `queries.test.ts`
 *  fails if the two disagree, so the label on /ai cannot drift from the
 *  schedule that actually runs. */
export const WATCHER_CRON_PATH = "/api/agents/run";
export const WATCHER_CRON_SCHEDULE = "23 12 * * *";

/** "23 12 * * *" → "Daily at 12:23 UTC". Only the daily shape is ever
 *  scheduled here (Hobby crons run at most once a day). */
export function scheduleLabel(cron: string): string {
  const [min, hour, dom, mon, dow] = cron.split(" ");
  if (dom === "*" && mon === "*" && dow === "*" && /^\d+$/.test(min) && /^\d+$/.test(hour)) {
    return `Daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")} UTC`;
  }
  return `On schedule ${cron} (UTC)`;
}

/** What /ai shows as "next run". */
export const WATCHER_SCHEDULE_LABEL: string = scheduleLabel(WATCHER_CRON_SCHEDULE);

export type AgentRunRow = {
  id: string;
  agent: AgentKind;
  status: AgentRunStatus;
  trigger: string;
  startedAt: Date;
  finishedAt: Date | null;
  summary: string | null;
  note: string | null;
  bidInvitationId: string | null;
  bidProjectName: string | null;
  requestedByName: string | null;
  findingCount: number;
};

export type FindingRow = {
  id: string;
  agent: AgentKind;
  kind: string;
  severity: "info" | "warn" | "flag";
  title: string;
  body: string;
  sources: FindingSource[];
  fixHref: string | null;
  bidInvitationId: string | null;
  bidProjectName: string | null;
  createdAt: Date;
  dismissedAt: Date | null;
  runId: string;
};

export type ActivityItem = {
  id: string;
  at: Date;
  kind: "run" | "finding";
  agent: AgentKind;
  title: string;
  detail: string | null;
  href: string | null;
  severity?: FindingRow["severity"];
};

const runSelect = {
  id: true,
  agent: true,
  status: true,
  trigger: true,
  startedAt: true,
  finishedAt: true,
  summary: true,
  note: true,
  bidInvitationId: true,
  bidInvitation: { select: { projectName: true } },
  requestedByUser: { select: { name: true, email: true } },
  _count: { select: { findings: true } },
} satisfies Prisma.AgentRunSelect;

type RunRecord = Prisma.AgentRunGetPayload<{ select: typeof runSelect }>;

function toRunRow(r: RunRecord): AgentRunRow {
  return {
    id: r.id,
    agent: r.agent,
    status: r.status,
    trigger: r.trigger,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    summary: r.summary,
    note: r.note,
    bidInvitationId: r.bidInvitationId,
    bidProjectName: r.bidInvitation?.projectName ?? null,
    requestedByName: r.requestedByUser ? (r.requestedByUser.name ?? r.requestedByUser.email) : null,
    findingCount: r._count.findings,
  };
}

export async function listRuns(
  companyId: string,
  opts: { limit?: number; agent?: AgentKind; bidInvitationId?: string } = {},
): Promise<AgentRunRow[]> {
  const rows = await prisma.agentRun.findMany({
    where: { companyId, agent: opts.agent, bidInvitationId: opts.bidInvitationId },
    orderBy: { startedAt: "desc" },
    take: opts.limit ?? 50,
    select: runSelect,
  });
  return rows.map(toRunRow);
}

export async function listRunningNow(companyId: string): Promise<AgentRunRow[]> {
  const rows = await prisma.agentRun.findMany({
    where: { companyId, status: "RUNNING" },
    orderBy: { startedAt: "desc" },
    select: runSelect,
  });
  return rows.map(toRunRow);
}

/** Json → sources, dropping anything that is not a cited source. addFinding
 *  refuses uncited rows, so this only bites on a row written some other way. */
function parseSources(json: Prisma.JsonValue): FindingSource[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (s): s is FindingSource =>
      typeof s === "object" && s !== null && !Array.isArray(s) && typeof (s as { label?: unknown }).label === "string",
  ) as FindingSource[];
}

const SEVERITIES = new Set(["info", "warn", "flag"]);

export async function listFindings(
  companyId: string,
  opts: { agent?: AgentKind; bidInvitationId?: string; includeDismissed?: boolean; limit?: number } = {},
): Promise<FindingRow[]> {
  const rows = await prisma.agentFinding.findMany({
    where: {
      companyId,
      agent: opts.agent,
      bidInvitationId: opts.bidInvitationId,
      ...(opts.includeDismissed ? {} : { dismissedAt: null }),
    },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 100,
    include: { bidInvitation: { select: { projectName: true } } },
  });
  return rows.map((f) => ({
    id: f.id,
    agent: f.agent,
    kind: f.kind,
    // A stored string, so an unknown value reads as the mildest rather
    // than rendering as nothing.
    severity: (SEVERITIES.has(f.severity) ? f.severity : "info") as FindingRow["severity"],
    title: f.title,
    body: f.body,
    sources: parseSources(f.sources),
    fixHref: f.fixHref,
    bidInvitationId: f.bidInvitationId,
    bidProjectName: f.bidInvitation?.projectName ?? null,
    createdAt: f.createdAt,
    dismissedAt: f.dismissedAt,
    runId: f.runId,
  }));
}

export function openFindingCount(companyId: string): Promise<number> {
  return prisma.agentFinding.count({ where: { companyId, dismissedAt: null } });
}

export async function watchingSummary(
  companyId: string,
  now: Date = new Date(),
): Promise<{
  openBids: number;
  dueThisWeek: { id: string; projectName: string; dueDate: Date; gcName: string }[];
  unreadAddenda: number;
  lastRunAt: Date | null;
  nextRunLabel: string;
}> {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekEnd = new Date(today.getTime() + 6 * 86_400_000);
  const [openBids, due, unreadAddenda, last] = await Promise.all([
    prisma.bidInvitation.count({ where: { companyId, status: "INVITED" } }),
    prisma.bidInvitation.findMany({
      where: { companyId, status: "INVITED", dueDate: { gte: today, lte: weekEnd } },
      orderBy: { dueDate: "asc" },
      select: { id: true, projectName: true, dueDate: true, contact: { select: { name: true } } },
    }),
    // The same "unread" the watcher flags: no reading, no scope decision, no
    // acknowledged date, on a bid still being priced.
    prisma.bidAddendum.count({
      where: {
        companyId,
        bidInvitation: { status: "INVITED" },
        acknowledgedOn: null,
        readings: { none: {} },
        decisions: { none: {} },
      },
    }),
    prisma.agentRun.findFirst({
      where: { companyId, agent: "BID_WATCHER", status: "DONE" },
      orderBy: { startedAt: "desc" },
      select: { finishedAt: true, startedAt: true },
    }),
  ]);
  return {
    openBids,
    dueThisWeek: due.map((b) => ({ id: b.id, projectName: b.projectName, dueDate: b.dueDate!, gcName: b.contact.name })),
    unreadAddenda,
    lastRunAt: last ? (last.finishedAt ?? last.startedAt) : null,
    nextRunLabel: WATCHER_SCHEDULE_LABEL,
  };
}

const RUN_VERB: Record<AgentRunStatus, string> = {
  RUNNING: "is running",
  DONE: "ran",
  FAILED: "failed",
  PAUSED_CAP: "was paused",
  SKIPPED: "was skipped",
};

/** Runs and findings, newest first. Other workers merge their own items
 *  (recommendations, outcomes) on top of this. */
export async function agentActivity(companyId: string, opts: { limit?: number } = {}): Promise<ActivityItem[]> {
  const limit = opts.limit ?? 50;
  const [runs, findings] = await Promise.all([
    listRuns(companyId, { limit }),
    listFindings(companyId, { includeDismissed: true, limit }),
  ]);
  const items: ActivityItem[] = [
    ...runs.map(
      (r): ActivityItem => ({
        id: r.id,
        at: r.startedAt,
        kind: "run",
        agent: r.agent,
        title: `${agentLabel(r.agent)} ${RUN_VERB[r.status]}${r.bidProjectName ? ` on ${r.bidProjectName}` : ""}`,
        detail: r.summary ?? r.note,
        href: r.bidInvitationId ? `/bids#${r.bidInvitationId}` : null,
      }),
    ),
    ...findings.map(
      (f): ActivityItem => ({
        id: f.id,
        at: f.createdAt,
        kind: "finding",
        agent: f.agent,
        title: f.title,
        detail: f.body,
        href: f.fixHref,
        severity: f.severity,
      }),
    ),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
