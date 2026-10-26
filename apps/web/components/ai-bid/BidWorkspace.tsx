import Link from "next/link";
import type { ReactNode } from "react";
import { RunAgentButton } from "@/components/RunAgentButton";
import { AiRowAction } from "@/components/ai/AiRowAction";
import type { ActionResult } from "@/lib/actions/shared";
import { BidOutcomeForm } from "@/components/BidOutcomeForm";
import { outcomeReasonLabel } from "@/components/ai-bid/outcome";
import { Card, SeverityDot, SourceChips, calendarDay, moment, sentenceCase } from "@/components/ai-bid/parts";
import type { BidWorkspaceData, FindingRow } from "@/components/ai-bid/types";
import { money } from "@/lib/money";
import { tradeScopeLabel } from "@/lib/trade-scopes";
import { bidLogHrefs, bidPageCrumbs } from "@/lib/bid/bidLogHrefs";
import type { Surface } from "@/lib/bid/surfaceHrefs";

type RowAction = (id: string) => Promise<ActionResult>;
export type FindingActions = { dismiss: RowAction; wrong: RowAction };

export const BID_TABS = [
  { key: "research", label: "Research" },
  { key: "estimate", label: "Estimate check" },
  { key: "addenda", label: "Addenda" },
  { key: "decision", label: "Decision" },
] as const;
export type BidTab = (typeof BID_TABS)[number]["key"];

/** `?tab=` as a tab, anything else as the first one. */
export function bidTabFrom(raw: string | string[] | undefined): BidTab {
  return BID_TABS.find((t) => t.key === raw)?.key ?? "research";
}

const STATUS: Record<string, { label: string; tone: string }> = {
  INVITED: { label: "Invited", tone: "bg-rail-hover text-ink-label" },
  SUBMITTED: { label: "Submitted", tone: "bg-tag-brand text-tag-brand-ink" },
  WON: { label: "Won", tone: "bg-tag-green text-tag-green-ink" },
  LOST: { label: "Lost", tone: "bg-tag-rose text-tag-rose-ink" },
  DECLINED: { label: "Declined", tone: "bg-rail-hover text-ink-muted" },
};

function lastRun(data: BidWorkspaceData, agent: string) {
  return data.lastRuns.find((r) => r.agent === agent && r.finishedAt)?.finishedAt ?? null;
}

/**
 * One bid, as the agents see it: what research found, what the estimate
 * check flagged, the addenda, and the advice — with the person deciding.
 *
 * The four steps are LINKS to `?tab=`, like the job stage steps: a tab is a
 * URL, back and forward work, and a keyboard reaches each one with no
 * scripted arrow handling to get wrong. Nothing here writes a business
 * record; the only writes are a Run button (an agent run row) and the
 * win/loss form (a BidOutcome row).
 */
export function BidWorkspace({
  data,
  tab,
  zone,
  ask,
  findingActions,
  surface = "crm",
}: {
  data: BidWorkspaceData;
  tab: BidTab;
  zone: string;
  /** The Ask panel and this bid's earlier conversations, built by the page.
   * Omitted in C Stream Bid, which has no Ask: the Decision step is then one
   * column. */
  ask?: ReactNode;
  /** Dismiss and "Not right" on each finding — Server Actions handed down
   * by the page, so this file imports no feature module. */
  findingActions?: FindingActions;
  /** Which product renders this; C Stream Bid passes "bid" (`lib/bid/bidLogHrefs.ts`). */
  surface?: Surface;
}) {
  const { bid } = data;
  const links = bidLogHrefs(surface);
  const contactHref = links.contact(bid.contactId);
  // Bid is measured at phone width: bound the source chips (see SourceChips). The CRM keeps its markup.
  const fit = surface === "bid";
  const status = STATUS[bid.status] ?? { label: sentenceCase(bid.status), tone: "bg-rail-hover text-ink-label" };
  const unread = data.addenda.filter((a) => !a.read).length;
  const counts: Partial<Record<BidTab, { n: number; tone: string }>> = {
    estimate: data.estimateCheck.length > 0 ? { n: data.estimateCheck.length, tone: "bg-tag-amber text-tag-amber-ink" } : undefined,
    addenda: unread > 0 ? { n: unread, tone: "bg-rail-hover text-ink-body" } : undefined,
  };

  return (
    <div data-bid-workspace>
      <nav aria-label="Breadcrumb" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
        {bidPageCrumbs(surface).map((crumb) => (
          <Link key={crumb.href} href={crumb.href} className="hover:text-ink">
            {crumb.label}
          </Link>
        ))}
      </nav>

      <header className="mt-2 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-balance break-words font-headline text-[34px] leading-none text-ink sm:text-[42px]">{bid.projectName}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-muted">
            <span className="font-medium text-ink-body">{bid.gcName}</span>
            {bid.tradeScope && <span>· {tradeScopeLabel(bid.tradeScope)}</span>}
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.tone}`}>{status.label}</span>
            {contactHref && (
              <Link href={contactHref} className="text-sm text-link hover:text-link-hover">
                Open the bid →
              </Link>
            )}
          </p>
        </div>
        <dl className="flex gap-8 md:text-right">
          <div>
            <dt className="text-xs uppercase tracking-wider text-ink-muted">Bid due</dt>
            <dd className="text-[22px] font-semibold tabular-nums text-ink">{bid.dueDate ? calendarDay(bid.dueDate) : "Not set"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-ink-muted">Your bid</dt>
            <dd className="text-[22px] font-semibold tabular-nums text-ink">{bid.bidAmount === null ? "Not priced" : money(bid.bidAmount)}</dd>
          </div>
        </dl>
      </header>

      <nav aria-label="Bid steps" className="mt-5 border-b border-line-row">
        <ul className="-mb-px flex gap-3.5 overflow-x-auto sm:gap-8">
          {BID_TABS.map((t) => {
            const on = t.key === tab;
            const count = counts[t.key];
            return (
              <li key={t.key} className="shrink-0">
                <Link
                  href={`?tab=${t.key}`}
                  scroll={false}
                  aria-current={on ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 text-sm font-medium sm:text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    on ? "border-brand text-ink" : "border-transparent text-ink-muted hover:border-line-card hover:text-ink-label"
                  }`}
                >
                  {t.key === "estimate" ? (
                    <span>
                      Estimate<span className="max-sm:hidden"> check</span>
                    </span>
                  ) : (
                    t.label
                  )}
                  {count && <span className={`rounded-full px-2 text-xs font-semibold ${count.tone}`}>{count.n}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-5">
        {tab === "research" && <ResearchTab data={data} zone={zone} actions={findingActions} fit={fit} />}
        {tab === "estimate" && <EstimateTab data={data} zone={zone} actions={findingActions} fit={fit} />}
        {tab === "addenda" && <AddendaTab data={data} contactHref={contactHref} />}
        {tab === "decision" && <DecisionTab data={data} zone={zone} ask={ask} fit={fit} />}
      </div>
    </div>
  );
}

