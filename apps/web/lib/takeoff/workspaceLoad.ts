import { loadWallModel } from "@/lib/takeoff/wallModelFile";
import type { StoredScheduleRow } from "./doorsWindows";
import { prisma } from "@prova/db";
import { aiGate } from "@/lib/ai/settings";
import { wallTypeSummary } from "@/lib/takeoff/wallTypeMatch";

import { sheetIndexFor } from "@/lib/plan-ingest/sheetIndexQuery";
import { isScannedSheet } from "@/lib/plan-ingest/scannedSheet";
import { storedRasterFrom, type StoredRaster } from "@/lib/plan-ingest/raster";
import { cutoutsFromJson, type ItemMeasurement, type TakeoffItemRow } from "@/lib/takeoff/itemQuantities";
import { scheduleSheetCountFor } from "@/lib/plan-ingest/scheduleProposalsQuery";
import { effectiveSheetNumber, effectiveTitle, sheetPickerLabel } from "@/lib/plan-ingest/sheetIndex";
import { sheetSuitability, duplicateWallsCaution } from "@/lib/takeoff/sheetSuitability";
import { levelsByPage } from "@/lib/plan-ingest/sheetLevel";
import {
  printedScalesFromProposals,
  scalePrefillsFromReadings,
  scaleDeclinesFromReadings,
  type ScaleDeclineByPage,
} from "@/lib/takeoff-plan-view";
import type {
  PlanMeasurementRow,
  PlanSheet,
  PrintedScaleByPage,
  ScalePrefillByPage,
} from "@/lib/takeoff-plan-view";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import type { WallGroup } from "@/lib/takeoff/wallGroups";
import { groupsFromProposals } from "@/lib/takeoff/wallProposal";
import type { SectionItem } from "@/lib/takeoff/proposalSections";
import { viewScalesFromJson, type ViewScale } from "@/lib/takeoff/sheetScale";
import { measurementScaleLabel, zoneNotices, zoneScales } from "@/lib/takeoff-zones";

/**
 * ── EVERYTHING `TakeoffPlanViewer` NEEDS, LOADED ONCE, FOR TWO PAGES ──
 *
 * The takeoff tab (`jobs/[id]/takeoff`) and the full-screen workspace
 * (`/takeoff/[id]`) show the same drawing with the same detection and the same
 * saved state. They differ only in what surrounds it: the tab sits inside the
 * app chrome beside the uploader, the schedule proposals and the measurement
 * list, and the workspace fills the viewport.
 *
 * So the LOADING is here and the two pages render. Extracted rather than
 * copied, because a second copy of this is a second answer to "what has been
 * measured on this job", and the two would drift silently — the shape this
 * repo keeps paying for (`findWallsOnSheet` was lifted out of the viewer for
 * the same reason, after the bench's copy had drifted and was inventing
 * walls).
 *
 * Returns null when the job has no plan at all. That case is a different PAGE
 * rather than different data — the tab offers an uploader, the workspace sends
 * you back — so the decision belongs to the caller and not here.
 */
export type TakeoffWorkspaceData = Awaited<ReturnType<typeof loadTakeoffWorkspace>>;

const CEILING_PAGE_TITLE = /REFLECTED\s+CEILING|\bRCP\b|CEILING\s+PLAN|FINISH\s+SCHEDULE|ROOM\s+FINISH/i;
/** Page numbers whose stored title block names a reflected ceiling plan or a finish schedule. */
async function ceilingPagesOf(planId: string): Promise<number[]> {
  const rows = await prisma.planSheetText.findMany({ where: { planId }, select: { pageNumber: true, titleBlockText: true } });
  return rows.filter((r) => r.titleBlockText !== null && CEILING_PAGE_TITLE.test(r.titleBlockText)).map((r) => r.pageNumber).sort((a, b) => a - b);
}

