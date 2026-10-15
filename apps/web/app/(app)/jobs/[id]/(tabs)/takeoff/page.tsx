import Link from "next/link";
import { prisma } from "@prova/db";

import { can } from "@/lib/permissions";
import { NoAccess } from "@/components/NoAccess";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { TakeoffMeasurementList } from "@/components/TakeoffMeasurementList";
import { TakeoffPlanUploader } from "@/components/TakeoffPlanUploader";
import { PlanIngestPanel } from "@/components/PlanIngestPanel";
import { ScheduleProposals } from "@/components/ScheduleProposals";
import { loadScheduleProposals, scheduleSheetCountFor } from "@/lib/plan-ingest/scheduleProposalsQuery";
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
export const maxDuration = 60;

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
  const allWallTypes = await prisma.wallType.findMany({
    where: { companyId: company.id },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      defaultHeightFt: true,
      sides: true,
      thicknessIn: true,
      _count: { select: { components: true } },
    },
  });
  // POSTING IS STILL GATED ON LAYERS, and this is the gate — unchanged in
  // substance, moved so that naming is not gated with it. A type with no
  // components produces no line items, so a measurement posted against one adds
  // nothing to the estimate and loses the quantities it replaced.
  const postableWallTypes = allWallTypes.filter((type) => type._count.components > 0);

  const plan = await prisma.takeoffPlan.findFirst({
    where: { jobId: job.id, companyId: company.id },
    orderBy: { createdAt: "desc" },
    include: {
      pages: {
        orderBy: { pageNumber: "asc" },
        include: {
          calibrations: { orderBy: { createdAt: "desc" } },
          /**
           * THE WALLS FOUND WHEN THE SCALE WAS SAVED. Newest first, and
           * filtered to the CURRENT calibration below rather than here —
           * `calibrations[0]` is only known once this query has returned.
           *
           * That filter is the whole invalidation story: a recalibration
           * inserts a new calibration, so proposals found under the old one
           * are simply never read again. No staleness flag, no sweep.
           */
          wallProposals: { orderBy: { createdAt: "desc" } },
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

  // WHICH FLOOR EACH SHEET DRAWS, read off its own title. Keyed by page number
  // for the same reason the printed scale above is — a `PlanSheet` row only
  // exists once somebody has calibrated — and newest-first for the same reason
  // too: `levelsByPage` keeps the first row it sees per page.
  const levelByPage: Record<number, string> = {};
  if (plan) {
    const levels = levelsByPage(
      await prisma.planSheetProposal.findMany({
        where: { planId: plan.id },
        orderBy: { createdAt: "desc" },
        select: {
          pageNumber: true,
          proposedTitle: true,
          acceptedTitle: true,
          proposedPageType: true,
        },
      }),
    );
    for (const [pageNumber, level] of levels) levelByPage[pageNumber] = level.label;
  }

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
  /**
   * WHAT EACH SHEET IS CALLED, so the pager can be jumped to one.
   *
   * Measured before it was built: reaching `A-101` on a 52-sheet set took
   * TWENTY presses of Next, and the pager reads "Sheet 23 of 52" — a position
   * in the file, not the sheet's own number — so all twenty were blind. It was
   * the largest single number in a nine-step press count of one real bid, and
   * the only one that was pure navigation.
   *
   * NOTHING IS QUERIED FOR IT. These are the rows two lines above, which the
   * sheet review already renders on this same page; the numbers were on screen
   * and were not reachable. One more assignment in a loop that was already
   * running is the whole server cost.
   *
   * AND IT LABELS NO QUANTITY, which is the distinction that makes this
   * legitimate. `TakeoffPlanPage.label` is "TYPED, never parsed off the title
   * block", because "a wrong one labels somebody's quantities with another
   * floor's name" — that argument is about naming measurements and it stands.
   * A jump target is not a name: nothing is stored, nothing is attached to a
   * measurement, and the worst a wrong number can do is open the wrong sheet,
   * which the estimator is looking straight at.
   */
  const sheetLabelByPage: Record<number, string> = {};
  for (const row of sheetRows) {
    const number = effectiveSheetNumber(row);
    const title = effectiveTitle(row);
    const caution = duplicateWallsCaution(
      sheetSuitability(number, title, row.proposal?.pageType ?? null),
      number,
    );
    if (caution) duplicateWallsByPage[row.pageNumber] = caution;
    const label = sheetPickerLabel(number, title);
    if (label !== null) sheetLabelByPage[row.pageNumber] = label;
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

  /**
   * ── THE WALLS ALREADY FOUND, PER SHEET ──
   *
   * Detection runs when a calibration is saved, so these are usually waiting
   * before anybody opens the sheet. Read here so the viewer can show them
   * without a press.
   *
   * ONLY THE NEWEST RUN, AND ONLY UNDER THE CURRENT CALIBRATION. The rows are
   * append-only — a second detection writes a second set rather than replacing
   * one — so "newest `createdAt`" is what makes a re-run win, and the
   * calibration filter is what makes a RECALIBRATION invalidate the lot for
   * free.
   *
   * AND IT REFUSES THE WHOLE SHEET ON A SINGLE BAD ROW. `groupsFromProposals`
   * returns null rather than a shorter list: a page showing three of its four
   * groups looks exactly like a page that has three, and the estimator has no
   * way to tell. Falling back to the Find the walls button is slow and honest.
   */
  const storedWallsByPage: Record<number, WallGroup[]> = {};
  for (const page of plan.pages) {
    const current = page.calibrations[0] ?? null;
    if (!current) continue;
    const feetPerUnit = feetPerPageWidth({
      x1: current.x1,
      y1: current.y1,
      x2: current.x2,
      y2: current.y2,
      declaredDistanceFeet: current.declaredDistanceFeet.toNumber(),
    });
    if (feetPerUnit === null) continue;

    const mine = page.wallProposals.filter((row) => row.calibrationId === current.id);
    if (mine.length === 0) continue;
    // One detection run writes every row at one timestamp, so the newest run is
    // every row sharing the newest `createdAt`.
    const newest = mine[0].createdAt.getTime();
    const groups = groupsFromProposals(
      mine
        .filter((row) => row.createdAt.getTime() === newest)
        .map((row) => ({
          thicknessInches: row.thicknessInches,
          source: row.source,
          sourceLabel: row.sourceLabel,
          namedCode: row.namedCode,
          runs: row.runs,
        })),
      allWallTypes.map((type) => ({
        id: type.id,
        code: type.code,
        name: type.name,
        hasParts: type._count.components > 0,
        thicknessIn: type.thicknessIn === null ? null : Number(type.thicknessIn),
      })),
      feetPerUnit,
    );
    if (groups !== null && groups.length > 0) storedWallsByPage[page.pageNumber] = groups;
  }

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

      <TakeoffPlanViewer
        duplicateWallsByPage={duplicateWallsByPage}
        sheetLabelByPage={sheetLabelByPage}
        jobId={job.id}
        planId={plan.id}
        sheets={sheets}
        printedScaleByPage={printedScaleByPage}
        storedWallsByPage={storedWallsByPage}
        scalePrefillByPage={scalePrefillByPage}
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
