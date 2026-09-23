"use client";

import Link from "next/link";
import { useState } from "react";
import { JobMediaCard, type JobMediaCardData } from "@/components/JobMediaCard";
import {
  bulkReportTarget,
  pruneSelected,
  selectEveryVisible,
  toggleSelected,
} from "@/components/jobMediaSelection";
import { photoReportHref } from "@/lib/photo-report";

/**
 * The grid of capture cards, and the one thing you can do to several of
 * them at once.
 *
 * WHY THIS COMPONENT EXISTS AT ALL. Both galleries used to map straight
 * from a server component to `<JobMediaCard>`, which is why there was no
 * way to pick more than one: a selection is state, state needs a client
 * component, and there was nowhere for it to live that both `/photos` and
 * the job page's section shared. Putting it in the card would give each
 * card its own private idea of what is picked; putting it in each page
 * would be the same logic written twice, which is how the two galleries
 * would start disagreeing. One wrapper, both pages, and the ordering,
 * pruning and cross-job rules are in a plain module a test can call
 * (components/jobMediaSelection.ts).
 *
 * THE BULK ACTION IS THE PHOTO REPORT, AND IT IS NOT SHARING — a decision
 * argued in full in the changelog entry, and worth the two sentences here
 * because the other reading is the obvious one. The customer's words were
 * "pick these three photos and… export", and this app's export for photos
 * already exists and is good: `/jobs/[id]/photo-report` is a printable
 * document with the marks drawn on the photographs. What it could not do
 * was "these three" — it took a RULE (everything the portal link shows, or
 * everything, or neither) and never a list. So the missing half was the
 * picking, which is exactly what the tick boxes supply.
 *
 * The thing deliberately NOT built is bulk sharing. Sharing is the one
 * irreversible act in this feature — the card's confirm step says "you
 * cannot un-show it" and means it — and its confirmation is per photo
 * because the decision is per photo: this one shows a GC their own delay,
 * that one shows them the crew's mistake. A bulk share that kept that
 * confirmation honest would have to put every capture's caption, marks and
 * playback warning in front of the person one at a time, which is the card
 * they just came from; a bulk share that did not would be the single worst
 * change this feature could take. Reversible bulk action first.
 */
export function JobMediaGallery({ media }: { media: JobMediaCardData[] }) {
  /* The ids, never the rows. A gallery re-renders on every share, caption
     edit and revalidate, handing this component a fresh array of freshly
     projected objects — a selection holding rows would be holding copies
     of records that have since changed. */
  const [picked, setPicked] = useState<string[]>([]);

  /* PRUNED ON EVERY RENDER, and this is the line that makes the count on
     the bar mean something. The list under a selection moves: a photo is
     deleted, a filter chip narrows the page, the cap drops the oldest off
     the end. `picked` may still name captures that are no longer here, and
     nothing below is allowed to see them — so the page's own state is the
     raw list and everything downstream, including every handler, works
     from this one. Derived at read time rather than stored, which is this
     schema's standing rule arriving in a component. */
  const selected = pruneSelected(picked, media);
  const ticked = new Set(selected);
  const target = bulkReportTarget(selected, media);

  const btn =
    "min-h-11 inline-flex items-center rounded-md border border-line-card px-3 text-sm text-ink-label hover:bg-neutral-800";

  return (
    <>
      {/* ONLY WHEN SOMETHING IS PICKED. An empty bar on every gallery would
          be a permanent strip of chrome explaining a feature nobody had
          asked for yet; the tick boxes on the cards are the affordance, and
          this is the consequence of using one.

          STICKY, because the situation this feature is for is picking three
          photographs out of sixty — which is four screens of scrolling, and
          a bar at the top of the page would mean scrolling back to it. The
          background is opaque for the reason the sidebar's sticky headings
          are (see Sidebar.tsx): a transparent sticky element has the
          photographs of the row behind it running through the text. */}
      {selected.length > 0 && (
        <div className="sticky top-0 z-20 mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line-card bg-canvas p-3">
          <p className="text-sm font-medium text-ink-label">
            {selected.length === 1 ? "1 capture picked" : `${selected.length} captures picked`}
          </p>

          {target.kind === "one-job" ? (
            <Link
              href={photoReportHref(target.jobId, { ids: target.ids })}
              className="min-h-11 inline-flex items-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
            >
              Photo report of these {target.ids.length}
            </Link>
          ) : target.kind === "many-jobs" ? (
            /* NOT A DISABLED BUTTON AND NOT AN ERROR. Picking captures
               across two jobs on the company-wide gallery is a reasonable
               thing to have done; it just cannot become a report, because a
               report is one job's document and its printed header carries
               that job and its contact. Saying which jobs are in the way,
               and where the fix is, is the whole of the remedy — the job
               chips are directly above this bar on `/photos`. */
            <p className="text-sm text-amber-400">
              A photo report is one job&apos;s document, and these {target.ids.length} are on{" "}
              {target.jobIds.length} jobs. Pick a job above first.
            </p>
          ) : null}

          {/* "All of them" means all of them ON THIS PAGE, and the number
              says so rather than leaving it to be assumed. Both galleries
              are capped (12 on a job page, 60 on `/photos`), so a control
              that reached past what is rendered would tick captures nobody
              can see to untick. */}
          {selected.length < media.length && (
            <button
              type="button"
              onClick={() => setPicked(selectEveryVisible(media))}
              className={btn}
            >
              Pick all {media.length}
            </button>
          )}
          <button type="button" onClick={() => setPicked([])} className={btn}>
            Clear
          </button>
        </div>
      )}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {media.map((item) => (
          <JobMediaCard
            key={item.id}
            media={item}
            select={{
              selected: ticked.has(item.id),
              // `selected` rather than `picked`: the handler starts from the
              // pruned value, so a toggle is also the moment anything stale
              // finally leaves the state for good.
              onToggle: () => setPicked(toggleSelected(selected, item.id)),
            }}
          />
        ))}
      </ul>
    </>
  );
}
