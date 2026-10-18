import Link from "next/link";
import { PageShell } from "@prova/ui";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { ActivityTimeline, agentFilterFrom } from "@/components/ai-activity/ActivityTimeline";
import { AgentSettingsForm } from "@/components/ai-activity/AgentSettingsForm";
import { groupByDay, mergeActivity } from "@/components/ai-activity/activity";
import { agentSettingsFor, agentSpendThisMonth } from "@/lib/agents/core";
import { agentActivity, listFindings, WATCHER_SCHEDULE_LABEL } from "@/lib/agents/queries";
import { recommendationActivity } from "@/lib/agents/recommendations-query";
import { viewerTimeZone, viewerToday } from "@/lib/viewerToday";

export const metadata = { title: "Agent activity & settings" };

/**
 * What the agents read, flagged and advised, newest first — and the
 * switches that decide when they run and who hears about it.
 */
export default async function AiActivityPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const companyId = context.company.id;
  const agent = agentFilterFrom((await searchParams).agent);

  const [runs, findings, recommendations, settings, spend, people, zone, today] = await Promise.all([
    agentActivity(companyId, { limit: 100 }),
    listFindings(companyId, { includeDismissed: true, limit: 100 }),
    recommendationActivity(companyId, 100),
    agentSettingsFor(companyId),
    agentSpendThisMonth(companyId),
    prisma.user.findMany({
      where: { companyId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, role: true },
    }),
    viewerTimeZone(),
    viewerToday(),
  ]);

  // ponytail: the filter applies to the newest 200 merged rows, not to the
  // whole history; a per-agent query is the upgrade if one agent gets buried.
  const dismissed = new Set(findings.filter((f) => f.dismissedAt !== null).map((f) => f.id));
  const wrong = new Set(findings.filter((f) => f.dismissedReason === "WRONG").map((f) => f.id));
  const items = mergeActivity(runs, recommendations, dismissed, wrong);
  const days = groupByDay(agent ? items.filter((i) => i.agent === agent) : items, zone, today);

  return (
    <PageShell width="working">
      <Link href="/ai" className="text-sm text-ink-muted hover:text-ink">
        ← AI
      </Link>
      <h1 className="mt-2 font-headline text-[34px] leading-none text-ink sm:text-[42px]">Agent activity &amp; settings</h1>
      <p className="mt-2 text-ink-muted">Everything the agents read and flagged, and what they are allowed to do.</p>
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
        <ActivityTimeline days={days} agent={agent} zone={zone} />
        <AgentSettingsForm
          settings={settings}
          spend={spend}
          people={people}
          schedule={WATCHER_SCHEDULE_LABEL}
          isOwner={context.role === "OWNER"}
        />
      </div>
    </PageShell>
  );
}
