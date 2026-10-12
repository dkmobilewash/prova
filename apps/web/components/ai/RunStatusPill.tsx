import Link from "next/link";
import type { AgentKind } from "@prova/db";
import type { TaskRow, TaskStatus } from "@/lib/agents/tasks";
import { RunAgentButton } from "@/components/RunAgentButton";
import { relativeTime } from "@/lib/integrations/relativeTime";
import { Spinner } from "@/components/Spinner";

/**
 * A run's status as a pill — on /ai's Running now, the top bar's Tasks list
 * and the home page's Running now card. Its own module, with no query
 * imports, because the Tasks list is a client component and AiParts.tsx
 * reaches lib/agents/core (Prisma).
 */

export const RUN_PILL =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-semibold";

const STATUS: Record<TaskStatus, { label: string; tone: string }> = {
  RUNNING: { label: "Running", tone: "bg-tag-brand-soft text-tag-brand-soft-ink" },
  DONE: { label: "Done", tone: "bg-tag-green text-tag-green-ink" },
  FAILED: { label: "Failed", tone: "bg-tag-rose text-tag-rose-ink" },
  // The cap is the owner's own number on /ai/activity; the pill says
  // why nothing ran rather than leaving a gap in the list.
  PAUSED_CAP: { label: "Paused: cap reached", tone: "bg-tag-amber text-tag-amber-ink" },
  SKIPPED: { label: "Skipped", tone: "border border-line-card bg-tag-slate text-tag-slate-ink" },
  // Still RUNNING on the row long after anything could still be running it
  // (lib/agents/tasks.ts, STALLED_AFTER_MS). No spinner: nothing is.
  STALLED: { label: "Stopped responding", tone: "bg-tag-rose text-tag-rose-ink" },
};

/** "started 2 minutes ago", "finished 1 hour ago", "ended 3 hours ago". */
export function taskWhen(row: Pick<TaskRow, "status" | "startedAt" | "finishedAt">, now: Date): string {
  if (row.status === "RUNNING") return `started ${relativeTime(new Date(row.startedAt), now)}`;
  return `${row.status === "DONE" ? "finished" : "ended"} ${relativeTime(new Date(row.finishedAt ?? row.startedAt), now)}`;
}

export function RunStatusPill({ status }: { status: TaskStatus }) {
  const { label, tone } = STATUS[status];
  return (
    <span className={`${RUN_PILL} ${tone}`} data-run-status={status}>
      {status === "RUNNING" && <Spinner className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

/**
 * The way out of a run that did not finish (UX review F6) — a status pill
 * alone was a dead end. A failed or stalled run can be run again (the same
 * RunAgentButton and runAgentNow as Run now, MANAGE_ESTIMATING-gated inside
 * the action); a run paused on the spend cap links to the cap; one skipped
 * because a switch is off links to that switch. Null when there is nothing
 * to do. Rendered BESIDE a row's link, never inside it (no nested controls).
 */
export function runWayOut(status: TaskStatus, note: string | null): { href: string; label: string } | "rerun" | null {
  if (status === "FAILED" || status === "STALLED") return "rerun";
  if (status === "PAUSED_CAP") return { href: "/ai/activity#cap", label: "See the spend cap" };
  if (status !== "SKIPPED") return null;
  // The company-wide switch's refusal names Settings → Assistant
  // (lib/ai/features.ts); the per-agent switch's says "switched off for this
  // company" (lib/agents/core.ts). Anything else (settings unreadable) says
  // to try again.
  if (note?.includes("Settings → Assistant")) return { href: "/settings/assistant#ai-switch", label: "See the AI switch" };
  if (note?.includes("switched off")) return { href: "/ai/activity#agent-switches", label: "See the agent switches" };
  return "rerun";
}

export function RunWayOut({
  status,
  note,
  agent,
  bidInvitationId,
}: {
  status: TaskStatus;
  note: string | null;
  agent: AgentKind;
  bidInvitationId: string | null;
}) {
  const way = runWayOut(status, note);
  if (!way) return null;
  if (way === "rerun") return <RunAgentButton agent={agent} bidInvitationId={bidInvitationId} label="Run again" />;
  return (
    <Link
      href={way.href}
      className="inline-flex min-h-11 items-center text-sm font-semibold text-link hover:text-link-hover hover:underline mouse:min-h-8"
    >
      {way.label} &rarr;
    </Link>
  );
}