/**
 * What a CLIENT component may be handed — the loader's result with `plan`
 * narrowed by `workspaceForClient`.
 *
 * Separate from `TakeoffWorkspaceData` so the compiler enforces the boundary:
 * a client component typed on this cannot be passed the raw loader result,
 * which is how a Prisma Decimal reached React and 500'd the takeoff page.
 * The runtime guard is `workspacePayloadPlain.dbtest.ts`; this is the half
 * that fails at build time.
 */
export type TakeoffWorkspaceClientData = Omit<
  NonNullable<TakeoffWorkspaceData>,
  "plan"
> & { plan: PlanForClient };

export async function loadTakeoffWorkspace(
  company: { id: string },
  job: { id: string; status: string },
) {
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
      studSpacingIn: true,
      boardLayers: true,
      notes: true,
      _count: { select: { components: true } },
      /**
       * THE PARTS, because the assembly panel prices the selected item from
       * them in the browser — with `componentRunQuantity`, the same function
       * the server expander uses, so the figure on screen is the figure that
       * gets written.
       *
       * `defaultUnitPrice` comes off the catalog entry rather than the part:
       * the part says HOW MUCH of a thing, the catalog says what the thing
       * costs, and that split is what lets an estimator reprice a whole
       * library from one place.
       */
      components: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          description: true,
          unit: true,
          basis: true,
          factor: true,
          perLayer: true,
          wastePercent: true,
          roundUp: true,
          catalogEntry: { select: { defaultUnitPrice: true } },
        },
      },
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
          viewScales: true,
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
  // ── THE SHEETS THAT CARRY SEVERAL DRAWINGS AT SEVERAL SCALES ──
  //
  // A page-wide prefill is deliberately absent on these — one scale would be
  // wrong for every drawing but one — so this is the only thing the workspace
  // has to offer on them. Read through `viewScalesFromJson`, which refuses a
  // blob it does not recognise rather than half-understanding one: a view with
  // a missing region would be measured across the WHOLE sheet at a detail's
  // scale, which is the "hundreds of feet that are not a building" failure
  // `sheetViews` exists to prevent.
  const viewScalesByPage: Record<number, ViewScale[]> = {};
  for (const row of scaleReadingRows) {
    const views = viewScalesFromJson(row.viewScales);
    if (views.length > 0) viewScalesByPage[row.pageNumber] = views;
  }
  // THE SAME ROWS, ASKED THE OTHER QUESTION: why a sheet offered nothing. One
  // query, two derivations — the reason is already on the row, and re-querying
  // for it would be a second trip for data we are holding.
  const scaleDeclineByPage: ScaleDeclineByPage = scaleDeclinesFromReadings(scaleReadingRows);

  const isEstimateStage = job.status === "ESTIMATE";

  if (!plan) return null;

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
  /**
   * ── THE TAKEOFF ITEMS, AND THEIR GEOMETRY ──
   *
   * One query for the items and their measurements, rather than reading them
   * off `plan.pages` above: an item's measurements span SHEETS, and several
   * of them may sit on a sheet this plan no longer has after a revision. The
   * rail must still add those up — they are quantities somebody measured —
   * so the item owns the read.
   *
   * `feetPerPageWidth` is computed HERE rather than sent to the client as a
   * calibration, because `itemQuantities.ts` takes a number and the Decimal
   * cannot cross into a client component anyway.
   */
  const itemRows = await prisma.takeoffItem.findMany({
    where: { jobId: job.id, companyId: company.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      measurements: {
        select: {
          id: true,
          kind: true,
          xs: true,
          ys: true,
          cutouts: true,
          page: { select: { pageNumber: true } },
          calibration: { select: { x1: true, y1: true, x2: true, y2: true, declaredDistanceFeet: true } },
        },
      },
    },
  });

  const items: TakeoffItemRow[] = itemRows.map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    colorHex: item.colorHex,
    lineStyle: item.lineStyle,
    heightFt: item.heightFt === null ? null : Number(item.heightFt),
    sides: item.sides,
    thicknessIn: item.thicknessIn === null ? null : Number(item.thicknessIn),
    wastePercent: item.wastePercent === null ? null : Number(item.wastePercent),
    spacingIn: item.spacingIn === null ? null : Number(item.spacingIn),
    depthIn: item.depthIn === null ? null : Number(item.depthIn),
    wallTypeId: item.wallTypeId,
    sortOrder: item.sortOrder,
    measurements: item.measurements.map((m) => ({
      id: m.id,
      pageNumber: m.page.pageNumber,
      kind: m.kind,
      xs: m.xs,
      ys: m.ys,
      cutouts: cutoutsFromJson(m.cutouts),
      feetPerPageWidth: feetPerPageWidth({
        x1: m.calibration.x1,
        y1: m.calibration.y1,
        x2: m.calibration.x2,
        y2: m.calibration.y2,
        declaredDistanceFeet: m.calibration.declaredDistanceFeet.toNumber(),
      }),
    })),
  }));

  /**
   * Whether this job has frozen its assembly library, and when.
   *
   * Read here rather than in the panel because the panel is a client
   * component and this is one field of the job it is already loading.
   */
  const assemblyLibraryPinnedAt = (
    await prisma.job.findUniqueOrThrow({
      where: { id: job.id },
      select: { assemblyLibraryPinnedAt: true },
    })
  ).assemblyLibraryPinnedAt;

  const sheetRows = isEstimateStage ? await sheetIndexFor(plan.id, company.id) : [];
  /**
   * WHICH PAGES ARE SCANS, straight off the ingest record.
   *
   * A scanned page has no text layer, which is the one thing that CANNOT be
   * worked out from a `PlanSheet`: a sheet row only exists once somebody has
   * saved a calibration, and a scan is precisely the page nobody can calibrate
   * until its printed scale has been read off the picture.
   *
   * `sheetIndexFor` already selects `hasTextLayer`, so this is free.
   */
  const scannedPages = sheetRows.filter(isScannedSheet).map((row) => row.pageNumber);
  // ── WHAT THE RASTER STAGE READ OFF THE SCANNED SHEETS ──
  // Lines and words in points, for the viewer's Find the walls; and the
  // printed scale OCR read, as a prefill where the inventory has none — so a
  // scan whose caption was read gets the one-press scale, and one whose
  // caption was not gets the ordinary set-the-scale prompt, nothing new.
  const rasterByPage: Record<number, StoredRaster> = {};
  const scannedNumberByPage: Record<number, string> = {};
  for (const row of await prisma.planSheetRaster.findMany({
    where: { planId: plan.id },
    select: { pageNumber: true, widthPt: true, heightPt: true, lines: true, text: true, printedScale: true, sheetNumber: true },
  })) {
    const stored = storedRasterFrom(row);
    if (stored === null) continue;
    rasterByPage[row.pageNumber] = stored;
    if (stored.printedScale !== null && printedScaleByPage[row.pageNumber] === undefined) printedScaleByPage[row.pageNumber] = stored.printedScale;
    // ── WHAT A SCANNED SHEET IS CALLED ──
    // The inventory has no text to name a scan by, so its number is the one
    // OCR read off the title-block corner (`rasterizeSheet`, the sparse
    // re-read) — a jump target, like the labels below, never a name on a
    // quantity. Snapping it against the set's other pages was measured on
    // Evergreen and HURT (71 → 67 of 106 right): a right read one edit from
    // a neighbour named twice moved to the neighbour. So it is used as read.
    if (row.sheetNumber !== null) scannedNumberByPage[row.pageNumber] = row.sheetNumber;
  }
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
    const label = sheetPickerLabel(number ?? scannedNumberByPage[row.pageNumber] ?? null, title);
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
      itemId: m.itemId,
      roomName: m.roomName,
      roomNumber: m.roomNumber,
      ceiling:
        m.source === "ROOM_FINDER"
          ? { family: m.ceilingFamily, code: m.ceilingCode, heightFeet: m.ceilingHeightFeet, from: m.ceilingFrom, guess: m.ceilingGuess }
          : null,
      cutouts: cutoutsFromJson(m.cutouts),
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
  /**
   * ── WHAT A LIVE MATCH NEEDS, JOINED ONCE ──
   *
   * Detection stores the item it matched each group to, and a group matched
   * before any condition existed stored a null — which is the ORDINARY case,
   * because detection fires the instant a scale is accepted and you scale a
   * sheet to look at the drawing before you decide what you are counting.
   * Those nulls are matched again at render time, so naming a condition sorts
   * the groups under it without a re-run.
   *
   * The join happens here because this is the only place that holds both: an
   * item stores the wall-type ID it points at, and the drawing prints that
   * type's CODE. The matching itself is the viewer's, so the one path through
   * a stored load and the one through a just-pressed Find the walls cannot
   * drift apart — see `proposalSections`.
   */
  const codeByWallTypeId = new Map(allWallTypes.map((type) => [type.id, type.code]));
  const matchableItems: SectionItem[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    thicknessIn: item.thicknessIn,
    assemblyCode: item.wallTypeId === null ? null : (codeByWallTypeId.get(item.wallTypeId) ?? null),
  }));
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
          itemId: row.itemId,
          runs: row.runs,
        })),
      allWallTypes.map((type) => ({
        id: type.id,
        code: type.code,
        name: type.name,
        hasParts: type._count.components > 0,
        thicknessIn: type.thicknessIn === null ? null : Number(type.thicknessIn),
        summary: wallTypeSummary({ name: type.name, sides: type.sides, notes: type.notes, components: type.components.map((c) => ({ description: c.description, basis: c.basis, factor: Number(c.factor) })) }),
        defaultHeightFt: type.defaultHeightFt === null ? null : Number(type.defaultHeightFt),
      })),
      feetPerUnit,
    );
    if (groups !== null && groups.length > 0) storedWallsByPage[page.pageNumber] = groups;
  }

  // "Find the rooms" is off until the owner turns it on (Settings). Read here
  // rather than from the viewer so the button's presence is decided by the
  // same load that decides everything else on the screen.
  const roomFinder = await prisma.company.findUnique({
    where: { id: company.id },
    select: { roomFinderOn: true, demotedWallsOff: true, scannedPlansOn: true, doorsWindowsOn: true, symbolCountOn: true },
  });
  // The door schedule rows the ingest read, newest per page, for the doors
  // panel's join — only for a company whose switch is on.
  const doorScheduleRows = roomFinder?.doorsWindowsOn ? await doorScheduleRowsOf(plan.id) : [];

  return {
    doorsWindowsOn: roomFinder?.doorsWindowsOn ?? false,
    doorScheduleRows,
    plan,
    sheets,
    symbolCountOn: roomFinder?.symbolCountOn ?? false,
    roomFinderOn: roomFinder?.roomFinderOn ?? false,
    // ON unless this company turned it off, and on for a company with no row.
    demotedWallsOn: !(roomFinder?.demotedWallsOff ?? false),
    scannedPlansOn: roomFinder?.scannedPlansOn ?? false,
    // The plan-text opt-in: the rail ranks the floor plans to scale first and
    // offers every sheet's printed scale in one press only for a company that
    // has turned plan-text reading on, the same switch the keyless sheet
    // names sit behind.
    planTextReadOn: (await aiGate(company.id, "PLAN_TEXT_READ")).ok,
    // The trained wall model, only for a company whose switch is on: ~80 KB
    // of trees that nobody else's page should carry.
    wallModel: (roomFinder?.demotedWallsOff ?? false) ? null : loadWallModel(process.env),
    // The plan's pages whose title block says ceiling plan or finish schedule, for the
    // room finder's ceilings: the viewer reads those pages' text itself when rooms are found.
    ceilingPages: roomFinder?.roomFinderOn ? await ceilingPagesOf(plan.id) : [],
    allWallTypes,
    postableWallTypes,
    printedScaleByPage,
    scannedPages,
    rasterByPage,
    storedWallsByPage,
    matchableItems,
    levelByPage,
    scalePrefillByPage,
    viewScalesByPage,
    scaleDeclineByPage,
    duplicateWallsByPage,
    sheetLabelByPage,
    sheetRows,
    items,
    isEstimateStage,
    scheduleSheetCount,
    /**
     * The wall types as the VIEWER takes them: matching only, and no Decimal.
     *
     * Mapped here rather than at each call site because `Decimal` does not
     * cross into a client component and two call sites is two chances to
     * forget — the takeoff tab's own comment says as much about `_count`. The
     * thickness is what reaches the untagged walls, which on a real sheet is
     * most of the footage.
     */
    /**
     * The library as the ASSEMBLY PANEL takes it: numbers rather than
     * Decimals, because a Decimal does not cross into a client component —
     * the same reason `viewerWallTypes` below is mapped here rather than at
     * the call site.
     */
    assemblyLibraryPinnedAt:
      assemblyLibraryPinnedAt === null ? null : assemblyLibraryPinnedAt.toISOString(),
    assemblies: allWallTypes.map((type) => ({
      id: type.id,
      code: type.code,
      name: type.name,
      defaultHeightFt: type.defaultHeightFt === null ? null : Number(type.defaultHeightFt),
      sides: type.sides,
      studSpacingIn: Number(type.studSpacingIn),
      boardLayers: type.boardLayers,
      components: type.components.map((component) => ({
        id: component.id,
        description: component.description,
        unit: component.unit,
        basis: component.basis,
        factor: Number(component.factor),
        wastePercent: Number(component.wastePercent),
        roundUp: component.roundUp,
        perLayer: component.perLayer,
        unitPrice:
          component.catalogEntry?.defaultUnitPrice == null
            ? null
            : Number(component.catalogEntry.defaultUnitPrice),
      })),
    })),
    viewerWallTypes: allWallTypes.map((type) => ({
      id: type.id,
      code: type.code,
      name: type.name,
      hasParts: type._count.components > 0,
      thicknessIn: type.thicknessIn === null ? null : Number(type.thicknessIn),
      summary: wallTypeSummary({ name: type.name, sides: type.sides, notes: type.notes, components: type.components.map((c) => ({ description: c.description, basis: c.basis, factor: Number(c.factor) })) }),
      defaultHeightFt: type.defaultHeightFt === null ? null : Number(type.defaultHeightFt),
    })),
  };
}

