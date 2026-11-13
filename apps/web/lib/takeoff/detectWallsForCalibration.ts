import type { PriorLine } from "./planCompare";
import { SheetTooSlowError, withTimeBudget } from "./timeBudget";
import { splitVariant, VARIANT_NOTES, variantNotes } from "./variantMark";
import { after } from "next/server";
import { prisma } from "@prova/db";
import { storedRasterFor } from "@/lib/plan-ingest/raster";
import { openSharedPlanPdf } from "@/lib/plan-ingest/sharedPlanPdf";
import { storePlanCaptions } from "./levelReads";
import type { SheetTextItem } from "./findWallsOnSheet";
import { asideExistingWalls, type ExistingDoorEvidence } from "./existingDoors";
import { productDetection, productSheetRuns, sampledSheetsFor, vocabularyFor } from "./productDetection";
import { userExclusionsFromRows } from "./userExclusions";
import type { ScoredPairing } from "./demotedRuns";
import { runsHeldOffEstimate } from "./estimateHold";
import { runScores } from "./wallReview";
import { loadWallModel } from "./wallModelFile";
import { SheetTooDenseError, type StrokeSegment, type WallCandidate } from "./wallVectors";
import { sameDesignation, type MatchableWallType } from "./wallTypeMatch";
import { namedCodeOf, proposalRowsFor } from "./wallProposal";
import { stampSuggestions } from "./suggestionStamp";
import { matchGroups } from "./proposalMatch";
import { groupsForStage, siblingPages } from "./stageGroups";
import { aiGate } from "@/lib/ai/settings";
import { wallTagCodes } from "./legendText";
import { doorScheduleForPlan, doorsOnSheet, LEGEND_TEXT_ON, legendForPlan, typedFeetOf, writeSheetResult } from "./planTextRead";

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

/** The least time the finder itself gets, however much sampling spent: inside the route's 60 s. */
export const FINDER_FLOOR_MS = 10_000;

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
export type DetectedBoundary = {
  pairings: WallCandidate[];
  segments: readonly StrokeSegment[];
  held: WallCandidate[];
  /** What the doors step needs to set existing doors aside: the walls set aside as existing, the demolition plan's doors (`existingDoors.ts`). */
  existingDoors?: ExistingDoorEvidence;
};

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
  /** Stored legend and schedule reads only, never the model: a suggestion refresh (`suggestionRefresh.ts`). */
  noModel?: boolean;
};

