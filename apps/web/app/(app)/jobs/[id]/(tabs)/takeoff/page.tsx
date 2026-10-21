import Link from "next/link";
import { prisma } from "@prova/db";
import { loadTakeoffWorkspace } from "@/lib/takeoff/workspaceLoad";

import { can } from "@/lib/permissions";
import { NoAccess } from "@/components/NoAccess";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { TakeoffMeasurementList } from "@/components/TakeoffMeasurementList";
import { TakeoffPlanUploader } from "@/components/TakeoffPlanUploader";
import { PlanIngestPanel } from "@/components/PlanIngestPanel";
import { ScheduleProposals } from "@/components/ScheduleProposals";
import { loadScheduleProposals, scheduleSheetCountFor } from "@/lib/plan-ingest/scheduleProposalsQuery";
import { legendTypeCountFor } from "@/lib/plan-ingest/legendProposalsQuery";
import { aiGate } from "@/lib/ai/settings";
import { PlanSheetReview } from "@/components/PlanSheetReview";
import { levelsByPage } from "@/lib/plan-ingest/sheetLevel";
import { sheetIndexFor } from "@/lib/plan-ingest/sheetIndexQuery";
import { effectiveSheetNumber, effectiveTitle, sheetPickerLabel } from "@/lib/plan-ingest/sheetIndex";
import { sheetSuitability, duplicateWallsCaution } from "@/lib/takeoff/sheetSuitability";
import { latestIngestFor } from "@/lib/plan-ingest/claim";
import { TakeoffCurrencyBanner } from "@/components/TakeoffCurrencyBanner";
import { TakeoffPlanRevisionForm } from "@/components/TakeoffPlanRevisionForm";
import { loadTakeoffCurrency } from "@/lib/takeoff-currency-query";
import { TakeoffPlanViewer } from "@/components/TakeoffPlanViewer";
import { deleteTakeoffPlan } from "@/lib/actions";
import { requireCapability } from "@/lib/authz";
import { requireJobGivenContext } from "@/lib/jobs/job-access";
import { printedScalesFromProposals, scalePrefillsFromReadings,
  scaleDeclinesFromReadings,
  type ScaleDeclineByPage,
} from "@/lib/takeoff-plan-view";
import { measurementScaleLabel, zoneNotices, zoneScales } from "@/lib/takeoff-zones";
import type { PlanMeasurementRow, PlanSheet, PrintedScaleByPage, ScalePrefillByPage } from "@/lib/takeoff-plan-view";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import type { WallGroup } from "@/lib/takeoff/wallGroups";
import { groupsFromProposals } from "@/lib/takeoff/wallProposal";

/**
 * ── THIS ROUTE NEEDS LONGER THAN A PAGE DOES, AND IT IS THE SAVE THAT NEEDS IT ──
 *
 * A Server Action posts to the route of the page it was rendered from, so this
 * number governs `saveTakeoffCalibration` as well as this render — and that
 * action starts wall detection in an `after()` callback, which runs inside the
 * same invocation.
 *
 * MEASURED IN PRODUCTION rather than feared. On a 52-sheet bid set, runtime
 * logs for one save (request `7lj2t-…`, 2026-10-15) read:
 *
 *   02:11:38.758  [db] connected                     — the action begins
 *   02:11:46.464  Cannot polyfill Path2D / DOMMatrix — pdf.js loading, 7.7s later
 *   —             nothing further from that request
 *
 * Those pdf.js lines are detection starting. It never got to a `pageStrokes`
 * call, nothing was written, and the browser got a 503 — the platform ended the
 * invocation. Most of the 7.7 seconds is `readPlanBytes` pulling the whole plan
 * set out of blob storage before a single wall can be looked at.
 *
 * So the budget is raised here and detection is given a DEADLINE of its own
 * (`DETECTION_BUDGET_MS`) that expires first, because the failure this fixes was
 * silent: being killed leaves no log line, and stopping ourselves writes one.
 * `plan-ingest/runner.ts` and `agents/cron.ts` both take that trade already.
 *
 * NO TEST IN THIS REPO CAN SEE THIS NUMBER. A platform limit is not observable
 * from vitest, so the proof is the production log after a save: proposals on the
 * sheet, or detection's own ran-out-of-time line. Silence is now a bug.
 */
