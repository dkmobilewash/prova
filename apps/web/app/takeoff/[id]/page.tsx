import Link from "next/link";
import { labellingAllowed } from "@/lib/plan-ingest/labelStore";
import { finderVersion } from "@/lib/takeoff/finderVersion";

import { requireCapability } from "@/lib/authz";
import { requireJobGivenContext } from "@/lib/jobs/job-access";
import { NoAccess } from "@/components/NoAccess";
import { TakeoffWorkspace } from "@/components/TakeoffWorkspace";
import { loadTakeoffWorkspace, takeoffSavedSignature, workspaceForClient } from "@/lib/takeoff/workspaceLoad";
import { loadReviewQueue } from "@/lib/takeoff/reviewQueueQuery";
import { loadSpecSaysByCode } from "@/lib/specs/specBookQuery";
import { planSetFromLoaded } from "@/lib/takeoff/planSet";

/**
 * ── THE FULL-SCREEN TAKEOFF WORKSPACE ──
 *
 * OUTSIDE the `(app)` route group, and that is the whole reason this route
 * exists at its own path rather than as another job tab. `(app)/layout.tsx`
 * renders the sidebar, the top bar, the bottom tabs and the command palette;
 * a job tab cannot opt out of its own group's layout, so a takeoff inside one
 * can never have the viewport. A subcontractor reviewing a takeoff wants every
 * pixel the screen has.
 *
 * It authenticates itself, exactly as `(app)/layout.tsx` does for the pages
 * inside it — `requireCapability` and then `requireJobGivenContext`, so a job
 * id in somebody else's company is a 404 and not a drawing. `/takeoff(.*)` is
 * in `middleware.ts`'s protected list beside `/jobs(.*)`.
 *
 * THE DATA IS THE TAKEOFF TAB'S OWN, loaded by `loadTakeoffWorkspace`, which
 * both pages call. There is no second query here and no second idea of what
 * has been measured: going back to the estimate shows what was just done
 * because it is the same rows, not because anything synchronises.
 */
export default async function TakeoffWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; key?: string; open?: string }>;
}) {
  const { id } = await params;
  const { page, key, open } = await searchParams;
  const { context, allowed } = await requireCapability("VIEW_JOB_COSTS");
  if (!allowed) return <NoAccess capability="VIEW_JOB_COSTS" />;
  const { company, job } = await requireJobGivenContext(id, context);

  const data = await loadTakeoffWorkspace(company, job);
  const savedAt = await takeoffSavedSignature(company.id, job.id);
  const queue = await loadReviewQueue(company.id, job.id);
  const specSays = await loadSpecSaysByCode(job.id, company.id);

  if (data === null) {
    // No drawing on this job. The tab offers an uploader because that is where
    // a job is set up; this page is for reviewing one, so it sends you there
    // rather than growing a second upload surface.
    return (
      <main className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-canvas p-6 text-center">
        <h1 className="text-sm font-semibold text-ink-label">No drawing on this job yet</h1>
        <p className="max-w-prose text-sm text-ink-body">
          The takeoff workspace opens a plan set that has already been uploaded. Upload one on the job&rsquo;s takeoff
          tab first.
        </p>
        <Link
          href={`/jobs/${job.id}/takeoff`}
          className="rounded-md border border-line-card px-3 py-1.5 text-sm text-link hover:text-link-hover"
        >
          Go to the takeoff tab
        </Link>
      </main>
    );
  }

  const openPage = Number.parseInt(page ?? "", 10);
  const sheetPages = new Set(data.sheets.map((sheet) => sheet.pageNumber));

  return (
    <TakeoffWorkspace
      jobId={job.id}
      jobName={job.name}
      // ── EVERYTHING BELOW HERE IS SERIALISED BY REACT ──
      //
      // `<TakeoffWorkspace>` is a client component, so the payload crosses the
      // RSC boundary. `workspaceForClient` narrows `plan`, whose `pages` carry
      // calibrations, whose `declaredDistanceFeet` is a Prisma Decimal that
      // React refuses outright. Its docstring has the rest.
      data={workspaceForClient(data)}
      savedAt={savedAt}
      // A page number nobody has a sheet for opens the first sheet rather than
      // an empty canvas: a stale link in somebody's notes should still show a
      // drawing.
      // No page asked for: the sheet `startPage` chooses — the last one worked
      // on or the best floor plan, never a cover; for the job stepper's Scale
      // (`?open=scale`) the first sheet with no scale, and for its Review
      // (`?open=review`) the first sheet holding a wall to confirm.
      openPage={
        sheetPages.has(openPage)
          ? openPage
          : open === "scale"
            ? data.startPage.scale
            : open === "review"
              ? // The first item's own sheet: the queue's jump on mount can
                // come before the viewer listens for it, and then the drawing
                // stayed on whatever sheet it opened on (the walk at 66eeca59).
                (queue.items.map((item) => ("pageNumber" in item ? item.pageNumber : null)).find((p): p is number => p !== null && sheetPages.has(p)) ?? data.startPage.review)
              : data.startPage.work
      }
      openReview={open === "review"}
      openScale={open === "scale"}
      reviewQueue={queue.items}
      reviewHeights={queue.heights}
      reviewLegend={queue.legend}
      reviewHeightChoices={queue.heightChoices}
      reviewSpecSays={specSays}
      reviewCodes={queue.codes}
      reviewAutoPosted={queue.autoPosted ?? []}
      reviewCodeInfo={queue.codeInfo ?? {}}
      planSet={planSetFromLoaded(data)}
      /* ── ANSWER-KEY MODE FROM THE URL ──
         So a review session can be opened on the right sheet in one link,
         rather than remembering to press a toggle that changes what every
         colour on the overlay MEANS. It is off unless the link says so. */
      openAnswerKey={key === "1" && labellingAllowed(process.env)}
      /* ── AND THE BUTTON FOR IT, ONLY WHERE LABELLING CAN HAPPEN ──
         A customer's deployment fails every condition of the gate, so the
         workspace never shows the mode at all; the link above is inert too. */
      labellingAvailable={labellingAllowed(process.env)}
      /* ── THE BUILD THAT DREW THE CANDIDATES, FOR THE DRAFT KEY ──
         An in-progress review is kept in the reviewer's own browser, and a
         draft is only meaningful for the candidates it was made about: the
         verdicts are keyed by positional ids, so a different finder means the
         same id is a different wall. Keying the draft by this build means a
         rebuild cannot hand one sheet's decisions to another's walls. */
      finderVersion={finderVersion()}
    />
  );
}
