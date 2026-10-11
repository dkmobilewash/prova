import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { RunAgentButton } from "@/components/RunAgentButton";

export const metadata = { title: "AI" };

/**
 * PLACEHOLDER. The AI page worker replaces this file wholesale with the
 * chat, Running now, Recommendations and Watching sections. It exists so
 * the `AI_AGENTS` feature has a rendered control from the first commit
 * (aiSurfaceCensus) and so the route is protected and reachable.
 */
export default async function AiPage() {
  const { allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">AI</h1>
      <p className="mt-2 text-sm text-ink-body">Background agents that read your bids and advise.</p>
      <div className="mt-6">
        <RunAgentButton agent="BID_WATCHER" label="Run the bid watcher now" />
      </div>
    </div>
  );
}
