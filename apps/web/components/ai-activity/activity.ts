import type { Severity } from "@/components/ai-bid/types";

/** One line on the timeline, whichever feed it came from. */
export type ActivityItem = {
  id: string;
  at: Date;
  /** The agent kind, or RECOMMENDATIONS for recommendation/outcome rows. */
  agent: string;
  title: string;
  detail: string | null;
  href: string | null;
  severity?: Severity | null;
  /** Set on a finding somebody dismissed — the row offers Restore. */
  dismissedFindingId?: string | null;
  /** That dismissal was "Not right" (WRONG), not plain Dismiss. */
  markedWrong?: boolean;
};

type AgentFeedRow = { id: string; at: Date; kind: string; agent: string; title: string; detail: string | null; href: string | null; severity?: Severity | null };
type RecommendationFeedRow = { id: string; at: Date; kind: string; title: string; detail: string | null; href: string | null };

/** Both feeds, newest first. Ids are prefixed by feed so a run and a
 * recommendation that happen to share an id cannot collide as React keys. */
export function mergeActivity(
  agentRows: AgentFeedRow[],
  recommendationRows: RecommendationFeedRow[],
  dismissedFindingIds: ReadonlySet<string> = new Set(),
  wrongFindingIds: ReadonlySet<string> = new Set(),
): ActivityItem[] {
  return [
    ...agentRows.map((r) => ({
      id: `a-${r.kind}-${r.id}`,
      at: r.at,
      agent: r.agent,
      title: r.title,
      detail: r.detail,
      href: r.href,
      severity: r.severity ?? null,
      dismissedFindingId: r.kind === "finding" && dismissedFindingIds.has(r.id) ? r.id : null,
      markedWrong: r.kind === "finding" && wrongFindingIds.has(r.id),
    })),
    ...recommendationRows.map((r) => ({ id: `r-${r.kind}-${r.id}`, at: r.at, agent: "RECOMMENDATIONS", title: r.title, detail: r.detail, href: r.href, severity: null })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** The reader's calendar day for a moment, as YYYY-MM-DD. */
export function dayKey(at: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone }).format(at);
}

export type ActivityDay = { key: string; label: string; items: ActivityItem[] };

/** Groups newest-first items by the reader's day. `today` is the reader's
 * YYYY-MM-DD (lib/viewerToday), so "Today" is their today, not the server's. */
export function groupByDay(items: ActivityItem[], zone: string, today: string): ActivityDay[] {
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);
  const days: ActivityDay[] = [];
  for (const item of items) {
    const key = dayKey(item.at, zone);
    let day = days.at(-1);
    if (!day || day.key !== key) {
      const date = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
        new Date(`${key}T00:00:00Z`),
      );
      const prefix = key === today ? "Today · " : key === yesterdayKey ? "Yesterday · " : "";
      day = { key, label: `${prefix}${date}`, items: [] };
      days.push(day);
    }
    day.items.push(item);
  }
  return days;
}
