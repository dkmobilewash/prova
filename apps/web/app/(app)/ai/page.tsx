import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { AskPanel } from "@/components/AskPanel";
import { RecentThreads } from "@/components/ask/RecentThreads";
import { AiHome } from "@/components/ai/AiParts";
import { listFindings, listRunningNow, listRuns, openFindingCount, watchingSummary } from "@/lib/agents/queries";
import { listRecommendations } from "@/lib/agents/recommendations-query";
import { dismissRecommendation, markRecommendationDone } from "@/lib/actions/recommendations";
import { dismissFinding } from "@/lib/actions/agentFindings";

export const metadata = { title: "AI" };

/** How many finished runs to show under the ones still running. */
const RECENT_RUNS = 2;

/**
 * /ai — the AI home (mockup ai-home-desktop.png): the chat, and beside it
 * what the background agents are doing. Every list is real rows from the
 * agent tables; each one that is empty says what fills it.
 *
 * MANAGE_ESTIMATING, the same as /bids: the agents read bids and estimates,
 * and a person who cannot open the bid list does not get a door to what was
 * read out of it. The actions behind the buttons check it again themselves.
 *
 * `?thread=<id>` reopens a saved conversation; the Recent list links to it.
 */
export default async function AiPage({ searchParams }: { searchParams: Promise<{ thread?: string | string[] }> }) {
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const { thread } = await searchParams;
  const threadId = typeof thread === "string" && thread ? thread : undefined;
  const companyId = context.company.id;

  const [running, recent, recommendations, watching, findings, findingCount] = await Promise.all([
    listRunningNow(companyId),
    listRuns(companyId, { limit: RECENT_RUNS }),
    listRecommendations(companyId, { status: "open", limit: 6 }),
    watchingSummary(companyId),
    listFindings(companyId, { limit: 5 }),
    openFindingCount(companyId),
  ]);
  // Running first, then the latest finished ones — a run still going is in
  // both lists, and is shown once.
  const runs = [...running, ...recent.filter((run) => !running.some((r) => r.id === run.id))];

  return (
    <PageShell width="working">
      <AiHome
        // Keyed so opening another thread from Recent starts a fresh panel.
        chat={<AskPanel key={threadId ?? "new"} threadId={threadId} />}
        // The signed-in person's own threads only (lib/ask/threads.ts is
        // user-scoped).
        recent={
          <RecentThreads
            companyId={companyId}
            userId={context.id}
            hrefFor={(id) => `/ai?thread=${encodeURIComponent(id)}`}
            activeId={threadId}
          />
        }
        threadOpen={threadId !== undefined}
        runs={runs}
        recommendations={recommendations}
        watching={watching}
        findings={findings}
        findingCount={findingCount}
        actions={{ dismissRecommendation, markRecommendationDone, dismissFinding }}
        now={new Date()}
      />
    </PageShell>
  );
}
