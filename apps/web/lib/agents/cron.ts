import { prisma, type AgentKind } from "@prova/db";
import "@/lib/agents/all";
import { runAgent } from "@/lib/agents/run";

/**
 * The scheduled agent run, as a function: the bid watcher (or the
 * recommendations agent) for every company that has it on, or has never
 * saved agent settings — absent means default ON.
 *
 * Two callers. `/api/agents/run` is the route a person or a one-off `curl`
 * hits with the CRON_SECRET. `/api/notifications/digest` is what the
 * SCHEDULE actually calls: `vercel.json` on `prova-web` may declare two cron
 * jobs on the Hobby plan, both were taken (the digest and plan ingest), and
 * a production deploy declaring a third is refused outright. So the daily
 * digest runs the watcher after its own work, with whatever is left of the
 * function's 60s — 2026-10-12, Diego's call on #748, in place of a plan
 * change. `lib/agents/queries.ts` names that schedule so /ai's "next run"
 * cannot drift from the entry that runs it.
 *
 * Every per-company gate (AI switch, agent switch, spend cap) is runAgent's,
 * so a paused or skipped company still leaves a run row saying why. Safe to
 * repeat: every watcher finding carries a dedupeKey, so a second run a
 * second later writes run rows and no repeated findings.
 */

export const CRON_AGENTS = {
  BID_WATCHER: "watcherEnabled",
  RECOMMENDATIONS: "recommendationsEnabled",
} as const satisfies Partial<Record<AgentKind, string>>;
export type CronAgent = keyof typeof CRON_AGENTS;

export function isCronAgent(name: string): name is CronAgent {
  return Object.hasOwn(CRON_AGENTS, name);
}

export type ScheduledRunCounts = {
  companies: number;
  ran: number;
  paused: number;
  skipped: number;
  failed: number;
  /** Companies the budget ran out before — a non-2xx for the caller. */
  notAttempted: number;
};

/** Below the route's maxDuration so the run stops itself and reports,
 *  rather than being killed mid-company with no body. Same figure as the
 *  digest's own. */
export const AGENT_RUN_BUDGET_MS = 45_000;

export async function runScheduledAgent(options: { agent: CronAgent; budgetMs?: number }): Promise<ScheduledRunCounts> {
  const { agent } = options;
  const budgetMs = options.budgetMs ?? AGENT_RUN_BUDGET_MS;
  const toggle = CRON_AGENTS[agent];

  const companies = await prisma.company.findMany({
    where: { OR: [{ agentSettings: null }, { agentSettings: { [toggle]: true } }] },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  const started = Date.now();
  const counts: ScheduledRunCounts = { companies: companies.length, ran: 0, paused: 0, skipped: 0, failed: 0, notAttempted: 0 };
  for (const { id } of companies) {
    if (Date.now() - started > budgetMs) {
      counts.notAttempted++;
      continue;
    }
    try {
      const outcome = await runAgent({ companyId: id, agent, trigger: "cron" });
      if (outcome.ran) counts.ran++;
      else if (outcome.status === "PAUSED_CAP") counts.paused++;
      else if (outcome.status === "SKIPPED") counts.skipped++;
      else counts.failed++;
    } catch (error) {
      // runAgent catches the runner; this is the gate or the run row itself
      // failing. One company's failure must not stop the rest.
      console.error("[agents] cron run threw", { companyId: id, agent }, error);
      counts.failed++;
    }
  }

  console.log(
    `[agents] cron ${agent} companies=${counts.companies} ran=${counts.ran} paused=${counts.paused} skipped=${counts.skipped} failed=${counts.failed} not-attempted=${counts.notAttempted}`,
  );
  return counts;
}

/** The status rule, shared by both callers: did this run do its WHOLE job.
 *  A run that failed a company or ran out of time is not clean. */
export function scheduledRunClean(counts: ScheduledRunCounts): boolean {
  return counts.failed === 0 && counts.notAttempted === 0;
}
