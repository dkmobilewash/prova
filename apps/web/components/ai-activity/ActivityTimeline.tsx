import Link from "next/link";
import { SeverityDot } from "@/components/ai-bid/parts";
import { RestoreFindingButton } from "@/components/ai-activity/RestoreFindingButton";
import { Disclosure } from "@/components/Disclosure";
import { groupConsecutive, type ActivityDay, type ActivityItem } from "@/components/ai-activity/activity";

/** The filter chips, in the order the agents run in a morning. */
export const AGENT_FILTERS = [
  { key: "BID_WATCHER", label: "Bid watcher" },
  { key: "BID_RESEARCH", label: "Research" },
  { key: "ESTIMATE_CHECK", label: "Estimate check" },
  { key: "RECOMMENDATIONS", label: "Recommendations" },
] as const;

export function agentFilterFrom(raw: string | string[] | undefined): string | null {
  return AGENT_FILTERS.find((f) => f.key === raw)?.key ?? null;
}

const shortLabel = (agent: string) => AGENT_FILTERS.find((f) => f.key === agent)?.label ?? agent;

const CHIP =
  "inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

/**
 * What the agents did, newest first, grouped by the reader's day. Filters
 * are links (`?agent=`), so a filtered view is a URL somebody can send.
 */
export function ActivityTimeline({ days, agent, zone }: { days: ActivityDay[]; agent: string | null; zone: string }) {
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
  return (
    <section className="min-w-0 rounded-2xl border border-line-card bg-surface px-5 pb-5 pt-4" aria-labelledby="ai-activity-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ai-activity-heading" className="font-headline text-2xl text-ink">
          Activity
        </h2>
        <nav aria-label="Filter by agent">
          <ul className="flex flex-wrap gap-1.5">
            {[{ key: null, label: "All" }, ...AGENT_FILTERS].map((f) => {
              const on = f.key === agent;
              return (
                <li key={f.label}>
                  <Link
                    href={f.key ? `?agent=${f.key}` : "?"}
                    aria-current={on ? "page" : undefined}
                    className={`${CHIP} ${on ? "border-ink-muted bg-rail-hover text-ink" : "border-line-card text-ink-muted hover:text-ink"}`}
                  >
                    {f.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {days.length === 0 ? (
        <div className="mt-4 flex flex-col gap-2" data-empty="activity">
          <p className="text-ink-body">
            {agent
              ? `Nothing from ${shortLabel(agent).toLowerCase()} yet.`
              : "Nothing yet. The bid watcher runs every morning; research and the estimate check run when you start them on a bid."}
          </p>
          {agent ? (
            <Link href="?" className="text-sm font-semibold text-link hover:text-link-hover">
              Show every agent
            </Link>
          ) : (
            <Link href="/bids" className="text-sm font-semibold text-link hover:text-link-hover">
              Open your bids →
            </Link>
          )}
        </div>
      ) : (
        days.map((day) => (
          <section key={day.key} className="mt-5" aria-label={day.label}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{day.label}</h3>
            <ol className="mt-2">
              {groupConsecutive(day.items).map((entry) =>
                "items" in entry ? (
                  <li key={entry.id} className="border-t border-line-row first:border-t-0" data-activity-group>
                    <Disclosure
                      variant="row"
                      name="activity-group"
                      summary={
                        <>
                          <span className="w-[4.5rem] shrink-0 text-sm tabular-nums text-ink-muted">
                            <time dateTime={entry.items[0].at.toISOString()}>{time.format(entry.items[0].at)}</time>
                          </span>
                          <SeverityDot severity={entry.items[0].severity} />
                          <span className="min-w-0 flex-1">
                            <span className="font-semibold text-ink">{entry.label}</span>{" "}
                            <span className="whitespace-nowrap text-sm text-ink-muted">{shortLabel(entry.items[0].agent)}</span>
                          </span>
                        </>
                      }
                    >
                      <ol>{entry.items.map(row)}</ol>
                    </Disclosure>
                  </li>
                ) : (
                  row(entry)
                ),
              )}
            </ol>
          </section>
        ))
      )}
    </section>
  );

  function row(item: ActivityItem) {
    const body = (
      <>
        <span className="w-[4.5rem] shrink-0 pt-px text-sm tabular-nums text-ink-muted">
          <time dateTime={item.at.toISOString()}>{time.format(item.at)}</time>
        </span>
        <SeverityDot severity={item.severity} />
        <span className="min-w-0 flex-1">
          <span className={`font-semibold ${item.dismissedFindingId ? "text-ink-muted line-through" : "text-ink"}`}>{item.title}</span>{" "}
          <span className="whitespace-nowrap text-sm text-ink-muted">{shortLabel(item.agent)}</span>
          {item.dismissedFindingId && <span className="ml-2 rounded-full bg-rail-hover px-2 py-0.5 text-xs font-semibold text-ink-body">{item.markedWrong ? "Marked not right" : "Dismissed"}</span>}
          {item.detail && <span className="mt-0.5 block break-words text-sm text-ink-body">{item.detail}</span>}
        </span>
      </>
    );
    return (
      <li key={item.id} className="border-t border-line-row first:border-t-0">
        {item.href ? (
          <Link href={item.href} className="-mx-2 flex gap-3 rounded-lg px-2 py-2.5 hover:bg-rail-hover">
            {body}
          </Link>
        ) : (
          <div className="flex gap-3 py-2.5">{body}</div>
        )}
        {item.dismissedFindingId && (
          <div className="pb-2.5 pl-[6.25rem]">
            <RestoreFindingButton findingId={item.dismissedFindingId} />
          </div>
        )}
      </li>
    );
  }
}
