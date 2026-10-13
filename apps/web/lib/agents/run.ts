import type { AgentKind } from "@prova/db";
import {
  agentAllowed,
  finishAgentRun,
  recordSkippedRun,
  startAgentRun,
  type AgentSettings,
  type StartRun,
} from "./core";

/** What a runner gets. It may read anything, and write ONLY through
 *  `addFinding`, the recommendation upsert, and `recordAgentUsage`. */
export type AgentContext = {
  run: { id: string; companyId: string; agent: AgentKind };
  companyId: string;
  bidInvitationId: string | null;
  userId: string | null;
  model: string;
  settings: AgentSettings;
};

export type AgentRunner = (ctx: AgentContext) => Promise<{ summary: string }>;

/**
 * The agents, by kind. Each agent's module registers itself here; a kind
 * with no runner is a run that fails with a sentence rather than a
 * silent no-op, so a half-wired agent shows up on the timeline.
 */
export const AGENT_RUNNERS: Partial<Record<AgentKind, AgentRunner>> = {};

export type RunOutcome =
  | { ran: true; runId: string; summary: string }
  | { ran: false; runId: string; status: "PAUSED_CAP" | "SKIPPED" | "FAILED"; note: string };

/**
 * Gate, record, run, stamp. The one entry point for cron, the Run-now
 * button and the on-event triggers, so every path checks the same switch
 * and the same cap and leaves the same row behind.
 */
export async function runAgent(input: StartRun): Promise<RunOutcome> {
  const permission = await agentAllowed(input.companyId, input.agent);
  if (!permission.ok) {
    const row = await recordSkippedRun(input, permission);
    return { ran: false, runId: row.id, status: permission.status, note: permission.note };
  }
  const run = await startAgentRun(input);
  const runner = AGENT_RUNNERS[input.agent];
  if (!runner) {
    const note = `No runner is registered for ${input.agent}.`;
    await finishAgentRun(run.id, { error: note });
    return { ran: false, runId: run.id, status: "FAILED", note };
  }
  try {
    const { summary } = await runner({
      run: { id: run.id, companyId: run.companyId, agent: run.agent },
      companyId: input.companyId,
      bidInvitationId: input.bidInvitationId ?? null,
      userId: input.requestedByUserId ?? null,
      model: permission.model,
      settings: permission.settings,
    });
    await finishAgentRun(run.id, { summary });
    return { ran: true, runId: run.id, summary };
  } catch (error) {
    // The sentence goes on the run row for the timeline; the stack goes to
    // the log. Never the other way round — a stack on screen is noise and a
    // sentence in the log is not enough to fix anything.
    console.error("[agents] run failed", { runId: run.id, agent: input.agent, companyId: input.companyId }, error);
    const note = error instanceof Error ? error.message : "The agent failed.";
    await finishAgentRun(run.id, { error: note });
    return { ran: false, runId: run.id, status: "FAILED", note };
  }
}
