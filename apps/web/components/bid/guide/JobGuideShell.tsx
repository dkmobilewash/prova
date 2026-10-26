import type { ReactNode } from "react";
import { JobGuideAsk } from "@/components/bid/guide/JobGuideAsk";
import { JobGuideAskBox } from "@/components/bid/guide/JobGuideAskBox";
import { JobGuideRail } from "@/components/bid/guide/JobGuideRail";
import type { JobGuide } from "@/lib/bid/guide/types";

/**
 * A job's screen, composed: the rail on the left (a step strip on top on a
 * phone), and in the main column the AI headline, the ask card, the job's own
 * working area for the current step (`children` — the takeoff, estimate, recap
 * or proposal page), and the disabled "Ask or tell me anything" box.
 *
 * `tabs` is the compact secondary row the layout passes in (Takeoff · Estimate ·
 * Bid recap · Proposal). The rail leads, but "Bid recap" has no step of its own
 * (the price step opens the estimate), so the tabs stay reachable rather than
 * leaving a screen with no way in.
 *
 * NOTHING HERE PRINTS except `children`: the proposal tab is the printable
 * document, and a GC's copy with a rail, a card and a chat box on it would be
 * the bug. Every piece of chrome is `print:hidden`, and the grid collapses to a
 * plain block on paper so the page is not squeezed into the main column.
 *
 * Presentational — it takes the `JobGuide` and decides nothing.
 */
export function JobGuideShell({ guide, tabs, children }: { guide: JobGuide; tabs: ReactNode; children: ReactNode }) {
  return (
    <div
      className="mx-auto max-w-7xl px-4 pb-8 pt-2 sm:px-6 lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-8 print:block print:max-w-none print:p-0"
      data-guide="shell"
    >
      <JobGuideRail guide={guide} />
      <div className="mt-4 min-w-0 lg:mt-0 print:mt-0" data-guide="main">
        <div className="mb-4 flex items-start gap-3 print:hidden" data-guide="headline">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand text-xs font-bold text-neutral-900"
          >
            AI
          </span>
          <h2 className="break-words font-headline text-xl font-semibold text-ink sm:text-2xl">{guide.headline}</h2>
        </div>
        <div className="mb-4">
          <JobGuideAsk guide={guide} />
        </div>
        <div className="print:hidden">{tabs}</div>
        <div className="-mx-4 min-w-0 sm:-mx-6 lg:mx-0 print:mx-0">{children}</div>
        <div className="mt-6">
          <JobGuideAskBox jobName={guide.name} />
        </div>
      </div>
    </div>
  );
}
