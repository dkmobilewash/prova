"use server";

import { revalidatePath } from "next/cache";
import type { AgentKind } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { runAgent, type RunOutcome } from "@/lib/agents/run";

export type RunAgentResult = { ok: true; outcome: RunOutcome } | { ok: false; error: string };

const KINDS: readonly AgentKind[] = ["BID_WATCHER", "BID_RESEARCH", "ESTIMATE_CHECK", "RECOMMENDATIONS"];

/**
 * "Run now". Gated like /bids (MANAGE_ESTIMATING) because the agents read
 * bids and estimates; a person who cannot open the bid list cannot start a
 * run over it. Returns a result rather than throwing — production redacts
 * a thrown Server Action message.
 */
export async function runAgentNow(agent: AgentKind, bidInvitationId?: string | null): Promise<RunAgentResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return { ok: false, error: "Running an agent needs estimating access." };
  if (!KINDS.includes(agent)) return { ok: false, error: "That is not an agent this app runs." };
  const outcome = await runAgent({
    companyId: context.companyId,
    agent,
    trigger: "manual",
    bidInvitationId: bidInvitationId ?? null,
    requestedByUserId: context.id,
  });
  revalidatePath("/ai");
  return { ok: true, outcome };
}