/**
 * ── RAISED FROM 60 TO 300 ON 2026-10-15, FOR THE SAME FAILURE AGAIN ──
 *
 * Read this sheet hit exactly what the paragraph above describes: a browser
 * tester pressed it, one request sat pending and came back 503, and the page
 * showed nothing at all. Being killed leaves no log line, which is why the
 * symptom was a button that span for three minutes.
 *
 * The ordering was inverted and that is the real defect. `AI_CLIENT_OPTIONS`
 * gives the model call 120 seconds, and the platform was ending the whole
 * invocation at 60 — so the budget that was supposed to expire FIRST, and
 * write a line saying so, could never run. 300 puts the route's ceiling above
 * the SDK's own timeout, so a slow tile now fails as a readable sentence
 * instead of a dead socket.
 *
 * It does not loosen wall detection, which still stops itself at
 * `DETECTION_BUDGET_MS` well inside the old 60.
 *
 * NO TEST IN THIS REPO CAN SEE THIS NUMBER, as above. The proof is a
 * production press that either reports words or reports why not.
 */
export const maxDuration = 300;

/**
 * TAKEOFF — measure a drawing on screen and turn what you traced into
 * estimate quantities.
 *
 * Hard-gated on VIEW_JOB_COSTS, the same capability the Estimate tab withholds
 * its content behind and the same one every write here asserts (issue #383).
 * One gate, one door: a second capability on this page would make it ambiguous
 * to `action-capability-guards.test.ts` and force every action behind it onto
 * a known-open list.
 *
 * WHAT THIS PAGE IS NOT. It is not a drawing register and must not become one.
 * `NAV-IA-AUDIT.md` records the decision to stay out of the
 * drawings/markup/sheet-management category that Procore, Fieldwire and
 * Bluebeam own deeply. The issued set, with the architect's own revision
 * labels, lives on `/drawings`. This is a measuring tool that happens to need
 * a drawing in front of it.
 *
 * NOTHING ON THIS PAGE IS A STORED QUANTITY. Every length, area and count is
 * derived on each render from the traced geometry and the sheet's calibration,
 * by the same pure module the Server Action re-runs before it writes anything.
 */
