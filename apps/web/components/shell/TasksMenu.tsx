"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import type { TaskList, TaskRow } from "@/lib/agents/tasks";
import { RunStatusPill, RunWayOut, taskWhen } from "@/components/ai/RunStatusPill";
import { Spinner } from "@/components/Spinner";

/**
 * The top bar's Tasks item (the owner's ask, 2026-10-11: "a section so that
 * they can see the current tasks that are running"). A spinner and "2
 * running" while agent runs are going, a quiet "Tasks" otherwise; it opens a
 * list of what is running and the last few that finished, each linking to
 * the bid's AI workspace or to the timeline.
 *
 * Drawn only for MANAGE_ESTIMATING (the layout passes no list otherwise),
 * the same gate as the AI word. On a phone the quiet "Tasks" is hidden —
 * the top bar has room for one more icon, not a word — and the spinner
 * shows only while something runs; the same runs are on /ai's agents strip.
 *
 * REFRESH. The layout's list goes stale on client-side navigation (Next keeps
 * the shared layout), so while the list is open or a run is going it asks
 * GET /api/agents/tasks every 30s, skips while the tab is hidden, asks once
 * when the tab comes back, and stops the moment nothing is running and the
 * list is closed. Nothing polls on a quiet company.
 */

export const TASKS_REFRESH_MS = 30_000;

/** Esc, a click outside, or focus leaving `holder` closes it; Esc also hands
 * focus back to `button`. Shared with the avatar menu so the two behave the
 * same. */
export function useMenuDismiss(
  open: boolean,
  close: () => void,
  holder: RefObject<HTMLElement | null>,
  button: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      button.current?.focus();
    };
    const outside = (e: Event) => {
      if (holder.current && !holder.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, close, holder, button]);
}

function Row({ row, now }: { row: TaskRow; now: Date }) {
  return (
    <li>
      <Link href={row.href} className="block rounded-lg px-3 py-2 hover:bg-rail-hover focus-visible:bg-rail-hover">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 break-words text-sm font-medium text-ink">
            {row.agent}
            {row.subject && <span className="font-normal text-ink-body"> · {row.subject}</span>}
          </span>
          <RunStatusPill status={row.status} />
        </span>
        <span className="mt-0.5 block break-words text-[13px] leading-snug text-ink-body">
          {row.detail && <>{row.detail} · </>}
          <span className="whitespace-nowrap text-ink-muted">{taskWhen(row, now)}</span>
        </span>
      </Link>
      <div className="px-3 empty:hidden">
        <RunWayOut status={row.status} note={row.detail} agent={row.kind} bidInvitationId={row.bidInvitationId} />
      </div>
    </li>
  );
}

const HEAD = "px-3 pb-1 pt-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted";
const FOOT = "inline-flex min-h-11 items-center px-3 text-sm font-semibold text-link hover:text-link-hover hover:underline mouse:min-h-9";

export function TasksMenu({
  tasks: initial,
  open,
  onOpenChange,
}: {
  tasks: TaskList;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tasks, setTasks] = useState(initial);
  // A fresh layout render (a Server Action revalidated it) brings newer rows.
  useEffect(() => setTasks(initial), [initial]);
  const running = tasks.running.length;
  const busy = running > 0;

  const holder = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useMenuDismiss(open, close, holder, button);

  // Focus moves into the list when it opens, like the avatar menu.
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("a[href]")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open && !busy) return;
    let live = true;
    const refresh = () => {
      if (document.hidden) return;
      fetch("/api/agents/tasks", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<TaskList>) : null))
        .then((fresh) => {
          if (live && fresh) setTasks(fresh);
        })
        // A failed refresh keeps the list it had; the next tick tries again.
        .catch(() => undefined);
    };
    if (open) refresh();
    const timer = setInterval(refresh, TASKS_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [open, busy]);

  const now = new Date();
  return (
    <div ref={holder} className={`relative ${busy ? "" : "max-md:hidden"}`}>
      <button
        ref={button}
        type="button"
        data-tasks-button=""
        aria-expanded={open}
        aria-controls="tasks-panel"
        aria-label={busy ? `AI tasks, ${running} running` : "AI tasks"}
        onClick={() => onOpenChange(!open)}
        className={`flex h-11 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm hover:bg-rail-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
          busy ? "font-semibold text-ink" : "text-ink-muted"
        }`}
      >
        {busy && <Spinner className="h-4 w-4 text-brand" />}
        {/* A phone's top bar has room for the spinner and the number, not
            the word (measured: "2 running" pushed the avatar 26px off a
            360px screen). The label says it in full. */}
        {busy ? (
          <>
            {running}
            <span className="max-sm:hidden"> running</span>
          </>
        ) : (
          "AI tasks"
        )}
      </button>

      {open && (
        <div
          ref={panel}
          id="tasks-panel"
          role="region"
          aria-label="AI tasks"
          className="fixed inset-x-2 top-14 z-50 max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain rounded-xl border border-line-card bg-surface p-2 shadow-2xl md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-2 md:w-[26rem]"
        >
          <h2 className={HEAD}>Running now</h2>
          {busy ? (
            <ul>
              {tasks.running.map((row) => (
                <Row key={row.id} row={row} now={now} />
              ))}
            </ul>
          ) : (
            <p className="px-3 pb-1 text-sm text-ink-body">Nothing running.</p>
          )}
          <h2 className={`${HEAD} mt-1 border-t border-line-row`}>Finished</h2>
          {tasks.recent.length > 0 ? (
            <ul>
              {tasks.recent.map((row) => (
                <Row key={row.id} row={row} now={now} />
              ))}
            </ul>
          ) : (
            <p className="px-3 pb-1 text-sm text-ink-body">
              No runs yet. Agents run on their schedule, when a bid is logged, or when you press Run now on AI.
            </p>
          )}
          <div className="mt-1 flex flex-wrap justify-between border-t border-line-row pt-1">
            <Link href="/ai" className={FOOT}>
              Open AI &rarr;
            </Link>
            <Link href="/ai/activity" className={FOOT}>
              All activity &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