/**
 * ── WHAT A SECOND TAB COMPARES, AND WHY IT IS NOT A TIMESTAMP ──
 *
 * `TakeoffPlan` has no `updatedAt` — only `createdAt`, set when the drawing was
 * uploaded — so there is no column that moves when somebody saves a
 * measurement. Adding one is a migration, and a migration for a reload notice
 * is the wrong trade: it has to be announced before the push, it reaches
 * production on merge, and nothing else wants the column.
 *
 * So the signature is DERIVED from the rows that actually change, which is
 * also this repo's standing rule — a stored flag can disagree with what it was
 * derived from. Counts and the newest `createdAt` across the three tables a
 * save writes: a new calibration, measurement or wall proposal moves the date,
 * and a DELETE moves the count. Either way the string differs and the other
 * tab says so.
 *
 * It is not a lock and does not try to be. The later save wins, as it already
 * did; this only stops the loser showing numbers nobody is looking at.
 */
/**
 * ── WHAT THE CLIENT GETS, WHICH IS NOT WHAT THE LOADER RETURNS ──
 *
 * `loadTakeoffWorkspace` serves two callers. The job's takeoff TAB is a server
 * component and reads `plan.pages`; the takeoff WORKSPACE hands its result to
 * `<TakeoffWorkspace>`, a client component, so the whole payload crosses the
 * RSC boundary and React serialises it.
 *
 * A Prisma `Decimal` is a class instance, not a plain object, and React
 * refuses it: *"Only plain objects can be passed to Client Components from
 * Server Components. Decimal objects are not supported."* The page 500s and
 * nothing before it says why — the type is honest, typecheck is green, and
 * this file already calls `.toNumber()` in five other places. The row that did
 * it was `plan.pages[].calibrations[].declaredDistanceFeet`, reached because
 * `plan` was returned exactly as Prisma handed it over.
 *
 * So the narrowing lives HERE, at the boundary, rather than in the loader
 * where it would break the tab. The client reads four fields off `plan` —
 * grep `plan.` in `TakeoffWorkspace` — so it gets four.
 *
 * Narrowing rather than a deep sanitiser on purpose: this payload carries
 * thousands of walls, and walking all of it on every page load to repair a
 * shape nobody needed is the wrong trade. `workspacePayloadPlain.dbtest.ts`
 * walks it in the test instead, and fails on a Decimal or a Date anywhere.
 */