export async function detectWallsForCalibration(
  target: DetectTarget,
  clock: DetectClock = {},
): Promise<DetectOutcome> {
  const now = clock.now ?? (() => Date.now());
  const budgetMs = clock.budgetMs ?? DETECTION_BUDGET_MS;
  const startedAt = now();
  // When this run read the legend: a legend saved after it makes its suggestions stale (`suggestionStamp.ts`).
  const readAt = new Date();
  const spent = () => now() - startedAt;
  const outOfTime = () => spent() >= budgetMs;

  // SCOPED BY COMPANY in the read itself, not by a check afterwards — this runs
  // detached from the request, so there is no context left to trust.
  // BORROWED, not read: every finder used to fetch and open the whole set, so
  // Confirm on 35 sheets held 35 copies (ELEVEN03, 342 MB: 5.07 GB peak). The
  // plan's one open copy is shared (`openSharedPlanPdf`) and `close` gives it back.
  const shared = await openSharedPlanPdf(target.planId, target.companyId);
  if (!shared.ok) return "unreadable";
  const doc = shared.pdf;

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
    await doc.close();
    return "out-of-time";
  }

  // ONE DOCUMENT FOR BOTH LAYERS: text and strokes both come off `doc`.
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
    // Shared with training (`productDetection.ts`): the rows a model learns from use this same read.
    // RUNNING OUT HERE COSTS THE TEMPLATE FILTER, NOT THE WALLS: null skips the pass, never the sheet.
    const sampledSheets = await sampledSheetsFor({
      pageCount: doc.pageCount,
      pageNumber: target.pageNumber,
      own: raster === null ? strokes : null,
      read: (pageNumber) => doc.pageStrokes(pageNumber),
      outOfTime,
      onOutOfTime: (sampled) =>
        console.info("[takeoff] detection ran out of time", { planId: target.planId, pageNumber: target.pageNumber, afterMs: spent(), reading: "other sheets for the template", sampled }),
    });

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
    // A legend read from the pages' text (no model): its codes type walls only where the sheet prints them as tags.
    let fromText = false;
    if (planTextOn || LEGEND_TEXT_ON()) {
      try {
        const legend = await legendForPlan({ companyId: target.companyId, planId: target.planId, doc, outOfTime, noModel: target.noModel, textOnly: !planTextOn });
        fromText = legend?.fromText === true;
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
    const vocabulary = vocabularyFor({ wallTypes, legendCodes, textItems, segments: strokes.segments });
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
    // A breath for the server between the finder's synchronous stages (the second
    // session's spots): requests waiting behind a big sheet get their turn here.
    // Results are unchanged; nothing is read or written across the pause.
    await new Promise((resolve) => setImmediate(resolve));
    // ONE INPUT FOR THE PRODUCT AND FOR TRAINING (`productDetection.ts`, METHOD v2 feature parity).
    // ── THE FINDER IS SYNCHRONOUS, SO THE BUDGET GOES INSIDE IT ──
    // `outOfTime` is read between the awaits; a sheet that held the finder itself ran on past it
    // (Broadway A1.0: 357 s before 2026-11-13). What is left of the budget is handed in, but never
    // less than `FINDER_FLOOR_MS`: a budget spent on sampling drops the template pass, not the walls
    // (the test "does NOT give up when the budget runs out while sampling"). `SheetTooSlowError`
    // below says "out-of-time" like every other overrun.
    const detected = withTimeBudget(Math.max(budgetMs - spent(), FINDER_FLOOR_MS), () => productDetection(
      {
        segments: strokes.segments,
        textItems,
        pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
        feetPerUnit: target.feetPerUnit,
        wallTypes,
        legendCodes,
        scanned: raster !== null,
        sampledSheets,
        pairWithThicknesses,
      },
      target.onBoundary === undefined
        ? undefined
        : (features, wall) => {
            pairings.push(wall);
            scored.push({ x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2, thicknessFeet: wall.thicknessFeet, features: [...features] });
          },
    ));
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
    // Shared with the opening training rows (`productSheetRuns`): the runs doors and windows are found against.
    const offer = (priorPlan?: { lines: PriorLine[]; sheet: string }) =>
      productSheetRuns({ detected, segmentsPt: strokes.segments, widthPt: W, feetPerUnit: target.feetPerUnit, textItems, ...(user === null ? {} : { user }), ...(priorPlan === undefined ? {} : { priorPlan }) });
    await new Promise((resolve) => setImmediate(resolve));
    let offered = offer();
    let priorDoors: { doors: NonNullable<ExistingDoorEvidence["priorDoors"]>; sheet: string } | null = null;
    // ── PLAN COMPARISON, ON A PAIRED SHEET WITH THE COMPANY'S SWITCH ON — see `priorPlan.ts` ──
    //
    // The demolition plan is read from this same document. One that does not
    // line up sets nothing aside, which is the safe failure.
    if (raster === null) {
      try {
        const company = await prisma.company.findUnique({ where: { id: target.companyId }, select: { planCompareOn: true } });
        if (company?.planCompareOn === true) {
          // Loaded only for a company that turned it on: the pairer reads every
          // sheet's title, and nobody else's detection should pay for it.
          const [{ priorPlanFor }, { pairingsForPlan, sheetName }] = await Promise.all([import("./priorPlan"), import("./priorPlanLoad")]);
          const pairings = await pairingsForPlan(target.planId);
          const pairing = pairings.byPage.get(target.pageNumber);
          if (pairing !== undefined && pairing.demoPage >= 1 && pairing.demoPage <= doc.pageCount && pairing.demoPage !== target.pageNumber) {
            const demoStrokes = await doc.pageStrokes(pairing.demoPage);
            const demoText = (await doc.pageText(pairing.demoPage)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
            const prior = priorPlanFor({
              demo: { segments: demoStrokes.segments, textItems: demoText, widthPt: demoStrokes.widthPt, heightPt: demoStrokes.heightPt },
              newPage: { segments: strokes.segments, widthPt: W },
              newRuns: offered.offeredRuns,
              feetPerUnit: target.feetPerUnit,
            });
            const sheet = sheetName(pairings.sheets, pairing.demoPage);
            if (prior.lines !== null) {
              offered = offer({ lines: prior.lines, sheet });
              priorDoors = { doors: prior.doors ?? [], sheet };
            }
            // Kept for the screen, which otherwise never hears what was set aside (`PRIOR_PLAN_READ`).
            const aside = prior.lines === null ? [] : offered.setAsideLines.filter((l) => l.kind === "on-prior-plan");
            const { PRIOR_PLAN_READ } = await import("./priorPlanLoad");
            const value = { demoPage: pairing.demoPage, sheet, n: aside.length, feet: aside.reduce((sum, l) => sum + l.lengthFeet, 0), why: prior.lines === null ? prior.why : null };
            const where = { planId_pageNumber_kind: { planId: target.planId, pageNumber: target.pageNumber, kind: PRIOR_PLAN_READ } };
            await prisma.takeoffPlanTextRead.upsert({ where, create: { planId: target.planId, pageNumber: target.pageNumber, kind: PRIOR_PLAN_READ, value }, update: { value, computedAt: new Date() } });
          }
        }
      } catch (error) {
        console.error("[takeoff] plan comparison failed; offering without it", { planId: target.planId, page: target.pageNumber }, error);
      }
    }
    if (target.onBoundary !== undefined) {
      const company = await prisma.company.findUnique({ where: { id: target.companyId }, select: { demotedWallsOff: true } });
      const config = company?.demotedWallsOff === false ? loadWallModel(process.env) : null;
      const held = config === null ? [] : runsHeldOffEstimate(config.model, offered.offeredRuns, scored, target.feetPerUnit, raster !== null);
      // Each run's score rides into the stored walls, so a set-wide review can order every sheet's runs.
      if (config !== null && raster === null) {
        runScores(config.model, offered.offeredRuns, scored, target.feetPerUnit).forEach((score, at) => {
          if (score !== null) offered.offeredRuns[at]!.modelScore = score;
        });
      }
      target.onBoundary({
        pairings,
        segments: detected.found.inUnits,
        held,
        existingDoors: { asideWalls: asideExistingWalls(offered.setAsideLines), ...(priorDoors === null ? {} : { priorDoors: priorDoors.doors, priorSheet: priorDoors.sheet }) },
      });
    }
    await new Promise((resolve) => setImmediate(resolve));
    const found = { ...detected.found, walls: offered.offeredRuns, groups: detected.found.regroup(offered.offeredRuns) };
    // The groups: the finder's own when it paired with the thicknesses, else
    // rebuilt here with them — same runs, same feet, named with the types.
    // ── A TEXT-READ LEGEND'S GUARD (`wallTagCodes`): its codes this sheet does not print as wall tags
    // leave the vocabulary, and the groups are rebuilt with the rest — the path the eval measured.
    const untrusted =
      fromText && legendCodes !== null
        ? (() => {
            const trusted = wallTagCodes({ text: textItems, segments: strokes.segments, walls: found.walls, widthPt: strokes.widthPt, feetPerUnit: target.feetPerUnit, codes: legendCodes });
            return new Set(legendCodes.filter((c) => !trusted.has(c.toUpperCase())));
          })()
        : null;
    const guardedCodes = untrusted === null ? (planText?.legendCodes ?? null) : (planText?.legendCodes.filter((c) => !untrusted.has(c.toUpperCase())) ?? null);
    let groups = pairWithThicknesses && untrusted === null
      ? found.groups
      : groupsForStage({ found, segmentsPt: strokes.segments, textItems, widthPt: strokes.widthPt, feetPerUnit: target.feetPerUnit, wallTypes, legendCodes: guardedCodes, midSpan: (legendCodes ?? []).length === 0 }).groups;
    // ── NO TAG ON THIS SHEET: READ THEM OFF ITS SIBLING — see `tagsFromSibling` ──
    if (!pairWithThicknesses && planText !== undefined && raster === null && !groups.some((g) => g.source.kind === "TAG")) {
      try {
        const { pairingsForPlan } = await import("./priorPlanLoad");
        for (const page of siblingPages((await pairingsForPlan(target.planId)).sheets, target.pageNumber)) {
          if (page < 1 || page > doc.pageCount) continue;
          const other = await doc.pageStrokes(page);
          const otherText = (await doc.pageText(page)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
          const withSibling = groupsForStage({ found, segmentsPt: strokes.segments, textItems, widthPt: strokes.widthPt, feetPerUnit: target.feetPerUnit, wallTypes, legendCodes: planText.legendCodes, sibling: { segmentsPt: other.segments, textItems: otherText, widthPt: other.widthPt }, midSpan: (legendCodes ?? []).length === 0 }).groups;
          if (withSibling.some((g) => g.source.kind === "TAG")) {
            groups = withSibling;
            break;
          }
        }
      } catch (error) {
        console.error("[takeoff] sibling-sheet tags failed; grouping without them", { planId: target.planId, page: target.pageNumber }, error);
      }
    }
    // ── WHAT A MARKED TAG MEANS, FOR THE QUEUE (`variantMark.ts`) ──
    // "C6*" types as C6; the words printed with it ride beside the groups so the
    // suggestion can say "C6 (C6* at tub/shower locations, see legend)". Only a
    // sheet that prints one gets a row, and a failed write costs the words only.
    if (groups.some((g) => g.source.kind === "TAG" && splitVariant(g.source.tag).mark !== "")) {
      try {
        const value = variantNotes(textItems);
        const where = { planId_pageNumber_kind: { planId: target.planId, pageNumber: target.pageNumber, kind: VARIANT_NOTES } };
        await prisma.takeoffPlanTextRead.upsert({ where, create: { planId: target.planId, pageNumber: target.pageNumber, kind: VARIANT_NOTES, value }, update: { value, computedAt: new Date() } });
      } catch (error) {
        console.error("[takeoff] variant notes not saved; the suggestion shows the bare mark", { planId: target.planId, page: target.pageNumber }, error);
      }
    }
    if (planTextOn) {
      try {
        const schedule = await doorScheduleForPlan({ companyId: target.companyId, planId: target.planId, doc, outOfTime, noModel: target.noModel });
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

    // Which plan on the sheet shows which level, for each wall's floor-to-floor. Never at
    // the walls' cost: a sheet whose captions do not store still posts, with no level.
    await storePlanCaptions(target.planId, target.pageNumber, textItems, strokes.widthPt).catch((error) =>
      console.error("[takeoff] plan captions not stored", { planId: target.planId, pageNumber: target.pageNumber }, error),
    );
    await prisma.takeoffWallProposal.createMany({
      data: proposalRowsFor(
        groups,
        { pageId: target.pageId, calibrationId: target.calibrationId },
        matched,
      ),
    });
    await stampSuggestions(target.planId, target.pageNumber, readAt).catch((error) =>
      console.error("[takeoff] suggestion stamp not stored", { planId: target.planId, pageNumber: target.pageNumber }, error),
    );
    return "written";
  } catch (error) {
    // `SheetTooDenseError` IS A FACT ABOUT THE DRAWING rather than a failure: a
    // sheet with more geometry than the pairing budget allows is refused by
    // design, and the viewer says so in its own words when somebody opens it.
    // Logged at info, not error, so it does not read as a fault in the alerting.
    if (error instanceof SheetTooSlowError) {
      console.info("[takeoff] sheet ran past the detection budget", { planId: target.planId, pageNumber: target.pageNumber, stage: error.stage });
      return "out-of-time";
    }
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
    // Gives the shared copy back; the last loan out closes it after a while.
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
/**
 * ── ONE FINDER AT A TIME PER SERVER INSTANCE ──
 *
 * Confirm scales saves one calibration per sheet, and each save starts a finder
 * here: 35 sheets started 35 at once, and the floor plan the person was waiting
 * on queued behind all of them (Topeka: its printed-scale Apply waited ~49 s).
 * The rest wait their turn. A waiting finder's time does not count against its
 * own budget (`DETECTION_BUDGET_MS` starts when it starts).
 *
 * ONE, because finding walls is CPU work on Node's one thread: a second at the
 * same time finishes no sooner, and holds a second sheet's parse in memory (two
 * at once put ELEVEN03's finder phase at 3.2 GB). Every finder goes through here:
 * after a scale save (in turn), a whole-set run's sheet and a refresh somebody
 * pressed (at the front), and the sheet Run takeoff is waiting on, which starts at
 * once beside the running one (`hurryFinder`).
 */
const FINDERS_AT_ONCE = 1;
// ON `globalThis`, for the reason `sharedPlanPdf.ts` gives: Confirm scales queues
// finders from the job page's bundle and Run takeoff asks to hurry one from the
// workspace's, and with module state those were two different queues — the hurry
// found nothing and A3.2 waited its turn (ELEVEN03: 102 s).
type FinderSlots = { running: number; waiting: { key: string | null; go: (hurried: boolean) => void }[]; userWork: number; lastUserWork: number; holderQuietWaiting: boolean };
const slots = ((globalThis as unknown as { __provaFinderSlots?: FinderSlots }).__provaFinderSlots ??= { running: 0, waiting: [], userWork: 0, lastUserWork: 0, holderQuietWaiting: false });

/**
 * ── A BACKGROUND FINDER WAITS FOR A QUIET MOMENT ──
 *
 * A finder is one synchronous call of 10–20 s on a big sheet, and nothing else on
 * the server runs meanwhile. Started between the database calls of an Accept all,
 * one after another, they starved it past a minute (ELEVEN03, 15 groups). So a
 * finder started after a scale save does not start while a person's action is in
 * flight, nor for `QUIET_MS` after one (the page refresh that follows). It cannot
 * stop one already running — that is the finder's own speed.
 */
const QUIET_MS = 2_000;
export function beginUserWork(): { end: () => void } {
  slots.userWork += 1;
  let ended = false;
  return {
    end: () => {
      if (ended) return;
      ended = true;
      slots.userWork -= 1;
      slots.lastUserWork = Date.now();
    },
  };
}
export async function asUserWork<T>(work: () => Promise<T>): Promise<T> {
  const working = beginUserWork();
  try {
    return await work();
  } finally {
    working.end();
  }
}
async function quietMoment(): Promise<void> {
  while (slots.userWork > 0 || Date.now() - slots.lastUserWork < QUIET_MS) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
const findersWaiting = slots.waiting;
export async function oneFinderSlot<T>(work: () => Promise<T>, key: string | null = null, urgent = false): Promise<T> {
  let hurried = false;
  // A finished finder hands its slot straight to the next in line, so a new
  // arrival can never slip in between and make it three.
  if (urgent && slots.running >= FINDERS_AT_ONCE && slots.holderQuietWaiting) {
    // The holder is only waiting for quiet and holds no sheet: an urgent one starts beside it.
    slots.running += 1;
  } else if (slots.running >= FINDERS_AT_ONCE) {
    await new Promise<void>((resolve) => {
      // An urgent one (a whole-set run's sheet, on a deadline) goes to the front.
      const go = (asked: boolean) => ((hurried = asked), resolve());
      if (urgent) findersWaiting.unshift({ key, go });
      else findersWaiting.push({ key, go });
    });
  } else slots.running += 1;
  if (!urgent && !hurried) {
    slots.holderQuietWaiting = true;
    try {
      await quietMoment();
    } finally {
      slots.holderQuietWaiting = false;
    }
  }
  try {
    return await work();
  } finally {
    // Over the limit (a hurried one ran beside it): this slot ends rather than passing on.
    const next = slots.running > FINDERS_AT_ONCE ? undefined : findersWaiting.shift();
    if (next) next.go(false);
    else slots.running -= 1;
  }
}

/**
 * The sheet somebody is waiting on goes to the front of the line. Confirm on 47
 * sheets queued 47 finders; the workspace's Run takeoff then waited 251 s for its
 * own sheet's finder at the back (ELEVEN03). Returns whether one was waiting.
 */
export function hurryFinder(planId: string, pageNumber: number): boolean {
  const at = findersWaiting.findIndex((entry) => entry.key === `${planId}:${pageNumber}`);
  if (at < 0) return false;
  // It starts NOW, beside the one running, not after it (that wait was 7 s of
  // ELEVEN03's 27.6 s): one extra finder, only for the sheet somebody is waiting on.
  const [entry] = findersWaiting.splice(at, 1);
  slots.running += 1;
  entry!.go(true);
  return true;
}

export function detectWallsAfterResponse(target: DetectTarget): void {
  try {
    after(() =>
      oneFinderSlot(() => detectWallsForCalibration(target), `${target.planId}:${target.pageNumber}`).catch((error) => {
        // Unreachable in practice — the function above catches everything — and
        // kept because "unreachable" is a claim about today's code.
        console.error("[takeoff] detection after response failed", { planId: target.planId }, error);
      }),
    );
  } catch {
    // Not in a request scope. See above.
  }
}
