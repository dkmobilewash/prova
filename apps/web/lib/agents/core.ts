import { prisma, type AgentKind, type Prisma } from "@prova/db";
import type { AskUsageTotals } from "@prova/integrations";
import { aiGate } from "@/lib/ai/settings";
import { spendOver } from "@/lib/ask/cost";
import { recordAskUsage, type AskUsageOutcome } from "@/lib/ask/usage";

/**
 * The shared spine of every background agent: the switch, the spend cap,
 * the run row, the finding row, the usage row.
 *
 * AGENTS ADVISE. An agent reads, computes, writes rows in ai-agents.prisma
 * and nothing else. A change to a business record goes through the Ask
 * confirm card; an outbound message goes through the existing channels
 * behind a confirm. Nothing in this file can write anything but its own
 * tables, and that is the whole safety argument — keep it that way.
 *
 * THE CAP IS CHECKED BEFORE THE MODEL IS CALLED, never after. `agentAllowed`
 * reads this month's `ai-agents` AskUsage rows and prices them with the same
 * `spendOver` /settings/assistant uses, so the number the owner sees and the
 * number the gate enforces are one number.
 */

/** The ledger feature every agent run records under. */
export const AGENT_FEATURE = "ai-agents" as const;

export type AgentSettings = {
  watcherEnabled: boolean;
  researchOnNewBid: boolean;
  checkerBeforeSend: boolean;
  recommendationsEnabled: boolean;
  dueSoonDays: number;
  monthlySpendCapUsd: number | null;
  notifyUserIds: string[];
};

export const AGENT_SETTINGS_DEFAULTS: AgentSettings = {
  watcherEnabled: true,
  researchOnNewBid: true,
  checkerBeforeSend: true,
  recommendationsEnabled: true,
  dueSoonDays: 5,
  monthlySpendCapUsd: null,
  notifyUserIds: [],
};

/** Which per-agent switch gates which agent. */
const SWITCH: Record<AgentKind, keyof AgentSettings> = {
  BID_WATCHER: "watcherEnabled",
  BID_RESEARCH: "researchOnNewBid",
  ESTIMATE_CHECK: "checkerBeforeSend",
  RECOMMENDATIONS: "recommendationsEnabled",
};

export async function agentSettingsFor(companyId: string): Promise<AgentSettings> {
  const row = await prisma.companyAgentSettings.findUnique({ where: { companyId } });
  if (!row) return AGENT_SETTINGS_DEFAULTS;
  return {
    watcherEnabled: row.watcherEnabled,
    researchOnNewBid: row.researchOnNewBid,
    checkerBeforeSend: row.checkerBeforeSend,
    recommendationsEnabled: row.recommendationsEnabled,
    dueSoonDays: row.dueSoonDays,
    monthlySpendCapUsd: row.monthlySpendCapUsd === null ? null : Number(row.monthlySpendCapUsd),
    notifyUserIds: row.notifyUserIds,
  };
}

export type AgentSpend = { usd: number; capUsd: number | null; overCap: boolean };

/** What the agents have spent this UTC month, against the company's cap. */
export async function agentSpendThisMonth(companyId: string, now: Date = new Date()): Promise<AgentSpend> {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [rows, settings] = await Promise.all([
    prisma.askUsage.findMany({
      where: { companyId, feature: AGENT_FEATURE, createdAt: { gte: from } },
      select: {
        model: true,
        createdAt: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
        webSearches: true,
      },
    }),
    agentSettingsFor(companyId),
  ]);
  const usd = spendOver(rows).usd;
  const capUsd = settings.monthlySpendCapUsd;
  return { usd, capUsd, overCap: capUsd !== null && usd >= capUsd };
}

export type AgentPermission =
  | { ok: true; model: string; settings: AgentSettings }
  /** `status` is what the run row should say when nothing runs. */
  | { ok: false; status: "PAUSED_CAP" | "SKIPPED"; note: string };

/**
 * May this agent run for this company right now? Checks, in order: the
 * company AI switch and the AI_AGENTS feature switch (`aiGate`), the
 * per-agent switch, then the spend cap. Refusals come back as a status and
 * a sentence so the caller records a row saying why, rather than nothing.
 */
export async function agentAllowed(companyId: string, agent: AgentKind): Promise<AgentPermission> {
  const gate = await aiGate(companyId, "AI_AGENTS");
  if (!gate.ok) return { ok: false, status: "SKIPPED", note: gate.error };
  const settings = await agentSettingsFor(companyId);
  if (!settings[SWITCH[agent]]) {
    return { ok: false, status: "SKIPPED", note: `${agentLabel(agent)} is switched off for this company.` };
  }
  const spend = await agentSpendThisMonth(companyId);
  if (spend.overCap) {
    return {
      ok: false,
      status: "PAUSED_CAP",
      note: `Paused: this month's AI spend cap of $${spend.capUsd!.toFixed(2)} is reached ($${spend.usd.toFixed(2)} spent).`,
    };
  }
  return { ok: true, model: gate.model, settings };
}

