import Link from "next/link";
import type { ReactNode } from "react";
import type { AgentKind, AgentRunStatus } from "@prova/db";
import { agentLabel, type FindingSource } from "@/lib/agents/core";
import type { ActionResult } from "@/lib/actions/shared";
import { relativeTime } from "@/lib/integrations/relativeTime";
import { formatCalendarDate } from "@/lib/render-date";
import { RunAgentButton } from "@/components/RunAgentButton";
import { RUN_PILL, RunStatusPill, RunWayOut } from "./RunStatusPill";
import { AiRowAction } from "./AiRowAction";
import { AiSideToggle } from "./AiSideToggle";

/**
 * The /ai page (C Stream AI mockup, ai-home-desktop.png / ai-home-phone.png):
 * the chat on the left, and on the right what the background agents are
 * doing — Running now, Recommendations, Watching.
 *
 * Presentational and server-safe. Every row arrives as a prop from
 * app/(app)/ai/page.tsx, which is where the loaders and the capability gate
 * live; the two write actions arrive as props too (Server Actions), so this
 * file imports no query module and the render test can hand it fixtures.
 *
 * The row types below are the FIELDS THIS PAGE READS, a structural subset of
 * the loaders' own row types (lib/agents/queries.ts, lib/agents/
 * recommendations-query.ts), so a loader row is assignable to them as is.
 * Nothing here invents a figure: an empty list renders a sentence that says
 * what fills it, and a button that does.
 */

export type AiRun = {
  id: string;
  agent: AgentKind;
  status: AgentRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  summary: string | null;
  note: string | null;
  bidProjectName: string | null;
  /** Set when the run was about one bid — its name then opens that bid,
   * and Run again (RunWayOut) can re-run it. */
  bidInvitationId?: string | null;
};

export type AiFinding = {
  id: string;
  severity: "info" | "warn" | "flag";
  title: string;
  body: string;
  sources: FindingSource[];
  fixHref: string | null;
  bidProjectName: string | null;
};

export type AiRecommendation = {
  id: string;
  title: string;
  reason: string;
  /** "low", "medium" or "high" (ai-agents.prisma). */
  confidence: string;
  href: string | null;
  sources: FindingSource[];
};

export type AiWatching = {
  openBids: number;
  dueThisWeek: { id: string; projectName: string; dueDate: Date; gcName: string | null }[];
  unreadAddenda: number;
  lastRunAt: Date | null;
  nextRunLabel: string | null;
};

type RowAction = (id: string) => Promise<ActionResult>;

/** Where one bid's AI workspace lives (the bid-ui worker's page). */
export const aiBidHref = (bidInvitationId: string) => `/ai/bids/${bidInvitationId}`;
export const AI_ACTIVITY_HREF = "/ai/activity";

/* ------------------------------------------------------------ pieces -- */

const PILL = RUN_PILL;

export { RunStatusPill };

const SEVERITY: Record<AiFinding["severity"], { label: string; tone: string }> = {
  flag: { label: "Flag", tone: "bg-tag-rose text-tag-rose-ink" },
  warn: { label: "Check", tone: "bg-tag-amber text-tag-amber-ink" },
  info: { label: "Note", tone: "border border-line-card bg-tag-slate text-tag-slate-ink" },
};

const CONFIDENCE: Record<string, string> = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

function SectionHead({ title, id, aside }: { title: string; id: string; aside?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <h2 id={id} className="font-headline text-lg font-semibold text-ink">
        {title}
      </h2>
      {aside}
    </div>
  );
}

const ASIDE_LINK = "inline-flex min-h-11 items-center text-[13px] text-ink-muted hover:text-ink lg:min-h-0";

/** Every finding and recommendation cites what it read. A source with a
 * page in the app links there; a web source opens in a new tab; one with
 * neither is still named. */