export default async function JobTakeoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { context, allowed } = await requireCapability("VIEW_JOB_COSTS");
  if (!allowed) return <NoAccess capability="VIEW_JOB_COSTS" />;
  const { company, job } = await requireJobGivenContext(id, context);

  // Whether what was measured came off current drawings. Loaded beside the
  // plan rather than after it: the answer belongs above the measurements, and
  // a second round-trip to decide whether to show a banner is a round-trip
  // spent deciding.
  const currency = await loadTakeoffCurrency(company.id, job.id);

  // #515. What a measured wall run can be posted AGAINST, so it arrives priced
  // instead of as a bare quantity. Only types that HAVE layers: one without
  // produces no schedule lines, so posting against it would record a run and
  // add nothing to the estimate — worse than the quantities it replaced. The
  // action refuses a layerless type as well, because a form can send anything.
  // ── EVERY TYPE, AND WHICH OF THEM HAVE PARTS ──
  //
  // One query rather than two: the wall FINDER needs every type so it can name
  // a group after the drawing's own tag, and the measurement list needs only
  // the ones that produce line items. Deriving the second from the first keeps
  // them from drifting and costs one round trip instead of two.
  //
  // The filter used to be in the query, and the wall finder inherited it. That
  // is why reading School-01's partition schedule produced ten wall types the
  // finder could not see — see `MatchableWallType` for the measurement.
  const loaded = await loadTakeoffWorkspace(company, job);
  const isEstimateStage = job.status === "ESTIMATE";

  if (loaded === null) {
    return (
      <section className="flex flex-col gap-4">
        <Header jobId={job.id} />
        <TakeoffCurrencyBanner jobId={job.id} currency={currency} />
        <div className="rounded-lg border border-line-card bg-surface-card p-4">
          <h3 className="text-sm font-semibold text-ink-label">No drawing on this job yet</h3>
          <p className="mt-1 max-w-prose text-sm text-ink-body">
            Upload a sheet, set its scale against a dimension printed on it, then click along what you&rsquo;re taking
            off. Lengths, areas and counts become estimate line items — unpriced, the way the typed takeoff form
            already works.
          </p>
          <div className="mt-3">{isEstimateStage ? <TakeoffPlanUploader jobId={job.id} /> : <NotEstimating />}</div>
        </div>
      </section>
    );
  }

  const {
    plan,
    sheets,
    allWallTypes,
    postableWallTypes,
    printedScaleByPage,
    scannedPages,
    storedWallsByPage,
    levelByPage,
    scalePrefillByPage,
    viewScalesByPage,
    scaleDeclineByPage,
    duplicateWallsByPage,
    sheetLabelByPage,
    sheetRows,
    scheduleSheetCount,
  } = loaded;


  /**
   * How many sheets the index would have somebody look at: a number nobody has
   * confirmed, or one that two sheets both claim.
   *
   * A DUPLICATE IS THE SHARPER OF THE TWO and is why this is in the summary
   * rather than only inside. A set where A5.11 appears twice is a set nobody
   * can navigate by number, and on a folded panel that fact would otherwise be
   * invisible until somebody opened it.
   */
  const seenNumbers = new Map<string, number>();
  for (const row of sheetRows) {
    const number = effectiveSheetNumber(row);
    if (number) seenNumbers.set(number, (seenNumbers.get(number) ?? 0) + 1);
  }
  const indexNeedsAttention = sheetRows.filter((row) => {
    const number = effectiveSheetNumber(row);
    if (!number) return true;
    if ((seenNumbers.get(number) ?? 0) > 1) return true;
    return row.proposal?.status === "PROPOSED";
  }).length;

  return (
    <section className="flex flex-col gap-4">
      <Header jobId={job.id} hasPlan />
      {/* ABOVE the measurements, for the reason the levelling caution sits
          above the quotes: it decides whether the numbers below mean
          anything. */}
      <TakeoffCurrencyBanner jobId={job.id} currency={currency} />

      {/* ── THE DRAWING FIRST, 2026-10-16 ──
          It used to be LAST, under the revision form, the ingest panel, the
          sheet index and the schedule proposals. On a 55-sheet set that is the
          whole index between somebody and the thing they came to look at, and
          it was reported as exactly that: "way too much scrolling to get down
          to the actual plan sheet display".
          Everything below it is about the SET — which sheets there are, what
          they are called, what has been read. Useful, and not what this tab is
          for. */}
      <TakeoffPlanViewer
        duplicateWallsByPage={duplicateWallsByPage}
        sheetLabelByPage={sheetLabelByPage}
        jobId={job.id}
        planId={plan.id}
        sheets={sheets}
        printedScaleByPage={printedScaleByPage}
        scannedPages={scannedPages}
        storedWallsByPage={storedWallsByPage}
        scalePrefillByPage={scalePrefillByPage}
        viewScalesByPage={viewScalesByPage}
        scaleDeclineByPage={scaleDeclineByPage}
        levelByPage={levelByPage}
        // MATCHING ONLY. The viewer never picks a wall type — it reports which
        // of these the DRAWING named beside a detected group. Already filtered
        // to types with layers, so a match always produces line items.
        // AND THE THICKNESS, which is what reaches the UNTAGGED walls: an
        // architect tags representative walls, not every wall — 25-43% of the
        // footage on a real sheet — so without it the majority of every
        // drawing stays unpriced. Null where the company never recorded one,
        // which the matcher reads as "cannot be matched by thickness".
        wallTypes={allWallTypes.map((type) => ({
          id: type.id,
          code: type.code,
          name: type.name,
          hasParts: type._count.components > 0,
          thicknessIn: type.thicknessIn === null ? null : Number(type.thicknessIn),
        }))}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-body">
          {plan.fileName ?? "Drawing"}
          {plan.pages.length > 0 && (
            <span className="text-ink-muted">
              {" "}
              · {plan.pages.length} sheet{plan.pages.length === 1 ? "" : "s"} worked on
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* Which issue this is. Beside the file name because that is where
              somebody looks to identify the sheet, and its button says when
              the date is MISSING — the state the currency check cannot judge. */}
          <TakeoffPlanRevisionForm
            jobId={job.id}
            planId={plan.id}
            revisionLabel={plan.revisionLabel}
            sheetIssuedOn={plan.sheetIssuedOn === null ? null : plan.sheetIssuedOn.toISOString().slice(0, 10)}
          />
        {isEstimateStage && (
          <ConfirmDeleteButton
            label="Delete plan"
            describe="Removes the drawing and everything traced on it. Line items already added to the estimate are not changed."
            action={async () => {
              "use server";
              await deleteTakeoffPlan(job.id, plan.id);
            }}
          />
        )}
        </div>
      </div>

      {!isEstimateStage && <NotEstimating />}

      {/* READING THE SHEETS, above the viewer because it is about the whole set
          rather than one sheet.

          NO PAGE COUNT IS PASSED, and this comment used to explain at length why
          one had to be: "the server has no PDF library to read one with", so the
          panel was handed the number of sheets already CALIBRATED and the real
          count "arrives with rasterisation". Both halves were wrong.
          `lib/ask/pageCount.ts` has counted PDF pages server-side for billing
          since it was written, and reading a PDF was never the same capability as
          rasterising one. `startPlanIngest` counts the file's own sheets now. */}
      {isEstimateStage && (
        <PlanIngestPanel
          planId={plan.id}
          existing={await latestIngestFor(plan.id)}
          scheduleSheetCount={scheduleSheetCount}
          legend={{
            on: (await aiGate(company.id, "PLAN_TEXT_READ")).ok,
            reviewHref: `/jobs/${job.id}/takeoff/legend`,
            typeCount: await legendTypeCountFor(plan.id),
          }}
        />
      )}

      {/* WHAT WAS READ, AND WHAT SOMEBODY SAYS IT IS — below the panel that reads
          it, because it only has anything to show once that has run. Rendered at
          all times rather than behind a condition: an empty index says so in one
          sentence, which is more useful than a section that appears from nowhere
          the first time a run finishes. */}
      {/* ── THE INDEX, FOLDED AWAY ──
          Fifty-five rows every time the tab opens, above the drawing, is a
          wall. It is a <details> so it costs one line until somebody wants it,
          and the summary carries the two numbers that would make them want it:
          how many sheets there are and how many have something to check.
          Native <details> rather than state: it works before hydration, it is
          keyboard-operable for free, and the browser's own disclosure is what
          a screen reader already announces. */}
      {isEstimateStage && (
        <details className="rounded-lg border border-line-card bg-surface" data-takeoff="sheet-index">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-label">
            Sheet index
            <span className="ml-2 font-normal text-ink-muted">
              {sheetRows.length} sheet{sheetRows.length === 1 ? "" : "s"}
              {indexNeedsAttention > 0 ? ` · ${indexNeedsAttention} to check` : ""}
            </span>
          </summary>
          <div className="px-4 pb-4">
            <PlanSheetReview rows={sheetRows} planId={plan.id} />
          </div>
        </details>
      )}

      {/* BELOW the sheet review, because the page types it shows are what decide
          which sheets have schedules at all. Silent until something has been
          read — the convention every advisory surface here follows. */}
      {/* `canAddWallTypes` is NOT this tab's own capability, deliberately. The
          tab withholds on VIEW_JOB_COSTS; turning a partition schedule into
          wall types writes the COMPANY library, which is MANAGE_ESTIMATING. An
          accountant can open this page and must not meet a button that refuses
          them. */}
      {isEstimateStage && (
        <ScheduleProposals
          proposals={await loadScheduleProposals(plan.id)}
          jobId={job.id}
          canAddWallTypes={can(context, "MANAGE_ESTIMATING")}
        />
      )}


      {/* ── WHOSE SHEET IS THIS, AND WHY THERE IS A HEADING ABOVE THE LIST ──
          A browser run reported "Measured on sheet 21" as a stale caption,
          seen while sheet 1 was open. It was not stale and nothing here was
          wrong: there ARE measurements on sheet 21, and each measured sheet
          gets its own section below the viewer.

          It read as a caption because it sits directly under the drawing with
          nothing saying these are ALL the measured sheets rather than the one
          on screen. The heading costs a line and makes the next person's
          reading the right one — which is cheaper than the report that comes
          back a second time. */}
      {sheets.length > 0 && (
        <h2 className="text-sm font-semibold text-ink-label">
          Measurements by sheet
          <span className="ml-2 font-normal text-ink-muted">
            every sheet with measurements on it, not just the one open above
          </span>
        </h2>
      )}

      {sheets.map((sheet) => (
        <div key={sheet.id} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink-label">
            Measured on sheet {sheet.pageNumber}
            {sheet.label ? ` — ${sheet.label}` : ""}
          </h3>
          <TakeoffMeasurementList
            jobId={job.id}
            sheet={sheet}
            // Decimal does not cross into a client component.
            wallTypes={postableWallTypes.map((type) => ({
              id: type.id,
              code: type.code,
              name: type.name,
              sides: type.sides,
              // `_count` is a query detail and does not cross into a client
              // component; nor does Decimal.
              defaultHeightFt: type.defaultHeightFt != null ? type.defaultHeightFt.toNumber() : null,
            }))}
          />
        </div>
      ))}
    </section>
  );
}

