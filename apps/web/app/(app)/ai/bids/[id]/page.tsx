import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { AskPanel } from "@/components/AskPanel";
import { BidWorkspace, bidTabFrom } from "@/components/ai-bid/BidWorkspace";
import { moment } from "@/components/ai-bid/parts";
import { loadBidWorkspace } from "@/lib/agents/bidWorkspace";
import { dismissFinding, markFindingWrong } from "@/lib/actions/agentFindings";
import { listThreadsForSubject } from "@/lib/ask/threads";
import { viewerTimeZone } from "@/lib/viewerToday";

export const metadata = { title: "Bid workspace" };

/**
 * One bid as the agents see it — research, the estimate check, addenda and
 * the advice — with the decision left to the person. `?tab=` picks the step;
 * `?thread=` reopens one of this person's earlier conversations about the bid.
 */
export default async function AiBidPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; thread?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const [{ id }, { tab: rawTab, thread }] = await Promise.all([params, searchParams]);
  const tab = bidTabFrom(rawTab);

  const [data, zone] = await Promise.all([loadBidWorkspace(id, context.company.id), viewerTimeZone()]);
  if (!data) notFound();

  // Only on the Decision step, where the panel is, and only this person's
  // own threads — threads are user-scoped, never another person's.
  const threads = tab === "decision" ? await listThreadsForSubject(context.company.id, "BidInvitation", data.bid.id, context.id) : [];
  const openThread = threads.find((t) => t.id === thread)?.id;

  const ask = (
    <div className="flex flex-col gap-4">
      <AskPanel key={openThread ?? "new"} subject={data.subject} threadId={openThread} />
      {threads.length > 0 && (
        <section className="rounded-2xl border border-line-card bg-surface px-5 py-4" aria-labelledby="bid-threads">
          <h2 id="bid-threads" className="font-headline text-xl text-ink">
            Your earlier questions
          </h2>
          <ul className="mt-2">
            {threads.map((t) => (
              <li key={t.id} className="border-t border-line-row first:border-t-0">
                <Link
                  href={`?tab=decision&thread=${t.id}`}
                  aria-current={t.id === openThread ? "page" : undefined}
                  className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:text-ink"
                >
                  <span className="min-w-0 truncate text-ink">{t.title}</span>
                  <span className="shrink-0 text-ink-muted">{moment(t.lastMessageAt, zone)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );

  return (
    <PageShell width="working">
      <BidWorkspace
        data={data}
        tab={tab}
        zone={zone}
        ask={ask}
        findingActions={{ dismiss: dismissFinding, wrong: markFindingWrong }}
      />
    </PageShell>
  );
}