export function Sources({ sources }: { sources: FindingSource[] }) {
  if (sources.length === 0) return null;
  const chip = "inline-flex max-w-full items-center rounded-lg border border-line-card px-2 py-0.5 text-sm text-ink-body";
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Sources">
      {sources.map((source, i) => (
        <li key={`${source.label}-${i}`} className="min-w-0">
          {source.href ? (
            <Link href={source.href} className={`${chip} hover:bg-rail-hover hover:text-ink`}>
              <span className="truncate">{source.label}</span>
            </Link>
          ) : source.url ? (
            <a href={source.url} target="_blank" rel="noopener noreferrer" className={`${chip} hover:bg-rail-hover hover:text-ink`}>
              <span className="truncate">{source.label}</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <span className={chip}>
              <span className="truncate">{source.label}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------- running now -- */

function runWhen(run: AiRun, now: Date): string {
  if (run.status === "RUNNING") return `Started ${relativeTime(run.startedAt, now)}`;
  return `${run.status === "DONE" ? "Finished" : "Ended"} ${relativeTime(run.finishedAt ?? run.startedAt, now)}`;
}

export function RunningNow({ runs, now }: { runs: AiRun[]; now: Date }) {
  return (
    <section aria-labelledby="ai-running" data-tour="ai-running">
      <SectionHead
        title="Running now"
        id="ai-running"
        aside={
          <Link href={AI_ACTIVITY_HREF} className={ASIDE_LINK}>
            Activity →
          </Link>
        }
      />
      {runs.length === 0 ? (
        <div data-empty="runs">
          <p className="text-sm text-ink-body">
            Nothing running. Agents run on their schedule, when a bid is logged, or when you press Run now.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <RunAgentButton agent="BID_WATCHER" label="Run the bid watcher" />
            <RunAgentButton agent="RECOMMENDATIONS" label="Run recommendations" />
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-line-row">
          {runs.map((run) => (
            <li key={run.id} className="py-1.5 first:pt-0.5">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words text-[14.5px] leading-snug text-ink">
                  {agentLabel(run.agent)}
                  {run.bidProjectName && (
                    <span className="text-ink-body">
                      {" · "}
                      {run.bidInvitationId ? (
                        <Link href={aiBidHref(run.bidInvitationId)} className="text-link hover:text-link-hover hover:underline">
                          {run.bidProjectName}
                        </Link>
                      ) : (
                        run.bidProjectName
                      )}
                    </span>
                  )}
                </p>
                <RunStatusPill status={run.status} />
              </div>
              {/* One line: what it did, then when — two lines a run cost
                  the column the room Watching needs above the fold. */}
              <p className="mt-0.5 break-words text-[13px] leading-snug text-ink-body">
                {(run.summary ?? run.note) && <>{run.summary ?? run.note} · </>}
                <span className="text-ink-muted">{runWhen(run, now)}</span>
              </p>
              <div className="mt-1 empty:hidden">
                <RunWayOut status={run.status} note={run.note} agent={run.agent} bidInvitationId={run.bidInvitationId ?? null} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* --------------------------------------------------- recommendations -- */

export function Recommendations({
  items,
  dismiss,
  done,
}: {
  items: AiRecommendation[];
  dismiss: RowAction;
  done: RowAction;
}) {
  return (
    <section aria-labelledby="ai-recommendations" data-tour="ai-recommendations">
      <SectionHead
        title="Recommendations"
        id="ai-recommendations"
        aside={items.length > 0 ? <span className="text-[13px] text-ink-muted tabular-nums">{items.length}</span> : undefined}
      />
      {items.length === 0 ? (
        <p className="text-sm text-ink-body" data-empty="recommendations">
          No recommendations yet. The recommendations agent reads your bid history, open retainage and estimates, and
          puts what is worth doing next here, with the records it read.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((rec) => (
            <li key={rec.id} className="rounded-2xl border border-line-card bg-surface px-3.5 py-2.5">
              <p className="break-words text-[14.5px] font-semibold leading-snug text-ink">{rec.title}</p>
              <p className="mt-1 break-words text-[13px] leading-snug text-ink-body">
                {rec.reason} <span className="whitespace-nowrap text-sm text-ink-muted">· {CONFIDENCE[rec.confidence] ?? rec.confidence}</span>
              </p>
              <Sources sources={rec.sources} />
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {rec.href && (
                  <Link href={rec.href} className="mr-auto inline-flex min-h-11 items-center text-sm font-semibold text-link hover:text-link-hover mouse:min-h-8">
                    Open →
                  </Link>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <AiRowAction id={rec.id} action={done} label="Done" />
                  <AiRowAction id={rec.id} action={dismiss} label="Dismiss" />
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ---------------------------------------------------------- watching -- */

const DAY_MS = 86_400_000;
const utcDay = (d: Date) => Math.floor(d.getTime() / DAY_MS);

export function Watching({
  summary,
  findings,
  findingCount,
  dismissFinding,
  markFindingWrong,
  now,
}: {
  summary: AiWatching;
  findings: AiFinding[];
  /** All open findings, not just the five shown. */
  findingCount: number;
  dismissFinding: RowAction;
  /** "Not right": the finding is wrong, not merely dealt with. */
  markFindingWrong: RowAction;
  now: Date;
}) {
  const runLine = [
    summary.lastRunAt ? `Last checked ${relativeTime(summary.lastRunAt, now)}` : "Not checked yet",
    // The label is "Daily at 12:23 UTC" (lib/agents/queries.ts).
    summary.nextRunLabel ? `runs ${summary.nextRunLabel.charAt(0).toLowerCase()}${summary.nextRunLabel.slice(1)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section aria-labelledby="ai-watching" data-tour="ai-watching">
      <SectionHead
        title="Watching"
        id="ai-watching"
        aside={
          <span className="text-[13px] text-ink-muted tabular-nums">
            {summary.openBids} open {summary.openBids === 1 ? "bid" : "bids"}
          </span>
        }
      />
      {summary.openBids === 0 ? (
        <p className="text-sm text-ink-body" data-empty="watching">
          No open bids to watch. Log a bid invitation and the bid watcher starts reading it.{" "}
          <Link href="/bids" className="font-semibold text-link hover:text-link-hover">
            Go to bids
          </Link>
        </p>
      ) : (
        <>
          {summary.dueThisWeek.length > 0 ? (
            <ul className="divide-y divide-line-row">
              {summary.dueThisWeek.map((bid) => {
                const soon = utcDay(bid.dueDate) - utcDay(now) <= 2;
                return (
                  <li key={bid.id}>
                    <Link href={aiBidHref(bid.id)} className="flex min-h-11 items-center gap-3 py-1.5 hover:text-ink mouse:min-h-9 mouse:py-1">
                      <span className="min-w-0 flex-1 break-words text-[14.5px] text-ink">
                        {bid.projectName}
                        {bid.gcName && <span className="text-[13px] text-ink-muted"> · {bid.gcName}</span>}
                      </span>
                      <span className={`${PILL} ${soon ? "bg-tag-amber text-tag-amber-ink" : "bg-rail-hover text-ink-label"}`}>
                        Due {formatCalendarDate(bid.dueDate, "dayMonth")}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-body">Nothing due this week.</p>
          )}
          <p className="mt-1 text-sm text-ink-muted">
            {summary.unreadAddenda > 0 && (
              <span className="text-ink-body">
                {summary.unreadAddenda} unread {summary.unreadAddenda === 1 ? "addendum" : "addenda"} ·{" "}
              </span>
            )}
            {runLine}
          </p>
        </>
      )}

      <div className="mt-3">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
          Findings
          {findingCount > 0 && (
            <span className="rounded-full bg-tag-rose px-1.5 text-[11px] leading-[1.15rem] text-tag-rose-ink tabular-nums">
              {findingCount}
            </span>
          )}
        </h3>
        {findings.length === 0 ? (
          <p className="mt-1 text-sm text-ink-body" data-empty="findings">
            Nothing flagged. When the bid watcher or the estimate check finds something, it lands here with what it read.
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-line-row">
            {findings.map((finding) => (
              <li key={finding.id} className="py-2">
                <div className="flex items-start gap-2">
                  <span className={`${PILL} ${SEVERITY[finding.severity].tone}`}>{SEVERITY[finding.severity].label}</span>
                  <p className="min-w-0 break-words text-[14px] font-semibold text-ink">{finding.title}</p>
                </div>
                <p className="mt-1 break-words text-[13px] text-ink-body">{finding.body}</p>
                <Sources sources={finding.sources} />
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  {finding.fixHref ? (
                    <Link href={finding.fixHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-link hover:text-link-hover mouse:min-h-8">
                      Fix it →
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="flex items-center gap-1">
                    <AiRowAction id={finding.id} action={dismissFinding} label="Dismiss" />
                    <AiRowAction id={finding.id} action={markFindingWrong} label="Not right" />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link href={AI_ACTIVITY_HREF} className={`${ASIDE_LINK} mt-1 font-semibold text-link hover:text-link-hover`}>
          See all activity →
        </Link>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- page -- */

export function AiHome({
  chat,
  recent,
  threadOpen,
  runs,
  recommendations,
  watching,
  findings,
  findingCount,
  actions,
  now,
}: {
  /** The Ask panel — mounted by the page, so this file never imports it. */
  chat: ReactNode;
  /** The recent-threads list. Under the chat on a fresh page, where it
   * fills what would be empty space; behind a "Recent" button once a
   * conversation is open. */
  recent: ReactNode;
  /** True when the page opened a saved conversation (`?thread=`). */
  threadOpen: boolean;
  runs: AiRun[];
  recommendations: AiRecommendation[];
  watching: AiWatching;
  findings: AiFinding[];
  findingCount: number;
  actions: {
    dismissRecommendation: RowAction;
    markRecommendationDone: RowAction;
    dismissFinding: RowAction;
    markFindingWrong: RowAction;
  };
  now: Date;
}) {
  const running = runs.filter((run) => run.status === "RUNNING").length;
  return (
    // Three grid children so a phone can put the agents strip BETWEEN the
    // header and the chat (ai-home-phone.png), while from `lg` the agents
    // column spans both rows on the right (ai-home-desktop.png).
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr] lg:gap-x-0 lg:gap-y-4">
      <header className="min-w-0 lg:col-start-1 lg:row-start-1 lg:pr-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 id="ai-title" className="mr-auto font-headline text-[26px] font-semibold leading-tight text-ink">
            AI
          </h1>
          {threadOpen && (
          <details className="group relative">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm font-semibold text-ink-muted hover:bg-rail-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-7 3.3M3 4v4h4" />
                <path d="M12 8v4l3 2" />
              </svg>
              Recent
            </summary>
            <div className="absolute right-0 z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] overscroll-contain rounded-xl border border-line-card bg-surface p-2 shadow-2xl">
              {recent}
            </div>
          </details>
          )}
          <Link
            href="/ai"
            className="inline-flex min-h-11 items-center rounded-lg border border-line-card px-4 text-sm font-semibold text-ink hover:bg-rail-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus mouse:min-h-9"
          >
            + New chat
          </Link>
        </div>
        <p className="text-pretty text-[13.5px] text-ink-muted">
          Ask about a bid, or tell C Stream what to do. Nothing is sent or changed until you confirm.
        </p>
      </header>

      <section
        aria-labelledby="ai-title"
        data-tour="ai-chat"
        className="order-last min-w-0 lg:order-none lg:col-start-1 lg:row-start-2 lg:pr-8"
      >
        {chat}
        {!threadOpen && (
          // RecentThreads brings its own "Recent" heading and empty sentence.
          <div className="mt-4" data-ai-recent="">
            {recent}
          </div>
        )}
      </section>

      <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-l lg:border-line-row lg:pl-7">
        <AiSideToggle running={running} recommendations={recommendations.length}>
          <div className="flex flex-col gap-5">
            <RunningNow runs={runs} now={now} />
            {/* Watching before Recommendations: what is due this week has to
                be on screen at 1440x900 without a scroll (Cyrus's review of
                the first screenshots, 2026-10-11). */}
            <Watching
              summary={watching}
              findings={findings}
              findingCount={findingCount}
              dismissFinding={actions.dismissFinding}
              markFindingWrong={actions.markFindingWrong}
              now={now}
            />
            <Recommendations items={recommendations} dismiss={actions.dismissRecommendation} done={actions.markRecommendationDone} />
          </div>
        </AiSideToggle>
      </div>
    </div>
  );
}
