import Link from "next/link";
import { prisma } from "@prova/db";

import { NoAccess } from "@/components/NoAccess";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { TakeoffMeasurementList } from "@/components/TakeoffMeasurementList";
import { TakeoffPlanUploader } from "@/components/TakeoffPlanUploader";
import { PlanIngestPanel } from "@/components/PlanIngestPanel";
import { ScheduleProposals } from "@/components/ScheduleProposals";
import { loadScheduleProposals, scheduleSheetCountFor } from "@/lib/plan-ingest/scheduleProposalsQuery";
import { PlanSheetReview } from "@/components/PlanSheetReview";
import { sheetIndexFor } from "@/lib/plan-ingest/sheetIndexQuery";
import { effectiveSheetNumber, effectiveTitle } from "@/lib/plan-ingest/sheetIndex";
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
  const postableWallTypes = await prisma.wallType.findMany({
    where: { companyId: company.id, components: { some: {} } },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, defaultHeightFt: true, sides: true },
  });

  const plan = await prisma.takeoffPlan.findFirst({
    where: { jobId: job.id, companyId: company.id },
    orderBy: { createdAt: "desc" },
    include: {
      pages: {
        orderBy: { pageNumber: "asc" },
        include: {
          calibrations: { orderBy: { createdAt: "desc" } },
          measurements: {
            orderBy: { createdAt: "asc" },
            include: { calibration: true },
          },
        },
      },
    },
  });

  // THE PRINTED SCALE PER PAGE, newest proposal first. One query for the plan
  // rather than one per page, and the newest row wins because there is no
  // `acceptedScale` to prefer — accepting a sheet writes only its number and
  // title, by design, so the proposal is the only record of what was printed.
  //
  // Scoped through `plan.id`, which the query above already scoped to this
  // company; a proposal carries no companyId of its own.
  // KEYED BY PAGE NUMBER, NOT HUNG OFF A SHEET ROW — and that is the whole
  // correction. This used to be folded into each `PlanSheet`, which is built
  // from a `TakeoffPlanPage`, and the only thing that creates one of those is
  // saving a calibration. So on the first calibration of a sheet there was no
  // row, no `PlanSheet`, and no printed scale — null exactly when it mattered.
  // A page number exists whether or not anybody has calibrated it.
  const printedScaleByPage: PrintedScaleByPage = plan
    ? printedScalesFromProposals(
        await prisma.planSheetProposal.findMany({
          where: { planId: plan.id },
          // Newest first — `printedScalesFromProposals` keeps the first it sees
          // per page and the ordering is what makes that the current reading.
          orderBy: { createdAt: "desc" },
          select: { pageNumber: true, proposedScale: true },
        }),
      )
    : {};

  // WHAT EACH SHEET SAID ABOUT ITS OWN SCALE, read off the dimensions printed on
  // it by `PAGE_INVENTORY`. Keyed by page number for the same reason the printed
  // scale above is: a `PlanSheet` row only exists once somebody has calibrated,
  // so keying by sheet id would be null exactly when the prefill matters most —
  // on the first calibration of a sheet.
  const scaleReadingRows = plan
    ? await prisma.planSheetScaleReading.findMany({
        where: { planId: plan.id },
        orderBy: { updatedAt: "desc" },
        select: {
          pageNumber: true,
          scaleName: true,
          x1: true,
          y1: true,
          x2: true,
          y2: true,
          declaredDistanceFeet: true,
          declaredText: true,
          agreedText: true,
          consideredCount: true,
          inheritedError: true,
          source: true,
          declineReason: true,
        },
      })
    : [];
  // ── EVERY SHEET'S OWN SIZE, SO A REDUCED PRINT CAN BE CAUGHT ──
  //
  // A half-size print carries the FULL-SIZE scale name in its title block, and
  // taking that name at face value measures every length at half. The answer
  // key's page 50 is exactly that — an 18in sheet in a 36in set with no
  // dimensions of its own to catch it — and it scored 32%, worst of sixty.
  //
  // A sheet cannot tell on its own: a half-size ARCH D is exactly an ARCH B, a
  // size drawings are genuinely issued at. The SET is what tells, so the widths
  // of all its pages are needed together. `widthPt` has been stored per page
  // since the inventory stage was written, so this is a second select on a table
  // already being written, not new extraction. See `takeoff/reducedPrint.ts`.
  const sheetWidthByPage: Record<number, number> = {};
  if (plan) {
    for (const sheet of await prisma.planSheetText.findMany({
      where: { planId: plan.id },
      select: { pageNumber: true, widthPt: true },
    })) {
      sheetWidthByPage[sheet.pageNumber] = sheet.widthPt;
    }
  }
  const scalePrefillByPage: ScalePrefillByPage = scalePrefillsFromReadings(scaleReadingRows, sheetWidthByPage);
  // THE SAME ROWS, ASKED THE OTHER QUESTION: why a sheet offered nothing. One
  // query, two derivations — the reason is already on the row, and re-querying
  // for it would be a second trip for data we are holding.
  const scaleDeclineByPage: ScaleDeclineByPage = scaleDeclinesFromReadings(scaleReadingRows);

  const isEstimateStage = job.status === "ESTIMATE";

  if (!plan) {
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

  // DERIVED HERE, NOT STORED: which calibration is current, and therefore
  // which measurements read at an older scale. Nothing on the row says so.
  // WHAT READING THE SCHEDULES WILL COST, counted over the newest title-block
  // proposal per page. The button says this number before anybody presses it,
  // which is the house rule for every control that spends an allowance.
  /**
   * WHICH SHEETS A WALL TAKEOFF WOULD DOUBLE-COUNT.
   *
   * Scored against a 60-page answer key: a THIRD of everything the wall finder
   * reported was not a wall, and every phantom page was a mechanical plan, a
   * reflected ceiling plan or an elevation — 13,767 ft invented. Those sheets
   * carry the architectural walls repeated in grey, so the finder is right
   * about the lines and they are still the same walls the A-101 already has.
   *
   * The evidence was already in the database. `proposedPageType` has held
   * COVER/PLAN/ELEVATION/SECTION/DETAIL/SCHEDULE since the ingest was built and
   * its schema comment says why: "'which pages are the schedules?' is the
   * question the takeoff side needs answered". The takeoff side never asked.
   *
   * Read from the SAME rows the sheet review below uses, rather than queried
   * again — one answer, one round trip.
   */
  const sheetRows = isEstimateStage ? await sheetIndexFor(plan.id, company.id) : [];
  const duplicateWallsByPage: Record<number, string> = {};
  for (const row of sheetRows) {
    const number = effectiveSheetNumber(row);
    const title = effectiveTitle(row);
    const caution = duplicateWallsCaution(
      sheetSuitability(number, title, row.proposal?.pageType ?? null),
      number,
    );
    if (caution) duplicateWallsByPage[row.pageNumber] = caution;
  }

  const scheduleSheetCount = await scheduleSheetCountFor(plan.id);

  const sheets: PlanSheet[] = plan.pages.map((page) => {
    const current = page.calibrations[0] ?? null;
    // EVERY calibration on the sheet, not just the newest — the question
    // "does this page carry two scales" cannot be asked of one row. The data
    // has supported this since the FK was added; nothing ever read it.
    const zones = zoneScales(
      page.calibrations.map((c) => ({
        id: c.id,
        x1: c.x1,
        y1: c.y1,
        x2: c.x2,
        y2: c.y2,
        declaredDistanceFeet: c.declaredDistanceFeet.toNumber(),
      })),
      page.pageWidthPt,
    );
    const notices = zoneNotices(zones);
    const measurements: PlanMeasurementRow[] = page.measurements.map((m) => ({
      id: m.id,
      kind: m.kind,
      xs: m.xs,
      ys: m.ys,
      label: m.label,
      packageLabel: m.packageLabel,
      postedAt: m.postedAt ? m.postedAt.toISOString() : null,
      calibration: {
        x1: m.calibration.x1,
        y1: m.calibration.y1,
        x2: m.calibration.x2,
        y2: m.calibration.y2,
        declaredDistanceFeet: m.calibration.declaredDistanceFeet.toNumber(),
      },
      outOfDate: current !== null && m.calibrationId !== current.id,
      scaleLabel: measurementScaleLabel(m.calibrationId, zones, notices),
    }));
    return {
      id: page.id,
      pageNumber: page.pageNumber,
      label: page.label,
      pageWidthPt: page.pageWidthPt,
      calibration: current
        ? {
            id: current.id,
            x1: current.x1,
            y1: current.y1,
            x2: current.x2,
            y2: current.y2,
            declaredDistanceFeet: current.declaredDistanceFeet.toNumber(),
            // Provenance, not decoration — see `PlanViewerCalibration`.
            note: current.note,
          }
        : null,
      measurements,
      zoneNotices: notices,
    };
  });

  return (
    <section className="flex flex-col gap-4">
      <Header jobId={job.id} />
      {/* ABOVE the measurements, for the reason the levelling caution sits
          above the quotes: it decides whether the numbers below mean
          anything. */}
      <TakeoffCurrencyBanner jobId={job.id} currency={currency} />

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
        />
      )}

      {/* WHAT WAS READ, AND WHAT SOMEBODY SAYS IT IS — below the panel that reads
          it, because it only has anything to show once that has run. Rendered at
          all times rather than behind a condition: an empty index says so in one
          sentence, which is more useful than a section that appears from nowhere
          the first time a run finishes. */}
      {isEstimateStage && <PlanSheetReview rows={sheetRows} planId={plan.id} />}

      {/* BELOW the sheet review, because the page types it shows are what decide
          which sheets have schedules at all. Silent until something has been
          read — the convention every advisory surface here follows. */}
      {isEstimateStage && <ScheduleProposals proposals={await loadScheduleProposals(plan.id)} />}

      <TakeoffPlanViewer
        duplicateWallsByPage={duplicateWallsByPage}
        jobId={job.id}
        planId={plan.id}
        sheets={sheets}
        printedScaleByPage={printedScaleByPage}
        scalePrefillByPage={scalePrefillByPage}
        scaleDeclineByPage={scaleDeclineByPage}
      />

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
              ...type,
              defaultHeightFt: type.defaultHeightFt != null ? type.defaultHeightFt.toNumber() : null,
            }))}
          />
        </div>
      ))}
    </section>
  );
}

function Header({ jobId }: { jobId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold text-ink-strong">Takeoff</h2>
      <p className="max-w-prose text-sm text-ink-body">
        Measure a drawing on screen. Set the scale on each sheet against a dimension printed on it, trace what
        you&rsquo;re taking off, and add it to the estimate.{" "}
        <Link href={`/jobs/${jobId}/estimate`} className="text-link hover:text-link-hover">
          Ceilings and anything you already have dimensions for
        </Link>{" "}
        are typed on the Estimate tab instead — a traced outline has an area, not a length and a width.
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
