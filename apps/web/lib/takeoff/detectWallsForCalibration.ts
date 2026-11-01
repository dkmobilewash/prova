import { after } from "next/server";
import { prisma } from "@prova/db";
import { readPlanBytes } from "@/lib/plan-ingest/planBytes";
import { storedRasterFor } from "@/lib/plan-ingest/raster";
import { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import { pagesToSample } from "./sheetTemplate";
import { inPageWidthUnits, type SheetTextItem } from "./findWallsOnSheet";
import { detectForSheet, offeredCandidates } from "./offeredCandidates";
import { userExclusionsFromRows } from "./userExclusions";
import type { ScoredPairing } from "./demotedRuns";
import { runsHeldOffEstimate } from "./estimateHold";
import { loadWallModel } from "./wallModelFile";
import { SheetTooDenseError, type StrokeSegment, type WallCandidate } from "./wallVectors";
import { sameDesignation, type MatchableWallType } from "./wallTypeMatch";
import { namedCodeOf, proposalRowsFor } from "./wallProposal";
import { matchGroups } from "./proposalMatch";
import { groupsForStage } from "./stageGroups";
import { aiGate } from "@/lib/ai/settings";
import { tagVocabulary } from "./planTextTags";
import { doorScheduleForPlan, doorsOnSheet, legendForPlan, typedFeetOf, writeSheetResult } from "./planTextRead";

/**
 * FINDING THE WALLS THE MOMENT A SCALE IS ACCEPTED, so the groups are waiting
 * when the estimator looks at the sheet instead of sitting behind a button.
 *
 * ── IT MUST NEVER FAIL THE SAVE ──
 *
 * This runs AFTER the response has gone out, and every path out of it is
 * caught. A calibration that succeeded and then reported failure because a
 * courtesy job threw is a worse bug than no detection at all: the estimator
 * would retype a scale that is already stored, and the second save is the one
 * that would look broken.
 *
 * So the contract is one-way. It writes proposals or it writes nothing, and
 * either way the browser has already been answered.
 *
 * ── WHY A SAVED CALIBRATION IS THE ONLY TRIGGER ──
 *
 * One answer to "why did this run", which is what makes it debuggable. It is
 * also the first moment detection is POSSIBLE — wall geometry in page-width
 * units is not a length until something says how big the sheet is — and the
 * moment it is most wanted, because somebody has just said which sheet they
 * care about.
 */

/**
 * How long detection may work before stopping itself.
 *
 * ── IT WAS BEING KILLED, AND A KILL LEAVES NOTHING BEHIND ──
 *
 * Measured on production, 2026-10-15, on a 52-sheet bid set: the save connected
 * at 02:11:38.758 and pdf.js was still LOADING at 02:11:46.464 — 7.7 seconds in,
 * almost all of it `readPlanBytes` pulling the whole plan set out of blob
 * storage. The invocation ended there. No proposals, no log line, and a 503 on a
 * save that had in fact stored the calibration correctly.
 *
 * The invisibility is the defect. Nothing distinguished "this sheet has no
 * walls" — which writes nothing BY DESIGN, see below — from "this was cut off
 * before it looked". So the route's budget went to 60s and this one expires
 * first, by the margin `plan-ingest/runner.ts` uses and for the reason it
 * states: *stopping ourselves beats being stopped*.
 *
 * `runner.ts` also establishes the shape: a budget reading `Date.now()` can only
 * be tested by waiting for it, so the clock is INJECTED and the deadline becomes
 * a test that runs in a millisecond.
 */
export const DETECTION_BUDGET_MS = 45_000;

/** Injected so the deadline is testable without waiting for it. */
export type DetectClock = { now?: () => number; budgetMs?: number };

/**
 * What a run did, so a caller — or a test — can tell the outcomes apart without
 * reading the log. Every one of these writes nothing except `written`.
 */
export type DetectOutcome =
  | "written"
  | "nothing-found"
  | "out-of-time"
  | "unreadable"
  | "no-such-page"
  | "too-dense"
  | "failed";

/** What the room step needs from a detection, so it need not detect again. */
export type DetectedBoundary = { pairings: WallCandidate[]; segments: readonly StrokeSegment[]; held: WallCandidate[] };

export type DetectTarget = {
  /** Handed every pairing and the sheet's strokes in page-width units, when a caller wants the rooms too. */
  onBoundary?: (boundary: DetectedBoundary) => void;
  pageId: string;
  calibrationId: string;
  planId: string;
  companyId: string;
  /** 1-based, the way the viewer and the title block both count. */
  pageNumber: number;
  /** Feet per page WIDTH unit, from the calibration this is keyed to. */
  feetPerUnit: number;
  wallTypes: MatchableWallType[];
  /**
   * Whether the finder may pair with the types' thicknesses. The WALLS
   * stage says false (Diego, 2026-10-29): the finder then gets the types
   * without thickness, so a whole-set takeoff is identical with or without
   * wall types, and the groups are rebuilt beside it with the thick ones
   * (`stageGroups.ts`). Absent, the finder behaves as it always has.
   */
  pairWithThicknesses?: boolean;
};

export async function detectWallsForCalibration(
  target: DetectTarget,
  clock: DetectClock = {},
): Promise<DetectOutcome> {
  const now = clock.now ?? (() => Date.now());
  const budgetMs = clock.budgetMs ?? DETECTION_BUDGET_MS;
  const startedAt = now();
  const spent = () => now() - startedAt;
  const outOfTime = () => spent() >= budgetMs;

  // SCOPED BY COMPANY in the read itself, not by a check afterwards — this runs
  // detached from the request, so there is no context left to trust.
  const read = await readPlanBytes(target.planId, target.companyId);
  if (!read.ok) return "unreadable";

  // THE DOWNLOAD IS THE EXPENSIVE PART and it has already happened, so this is
  // the first honest place to ask. Giving up here is the only hard stop: past
  // it there is always a smaller job worth finishing.
  if (outOfTime()) {
    console.info("[takeoff] detection ran out of time", {
      planId: target.planId,
      pageNumber: target.pageNumber,
      afterMs: spent(),
      reading: "the plan file",
    });
    return "out-of-time";
  }

  // ONE DOCUMENT FOR BOTH LAYERS. `openPlanPdf` hands the bytes to pdfjs as a
  // VIEW and pdfjs DETACHES the buffer behind it, so a second open on the same
  // Buffer throws `Cannot perform Construct on a detached ArrayBuffer` — the
  // trap `PlanPdf.pageStrokes` documents.
  const doc = await openPlanPdf(read.bytes);
  try {
    if (target.pageNumber < 1 || target.pageNumber > doc.pageCount) return "no-such-page";

    // ── A SCANNED SHEET READS FROM WHAT THE RASTER STAGE STORED ──
    // The file has no strokes and no text for it; the stage read both off
    // the bitmap, in the same points. Everything after this line is the
    // same finder on the same shapes.
    const raster = await storedRasterFor(target.planId, target.pageNumber);
    const strokes = raster
      ? { segments: raster.segments, widthPt: raster.widthPt, heightPt: raster.heightPt }
      : await doc.pageStrokes(target.pageNumber);
    const text = raster ? null : await doc.pageText(target.pageNumber);
    const textItems: SheetTextItem[] = raster
      ? raster.textItems
      : (text?.items ?? []).map((item) => ({
          str: item.str,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
        }));

    // THE SET'S OWN TEMPLATE, read off other sheets. The frame, the title block
    // and the logo are the only geometry at the same page position on every
    // sheet of a set; a wall is not. Each sampled sheet is converted in ITS OWN
    // page width, which is what makes two sheets comparable at all.
    const sampledSheets: StrokeSegment[][] = [];
    let sampleFailed = false;
    for (const pageNumber of pagesToSample(doc.pageCount, target.pageNumber)) {
      // ── RUNNING OUT HERE COSTS THE TEMPLATE FILTER, NOT THE WALLS ──
      //
      // Sampling is the long tail: six more pages parsed to learn where the
      // frame and the title block sit. The sheet in front of somebody is
      // already read by this point, so the right answer to a deadline is the
      // same one a failed page gets three lines below — drop the template pass
      // and detect anyway. The fail-safe direction this file and
      // `sheetTemplate.ts` both state is "no template filter", never "no walls".
      if (outOfTime()) {
        console.info("[takeoff] detection ran out of time", {
          planId: target.planId,
          pageNumber: target.pageNumber,
          afterMs: spent(),
          reading: "other sheets for the template",
          sampled: sampledSheets.length,
        });
        sampleFailed = true;
        break;
      }
      try {
        const other = await doc.pageStrokes(pageNumber);
        sampledSheets.push(other.segments.map(inPageWidthUnits(other.widthPt)));
      } catch {
        // ONE BAD PAGE MUST NOT COST THE SHEET IN FRONT OF SOMEBODY. The
        // fail-safe direction is "no template filter", never "no walls", so a
        // partial read is discarded rather than used — and `null` is how the
        // pipeline is told to skip the pass entirely.
        sampleFailed = true;
        break;
      }
    }

    // ── PLAN TEXT, BEHIND THE SWITCH ──
    //
    // Off (the default, per company — `OPT_IN_FEATURES`), `planText` stays
    // undefined and nothing below this comment runs. On, the set's legend is read once (cached) and its codes
    // are what the finder's symbol tags are filtered by; the door schedule and
    // the per-sheet join follow once the groups exist. A failure in any of it
    // logs and leaves the detection exactly as it would have been.
    const planTextOn = (await aiGate(target.companyId, "PLAN_TEXT_READ")).ok;
    let legendCodes: string[] | null = null;
    let legendPage: number | null = null;
    // The company's types, with the legend's own "unless noted otherwise"
    // sentence on the type it names (`MatchableWallType.unoNote`), so a sheet
    // with no such note of its own still gets the legend's default.
    let wallTypes: MatchableWallType[] = target.wallTypes;
    if (planTextOn) {
      try {
        const legend = await legendForPlan({ companyId: target.companyId, planId: target.planId, doc, outOfTime });
        if (legend !== null) {
          legendCodes = legend.codes;
          legendPage = legend.page;
          const uno = legend.uno ?? [];
          if (uno.length > 0) wallTypes = target.wallTypes.map((type) => ({ ...type, unoNote: uno.find((u) => sameDesignation(u.code, type.code))?.note ?? type.unoNote ?? null }));
        }
      } catch (error) {
        console.error("[takeoff] legend read failed; detecting without it", { planId: target.planId }, error);
      }
    }
    // ── THE SYMBOL TAGS RUN WITH OR WITHOUT THE SWITCH ──
    // The vocabulary is the company's own codes, plus the legend's when read
    // (`tagVocabulary`). A company with no wall types has no vocabulary and
    // gets the detection it always had.
    const vocabulary = tagVocabulary(
      wallTypes.map((type) => type.code),
      legendCodes,
    );
    const planText = vocabulary.length === 0 ? undefined : { legendCodes: vocabulary };
    // ── THE SAME PIPELINE THE VIEWER RUNS, NOT THE FINDER UNDERNEATH IT ──
    //
    // This called `findWallsOnSheet` on the WHOLE SHEET. The viewer has not
    // done that since view detection landed — it calls `detectForSheet`, which
    // splits the sheet into drawings, keeps the plan views and measures each
    // at its own scale. So the two paths disagreed about what a sheet even
    // contains, and this one measured ELEVATIONS as walls: Baker A401 came
    // back as 88 walls, 796 ft.
    //
    // Everything downstream inherited it — the calibration save, the whole-set
    // takeoff, and every row they wrote. One pipeline, one answer.
    const pairWithThicknesses = target.pairWithThicknesses !== false;
    const pairings: WallCandidate[] = [];
    const scored: ScoredPairing[] = [];
    const detected = detectForSheet({
      segments: strokes.segments,
      textItems,
      ...(target.onBoundary === undefined ? {} : {
            onCandidate: (features: readonly number[], wall: WallCandidate) => {
              pairings.push(wall);
              scored.push({ x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2, thicknessFeet: wall.thicknessFeet, features: [...features] });
            },
          }),
      pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
      feetPerUnit: target.feetPerUnit,
      wallTypes: pairWithThicknesses ? wallTypes : wallTypes.map((type) => ({ ...type, thicknessIn: null })),
      scanned: raster !== null,
      sampledSheets: sampleFailed ? null : sampledSheets,
      ...(planText === undefined ? {} : { planText }),
    });
    // ── AND THE SAME SET-ASIDES THE VIEWER APPLIES, NOT THE FINDER'S RAW RUNS ──
    //
    // `detectForSheet` is only half of what the viewer shows. The other half
    // is `offeredCandidates`: the legend box, the dashed faces, the title
    // underline, the schedule rows, the site equipment, the existing wall —
    // each set aside with its reason. This posted `found.groups` straight
    // from the finder, so NONE of that reached a whole-set estimate while
    // every one of them was measured and shipped against the viewer's list.
    // Same call, same arguments as `TakeoffPlanViewer`; the stage then
    // regroups what survived with the finder's own grouping.
    const W = strokes.widthPt;
    // ── AND WHAT THE USER EXCLUDED ON THIS SHEET — see `userExclusions.ts` ──
    //
    // The viewer reads the same rows, so the estimate and the screen agree.
    // A page with none is detected as it always was.
    const exclusionRows = await prisma.takeoffSheetExclusion.findMany({
      where: { pageId: target.pageId },
      select: { kind: true, xs: true, ys: true },
    });
    const user = userExclusionsFromRows(exclusionRows);
    const offered = offeredCandidates({
      walls: detected.found.walls,
      segments: detected.found.inUnits.map((one) => ({ ...one, x1: one.x1 * W, y1: one.y1 * W, x2: one.x2 * W, y2: one.y2 * W })),
      pageSegments: strokes.segments,
      widthPt: W,
      feetPerUnit: target.feetPerUnit,
      planBoxes: detected.planBoxes,
      textItems,
      ...(user === null ? {} : { user }),
    });
    if (target.onBoundary !== undefined) {
      const company = await prisma.company.findUnique({ where: { id: target.companyId }, select: { demotedWallsOff: true } });
      const config = company?.demotedWallsOff === false ? loadWallModel(process.env) : null;
      const held = config === null ? [] : runsHeldOffEstimate(config.model, offered.offeredRuns, scored, target.feetPerUnit, raster !== null);
      target.onBoundary({ pairings, segments: detected.found.inUnits, held });
    }
    const found = { ...detected.found, walls: offered.offeredRuns, groups: detected.found.regroup(offered.offeredRuns) };
    // The groups: the finder's own when it paired with the thicknesses, else
    // rebuilt here with them — same runs, same feet, named with the types.
    const groups = pairWithThicknesses
      ? found.groups
      : groupsForStage({ found, segmentsPt: strokes.segments, textItems, widthPt: strokes.widthPt, feetPerUnit: target.feetPerUnit, wallTypes, legendCodes: planText?.legendCodes ?? null }).groups;
    if (planTextOn) {
      try {
        const schedule = await doorScheduleForPlan({ companyId: target.companyId, planId: target.planId, doc, outOfTime });
        const doors =
          schedule === null
            ? null
            : {
                schedulePage: schedule.page,
                ...doorsOnSheet({
                  segments: strokes.segments,
                  widthPt: strokes.widthPt,
                  text: textItems,
                  walls: found.walls,
                  feetPerUnit: target.feetPerUnit,
                  rows: schedule.rows,
                }),
              };
        await writeSheetResult({
          planId: target.planId,
          pageNumber: target.pageNumber,
          calibrationId: target.calibrationId,
          legend: legendCodes === null || legendPage === null ? null : { page: legendPage, codes: legendCodes },
          doors,
          typed: typedFeetOf(groups),
        });
      } catch (error) {
        console.error("[takeoff] door join failed; proposals unaffected", { planId: target.planId }, error);
      }
    }

    // NOTHING FOUND IS NOT A FAILURE AND WRITES NOTHING. A sheet with no walls
    // on it — a schedule, a detail page, a site plan — is a fact about the
    // drawing, and a row saying "no walls" would be indistinguishable from
    // never having looked.
    if (groups.length === 0) return "nothing-found";

    // APPEND-ONLY, so there is nothing to delete first. A second run under the
    // same calibration writes a second set; the reader takes the newest
    // `createdAt`, and `createMany` gives every row of one run the same one.
    // ── WHICH CONDITION EACH GROUP PROPOSES INTO ──
    //
    // Detection ADDS to an item somebody named rather than landing in a pile
    // called "Add these". The rules are in `proposalMatch.ts` — the drawing's
    // own wall tag first, the measured thickness last, and a REFUSAL on a tie
    // — and a group that matches nothing keeps a null and shows as
    // "Unassigned walls", which an estimator sorts in a minute.
    //
    // A job with no items matches nothing, which is the ordinary state until
    // somebody names a condition and costs one query to establish.
    // THE JOB, VIA THE PLAN. `DetectTarget` carries the plan and the company
    // but not the job — it is keyed on a page, and a page belongs to a plan.
    // One lookup rather than widening the type, because every other caller of
    // that type has no use for a job id.
    const plan = await prisma.takeoffPlan.findUnique({
      where: { id: target.planId },
      select: { jobId: true },
    });
    const items = plan === null
      ? []
      : await prisma.takeoffItem.findMany({
      where: { jobId: plan.jobId, companyId: target.companyId },
      select: { id: true, name: true, thicknessIn: true, wallType: { select: { code: true } } },
    });
    const { matched } = matchGroups(
      groups.map((group) => ({
        namedCode: namedCodeOf(group),
        thicknessInches: group.inches,
      })),
      items.map((item) => ({
        id: item.id,
        name: item.name,
        thicknessIn: item.thicknessIn === null ? null : Number(item.thicknessIn),
        assemblyCode: item.wallType?.code ?? null,
      })),
    );

    await prisma.takeoffWallProposal.createMany({
      data: proposalRowsFor(
        groups,
        { pageId: target.pageId, calibrationId: target.calibrationId },
        matched,
      ),
    });
    return "written";
  } catch (error) {
    // `SheetTooDenseError` IS A FACT ABOUT THE DRAWING rather than a failure: a
    // sheet with more geometry than the pairing budget allows is refused by
    // design, and the viewer says so in its own words when somebody opens it.
    // Logged at info, not error, so it does not read as a fault in the alerting.
    if (error instanceof SheetTooDenseError) {
      console.info("[takeoff] sheet too dense to detect", {
        planId: target.planId,
        pageNumber: target.pageNumber,
      });
      return "too-dense";
    }
    console.error(
      "[takeoff] wall detection after calibration failed",
      { planId: target.planId, pageNumber: target.pageNumber },
      error,
    );
    return "failed";
  } finally {
    // pdfjs holds per-document state, which `PlanPdf.close` exists for.
    await doc.close().catch(() => {});
  }
}

/**
 * The same work, started once the response has gone out.
 *
 * `after()` keeps the function alive for it; a bare `void` would not, which is
 * what `floatingPromiseCensus` is for. Outside a request — a database test, a
 * script — `after()` THROWS and there is nothing to outlive, so nothing runs:
 * detection is a courtesy to the person who just pressed Save, not a job queue.
 * Modelled on `runAgentAfterResponse`, which carries the same reasoning.
 *
 * NOTHING HERE CAN REACH THE CALLER. The inner work catches its own errors and
 * this catches `after()` itself, so an action that calls it cannot be made to
 * fail by anything detection does.
 */
export function detectWallsAfterResponse(target: DetectTarget): void {
  try {
    after(() =>
      detectWallsForCalibration(target).catch((error) => {
        // Unreachable in practice — the function above catches everything — and
        // kept because "unreachable" is a claim about today's code.
        console.error("[takeoff] detection after response failed", { planId: target.planId }, error);
      }),
    );
  } catch {
    // Not in a request scope. See above.
  }
}