function Header({ jobId, hasPlan = false }: { jobId: string; hasPlan?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink-strong">Takeoff</h2>
        {/* ── THE WAY INTO THE FULL-SCREEN WORKSPACE ──
            Added 2026-10-16, after it was reported missing — and it was: the
            workspace shipped reachable only from the ESTIMATE tab, which is
            not where anybody stands when they want the drawing bigger. They
            stand here, on a 55-sheet set, scrolling.
            A real link, so Cmd-click and right-click open it in a tab of its
            own; an estimator comparing a bid against a drawing wants both. */}
        {hasPlan && (
          <Link
            href={`/takeoff/${jobId}`}
            className="rounded-md border border-line-card px-3 py-1.5 text-sm text-link hover:text-link-hover"
            data-takeoff="open-workspace"
          >
            Open full screen
          </Link>
        )}
      </div>
      <p className="max-w-prose text-sm text-ink-body">
        Measure a drawing on screen. Set the scale on each sheet against a dimension printed on it, trace what
        you&rsquo;re taking off, and add it to the estimate.{" "}
        <Link href={`/jobs/${jobId}/estimate`} className="text-link hover:text-link-hover">
          Ceilings and anything you already have dimensions for
        </Link>{" "}
        are typed on the estimate page instead — a traced outline has an area, not a length and a width.
      </p>
    </div>
  );
}

function NotEstimating() {
  return (
    <p className="rounded-lg border border-line-row bg-amber-500/5 p-3 text-sm text-tag-amber-ink">
      This job is past the estimate stage, so line items are changed through a change order rather than added
      directly. You can still read what was measured.
    </p>
  );
}