export function workspaceForClient<T extends { plan: PlanForClientInput }>(
  data: T,
): Omit<T, "plan"> & { plan: PlanForClient } {
  const { plan, ...rest } = data;
  return {
    ...rest,
    plan: {
      id: plan.id,
      fileName: plan.fileName,
      revisionLabel: plan.revisionLabel,
      // ISO rather than a Date: the client already does `new Date(...)` on it
      // and `TakeoffPlanRevisionForm` has typed it `string | null` all along.
      // A Date survives serialisation but lands on the client as a string
      // while the types still claim Date, which is quieter than the crash and
      // worse.
      sheetIssuedOn: plan.sheetIssuedOn === null ? null : plan.sheetIssuedOn.toISOString(),
    },
  };
}

type PlanForClientInput = {
  id: string;
  fileName: string | null;
  revisionLabel: string | null;
  sheetIssuedOn: Date | null;
};

export type PlanForClient = {
  id: string;
  fileName: string | null;
  revisionLabel: string | null;
  sheetIssuedOn: string | null;
};

export async function takeoffSavedSignature(companyId: string, jobId: string): Promise<string> {
  const plan = await prisma.takeoffPlan.findFirst({
    where: { jobId, companyId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (plan === null) return "no-plan";

  const [calibrations, measurements, proposals] = await Promise.all([
    prisma.takeoffScaleCalibration.aggregate({
      where: { page: { planId: plan.id } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.takeoffMeasurement.aggregate({
      where: { page: { planId: plan.id } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.takeoffWallProposal.aggregate({
      where: { page: { planId: plan.id } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
  ]);

  const part = (group: { _count: { _all: number }; _max: { createdAt: Date | null } }) =>
    `${group._count._all}@${group._max.createdAt?.toISOString() ?? "-"}`;
  return [plan.id, part(calibrations), part(measurements), part(proposals)].join("|");
}

/** Every row of the newest DOOR schedule read on each page of the plan, flattened. */
async function doorScheduleRowsOf(planId: string): Promise<StoredScheduleRow[]> {
  const proposals = await prisma.planScheduleProposal.findMany({
    where: { planId, kind: "DOOR" },
    orderBy: { createdAt: "desc" },
    select: { pageNumber: true, rows: true },
  });
  const seen = new Set<number>();
  const out: StoredScheduleRow[] = [];
  for (const p of proposals) {
    if (seen.has(p.pageNumber)) continue;
    seen.add(p.pageNumber);
    const rows = Array.isArray(p.rows) ? (p.rows as unknown[]) : [];
    for (const r of rows) {
      if (r !== null && typeof r === "object" && typeof (r as { mark?: unknown }).mark === "string") {
        const row = r as { mark: string; size?: string | null; description?: string | null };
        out.push({ mark: row.mark, size: row.size ?? null, description: row.description ?? null });
      }
    }
  }
  return out;
}