export function agentLabel(agent: AgentKind): string {
  return {
    BID_WATCHER: "The bid watcher",
    BID_RESEARCH: "Bid research",
    ESTIMATE_CHECK: "The estimate check",
    RECOMMENDATIONS: "Recommendations",
  }[agent];
}

export type StartRun = {
  companyId: string;
  agent: AgentKind;
  trigger: "cron" | "manual" | "event";
  bidInvitationId?: string | null;
  requestedByUserId?: string | null;
};

/** Writes the RUNNING row. "Running now" on /ai reads these. */
export async function startAgentRun(input: StartRun) {
  return prisma.agentRun.create({
    data: {
      companyId: input.companyId,
      agent: input.agent,
      trigger: input.trigger,
      bidInvitationId: input.bidInvitationId ?? null,
      requestedByUserId: input.requestedByUserId ?? null,
    },
  });
}

/** Records a run that did not run, with the reason, so the timeline says so. */
export async function recordSkippedRun(input: StartRun, permission: Extract<AgentPermission, { ok: false }>) {
  return prisma.agentRun.create({
    data: {
      companyId: input.companyId,
      agent: input.agent,
      trigger: input.trigger,
      bidInvitationId: input.bidInvitationId ?? null,
      requestedByUserId: input.requestedByUserId ?? null,
      status: permission.status,
      note: permission.note,
      finishedAt: new Date(),
    },
  });
}

export async function finishAgentRun(runId: string, result: { summary: string } | { error: string }) {
  return prisma.agentRun.update({
    where: { id: runId },
    data:
      "error" in result
        ? { status: "FAILED", note: result.error, finishedAt: new Date() }
        : { status: "DONE", summary: result.summary, finishedAt: new Date() },
  });
}

/** One place a finding points at. At least one of href/url/recordId must be
 *  set — a label alone is a claim, not a source. */
export type FindingSource = {
  label: string;
  href?: string;
  url?: string;
  recordType?: string;
  recordId?: string;
};

export type NewFinding = {
  kind: string;
  severity: "info" | "warn" | "flag";
  title: string;
  body: string;
  sources: FindingSource[];
  fixHref?: string | null;
  bidInvitationId?: string | null;
  /** Set it and a repeat run skips a finding it already made. */
  dedupeKey?: string | null;
};

export function sourcesAreCited(sources: FindingSource[]): boolean {
  return sources.length > 0 && sources.every((s) => s.label.trim() && (s.href || s.url || s.recordId));
}

/**
 * Writes a finding. REFUSES an uncited one by throwing: that is a bug in
 * the agent, not a user-facing condition, and the run's caller records the
 * failure on the run row. Returns null when `dedupeKey` already exists.
 */
export async function addFinding(
  run: { id: string; companyId: string; agent: AgentKind },
  finding: NewFinding,
): Promise<{ id: string } | null> {
  if (!sourcesAreCited(finding.sources)) {
    throw new Error(`agent finding "${finding.kind}" has no usable source — every finding cites where it came from`);
  }
  const data: Prisma.AgentFindingUncheckedCreateInput = {
    companyId: run.companyId,
    runId: run.id,
    agent: run.agent,
    bidInvitationId: finding.bidInvitationId ?? null,
    kind: finding.kind,
    severity: finding.severity,
    title: finding.title,
    body: finding.body,
    sources: finding.sources as unknown as Prisma.InputJsonValue,
    fixHref: finding.fixHref ?? null,
    dedupeKey: finding.dedupeKey ?? null,
  };
  if (!finding.dedupeKey) return prisma.agentFinding.create({ data, select: { id: true } });
  const existing = await prisma.agentFinding.findUnique({
    where: { companyId_dedupeKey: { companyId: run.companyId, dedupeKey: finding.dedupeKey } },
    select: { id: true },
  });
  if (existing) return null;
  return prisma.agentFinding.create({ data, select: { id: true } });
}

/** Every model pass an agent makes is written to the ledger under `ai-agents`. */
export async function recordAgentUsage(input: {
  companyId: string;
  userId: string | null;
  model: string;
  usage: AskUsageTotals;
  outcome: AskUsageOutcome;
  jobId?: string | null;
}): Promise<void> {
  await recordAskUsage({ ...input, feature: AGENT_FEATURE });
}
