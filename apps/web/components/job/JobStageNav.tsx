"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { selectedStageKey, type JobStage } from "@/components/job/jobStages";

/**
 * The five stage steps and, under them, the open stage's own pages.
 *
 * Every step and sub-link is a real `<Link>` to a real URL — the reason the
 * job page was split into routes (`JobSectionNav`'s history): linkable,
 * back/forward work, a refresh re-renders from the database. The stage
 * mapping is `jobStages()`; this only draws it.
 *
 * Two different highlights, on purpose: the yellow-filled NUMBER is where
 * the job is (its current stage); the yellow OUTLINE is which stage you are
 * looking at. On most visits they are the same step.
 *
 * Phone: the steps become a row of compact pills that scrolls sideways,
 * and the one in view is scrolled to on arrival.
 */
export function JobStageNav({ stages }: { stages: JobStage[] }) {
  const pathname = usePathname();
  const selected = selectedStageKey(stages, pathname);
  const scroller = useRef<HTMLOListElement>(null);
  const focusKey = selected ?? stages.find((s) => s.state === "current")?.key;

  useEffect(() => {
    const list = scroller.current;
    const item = list?.querySelector<HTMLElement>(`[data-stage="${focusKey}"]`);
    if (!list || !item || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft = item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2;
  }, [focusKey]);

  const open = stages.find((s) => s.key === selected);

  return (
    <nav aria-label="Job stages" className="mb-7 print:hidden">
      <ol
        ref={scroller}
        className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-2.5 sm:overflow-visible sm:px-0 sm:pb-0"
      >
        {stages.map((stage, i) => {
          const isOpen = stage.key === selected;
          const body = (
            <>
              <span
                aria-hidden="true"
                className={`grid size-[26px] shrink-0 place-items-center rounded-full border text-[13px] font-semibold sm:size-[30px] sm:text-sm ${
                  stage.state === "current"
                    ? "border-brand bg-brand text-neutral-900"
                    : stage.state === "done"
                      ? "border-rail-hover bg-rail-hover text-ok"
                      : "border-line-card text-ink-muted"
                }`}
              >
                {stage.state === "done" ? "✓" : i + 1}
              </span>
              <span className="min-w-0">
                <span
                  className={`block font-headline text-lg leading-none sm:text-[22px] ${
                    stage.state === "upcoming" ? "text-ink-muted" : stage.state === "done" ? "text-ink-body" : "text-ink"
                  }`}
                >
                  {stage.label}
                </span>
                {stage.status && (
                  <span
                    className={`mt-[3px] hidden truncate text-[13px] sm:block ${
                      stage.state === "current" ? "text-ink-body" : "text-ink-muted"
                    }`}
                  >
                    {stage.status}
                  </span>
                )}
              </span>
              <span className="sr-only">
                {stage.state === "done" ? " (done)" : stage.state === "current" ? " (current stage)" : ""}
              </span>
            </>
          );
          const box = `flex min-h-[44px] items-center gap-2.5 border bg-surface sm:gap-3.5 sm:rounded-xl sm:px-[18px] sm:py-3.5 rounded-full py-1.5 pl-1.5 pr-4 ${
            isOpen ? "border-focus ring-1 ring-inset ring-focus" : "border-line-card"
          }`;
          return (
            <li key={stage.key} data-stage={stage.key} className="relative shrink-0 sm:min-w-0">
              {stage.links.length > 0 ? (
                <Link
                  href={stage.links[0].href}
                  aria-current={isOpen ? "true" : undefined}
                  title={stage.status ?? undefined}
                  className={`${box} hover:border-ink-muted`}
                >
                  {body}
                </Link>
              ) : (
                <div className={`${box} cursor-default`} title={stage.status ?? undefined}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {open && open.links.length > 0 && (
        <ul
          aria-label={`${open.label} pages`}
          className="-mx-6 mt-4 flex gap-1 overflow-x-auto border-b border-line-card px-6 sm:mx-0 sm:px-0"
        >
          {open.links.map((link) => {
            const isActive = pathname === link.href;
            return (
              <li key={link.href} className="shrink-0">
                <Link
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`inline-flex min-h-[40px] items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium ${
                    isActive
                      ? "border-brand text-ink"
                      : "border-transparent text-ink-muted hover:border-line-card hover:text-ink-label"
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