function Finding({ finding, fix, actions, fit }: { finding: FindingRow; fix: boolean; actions?: FindingActions; fit: boolean }) {
  return (
    <li className="border-t border-line-row py-3 first:border-t-0 first:pt-0" data-finding={finding.id}>
      <div className="flex gap-2.5">
        <SeverityDot severity={finding.severity} />
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-semibold leading-snug text-ink">{finding.title}</h3>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-ink-body">{finding.body}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <SourceChips sources={finding.sources} fit={fit} />
            {fix && finding.fixHref && (
              <Link href={finding.fixHref} className="text-sm font-semibold text-link hover:text-link-hover">
                Fix this →
              </Link>
            )}
            {actions && (
              <span className="ml-auto flex items-center gap-1">
                <AiRowAction id={finding.id} action={actions.dismiss} label="Dismiss" />
                <AiRowAction id={finding.id} action={actions.wrong} label="Not right" />
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function ResearchTab({ data, zone, actions, fit }: { data: BidWorkspaceData; zone: string; actions?: FindingActions; fit: boolean }) {
  const last = lastRun(data, "BID_RESEARCH");
  const run = <RunAgentButton agent="BID_RESEARCH" bidInvitationId={data.bid.id} label={data.research.length > 0 ? "Research again" : "Research this bid"} />;
  return (
    <Card title="Research" aside={last ? `Last researched ${moment(last, zone)}` : undefined}>
      {data.research.length === 0 ? (
        <div className="flex flex-col gap-3" data-empty="research">
          <p className="text-ink-body">
            Not researched yet. Research reads your history with this GC, similar jobs you bid, and the bid documents,
            and cites every record it used.
          </p>
          {run}
        </div>
      ) : (
        <>
          <ul>
            {data.research.map((f) => (
              <Finding key={f.id} finding={f} fix={false} actions={actions} fit={fit} />
            ))}
          </ul>
          <div className="mt-3 border-t border-line-row pt-3">{run}</div>
        </>
      )}
    </Card>
  );
}

function EstimateTab({ data, zone, actions, fit }: { data: BidWorkspaceData; zone: string; actions?: FindingActions; fit: boolean }) {
  const last = lastRun(data, "ESTIMATE_CHECK");
  const groups = new Map<string, FindingRow[]>();
  for (const f of data.estimateCheck) groups.set(f.kind, [...(groups.get(f.kind) ?? []), f]);
  const run = <RunAgentButton agent="ESTIMATE_CHECK" bidInvitationId={data.bid.id} label={last ? "Check again" : "Check the estimate"} />;
  return (
    <Card title="Estimate check" aside={last ? `Last checked ${moment(last, zone)}` : undefined}>
      {groups.size === 0 ? (
        <div className="flex flex-col gap-3" data-empty="estimate">
          <p className="text-ink-body">
            {last
              ? "The last check found nothing to flag. It compares your prices with your own past bids and job costs, and checks the addenda against what is priced."
              : "Not checked yet. The check compares your prices with your own past bids and job costs, and checks the addenda against what is priced."}
          </p>
          {run}
        </div>
      ) : (
        <>
          {[...groups].map(([kind, rows]) => (
            <section key={kind} className="mb-4" aria-label={sentenceCase(kind)}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                {sentenceCase(kind)} · {rows.length}
              </h3>
              <ul>
                {rows.map((f) => (
                  <Finding key={f.id} finding={f} fix actions={actions} fit={fit} />
                ))}
              </ul>
            </section>
          ))}
          <div className="border-t border-line-row pt-3">{run}</div>
        </>
      )}
    </Card>
  );
}

function AddendaTab({ data, contactHref }: { data: BidWorkspaceData; contactHref: string | null }) {
  return (
    <Card title="Addenda">
      {data.addenda.length === 0 ? (
        <div className="flex flex-col gap-2" data-empty="addenda">
          <p className="text-ink-body">No addenda logged on this bid.</p>
          {contactHref && (
            <Link href={contactHref} className="text-sm font-semibold text-link hover:text-link-hover">
              Log one on the bid →
            </Link>
          )}
        </div>
      ) : (
        <ul>
          {data.addenda.map((a) => (
            <li key={a.id} className="border-t border-line-row first:border-t-0">
              <Link href={a.href} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:bg-rail-hover">
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${a.read ? "bg-line-card" : "bg-brand text-neutral-900"}`} />
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{a.reference}</span>
                <span className="text-sm text-ink-muted">{a.issuedOn ? `Issued ${calendarDay(a.issuedOn)}` : ""}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${a.read ? "bg-rail-hover text-ink-body" : "bg-tag-brand-soft text-tag-brand-soft-ink"}`}>
                  {a.read ? "Read" : "Not read"}
                </span>
                {a.openDecisions > 0 && (
                  <span className="rounded-full bg-tag-amber px-2.5 py-0.5 text-xs font-semibold text-tag-amber-ink">
                    {a.openDecisions} open {a.openDecisions === 1 ? "decision" : "decisions"}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DecisionTab({ data, zone, ask, fit }: { data: BidWorkspaceData; zone: string; ask?: ReactNode; fit: boolean }) {
  const { recommendation, outcome } = data.decision;
  return (
    <div className={ask ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]" : "grid gap-5"}>
      <div className="flex min-w-0 flex-col gap-5">
        <Card title="Recommendation" aside="Advice — you decide">
          {recommendation ? (
            <div data-recommendation>
              <div className="flex items-center gap-3 rounded-xl border border-line-card bg-canvas px-4 py-3">
                <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-rail-hover text-brand">
                  ✦
                </span>
                <p className="min-w-0 flex-1 break-words font-semibold text-ink">{recommendation.title}</p>
                <p className="shrink-0 text-right text-xs text-ink-muted">
                  <span className="block text-[15px] font-semibold text-ink">{sentenceCase(recommendation.confidence)}</span>
                  confidence
                </p>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm text-ink-body">{recommendation.reason}</p>
              <div className="mt-3">
                <SourceChips sources={recommendation.sources} fit={fit} />
              </div>
              <p className="mt-3 text-xs text-ink-muted">
                Updated {moment(recommendation.updatedAt, zone)}. C Stream never submits a bid for you.
              </p>
            </div>
          ) : (
            <p className="text-ink-body" data-empty="recommendation">
              No recommendation yet. One appears after research and the estimate check have run on this bid.
            </p>
          )}
        </Card>

        <Card title="Outcome">
          {outcome ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm" data-outcome>
              <dt className="text-ink-muted">Result</dt>
              <dd className="font-semibold text-ink">{outcome.result === "WON" ? "Won" : "Lost"}</dd>
              <dt className="text-ink-muted">Main reason</dt>
              <dd className="text-ink-body">{outcomeReasonLabel(outcome.reason)}</dd>
              {outcome.winningPrice !== null && (
                <>
                  <dt className="text-ink-muted">Winning price</dt>
                  <dd className="tabular-nums text-ink-body">{money(outcome.winningPrice)}</dd>
                </>
              )}
              {outcome.winnerName && (
                <>
                  <dt className="text-ink-muted">Who got it</dt>
                  <dd className="text-ink-body">{outcome.winnerName}</dd>
                </>
              )}
              {outcome.decidedOn && (
                <>
                  <dt className="text-ink-muted">Decided on</dt>
                  <dd className="text-ink-body">{calendarDay(outcome.decidedOn)}</dd>
                </>
              )}
              {outcome.note && (
                <>
                  <dt className="text-ink-muted">Note</dt>
                  <dd className="whitespace-pre-line break-words text-ink-body">{outcome.note}</dd>
                </>
              )}
            </dl>
          ) : (
            <>
              <p className="mb-4 text-sm text-ink-body">
                Once the GC tells you, record how it went and why. That is what the recommendations learn from.
              </p>
              <BidOutcomeForm
                bidInvitationId={data.bid.id}
                defaultResult={data.bid.status === "WON" || data.bid.status === "LOST" ? data.bid.status : undefined}
              />
            </>
          )}
        </Card>
      </div>
      {ask && (
        <aside aria-label="Ask about this bid" className="min-w-0">
          {ask}
        </aside>
      )}
    </div>
  );
}
