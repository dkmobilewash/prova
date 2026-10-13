"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { selectedStageKey, type JobStage } from "@/components/job/jobStages";

/**
 * The five stage steps — the job's progress bar. Each step links to its
 * stage's first page; getting around the job is the tab row directly under
 * this (`JobSectionNav`). The open stage's pages used to sit here as a
 * second row of links, which duplicated the tab row once it came back
 * (restore brief, 2026-10-12), so it went.
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
 * and the one in view is scrolled to on arrival. Each pill still carries
 * its status line — it used to be `hidden sm:block` with the words only in
 * a `title`, which a finger never sees. A pill may cut a long status short
 * (every word stays in its text and title), so the stage in view also says
 * its status in full under the row. The sideways row fades at the
 * right edge, so a step past the edge reads as "more this way".
 *
 * Desktop: a status WRAPS, never truncates — "Pay app #2 overdue 8 d…" hid
 * the one word that mattered (2026-10-11). The grid stretches every step to
 * the tallest one (`sm:h-full`), so the five stay one height.
 */

/** The right-edge fade on a sideways-scrolling row, phones only. The rows
 * pad 24px on the right, so at the end of the scroll the fade covers only
 * that padding and the last item is fully visible. */
export const EDGE_FADE = "max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)]";

function statusTone(stage: JobStage): string {
  return stage.tone === "danger"
    ? "text-danger"
    : stage.tone === "warn"
      ? "text-tag-amber-ink"
      : stage.state === "current"
        ? "text-ink-body"
        : "text-ink-muted";
}

export function JobStageNav({ stages }: { stages: JobStage[] }) {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const selected = selectedStageKey(stages, pathname, search);
  const scroller = useRef<HTMLOListElement>(null);
  const focusKey = selected ?? stages.find((s) => s.state === "current")?.key;

  useEffect(() => {
    const list = scroller.current;
    const item = list?.querySelector<HTMLElement>(`[data-stage="${focusKey}"]`);
    if (!list || !item || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft = item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2;
  }, [focusKey]);

  // Phone: a pill may cut its status short, so the stage in view says it in
  // full under the row. aria-hidden: the pill's own text (and title) already
  // gives a screen reader every word, and this would say it twice.
  const inView = stages.find((s) => s.key === focusKey);

  return (
    <nav aria-label="Job stages" className="mb-5 print:hidden">
      <ol
        ref={scroller}
        className={`${EDGE_FADE} -mx-6 flex gap-2 overflow-x-auto px-6 pb-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-2.5 sm:overflow-visible sm:px-0 sm:pb-0`}
      >
        {stages.map((stage, i) => {
          const isOpen = stage.key === selected;
          const body = (
            <>
              <span
                aria-hidden="true"
                className={`grid size-[26px] shrink-0 place-items-center rounded-full border text-[13px] font-semibold sm:size-7 sm:text-sm ${
                  stage.state === "current"
                    ? "border-brand bg-brand text-neutral-900"
                    : stage.state === "done"
                      ? "border-rail-hover bg-rail-hover text-ok"
                      : stage.state === "attention"
                        ? "border-tag-amber bg-tag-amber text-tag-amber-ink"
                        : "border-line-card text-ink-muted"
                }`}
              >
                {stage.state === "done" ? "✓" : stage.state === "attention" ? "!" : i + 1}
              </span>
              <span className="min-w-0">
                <span
                  className={`block font-headline text-lg leading-none sm:text-xl ${
                    stage.state === "upcoming" ? "text-ink-muted" : stage.state === "done" ? "text-ink-body" : "text-ink"
                  }`}
                >
                  {stage.label}
                </span>
                {stage.status && (
                  <span
                    className={`mt-[3px] block text-xs max-sm:max-w-[12rem] max-sm:truncate sm:text-balance sm:text-[13px] sm:leading-snug ${statusTone(stage)}`}
                  >
                    {stage.status}
                  </span>
                )}
              </span>
              <span className="sr-only">
                {stage.state === "done"
                  ? " (done)"
                  : stage.state === "attention"
                    ? " (needs attention)"
                    : stage.state === "current"
                      ? " (current stage)"
                      : ""}
              </span>
            </>
          );
          const box = `flex min-h-[44px] items-center sm:h-full gap-2.5 border bg-surface sm:gap-3 sm:rounded-xl sm:px-4 sm:py-2.5 rounded-[22px] py-1.5 pl-1.5 pr-4 ${
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
      {inView?.status && (
        <p aria-hidden="true" data-stage-open-status className="mt-2 text-sm sm:hidden">
          <span className="font-semibold text-ink">{inView.label}:</span>{" "}
          <span className={statusTone(inView)}>{inView.status}</span>
        </p>
      )}

    </nav>
  );
}
