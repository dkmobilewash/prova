import Link from "next/link";

import { requireCapability } from "@/lib/authz";
import { requireJobGivenContext } from "@/lib/jobs/job-access";
import { NoAccess } from "@/components/NoAccess";
import { TakeoffWorkspace } from "@/components/TakeoffWorkspace";
import { loadTakeoffWorkspace, takeoffSavedSignature, workspaceForClient } from "@/lib/takeoff/workspaceLoad";

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
  searchParams: Promise<{ page?: string; key?: string }>;
}) {
  const { id } = await params;
  const { page, key } = await searchParams;
  const { context, allowed } = await requireCapability("VIEW_JOB_COSTS");
  if (!allowed) return <NoAccess capability="VIEW_JOB_COSTS" />;
  const { company, job } = await requireJobGivenContext(id, context);

  const data = await loadTakeoffWorkspace(company, job);
  const savedAt = await takeoffSavedSignature(company.id, job.id);

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
      openPage={sheetPages.has(openPage) ? openPage : (data.sheets[0]?.pageNumber ?? 1)}
      /* ── ANSWER-KEY MODE FROM THE URL ──
         So a review session can be opened on the right sheet in one link,
         rather than remembering to press a toggle that changes what every
         colour on the overlay MEANS. It is off unless the link says so. */
      openAnswerKey={key === "1"}
    />
  );
}
