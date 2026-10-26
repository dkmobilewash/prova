"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pickOnClick } from "@/lib/takeoff/clickPick";
import {
  SNAP_RADIUS,
  closesRing,
  moveVertex,
  nearestOnSegment,
  pointInRing,
  vertexAt,
  extendByLength,
  lockToAxis,
  rectanglePoints,
  snapToGeometry,
  type SnapTarget,
} from "@/lib/takeoff/drawTools";

import { ActionForm } from "@/components/ActionForm";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { Spinner } from "@/components/Spinner";
import { SubmitButton } from "@/components/SubmitButton";
import { canvasPlan } from "@/lib/takeoff/canvasPlan";
import { DISTINCT_MARKS, SHOWN_AT_FIRST, markFor } from "@/lib/takeoff/clusterMarks";
import { formatFeetInches, parseFeetInches } from "@/lib/feet-inches";
import {
  calibrationNotices,
  calibrationRefusal,
  feetPerPageWidth,
  polylineLength,
  readScale,
  ringArea,
  ringSelfIntersects,
  verticesProblem,
  type MeasurementKind,
  type StoredCalibration,
} from "@/lib/takeoff-plan";
import {
  addMeasurementCutout,
  deleteTakeoffMeasurement,
  saveTakeoffCalibration,
  saveTakeoffMeasurement,
  saveTakeoffMeasurements,
  updateMeasurementGeometry,
} from "@/lib/actions";
import type {
  PlanSheet,
  PrintedScaleByPage,
  ScaleDeclineByPage,
  ScalePrefill,
  ScalePrefillByPage,
} from "@/lib/takeoff-plan-view";
import {
  errorBandText,
  evidenceOrder,
  fitZoom,
  fitWidthZoom,
  stepZoom,
  TOOLS,
  ZOOM_STEPS,
  type ToolId,
} from "@/lib/takeoff-plan-view";
import {
  type WallCandidate,
  inchLabel,
  type StrokeSegment,
} from "@/lib/takeoff/wallVectors";
import { classifyWallCandidates } from "@/lib/actions/takeoffClassify";
import { loadPlanText, type PlanTextView } from "@/lib/actions/planTextRead";
import { PlanTextPanel } from "@/components/PlanTextPanel";
import { isPropagatedTag, plainTag } from "@/lib/takeoff/planTextTags";
import { doorsByGroup, feetInches } from "@/lib/takeoff/planTextView";
import { readScannedSheetTile } from "@/lib/actions/takeoffReadSheet";
import { BLANK_TILE_INK, TILE_PT, TILE_PX } from "@/lib/takeoff/rasterText";
import { demotedRuns, demotedSentence, demotedWord, demotes, modelVerdicts, type RunVerdict } from "@/lib/takeoff/demotedRuns";
import type { WallModel } from "@/lib/takeoff/wallClassifier";
import type { WallClassifyLabel } from "@prova/integrations";
import { ceilingsForRooms, type CeilingPageText, type RoomCeiling } from "@/lib/takeoff/roomCeilings";
import { tableRowsFromPage } from "@/lib/plan-ingest/scheduleTable";
import { pagesToSample } from "@/lib/takeoff/sheetTemplate";
import { findWallsOnSheet, inPageWidthUnits, type FoundOnSheet } from "@/lib/takeoff/findWallsOnSheet";
import { SheetTooDenseError, oneFacePerLine, wallFromPair } from "@/lib/takeoff/wallVectors";
import { layersOf, segmentsFromOpenPage } from "@/lib/takeoff/sheetStrokes";
import { droppedLayersSentence, type LayerDrop } from "@/lib/takeoff/layerNames";
import { sheetNumberFrom } from "@/lib/plan-ingest/sheetNumber";
import {
  cautionToShow,
  duplicateWallsCaution,
  multiScaleCaution,
  sheetSuitability,
  viewsMeasuredCaution,
} from "@/lib/takeoff/sheetSuitability";
import { printedScalesOnPage } from "@/lib/takeoff/printedScales";
import {
  excludedViews,
  primaryView,
  sheetViews,
  viewRegions,
  viewsInRegions,
  wallsPerView,
  type ExcludedView,
  type ViewWalls,
} from "@/lib/takeoff/sheetViews";
import { tagSentence } from "@/lib/takeoff/wallTags";
import {
  verdictFor,
  groupSentence,
  groupChoices,
  typeOptionLabel,
  wallsOnThisSheet,
  storedWallsFor,
  type WallGroup,
  type GroupVerdict,
} from "@/lib/takeoff/wallGroups";
import { proposalSections, showsHeadings } from "@/lib/takeoff/proposalSections";
import { calibrationForView, type ViewScale } from "@/lib/takeoff/sheetScale";
import { SINGLE_LINE_COLOUR, VERDICT_COLOURS } from "@/components/AnswerKeyPanel";
import { onThisSheet, setOnThisSheet } from "@/lib/takeoff/perSheet";
import { drawingRegions, segmentsInRegions } from "@/lib/takeoff/planRegion";
import { takeoffSheetVerdict, type TakeoffSheetVerdict } from "@/lib/takeoff/takeoffSheet";
import {
  candidatesFromSheet,
  candidatesInBox,
  setVerdict,
  type Candidate,
  type ReviewState,
} from "@/lib/takeoff/answerKeyReview";
import { offeredCandidates } from "@/lib/takeoff/offeredCandidates";
import type { MatchableWallType } from "@/lib/takeoff/wallTypeMatch";
import { TakeoffRoomsPanel } from "./TakeoffRoomsPanel";
import { roomBoundary } from "@/lib/takeoff/roomBoundary";
import { roomsFromWalls, type RoomsFromWallsResult } from "@/lib/takeoff/roomsFromWalls";

/**
 * THE MEASURING SURFACE — a PDF page rendered to a canvas, with an SVG
 * overlay that everything is drawn and measured on.
 *
 * SVG OVER CANVAS FOR THE GEOMETRY, which is the choice `JobMediaAnnotator`
 * already argued for as "THE FIRST DRAWING SURFACE IN THIS APP": shapes stay
 * as elements, so they hit-test, they scale with a transform, and they can be
 * read out of the DOM by a test. The canvas underneath is a rendering surface
 * and nothing else — no pixel is ever read back from it, which is also why
 * the tainting caveat recorded on the photo report does not apply here.
 *
 * PDFJS IS IMPORTED INSIDE AN EFFECT, never statically. That keeps it out of
 * every server graph — so the `Can't resolve 'canvas'` build failure cannot
 * arise — and out of every other page's bundle. The LEGACY build, because the
 * modern one needs `Promise.withResolvers` (Chrome 119 / Safari 17.4) and a
 * contractor's iPad is a real device. The worker is resolved with
 * `new URL(..., import.meta.url)` so the bundler emits it and rewrites the
 * path, which makes worker/API version skew — the single most reported
 * pdf.js-in-Next failure — structurally impossible.
 *
 * ZOOMING RE-RENDERS THE PAGE rather than scaling pixels. A measuring tool is
 * zoomed in precisely so a click can be placed accurately, and a blurry
 * upscale would defeat the entire point of the feature.
 */

type Draft = { xs: number[]; ys: number[] };

const EMPTY: Draft = { xs: [], ys: [] };

/** How wide one PDF point is rendered, before zoom. 1.5 gives a legible
 * sheet on a laptop without asking pdf.js to rasterise a 42-inch drawing at
 * full resolution on first paint. */
const BASE_SCALE = 1.5;

/**
 * ── THE BOTTOM OF THIS LIST USED TO BE 0.5, AND A WHOLE SHEET DID NOT FIT ──
 *
 * These multiply `BASE_SCALE`, so the old floor of 0.5 rendered at 0.75 of full
 * size — on a 42-inch ARCH E sheet that is 3,024pt × 0.75 ≈ 2,270 CSS px, wider
 * than the viewport it sits in. The control said "50%" and the drawing still
 * ran off the edge, with no way to go further out. Reported from a real plan
 * set on 2026-10-07: "the area that displays the plans is too small and cuts
 * off most of the plans even when you zoom all the way out to 50%".
 *
 * The percentage shown is this number, not the render scale, which is why 50%
 * was never half of anything.
 */


/**
 * FIT, which is what somebody actually wants on a 42-inch sheet.
 *
 * Steps alone do not solve it: the right zoom for a whole sheet depends on the
 * sheet's size AND the window's, so no fixed list contains it. This computes
 * the exact scale that puts the full width in view, and it is a MODE rather
 * than a step for that reason — resizing the window keeps it fitted.
 *
 * Sheets are landscape and far wider than tall, so width is the binding
 * dimension; fitting height as well would shrink a 42×30 to the point of
 * uselessness on a laptop.
 */
const FIT = "fit" as const;
/** Fill the width and let the height scroll — see `fitWidthZoom`. */
const FIT_WIDTH = "fit-width" as const;

/**
 * How many of a sheet's strokes are kept as snap targets.
 *
 * `snapToGeometry` is linear in them and runs on every click, and a real
 * architectural sheet carries well over a hundred thousand segments — Camp
 * Bow Wow's A101 has 12,179 wall-length lines alone, and that is after
 * filtering. The LONGEST are kept, because the long ones are the walls and
 * grid lines somebody is aiming at; hatching, text outlines and furniture are
 * short and are exactly what should not pull a click off target.
 */
const SNAP_SEGMENT_CAP = 4_000;

/** How close a click has to be to SELECT a shape. See the edit branch. */
const PICK_RADIUS = 0.016;
type Zoom = number | typeof FIT | typeof FIT_WIDTH;

/**
 * ── THE WORDS ON A PAGE, IN `planPdf`'s CONVENTION, READ ONCE ──
 *
 * `y` is the BASELINE and runs DOWN from the top, which is what
 * `plan-ingest/planPdf.ts` stores and therefore what every consumer in this
 * repo expects. `findWallsOnSheet` does the glyph-height shift itself, once —
 * see `fromBaseline` — so nothing here subtracts anything.
 *
 * EXTRACTED BECAUSE THERE WERE ABOUT TO BE TWO COPIES in this one file: the
 * wall finder reads the text, and so does the sheet-kind caution below. Two
 * copies of a coordinate convention is exactly the drift that put every text
 * box one glyph height out the last time, and nothing threw.
 */
async function pageTextItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs ships no types for the legacy build entry.
  page: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above.
  pdfjs: any,
): Promise<{ str: string; x: number; y: number; width: number; height: number }[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = (await page.getTextContent()) ?? { items: [] };
  return (content.items as unknown[]).flatMap((raw) => {
    const item = raw as { str?: string; transform?: number[]; width?: number; height?: number };
    if (typeof item.str !== "string" || item.str.trim() === "" || !Array.isArray(item.transform)) return [];
    const m = pdfjs.Util.transform(viewport.transform, item.transform);
    return [{ str: item.str, x: m[4], y: m[5], width: item.width ?? 0, height: item.height ?? 0 }];
  });
}

/**
 * Whether the evenly-pitched-hatch rule is on. Set only by Chrome's labelling
 * server; see `ClassifyInput.hatchPitchRule` for the measured trade.
 */
const HATCH_PITCH_RULE = process.env.NEXT_PUBLIC_TAKEOFF_HATCH_PITCH === "1";

export function TakeoffPlanViewer({
  jobId,
  planId,
  sheets,
  printedScaleByPage,
  // Defaulted for the test renders that build partial props through
  // `as never`. The TYPE still requires it, so a real caller that forgets it
  // is a build error rather than a button that silently never appears —
  // which is the failure this prop exists to fix.
  scannedPages = [],
  storedWallsByPage,
  takeoffItems = [],
  levelByPage,
  wallTypes,
  scalePrefillByPage,
  viewScalesByPage,
  answerKey,
  scaleDeclineByPage,
  duplicateWallsByPage = {},
  onSheetNumber,
  sheetLabelByPage = {},
  initialPage = 1,
  onPageChange,
  fill = false,
  panelOpen = true,
  readOnly = false,
  roomFinder = false,
  demotedWalls = false,
  wallModel = null,
  ceilingPages = [],
  onMeasurementSaved,
  activeItemId = null,
}: {
  jobId: string;
  planId: string;
  sheets: PlanSheet[];
  /** The company's wall types that have layers, so they produce line items.
   *  Used only to MATCH the drawing's own tags against — the viewer never
   *  chooses a type, it reports which one the drawing named. */
  wallTypes: MatchableWallType[];
  /**
   * The title-block scale per PAGE NUMBER, deliberately not per sheet.
   *
   * A `PlanSheet` only exists once somebody has saved a calibration on that
   * page, so reading this off `sheet` made it null on every FIRST calibration
   * — the only time it has anything to say. See the note in
   * `takeoff-plan-view.ts`.
   */
  /** The sheet to open on. 1 unless a caller knows better — see the state. */
  initialPage?: number;
  /**
   * Which sheet is on screen, reported whenever it changes.
   *
   * ── THERE WERE TWO CURRENT PAGES, AND THEY DISAGREED ──
   *
   * This component owns `pageNumber` and its own picker changes it. The
   * workspace owns `page`, and only the sheet TREE and the overview changed
   * that — both of which tell this component through a `takeoff-goto` event.
   * Nothing ever went the other way.
   *
   * So picking a sheet from the picker moved the drawing and left the
   * workspace believing it was still on the old one. Everything the workspace
   * keys by page then belonged to the wrong sheet: the answer-key candidates
   * and verdicts, the traced walls, the scale a traced wall is measured at,
   * and the sheet number a saved key is named after.
   *
   * One notion of the current sheet, reported from the component that owns it.
   */
  onPageChange?: (page: number) => void;
  /**
   * ── FILL THE HOST, RATHER THAN BE AS TALL AS THE CONTENT ──
   *
   * False for the takeoff tab, which is every caller that existed before the
   * full-screen workspace: inside the app shell this component is one section
   * of a scrolling page, so its height has to come from its content.
   *
   * True for a host that has already decided the height — the workspace, where
   * the whole point is that the drawing gets the viewport. Without it the
   * frame's height is circular: the box sizes to the canvas and the canvas is
   * sized from the box, so it settles on the `min-h-[24rem]` floor. That is the
   * failure the comment above the frame already describes from the other
   * direction — "a short frame makes a small sheet, so the width beside it went
   * empty" — measured here at 1440px as a plan at 18% with half the viewport
   * empty under it.
   *
   * It changes three class strings and nothing else. FIT already fits BOTH
   * dimensions (`fitZoom`), so a frame with a real height is all it needs.
   */
  fill?: boolean;
  /**
   * Whether the found-walls panel is shown. True for every caller that is not
   * the workspace, where it is a rail the reviewer opens and closes and the
   * canvas takes the space it gives up.
   */
  panelOpen?: boolean;
  /**
   * No tools and no actions — a phone, where the screen is for LOOKING at a
   * takeoff somebody else made.
   *
   * The toolbar's controls all place something on the drawing by clicking it,
   * and a 390px screen cannot be clicked accurately enough to trace a wall. An
   * estimator on a phone is checking a number, not measuring; offering the
   * tools there is offering a way to put a wrong line on a real takeoff.
   */
  readOnly?: boolean;
  /**
   * "Find the rooms" beside "Find the walls". OFF for every company until the
   * owner turns it on (Settings → `RoomFinderSwitch`); with it off nothing
   * about this screen changes and `takeoffRoomFinder.test.tsx` holds the
   * button absent. See `lib/takeoff/NOTES-rooms.md`.
   */
  roomFinder?: boolean;
  /**
   * "Demote, don't hide": a run the check labels casework or reference stays
   * on the sheet greyed, out of the total, one click to take back. Read from
   * `Company.demotedWallsOn`, false for everyone until chosen; never in
   * labelling mode. See `lib/takeoff/demotedRuns.ts`.
   */
  demotedWalls?: boolean;
  /**
   * The trained wall classifier and its cut, read from the file
   * `TAKEOFF_WALL_MODEL` names (`lib/takeoff/wallModelFile.ts`). With the
   * switch on, a run it scores below the cut is demoted at Find time, with
   * no model call. Null when no file is configured; inert with the switch off.
   */
  wallModel?: { model: WallModel; cut: number } | null;
  /**
   * The plan's pages whose title block names a reflected ceiling plan or a
   * finish schedule. When the rooms are found, their text is read from the
   * open PDF and each room's ceiling comes from it — see `roomCeilings.ts`.
   */
  ceilingPages?: number[];
  /**
   * Told when a measurement has been saved, so a HOST can offer to undo it.
   *
   * Optional, and the takeoff tab does not pass it — undo belongs to whoever
   * owns the keyboard, and on the tab that is the browser. The viewer holds no
   * stack of its own precisely so there cannot be two.
   */
  onMeasurementSaved?: (saved: { id: string; kind: MeasurementKind }) => void;
  /**
   * The takeoff item new measurements belong to, when a host has one selected.
   *
   * The viewer does not OWN this — the items rail does — and does not render
   * the list. It only needs to stamp what it saves, which is the one thing the
   * rail cannot do from outside the form.
   */
  activeItemId?: string | null;
  printedScaleByPage: PrintedScaleByPage;
  /**
   * Page numbers whose page carries NO TEXT LAYER — that is, scans.
   *
   * ── WHY THIS IS A PROP AND NOT SOMETHING THE VIEWER WORKS OUT ──
   *
   * Read this sheet first appeared only once Find the walls had run and come
   * back with no lines, which reads as the careful choice and is a DEADLOCK.
   * Find the walls is disabled until a sheet has a scale (`!calibration`); a
   * scan's scale is printed on the drawing and can only be got at by reading
   * the picture; and reading the picture was the thing behind the button. So
   * the one control that could break the cycle was inside it, and the feature
   * was unreachable on exactly the sheets it exists for.
   *
   * Found by a person clicking, after a census asserted the control existed
   * and was rendered from a page — which it was. The same shape as #764:
   * PRESENT IS NOT USABLE, and a sibling condition is what makes it so.
   *
   * Being a scan is a fact about the FILE, settled at ingest and independent
   * of scale, of Find the walls and of anything the viewer has done. So the
   * gate is that fact, and nothing else.
   */
  scannedPages: number[];
  /**
   * THE WALLS ALREADY FOUND ON EACH SHEET, from `TakeoffWallProposal`, keyed by
   * page number.
   *
   * KEYED BY PAGE RATHER THAN READ OFF `sheet`, which is the shape
   * `printedScaleByPage` above was moved to after the field version turned out
   * to be unreachable. This one would in fact be safe on `PlanSheet` — a
   * proposal only exists once a calibration does, and saving a calibration is
   * what creates the page row, so the row is guaranteed present exactly when
   * there is something to show. It is keyed anyway, because two props that
   * mean "something the server knows about page N" should not be reached two
   * different ways.
   *
   * Optional and absent is normal: an uncalibrated sheet has nothing stored,
   * and a sheet whose scale changed has nothing stored UNDER THE CURRENT
   * calibration, which is the same thing from the reader's side.
   */
  storedWallsByPage?: Record<number, WallGroup[]>;
  /**
   * The job's takeoff items, so detected groups can read under the condition
   * they propose into rather than as a flat list of thicknesses.
   *
   * Names only — the quantities and prices are the items panel's business. An
   * empty list is the ordinary state of a job nobody has named conditions on,
   * and the panel then draws no headings at all.
   */
  takeoffItems?: readonly { id: string; name: string }[];
  /** Which floor each sheet draws, read off its own title — see
   *  `sheetLevel.ts`. Absent for a sheet whose title names no floor, which is
   *  most of them on a single-storey job. */
  levelByPage?: Record<number, string>;
  /** What each sheet said about its own scale, read off the dimensions
   *  printed on it. A PREFILL and never a calibration — see `ScalePrefill`. */
  scalePrefillByPage: ScalePrefillByPage;
  /**
   * The drawings on each multi-scale sheet, with the scale captioned under
   * each. Absent for every page that read a scale of its own, which is most of
   * them — see `sheetScale.ts` for why a page-wide prefill must NOT be invented
   * for these.
   */
  viewScalesByPage?: Record<number, ViewScale[]>;
  /**
   * ── ANSWER-KEY REVIEW ──
   *
   * When set, the overlay stops being a list of findings and becomes a list of
   * QUESTIONS: every candidate is drawn in the colour of its verdict, clicking
   * one focuses it, and dragging a box decides many at once. See
   * `AnswerKeyPanel` for why nothing is accepted until it is accepted.
   */
  /**
   * The sheet NUMBER this viewer read off the title block, reported as it is
   * read.
   *
   * ── WHY THE VIEWER IS THE ONE THAT KNOWS ──
   *
   * The number on screen comes from a `PlanSheetProposal`, which the ingest's
   * TITLE_BLOCK stage writes — and that stage calls a model, so a set ingested
   * without one has no sheet numbers at all. The viewer has the PDF open and
   * reads the title block itself, with no model, for the duplicate-walls
   * caution; this hands that reading to the workspace so an answer key is
   * named `A120.key.json` rather than `p15.key.json`.
   *
   * Somebody spent an hour reviewing A120 and then could not find the file,
   * because nothing had told them it was called p15.
   */
  onSheetNumber?: (page: number, sheetNumber: string) => void;
  answerKey?: {
    state: ReviewState;
    onState: (next: ReviewState) => void;
    focusedId: string | null;
    onFocus: (id: string | null) => void;
    overlaysOn: boolean;
    /**
     * Called with everything a reviewer has to decide about, once detection
     * has run. Derived in here because the raw geometry never leaves this
     * component, and the unpaired lines cannot be found without it.
     */
    /**
     * The runs a reviewer judges, and the sheet's own lines beside them.
     *
     * The segments are passed because the duplicate rule needs them: picking
     * which of two twins to keep is a question about which one's faces are
     * actually drawn, and without them it falls back to length — which chose
     * the wrong twin twice on E Street 421. They arrive in PAGE-WIDTH units,
     * the same units the candidates are in.
     */
    /**
     * The candidate list, and WHY it changed: a fresh detection replaces the
     * review, a change of what is OFFERED adds to it. See `mergeOffered`.
     */
    /**
     * The candidate list, and WHY it changed.
     *
     * "detect" is a fresh reading of the drawing and REPLACES the review.
     * "offer" is the same reading with a different amount offered — the hatch
     * override — and must ADD to it. The receiver cannot tell these apart from
     * the lists: a restored sheet holds a split's halves and carried
     * decisions that the finder never proposes, so "did it only grow" is
     * false on exactly the sheets with the most work in them. That guess cost
     * NG Green Bay A3.1 its 109 decisions and 32 traces.
     */
    onCandidates?: (
      candidates: Candidate[],
      segments?: StrokeSegment[],
      reason?: "detect" | "offer",
    ) => void;
    /**
     * Every PAIRING the finder considered, with its feature vector.
     *
     * Not the same list as `onCandidates`: that one is the runs a reviewer
     * judges, and this is what the geometry proposed before merging and
     * filtering. A reviewed sheet is training data only if both are kept —
     * `labelRows` carries each verdict from the run back to the pairings it
     * was made of, and without these there is nothing to carry it to.
     */
    /** Cut the candidate at a point on it — the shift-click path, for a
     *  boundary with no wall on it. In page-width units. */
    onSplitAt?: (id: string, at: { x: number; y: number }) => void;
    onPairings?: (
      pairings: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet: number; features: number[] }[],
    ) => void;
    /**
     * What the classifier set aside, counted by its own reason.
     *
     * ── NOTHING IS EXCLUDED SILENTLY, AND THIS IS THE HALF THAT KEEPS IT
     *    TRUE ──
     *
     * Only `unclassified` lines are offered, which took A102 from 168 blue
     * candidates to 2. The other 166 are not gone: they are a hatch, a grid
     * line past the building or a symbol, each already named as such, and a
     * reviewer who cannot see that the app decided for them is reviewing the
     * app's opinion rather than the drawing.
     */
    onSetAside?: (counts: { kind: string; why: string; n: number }[]) => void;
    /** Offer every unpaired line, including the ones the classifier named.
     *  The reviewer's own override for the filter above. */
    offerAll?: boolean;
    /**
     * Tracing is armed: the next two clicks on the sheet are the ends of a
     * wall the drawing has no candidate for.
     *
     * The panel owns the arming and the shortcut, because that is where the
     * reviewer's hands are and where every other key in this mode lives.
     */
    tracing?: boolean;
    /** Arm or disarm tracing — the `t` shortcut lives in the viewer, because
     *  the panel it used to live in is not mounted until candidates exist. */
    onTracing?: (next: boolean) => void;
    /** A wall the reviewer drew, ready to go into the key as accepted. */
    onTraced?: (from: { x: number; y: number }, to: { x: number; y: number }) => void;
    /** Both ends are down and Enter will commit — for the panel's prompt. */
    onTraceReady?: (ready: boolean) => void;
  };
  scaleDeclineByPage?: ScaleDeclineByPage;
  /**
   * Per page, why a wall takeoff here would probably be a DOUBLE COUNT.
   *
   * Empty for an ordinary floor plan, and that silence is the point: this is
   * shown beside found walls on a mechanical plan, a reflected ceiling plan or
   * an elevation, where the architectural walls are repeated in grey. Scored
   * against a 60-page answer key, those sheets invented 13,767 ft — a third of
   * everything the finder reported across the set.
   *
   * A CAUTION AND NOT A REFUSAL. A wall can genuinely be measured on a section,
   * and a sheet number read by a model can be wrong; disabling the tool would
   * remove a capability on a guess, and leave a reader unable to tell "no walls
   * here" from "the app decided for me".
   */
  duplicateWallsByPage?: Record<number, string>;
  /**
   * What each sheet is called, so the pager can be jumped rather than walked.
   *
   * Absent for a page nothing has read a number off — a scan, or a set whose
   * ingest has not run — and the picker falls back to "Sheet 23" for those,
   * which is what this control said for every page before it existed. A page
   * is never missing from the list; only its name is.
   */
  sheetLabelByPage?: Record<number, string>;
}) {
  // ── WHICH SHEET IS OPEN IS PART OF WHERE YOU ARE ──
  //
  // Defaulted to 1, which is every caller that existed before the full-screen
  // workspace. The workspace passes the page out of its own URL, so its sheet
  // rail can be a list of REAL LINKS: a reviewer can send somebody "look at
  // A-102" and have them land on it, and Cmd-click opens a second sheet beside
  // the first. A click handler could not do either.
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [pageCount, setPageCount] = useState<number | null>(null);
  /** How many strokes the set's own template accounted for, so the panel can
   *  SAY it rather than quietly returning a smaller number. */
  const [templateStrokes, setTemplateStrokes] = useState(0);
  /** What the LAYER filter left out, so the panel can say it. Empty on a
   *  flattened plot, which carries no layer names at all. */
  const [layerDropped, setLayerDropped] = useState<LayerDrop[]>([]);
  /** The sheet-kind caution read off the drawing's own title block, per
   *  page. Only ever consulted where the server had nothing to say. */
  const [readCaution, setReadCaution] = useState<Record<number, string>>({});
  /** Pages already asked about, so a page with no caution is not re-read on
   *  every render — `seeded`'s trick, and for its reason. */
  const cautionAsked = useRef<Set<number>>(new Set());
  // FIT by default. A sheet opens showing all of itself, which is what
  // somebody opening a drawing wants to see first; they zoom IN to measure.
  const [zoom, setZoom] = useState<Zoom>(FIT);
  const [tool, setTool] = useState<ToolId>("pan");

  /**
   * ── THE HOST'S KEYBOARD REACHES THE CANVAS HERE ──
   *
   * The full-screen workspace owns the keyboard — it is the thing with focus
   * — but zoom and paging belong to this component, so the shell forwards
   * them as DOM events rather than reaching into state it does not own.
   *
   * **WIRED 2026-10-16, AND IT WAS A REAL BUG THAT IT WAS NOT.** The shell
   * had been dispatching `takeoff-shortcut` since the workspace shipped and
   * NOTHING listened: `f`, `j` and `k` did nothing at all while the shortcut
   * cheat sheet told everybody they worked. The "written, documented and
   * never called" shape that CLAUDE.md records three instances of — and the
   * reason the e2e spec now presses these keys and asserts the result rather
   * than asserting that the cheat sheet lists them.
   */
  useEffect(() => {
    const onShortcut = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key === "f") setZoom(FIT);
      // BOUNDED BY THE PDF'S PAGE COUNT, NOT BY `sheets.length`.
      // `sheets` is the TakeoffPlanPage rows, and a page only gets one once
      // somebody has saved a calibration on it — so on a fresh set that array
      // is one entry long while the file has 175 pages. The first version of
      // this bounded by it and `j` simply refused to move, which is exactly
      // what the spec caught: the pager was visible and the key did nothing.
      else if (key === "j") setPageNumber((at) => (pageCount === null ? at : Math.min(pageCount, at + 1)));
      else if (key === "k") setPageNumber((at) => Math.max(1, at - 1));
    };
    const onGoto = (event: Event) => {
      const page = (event as CustomEvent<{ page?: number }>).detail?.page;
      if (typeof page === "number" && page >= 1) setPageNumber(page);
    };
    document.addEventListener("takeoff-shortcut", onShortcut);
    document.addEventListener("takeoff-goto", onGoto);
    return () => {
      document.removeEventListener("takeoff-shortcut", onShortcut);
      document.removeEventListener("takeoff-goto", onGoto);
    };
  }, [pageCount]);

  // ── FOUND WALLS ──
  //
  // Held in component state and NEVER written anywhere until a person accepts a
  // group. A found wall is a proposal; the measurements table is for things
  // somebody chose. That also means switching sheets or reloading simply
  // forgets them, which is the correct behaviour for a proposal nobody acted on.
  //
  // THE SENTENCE ABOVE WAS TRUE ABOUT RELOADING AND FALSE ABOUT SHEETS, for as
  // long as this feature has existed. Nothing cleared `found` on a page change,
  // so walls found on A-101 were drawn over whatever sheet you paged to next —
  // reported 2026-10-11 from three screenshots showing one identical overlay on
  // sheet 30, sheet 52 and S-101, none of which it had anything to do with.
  //
  // THE FIX IS THE PAGE NUMBER BESIDE THE RESULT rather than an effect that
  // clears it, because an effect is a thing somebody has to remember and this
  // file already has one for the half-drawn shape that nobody thought to extend.
  // A result that knows which sheet it came from cannot be shown on another one,
  // and `wallsOnThisSheet` below is the whole of the rule, in one place that
  // both the panel and the ghost overlay read.
  //
  // It also makes paging AWAY and BACK free: the proposal is still the answer to
  // the question somebody asked about that sheet, so returning restores it
  // rather than demanding another press.
  const [foundRaw, setFound] = useState<WallGroup[] | null>(null);
  /**
   * WHICH PAGES HAVE ALREADY BEEN SEEDED FROM THE SERVER, so a sheet is seeded
   * once and "Clear" sticks.
   *
   * A ref and not state: nothing renders from it, and React double-invokes
   * effects in development, which would otherwise seed twice.
   */
  const seeded = useRef<Set<number>>(new Set());
  const [foundOnPage, setFoundOnPage] = useState<number | null>(null);
  // ── WHAT THE RUNS ARE, as opposed to what they measure ──
  //
  // The runs themselves, kept so a label can be applied to one without finding
  // them again, and a closure that rebuilds the panel from a filtered list —
  // the tags, the schedule and the sheet's general note all live inside it, so
  // re-grouping cannot drift from the grouping that was shown first.
  const runsRef = useRef<WallCandidate[]>([]);
  // ── FOR THE ROOM STEP ──
  // Every pairing the last find produced (long ones bound rooms the kept runs
  // do not — NOTES-rooms.md §5) and the sheet's words (the room tags), kept
  // from the find so "Find the rooms" costs no second read of the PDF.
  const pairingsRef = useRef<{ x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet: number }[]>([]);
  const wordsRef = useRef<{ str: string; x: number; y: number; width: number; height: number }[]>([]);
  const [rooms, setRooms] = useState<RoomsFromWallsResult | null>(null);
  const [roomsOnPage, setRoomsOnPage] = useState<number | null>(null);
  const [hoveredRoom, setHoveredRoom] = useState<number | null>(null);
  /**
   * The answer-key props, readable from inside the detect without putting them
   * in its dependencies.
   *
   * The detect is expensive and re-running it because a reviewer pressed a key
   * would be a different bug; a ref keeps the reporting current without making
   * the work depend on the review's state.
   */
  const answerKeyRef = useRef(answerKey);
  answerKeyRef.current = answerKey;
  /** Feet across the page width, as the find that produced these runs read it. */
  const feetAcrossRef = useRef<number>(0);
  const regroupRef = useRef<((runs: WallCandidate[]) => WallGroup[]) | null>(null);
  /**
   * ── EVERYTHING A FIND PRODUCES IS KEPT PER PAGE, WITHOUT EXCEPTION ──
   *
   * `wallsOnThisSheet` above fixed the groups by keeping the page beside the
   * result, and these three were left as plain state — so a check run on A120
   * put its labels, its missed-wall list and its view name on A130 and A140 as
   * well. The groups were right and the sentences around them were another
   * sheet's.
   *
   * The lesson is the one that file already states and this did not follow:
   * the rule has to be in ONE place that every render site reads. A record
   * keyed by page is that place, it is the idiom the three states below it
   * already use, and paging away and back keeps the work rather than throwing
   * it away.
   */
  const [labelsByPage, setLabelsByPage] = useState<
    Record<number, Map<number, RunVerdict>>
  >({});
  const labels = onThisSheet(labelsByPage, pageNumber);
  const setLabels = useCallback(
    (next: Map<number, RunVerdict> | null) =>
      setLabelsByPage((prev) => setOnThisSheet(prev, pageNumber, next)),
    [pageNumber],
  );
  /** Walls the check says the finder missed. Words, never a quantity — the
   *  estimator traces each one with the measuring tools. */
  const [missedByPage, setMissedByPage] = useState<
    Record<number, { where: string; why: string }[]>
  >({});
  const missed = onThisSheet(missedByPage, pageNumber) ?? EMPTY_MISSED;
  const setMissed = useCallback(
    (next: { where: string; why: string }[]) =>
      setMissedByPage((prev) => setOnThisSheet(prev, pageNumber, next)),
    [pageNumber],
  );
  const [checking, setChecking] = useState(false);
  /** The multi-scale caution per page, read off the drawing's own captions. */
  const [scaleCautionByPage, setScaleCautionByPage] = useState<Record<number, string>>({});
  /** The views NOT quoted, per page — measured, each at its own scale, and
   *  reported rather than added. See `primaryView`. */
  const [otherViewsByPage, setOtherViewsByPage] = useState<Record<number, ViewWalls[]>>({});
  /** The views that could not be measured at all, per page, with the reason.
   *  Named in the caution rather than dropped — nothing is excluded silently. */
  const [excludedByPage, setExcludedByPage] = useState<Record<number, ExcludedView[]>>({});
  /** The view the quantities on screen ARE, so the sentence can name it.
   *  Per page for the reason `labelsByPage` is: it names the drawing a FIND
   *  was about, and on any other sheet it names the wrong one. */
  const [primaryViewByPage, setPrimaryViewByPage] = useState<
    Record<number, { name: string; scaleName: string | null }>
  >({});
  const primaryViewShown = onThisSheet(primaryViewByPage, pageNumber);
  const setPrimaryViewShown = useCallback(
    (next: { name: string; scaleName: string | null } | null) =>
      setPrimaryViewByPage((prev) => setOnThisSheet(prev, pageNumber, next)),
    [pageNumber],
  );
  const [checkError, setCheckError] = useState<string | null>(null);
  /**
   * Whether each sheet is one with a floor plan on it — read from the title
   * block and the drawings' own captions. See `takeoffSheet.ts`.
   */
  const [takeoffVerdictByPage, setTakeoffVerdictByPage] = useState<
    Record<number, TakeoffSheetVerdict>
  >({});
  /** Sheets where somebody pressed "Run anyway". Per page, because an override
   *  is a judgement about ONE drawing. */
  const [overriddenByPage, setOverriddenByPage] = useState<Record<number, true>>({});
  const askedVerdict = useRef<Set<string>>(new Set());
  /**
   * What this sheet has to show. Every render site reads THIS and not the raw
   * state, which is why the name it kept is the one they were already using.
   */
  const found = wallsOnThisSheet(foundRaw, foundOnPage, pageNumber);
  // ONE SLOT, and `cautionToShow` owns which of the three fills it.
  //
  // THE MEASURED SENTENCE BEATS THE WARNING, and it is the same slot. Before
  // the walls are found, all that can be said is "this sheet prints two
  // scales". After, the other drawing has a name, a scale and a figure — so
  // `multiScaleCaution` is what shows until `onFindWalls` has run, and
  // `viewsMeasuredCaution` replaces it once there is a result to report.
  const measuredViews = otherViewsByPage[pageNumber];
  const leftOutViews = excludedByPage[pageNumber];
  const viewsSentence =
    (measuredViews === undefined || measuredViews.length === 0) &&
    (leftOutViews === undefined || leftOutViews.length === 0)
      ? undefined
      : viewsMeasuredCaution(
          primaryViewShown,
          (measuredViews ?? []).map((one) => ({
            name: one.view.name,
            scaleName: one.view.scaleName,
            lengthFeet: one.lengthFeet,
          })),
          leftOutViews ?? [],
        );
  const sheetCaution = cautionToShow(
    duplicateWallsByPage[pageNumber],
    readCaution[pageNumber],
    viewsSentence ?? scaleCautionByPage[pageNumber],
  );
  /**
   * WHICH TYPE A PERSON PICKED for a group that could be more than one, by
   * group index.
   *
   * Only an `ASK` group has one, and only because a floor plan cannot settle
   * it: A1 and A2 are both 4-7/8in on School-01 and differ by fire rating. The
   * app will not choose between them, so the estimator does, once per group
   * rather than once per run.
   *
   * TWO PARALLEL ARRAYS LEFT WHEN THIS ARRIVED — `tagNames` and `typeMatches`,
   * both indexed against `found`. They are gone: a `WallGroup` carries its own
   * tag and its own candidates, so the three can no longer fall out of step
   * with each other, which is a class of bug rather than a tidy-up.
   */
  const [chosen, setChosen] = useState<Record<number, string>>({});
  /** A height typed for a group whose type has no default — the posting refuses without one. */
  const [groupHeight, setGroupHeight] = useState<Record<number, string>>({});
  /** Whether the groups below the fold are showing. See `SHOWN_AT_FIRST`. */
  const [showingAll, setShowingAll] = useState(false);
  /** The rows on screen. Indexes into this ARE the indexes into `found`,
   *  because it only ever truncates — every handler, the colour and the
   *  overlay all key off the same number, and a slice that reordered would
   *  silently hover one group and add another. */
  const shownGroups = showingAll ? (found ?? []) : (found ?? []).slice(0, SHOWN_AT_FIRST);
  /**
   * The same groups, read under the condition each proposes into.
   *
   * A READING ORDER, NOT A RE-SORT — every entry carries the index it had in
   * `shownGroups`, because that index is what addresses the group everywhere
   * else: `ClusterMark index=` picks its colour and dash on the drawing,
   * `chosen[index]` holds its wall type, and `hovered` lights its runs.
   * Renumber and the panel's third row highlights the drawing's first.
   *
   * `heading` is set on the first entry of each section, so the headings ride
   * inside the one list rather than needing a list per section — the rows stay
   * siblings and the gap between them stays even.
   */
  const ordered = useMemo(() => {
    const sections = proposalSections(shownGroups, takeoffItems);
    const withHeadings = showsHeadings(sections);
    return sections.flatMap((section) =>
      section.entries.map((entry, within) => ({
        ...entry,
        heading: withHeadings && within === 0 ? section : null,
        /** How many are under this heading, for the heading's own count. */
        inSection: section.entries.length,
      })),
    );
  }, [shownGroups, takeoffItems]);
  /** How many strokes the sheet held when it was last read, so an empty result
   *  can say which kind of empty it is. See the message below. */
  const [strokesSeen, setStrokesSeen] = useState(0);
  // ── READING A SCANNED SHEET ──
  // `reading` drives the button; `readError` and `wordsRead` are what the
  // estimator is told. The WORDS themselves go in a ref rather than state
  // because nothing renders them — `onFindWalls` reads them on its next pass,
  // and putting them in state would re-render the canvas for no pixels.
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [wordsRead, setWordsRead] = useState<number | null>(null);
  const [readProgress, setReadProgress] = useState<string | null>(null);
  const [readReported, setReadReported] = useState(0);
  const [readBlank, setReadBlank] = useState(false);
  const scannedWordsRef = useRef<{ str: string; x: number; y: number; width: number; height: number }[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(true);
  /** The page box, straight from the viewer — the ONLY place this number is
   * ever produced. Posted with a calibration so the scale can be named. */
  const [pageSize, setPageSize] = useState<{ widthPt: number; heightPt: number } | null>(null);
  /** The scrolling box the sheet sits in — measured, so FIT knows what it is
   *  fitting into. */
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [frameHeight, setFrameHeight] = useState(0);
  const [cssWidth, setCssWidth] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<{ numPages: number; getPage: (n: number) => Promise<unknown> } | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const sheet = sheets.find((s) => s.pageNumber === pageNumber) ?? null;
  const calibration = sheet?.calibration ?? null;
  /**
   * What the last detection on this page was computed FROM.
   *
   * Answer-key mode needs the raw geometry to find the lines the detector
   * could not pair, and that geometry is read inside `onFindWalls` and
   * discarded. Without this, turning the mode on after a detection showed an
   * empty rail telling the reviewer to press a button they had already
   * pressed — found by walking it in a browser, which is the only instrument
   * that could have.
   */
  /** What the classifier set aside on the last find, counted by reason. */
  const setAsideRef = useRef<{ kind: string; why: string; n: number }[]>([]);
  const lastDetect = useRef<{
    page: number;
    segments: StrokeSegment[];
    feetPerUnit: number;
    widthPt: number;
    walls: WallCandidate[];
    /**
     * The parts of the page the measured PLAN views own, or null on a sheet
     * that was measured whole.
     *
     * Answer-key mode offers the unclaimed long lines as possible walls, and
     * on a mixed sheet most of them are not on a plan at all: A120 carries
     * eight interior elevations and a schedule, and every long line in those
     * was offered to the reviewer. Null means "the whole sheet", which is what
     * a single-view sheet is.
     */
    planBoxes: { from: number; to: number; fromY: number; toY: number }[] | null;
  } | null>(null);

  /**
   * Everything a reviewer has to decide about on the last-detected page.
   *
   * Two populations: what the detector REPORTED, and the long lines it could
   * not pair at all — 7,694 ft of those on one real sheet, 93% of which
   * classify as hatching. A key made from the first alone would be a key about
   * the detector's own output, which is the thing it exists to grade.
   *
   * Null when nothing has been detected on this page, which is what the rail's
   * empty state is for.
   */
  const offerAll = answerKey?.offerAll ?? false;
  const candidatesFromLastDetect = useCallback((): Candidate[] | null => {
    const last = lastDetect.current;
    if (last === null || last.page !== pageNumber) return null;
    // ── ONE PIPELINE, SHARED WITH EVERY EVAL ──
    //
    // This logic lived here, which meant no eval could reach it — so every
    // measurement in `realplan/` was of the finder's RAW output while the
    // panel showed something else. The gap reached 128 candidates on Murray
    // A101 (app 32, eval 160) and produced two wrong conclusions before
    // anybody checked. `offeredCandidates` is that function, and it says what
    // reduces the list and by how much.
    const offered = offeredCandidates(
      {
        walls: last.walls,
        segments: last.segments,
        widthPt: last.widthPt,
        feetPerUnit: last.feetPerUnit,
        planBoxes: last.planBoxes,
      },
      offerAll,
      // ── ON FOR LABELLING, OFF FOR CUSTOMERS ──
      //
      // The pitch rule recovers 15,921 ft of the 16,530 ft of real wall the
      // hatch class withheld and offers 49,419 ft of junk for it. A reviewer
      // judging each line wants that; a customer would see the junk as walls.
      // Chrome's labelling server (:3010) sets this; nothing else does, and
      // the flag retires when "demote, don't hide" ships.
      HATCH_PITCH_RULE,
    );
    setAsideRef.current = offered.setAside;
    return offered.candidates;
  }, [pageNumber, offerAll]);

  // ── AND THE MODE CAN BE TURNED ON AFTER A DETECTION ──
  //
  // Without this, a reviewer who had already pressed Find the walls opened the
  // rail onto an empty state telling them to press it again. Found by walking
  // it in a browser, which is the only instrument that could have: every unit
  // test here passed, because each one calls the mode the way the mode wants
  // to be called.
  /** The `offerAll` the current candidate list was built with. */
  const builtWith = useRef<boolean | null>(null);
  useEffect(() => {
    if (!answerKey?.onCandidates) return;
    // ── THE OVERRIDE HAS TO BE ABLE TO LENGTHEN AN EXISTING LIST ──
    //
    // This returned as soon as a list existed, which is right for every
    // ordinary re-render and made the hatch override a DEAD CONTROL: the
    // reviewer pressed it, the callback was rebuilt, this effect re-ran and
    // returned immediately. The smoke test caught it as "82 -> 82 offered".
    //
    // So the guard asks the real question — is the list already built with
    // the setting now in force — rather than merely whether one exists.
    // `keepReview` is what makes the rebuild safe for work in progress.
    const already = answerKey.state.candidates.length > 0;
    if (already && builtWith.current === offerAll) return;
    // WHY the list is changing, which the receiver cannot work out from the
    // lists themselves — a restored sheet holds split halves and carried
    // decisions the finder never proposes, so "did it only grow" is false on
    // exactly the sheets with the most work in them. See `mergeOffered`.
    const reason = already ? "offer" : "detect";
    builtWith.current = offerAll;
    const candidates = candidatesFromLastDetect();
    if (candidates !== null && candidates.length > 0) {
      const W = lastDetect.current?.widthPt ?? 0;
      answerKey.onCandidates(
        candidates,
        W > 0
          ? lastDetect.current?.segments.map((one) => ({
              ...one,
              x1: one.x1 / W,
              y1: one.y1 / W,
              x2: one.x2 / W,
              y2: one.y2 / W,
            }))
          : undefined,
        reason,
      );
      answerKey.onSetAside?.(setAsideRef.current);
    }
  }, [answerKey, candidatesFromLastDetect]);

  /** The ends of the wall being traced in answer-key mode, in page-width
   *  units. `traceTo` set means both ends are down and Enter will commit. */
  const [traceFrom, setTraceFrom] = useState<{ x: number; y: number } | null>(null);
  const [traceTo, setTraceTo] = useState<{ x: number; y: number } | null>(null);
  /**
   * Where the next click would land, snapped — redrawn as the pointer moves.
   *
   * Without it the first click is blind: a reviewer could not see WHICH line
   * their click was about to grab, and snapping that cannot be seen reads as a
   * click that landed in the wrong place.
   */
  const [traceHover, setTraceHover] = useState<{ x: number; y: number } | null>(null);
  /** The wall just added, for a confirmation that says what it measured. */
  const [traceAdded, setTraceAdded] = useState<string | null>(null);

  /**
   * ── ENTER COMMITS THE TRACED WALL, ESCAPE ABANDONS IT ──
   *
   * Here and not in the panel, although every other key in this mode is the
   * panel's: these two are about the two points held in THIS component's
   * state, and routing them through a prop would mean the panel deciding
   * something it cannot see.
   *
   * Only while tracing is armed and both ends are down, so Escape still means
   * what it means everywhere else in this viewer the rest of the time.
   */
  /**
   * ── T ARMS TRACING, AND IT HAS TO LIVE HERE ──
   *
   * It was in `AnswerKeyPanel`, with the other shortcuts, and that panel is
   * only rendered once there are candidates — so before Find the walls had
   * run, the key did nothing at all and nothing said why. Reported from the
   * workspace as "I press t and there is no visual change".
   *
   * The viewer is mounted whenever answer-key mode is on, so the shortcut is
   * too. The panel keeps its button, which is the visible half of the same
   * affordance.
   */
  useEffect(() => {
    if (answerKey === undefined) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() !== "t") return;
      // ── A FOCUSED BUTTON IS NOT TYPING ──
      //
      // Only INPUT, TEXTAREA and contentEditable block this, deliberately:
      // "T does nothing while the Save button has focus" was reported, and a
      // guard that skipped any focused element would make it true. After a
      // click, SOMETHING always has focus.
      event.preventDefault();
      answerKey?.onTracing?.(answerKey?.tracing !== true);
      setTraceFrom(null);
      setTraceTo(null);
      setTraceHover(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (answerKey?.tracing !== true) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (event.key !== "Enter" && event.key !== "Escape") return;
      if (event.key === "Enter" && traceFrom !== null && traceTo !== null) {
        event.preventDefault();
        answerKey?.onTraced?.(traceFrom, traceTo);
        // SAYS WHAT IT MEASURED, not just that something happened: a wall
        // added at the wrong length is the failure worth catching in the
        // second it takes to read, rather than in the key a week later.
        const feet =
          Math.hypot(traceTo.x - traceFrom.x, traceTo.y - traceFrom.y) * (feetPerUnit ?? 0);
        setTraceAdded(feet > 0 ? formatFeetInches(feet) : null);
        setTraceFrom(null);
        setTraceTo(null);
        setTraceHover(null);
      } else if (event.key === "Escape") {
        // ── ESCAPE LEAVES TRACE MODE, NOT JUST THE HALF-DRAWN LINE ──
        //
        // This cleared the two points and left the mode ARMED, while the
        // panel disarmed it from its own handler — so what Escape did
        // depended on which ran and what the other had changed. Reported as
        // "Escape doesn't leave trace mode (only T does)". It does both here
        // now, and the panel has stopped claiming the key.
        event.preventDefault();
        setTraceFrom(null);
        setTraceTo(null);
        setTraceHover(null);
        answerKey?.onTracing?.(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // The panel's prompt follows the points, so it says "press Enter" only when
  // Enter would do something.
  useEffect(() => {
    answerKey?.onTraceReady?.(traceFrom !== null && traceTo !== null);
  }, [traceFrom, traceTo, answerKey]);

  /**
   * ── THE SHEET ON SCREEN, ANNOUNCED; AND A HALF-DRAWN TRACE ABANDONED ──
   *
   * The announcement is the fix for the two-page split above. The clearing is
   * a smaller leak of the same kind: `traceFrom`/`traceTo` are this
   * component's own state and were not keyed to a sheet at all, so a trace
   * begun on one drawing and not finished followed the reviewer to the next
   * one and could be committed there.
   */
  useEffect(() => {
    onPageChange?.(pageNumber);
    setTraceFrom(null);
    setTraceTo(null);
    setTraceHover(null);
    setTraceAdded(null);
  }, [pageNumber, onPageChange]);

  /** The box being dragged in answer-key mode, in page-width units. */
  const [keyBox, setKeyBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(
    null,
  );
  /** Whether Shift was held during the box drag — Shift rejects, plain accepts. */
  const [keyShift, setKeyShift] = useState(false);

  // ── Load the document once ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();
        const doc = await pdfjs.getDocument({
          url: `/api/takeoff/plan/${planId}`,
          // Served from this app, so the session cookie must go with it.
          // NO `withCredentials`, AND THAT IS THE FIX RATHER THAN AN OMISSION.
          // Setting it makes this a CREDENTIALED cross-origin request, and a
          // server answering one must name a specific origin -- `*` is refused
          // by the browser. Vercel Blob serves public files with `*`, so the
          // flag turns a readable file into an unreadable one. Measured in the
          // live page against a real uploaded drawing on 2026-10-05:
          //
          //   credentials: "omit"     -> 206 Partial Content, reads fine
          //   credentials: "include"  -> TypeError: Failed to fetch
          //
          // The file is public by construction (`access: "public"`), so there
          // are no credentials to send and nothing is lost by not sending
          // them. See `blobPdfCredentials.test.ts`.
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        }).promise;
        if (cancelled) return;
        docRef.current = doc as never;
        setPageCount(doc.numPages);
      } catch (error) {
        if (cancelled) return;
        setLoadError(
          error instanceof Error && /password/i.test(error.message)
            ? "That PDF is password-protected, so it can't be opened here."
            : "That drawing couldn't be opened. It may not be a PDF, or the upload may not have finished.",
        );
        setIsRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId]);

  // ── What FIT is fitting into ──────────────────────────────────────────
  //
  // Watched rather than read once: the sheet should stay fitted when the window
  // changes, and a sidebar opening or the browser being resized both change
  // this without any render of ours.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      setFrameWidth(frame.clientWidth);
      setFrameHeight(frame.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  /** The multiplier in force, with FIT resolved against the measured frame.
   *  Falls back to the old default until the frame has been measured, so the
   *  first paint is never a divide by zero. */
  const zoomFactor = useMemo(() => {
    if (zoom !== FIT && zoom !== FIT_WIDTH) return zoom;
    if (!pageSize || frameWidth === 0) return 1;
    if (zoom === FIT_WIDTH) return fitWidthZoom({ width: frameWidth }, pageSize, BASE_SCALE);
    // Decided in `fitZoom`, which is pure and tested — see its header for why
    // this fits BOTH dimensions and why that took a second attempt.
    return fitZoom({ width: frameWidth, height: frameHeight }, pageSize, BASE_SCALE);
  }, [zoom, pageSize, frameWidth, frameHeight]);

  // ── Render the current page at the current zoom ───────────────────────
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || pageCount === null) return;
    let cancelled = false;
    setIsRendering(true);

    (async () => {
      try {
        renderTaskRef.current?.cancel();
        const page = (await doc.getPage(pageNumber)) as {
          getViewport: (o: { scale: number }) => { width: number; height: number };
          render: (o: unknown) => { promise: Promise<void>; cancel: () => void };
        };
        if (cancelled) return;

        // THE PAGE-WIDTH BOX is defined at scale 1, with pdf.js having
        // applied the page's own /Rotate. Everything stored is a fraction of
        // THIS width — see `lib/takeoff-plan.ts`.
        const unit = page.getViewport({ scale: 1 });
        setPageSize({ widthPt: unit.width, heightPt: unit.height });

        // ── SIZED WITHIN WHAT A BROWSER WILL ACTUALLY DRAW ──
        //
        // This multiplied the page by zoom and by devicePixelRatio and handed
        // the result straight to the canvas. Past Fit that asks for more
        // pixels than any browser allocates — 4x on a retina screen wants 645
        // megapixels of an ARCH-D sheet — and a canvas over the cap does not
        // throw: it allocates nothing and the page renders BLACK. Zooming in
        // to look at a line is the commonest thing a reviewer does, so every
        // customer would have met this. `canvasPlan` holds the limits and the
        // reasoning.
        const plan = canvasPlan({
          pageWidth: unit.width,
          pageHeight: unit.height,
          scale: BASE_SCALE * zoomFactor,
          devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        });
        const viewport = page.getViewport({ scale: plan.renderScale });
        canvas.width = plan.canvasWidth;
        canvas.height = plan.canvasHeight;
        // The CSS size is what was asked for and is never reduced, so the
        // overlay's coordinates and the scroll position do not move.
        canvas.style.width = `${plan.cssWidth}px`;
        canvas.style.height = `${plan.cssHeight}px`;
        setCssWidth(plan.cssWidth);

        const canvasContext = canvas.getContext("2d");
        if (!canvasContext) return;
        const task = page.render({ canvasContext, viewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch (error) {
        // A cancelled render is the normal result of changing page or zoom
        // quickly, not a failure worth telling anybody about.
        if (!cancelled && !(error instanceof Error && /cancel/i.test(error.message))) {
          setLoadError("That page couldn't be drawn.");
        }
      } finally {
        if (!cancelled) setIsRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pageNumber, zoomFactor, pageCount]);

  // Changing page or tool abandons a half-drawn shape rather than carrying
  // points from one sheet onto another.
  useEffect(() => {
    setDraft(EMPTY);
  }, [pageNumber, tool]);


  const aspect = pageSize ? pageSize.heightPt / pageSize.widthPt : 1.294;

  /** Pointer position as page-width units — both axes divided by the
   * rendered WIDTH, which is the contract the whole feature rests on. */
  const pointAt = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): { x: number; y: number } | null => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width <= 0) return null;
      return {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.width,
      };
    },
    [],
  );

  const drawing = tool !== "pan";

  /**
   * ── WHAT A CLICK CAN SNAP TO ──
   *
   * The sheet's own strokes, plus the vertices of everything already measured
   * on it. Two things make this cheap enough to be worth having:
   *
   *  1. IT IS LAZY. Nothing is parsed until somebody picks a drawing tool, so
   *     opening a sheet to look at it costs nothing. `snapPage` is what
   *     remembers which page the targets belong to, so switching sheets
   *     re-reads and switching back does not.
   *  2. IT IS CAPPED. A real sheet carries hundreds of thousands of segments
   *     and `snapToGeometry` is linear in them — at 150k a click would take
   *     long enough to feel. The cap keeps the longest ones, which are the
   *     walls and grid lines people aim at; hatching and text outlines are
   *     short and are what gets dropped.
   *
   * A sheet that will not parse yields NO targets, which is not an error: the
   * tools work exactly as they did before snapping existed.
   */
  const [snapTargets, setSnapTargets] = useState<readonly SnapTarget[]>([]);
  const snapPage = useRef<number | null>(null);

  useEffect(() => {
    if (!drawing) return;
    if (snapPage.current === pageNumber) return;
    snapPage.current = pageNumber;
    setSnapTargets([]);
    let cancelled = false;
    (async () => {
      try {
        const doc = docRef.current;
        if (!doc || !pageSize) return;
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const page = await doc.getPage(pageNumber);
        // `layers: null` — optional-content names do not matter for snapping.
        // A snap target is a place on the paper; which layer drew it is the
        // wall finder's question, not this one's.
        const { segments } = await segmentsFromOpenPage(page, pdfjs, pageNumber, null);
        if (cancelled) return;
        const raw = segments.map(inPageWidthUnits(pageSize.widthPt));
        const longest = [...raw]
          .sort(
            (a, b) =>
              Math.hypot(b.x2 - b.x1, b.y2 - b.y1) - Math.hypot(a.x2 - a.x1, a.y2 - a.y1),
          )
          .slice(0, SNAP_SEGMENT_CAP);
        const targets: SnapTarget[] = [];
        for (const segment of longest) {
          targets.push({ kind: "segment", ...segment });
          targets.push({ kind: "vertex", x: segment.x1, y: segment.y1 });
          targets.push({ kind: "vertex", x: segment.x2, y: segment.y2 });
        }
        setSnapTargets(targets);
      } catch {
        // No targets. The tools behave exactly as they did before snapping.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [drawing, pageNumber]);
  /**
   * A tool's measurement KIND, which is not the same as the tool.
   *
   * `rect` stores AREA geometry — it is a faster way to draw the same four
   * points, not a different thing to measure, so nothing downstream has to
   * learn about it. `cutout` has no kind at all: it edits an area that is
   * already saved rather than creating anything.
   */
  const kindOf = (id: ToolId): MeasurementKind | null =>
    id === "linear"
      ? "LINEAR"
      : id === "area" || id === "rect"
        ? "AREA"
        : id === "count"
          ? "COUNT"
          : null;

  /**
   * ── WHERE A CLICK ACTUALLY LANDS ──
   *
   * Three corrections, in the order they have to happen:
   *
   *  1. SNAP to the drawing's own geometry, so a wall traced over a wall
   *     starts at the wall rather than near it.
   *  2. AXIS LOCK while Shift is held, measured from the PREVIOUS point.
   *  3. …and the lock wins, because somebody holding Shift has said what
   *     they want more loudly than a corner 3px away has.
   *
   * The snap radius is divided by the zoom. A radius that grows as you zoom
   * in is a snap that fights you exactly when you are being careful.
   */
  const placePoint = (
    raw: { x: number; y: number },
    from: { x: number; y: number } | null,
    shift: boolean,
  ): { x: number; y: number } => {
    if (shift && from) return lockToAxis(from, raw);
    const radius = SNAP_RADIUS / Math.max(1, zoomFactor);
    return snapToGeometry(raw, snapTargets, radius);
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    // ── CLICKING THE PLAN TAKES THE KEYBOARD WITH IT ──
    //
    // The shortcut handler ignores keys typed into an INPUT, correctly — a
    // reviewer typing a filename should not accept a wall with every "a".
    // But focus stays in the name box after they type it, so the first click
    // on the drawing moves the highlight and the next N/A/R goes into the
    // box. The reviewer sees a candidate selected and their verdicts landing
    // nowhere, with their own name slowly filling up with "nanana".
    //
    // Blurring on pointer-down is the whole fix: the plan does not need focus
    // itself, since the shortcuts listen on the document. It needs the INPUT
    // not to have it.
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)
    ) {
      active.blur();
    }

    // ── A DRAG IN REVIEW MODE IS A SELECTION, NOT A DRAWING ──
    //
    // Deciding a hundred hatch lines one at a time is the thing that makes a
    // key cost an afternoon instead of twenty minutes, and hatching arrives in
    // a block. So a drag takes everything whose midpoint lands inside it.
    //
    // Before the `drawing` guard, because review mode is not a drawing tool
    // and must work with no tool selected.
    // ── TRACING TAKES THE CLICK BEFORE THE SELECTION BOX DOES ──
    //
    // A drag in review mode selects; a click while tracing is armed is one end
    // of a wall. Tracing is checked first because it is an explicit mode the
    // reviewer turned on, and a selection box is the default.
    if (answerKey?.tracing === true && !drawing) {
      const raw = pointAt(event);
      if (!raw) return;
      event.preventDefault();
      // SNAPPED like every other point this viewer places, so a wall traced
      // along a drawn one lands on it rather than near it.
      const point = placePoint(raw, traceFrom, event.shiftKey);
      if (traceFrom === null) {
        setTraceFrom(point);
        setTraceTo(null);
      } else {
        setTraceTo(point);
      }
      return;
    }
    if (answerKey !== undefined && !drawing) {
      const raw = pointAt(event);
      if (!raw) return;
      event.preventDefault();
      setKeyShift(event.shiftKey);
      setKeyBox({ x1: raw.x, y1: raw.y, x2: raw.x, y2: raw.y });
      return;
    }
    if (!drawing) return;
    const raw = pointAt(event);
    if (!raw) return;
    event.preventDefault();

    // ── EDIT MODE SELECTS RATHER THAN DRAWS ──
    //
    // A click picks the nearest shape whose outline the click is on; a click
    // on nothing clears the selection, which is how somebody gets out without
    // hunting for a Cancel. The handles themselves stop propagation, so
    // grabbing one never re-selects and never clears.
    if (tool === "edit") {
      // ── SELECTING IS DELIBERATELY MORE FORGIVING THAN SNAPPING ──
      //
      // `SNAP_RADIUS` is about 3px, which is right for deciding WHERE a new
      // point lands — a snap that reaches further would move points nobody
      // asked to move. Picking an existing shape is the opposite problem: the
      // thing being aimed at is a one-pixel line, and a 3px target makes
      // selecting it a game. `PICK_RADIUS` is about four times that, which is
      // roughly a fingertip and close to what every drawing tool uses.
      //
      // It does not scale with zoom: at 400% a shape is already easy to hit,
      // and a pick radius that grew would start claiming the shape next to it.
      const hit = (sheet?.measurements ?? []).find((m) => {
        if (vertexAt(raw, m.xs, m.ys, PICK_RADIUS) !== null) return true;
        for (let i = 1; i < m.xs.length; i += 1) {
          const near = nearestOnSegment(raw, m.xs[i - 1], m.ys[i - 1], m.xs[i], m.ys[i]);
          if (Math.hypot(near.x - raw.x, near.y - raw.y) <= PICK_RADIUS) return true;
        }
        // An AREA is pickable by its INSIDE as well as its edge: a room is a
        // big obvious target and making somebody find its outline would be
        // the same game one step harder.
        if (m.kind === "AREA" && pointInRing(raw.x, raw.y, m.xs, m.ys)) return true;
        return false;
      });
      setEditError(null);
      setEditingId(hit?.id ?? null);
      setEditDraft(hit ? { xs: [...hit.xs], ys: [...hit.ys] } : null);
      return;
    }

    setDraft((current) => {
      const last =
        current.xs.length > 0
          ? { x: current.xs[current.xs.length - 1], y: current.ys[current.ys.length - 1] }
          : null;
      const point = placePoint(raw, last, event.shiftKey);

      // A calibration is exactly two points: the second click replaces the
      // end rather than extending a polyline.
      if (tool === "calibrate" && current.xs.length >= 2) {
        return { xs: [current.xs[0], point.x], ys: [current.ys[0], point.y] };
      }

      // ── A RECTANGLE IS TWO CLICKS, AND EVERY LATER ONE RE-DRAGS ──
      //
      // The opposite corner is always rebuilt from the FIRST click, so the
      // shape never grows a fifth point however many times somebody clicks.
      // A third click moves the far corner rather than starting again, which
      // is the forgiving reading: the Save form is on screen by then, so the
      // likely intent is "not quite" rather than "start over" — and Clear is
      // there for the other one.
      //
      // (This comment said the opposite for an hour — "a third click starts a
      // new rectangle" — and the e2e walk written from it failed against the
      // code. The code was the better behaviour; the sentence was wrong.)
      if (tool === "rect") {
        if (current.xs.length === 0) return { xs: [point.x], ys: [point.y] };
        return rectanglePoints({ x: current.xs[0], y: current.ys[0] }, point);
      }

      // ── CLICKING THE FIRST POINT CLOSES A RING ──
      //
      // Areas and cutouts only. A LINEAR run that ends where it started is a
      // legitimate loop of wall, and treating that click as "close" would
      // refuse to measure the last few feet of a room's perimeter.
      //
      // Closing is a no-op on the geometry — `ringArea` already treats the
      // list as closed — so this just stops the click adding a duplicate of
      // the first vertex, which would read as a zero-length final edge.
      if ((tool === "area" || tool === "cutout") && closesRing(point, current.xs, current.ys, SNAP_RADIUS / Math.max(1, zoomFactor))) {
        return current;
      }

      return { xs: [...current.xs, point.x], ys: [...current.ys, point.y] };
    });
  };

  /**
   * ── A TYPED LENGTH, which is how a plan's PRINTED dimension gets used ──
   *
   * A corridor marked 42'-6" often scales at 42'-2", and the estimator trusts
   * the figure on the paper. So the direction comes from the last two points
   * and the distance comes from the keyboard.
   */
  const [typedFeet, setTypedFeet] = useState("");
  /**
   * ── NO `router.refresh()` AFTER THESE SAVES, AND THAT IS NOT AN OMISSION ──
   *
   * CLAUDE.md's #61 entry establishes it from the installed Next source: a
   * Server Action that calls `revalidatePath` and RETURNS a value has flight
   * data appended to its own POST response, and the client re-renders from
   * it. `TakeoffForm` is the control that proves it — no refresh, and it
   * works.
   *
   * The first version of this called `useRouter().refresh()`, which also
   * broke every unit test that renders this component: `useRouter` throws
   * "invariant expected app router to be mounted" outside one.
   */

  /**
   * ── EDITING A SAVED SHAPE ──
   *
   * `editDraft` is the geometry being dragged; the stored row is untouched
   * until Save. Local-first on purpose: a vertex drag at 60fps against a
   * server action would be a request per frame, and the thing being moved
   * would lag the pointer by a round trip.
   */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft | null>(null);
  const [draggingVertex, setDraggingVertex] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // A different sheet is a different set of shapes.
  useEffect(() => {
    setEditingId(null);
    setEditDraft(null);
    setDraggingVertex(null);
  }, [pageNumber]);
  const [cuttingOut, setCuttingOut] = useState(false);
  const [cutoutError, setCutoutError] = useState<string | null>(null);
  const applyTypedLength = () => {
    const feet = Number(typedFeet.replace(/,/g, ""));
    setDraft((current) => {
      if (current.xs.length < 2) return current;
      const n = current.xs.length;
      const from = { x: current.xs[n - 2], y: current.ys[n - 2] };
      const toward = { x: current.xs[n - 1], y: current.ys[n - 1] };
      const moved = extendByLength(from, toward, feet, feetPerUnit);
      if (!moved) return current;
      const xs = [...current.xs];
      const ys = [...current.ys];
      xs[n - 1] = moved.x;
      ys[n - 1] = moved.y;
      return { xs, ys };
    });
    setTypedFeet("");
  };

  const undoPoint = () =>
    setDraft((current) => ({ xs: current.xs.slice(0, -1), ys: current.ys.slice(0, -1) }));

  // ── THE FEET-PER-PAGE-WIDTH THIS SHEET IS CALIBRATED AT ──
  //
  // One derivation, used by the readout below AND by the wall finder, so the
  // two can never disagree about what the sheet's scale is.
  const feetPerUnit = useMemo(
    () => (calibration ? feetPerPageWidth(calibration as StoredCalibration) : null),
    [calibration],
  );

  /**
   * FINDING THE WALLS ON THIS SHEET.
   *
   * ── IT RUNS IN THE BROWSER, AND THAT IS NOT A SHORTCUT ──
   *
   * This component already holds the pdf.js document open to draw the sheet, so
   * the stroked lines a wall is made of are a method call away —
   * `getOperatorList()`, the same one the server-side reader uses. Detecting
   * here means no upload, no round trip, no stored proposals and no new table:
   * the drawing is already here and the answer is already in it.
   *
   * ── IT WORKS IN PAGE-WIDTH UNITS, NOT POINTS ──
   *
   * The finder only needs its coordinates and its feet-per-unit to agree with
   * each other. Converting the segments to the same 0..1 box the measurements
   * live in means the centrelines come back ready to SAVE, with no second
   * conversion anywhere for a sign or a factor to go wrong in.
   *
   * ── WHY A BUTTON RATHER THAN AUTOMATIC ──
   *
   * On the biggest sheet measured this takes about 1.7 seconds and returns 511
   * runs. Doing that unasked, on every sheet somebody opens, would be a freeze
   * nobody requested — and a found wall is a proposal, which should arrive
   * because a person asked a question.
   */
  /**
   * ── ASK WHAT THESE RUNS ACTUALLY ARE ──
   *
   * The geometry has already measured every one of them. This sends a picture
   * of the part of the sheet on screen, with the runs drawn and numbered on it,
   * and gets back a label each. Nothing it returns can change a length, a
   * thickness or a quantity — only whether a run is counted.
   *
   * WHY THE PART ON SCREEN. `planSheets.ts` works out why it never sends an
   * image: an ARCH D page fitted to a model's 2,576px long edge is about 65
   * DPI, which puts 1/8in lettering at eight pixels. The same arithmetic is why
   * this crops. What the estimator has zoomed to is already the region they
   * care about, and at a readable zoom it is a readable image — the room tags
   * and fixture outlines are what separate a kitchen from a corridor.
   */
  /**
   * Read a scanned sheet's lettering, one tile at a time.
   *
   * Tiled because a whole ARCH D sheet in one image is a thumbnail by the time
   * the model sees it — nobody reads a dimension string at 44 dpi. Each tile
   * is rendered at `TILE_PX` across `TILE_PT` of paper, about 190 dpi, and the
   * tile's own offset is applied on the server so page coordinates cannot
   * drift between the two sides.
   *
   * Tiles go ONE AT A TIME rather than in parallel: each is a separate charge
   * against the company's allowance, and a refusal part way through should
   * stop the rest rather than race a dozen requests that have already been
   * sent.
   */
  const onReadSheet = useCallback(async () => {
    setReading(true);
    setReadError(null);
    try {
      const doc = docRef.current;
      if (!doc) {
        setReadError("The sheet isn't open yet.");
        return;
      }
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const page = (await doc.getPage(pageNumber)) as {
        getViewport: (o: { scale: number }) => { width: number; height: number };
        render: (o: unknown) => { promise: Promise<void> };
      };
      // ── THE VIEWER'S OWN RENDER HAS TO GET OUT OF THE WAY FIRST ──
      //
      // pdf.js serialises renders per PAGE, and `doc.getPage` hands back the
      // same cached page object the viewer is drawing with. So a tile render
      // started while the sheet is still drawing simply queues behind it —
      // and a browser tester watched exactly that: "Drawing…" on the canvas,
      // the counter stuck on "0 of 15" for five minutes, and NOT ONE request
      // ever sent, because the loop never reached its first call.
      //
      // Cancelling is the same discipline this component already uses on
      // itself before each of its own renders; it just was not applied to
      // these. The sheet redraws afterwards on the next pass.
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;

      const full = page.getViewport({ scale: 1 });
      const across = Math.ceil(full.width / TILE_PT);
      const down = Math.ceil(full.height / TILE_PT);
      const scale = TILE_PX / TILE_PT;

      const words: { str: string; x: number; y: number; width: number; height: number }[] = [];
      const total = across * down;
      let done = 0;
      // Tiles skipped for carrying no ink at all. If EVERY tile is blank the
      // render is broken, not the drawing, and the message below says which.
      let blankTiles = 0;
      // What the model CLAIMED across every tile, which is the only thing that
      // tells a zero apart from a zero. See the message below.
      let reported = 0;
      setReadProgress(`Reading the sheet — 0 of ${total} parts…`);
      for (let ty = 0; ty < down; ty += 1) {
        for (let tx = 0; tx < across; tx += 1) {
          const tile = document.createElement("canvas");
          tile.width = TILE_PX;
          tile.height = TILE_PX;
          const ctx = tile.getContext("2d");
          if (!ctx) {
            setReadError("This browser couldn't prepare the image. Nothing was sent.");
            return;
          }
          // Paper first: a PDF page is transparent where nothing is drawn, and
          // a transparent pixel reads as black once alpha is dropped.
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, TILE_PX, TILE_PX);
          // ── THE OFFSET GOES TO pdf.js, NOT ON THE CONTEXT ──
          //
          // This pre-applied `ctx.translate(...)` and let render draw through
          // it. That works in the Node build — the eval reads 101 of 101
          // printed strings that way — and it does NOT work here: a browser
          // tester ran the whole sheet, fifteen requests, every one a 200, and
          // got back "No writing could be made out on this sheet." The model
          // was right. It was handed fifteen blank tiles.
          //
          // `transform` is pdf.js's own parameter for exactly this, and it is
          // applied inside `beginDrawing` where the viewport transform is
          // composed. Nothing about a canvas context's prior state is part of
          // that contract.
          await page.render({
            canvasContext: ctx,
            viewport: page.getViewport({ scale }),
            transform: [1, 0, 0, 1, -tx * TILE_PT * scale, -ty * TILE_PT * scale],
          }).promise;

          // ── JPEG, BECAUSE THIS READS SCANS ──
          //
          // PNG is the wrong format for speckled paper: the same tile measured
          // 1.20 MB as PNG against 0.54 MB as JPEG, and the PNG was over a
          // Server Action's body limit — so the feature failed on exactly the
          // sheets it exists for and worked on the clean ones.
          // ── A BLANK TILE IS NEVER WORTH SENDING ──
          //
          // Fifteen model calls were spent on fifteen empty images, and the
          // only thing that came back was the app's own "nothing was legible"
          // sentence — which is indistinguishable from a genuinely blank sheet.
          // Counting the ink first is free, it refuses to spend on an empty
          // picture, and it tells the two apart: a RENDER that produced
          // nothing is our bug, and this says so rather than blaming the scan.
          //
          // Sampled rather than exhaustive: every 16th pixel over 2.56M is
          // 160,000 samples, which is far more than enough to tell ink from
          // paper and costs no perceptible time on the page.
          const probe = ctx.getImageData(0, 0, TILE_PX, TILE_PX).data;
          let dark = 0;
          let seen = 0;
          for (let i = 0; i < probe.length; i += 4 * 16) {
            seen += 1;
            if ((probe[i] * 299 + probe[i + 1] * 587 + probe[i + 2] * 114) / 1000 <= 160) dark += 1;
          }
          if (seen > 0 && dark / seen < BLANK_TILE_INK) {
            blankTiles += 1;
            done += 1;
            setReadProgress(`Reading the sheet — ${done} of ${total} parts…`);
            continue;
          }

          const base64 = tile.toDataURL("image/jpeg", 0.9).split(",")[1] ?? "";

          // ── A FAILED TILE MUST NOT LEAVE THE BUTTON SPINNING ──
          //
          // A browser tester watched this sit on "Reading the sheet…" for
          // three minutes after a 503 and never say anything. The action
          // returns a readable refusal for every case it can see, but a
          // request the PLATFORM ends never reaches it — so the throw has to
          // be caught here, or the page stops having an opinion at all.
          let result;
          try {
            result = await readScannedSheetTile({
              imageBase64: base64,
              tileX: tx,
              tileY: ty,
              tilePt: TILE_PT,
              mediaType: "image/jpeg",
            });
          } catch {
            setReadError(
              `The sheet stopped being read part way through (${done} of ${total} parts done). ` +
                "Nothing was changed. Press Read this sheet to try again.",
            );
            return;
          }
          if (!result.ok) {
            setReadError(result.error);
            return;
          }
          words.push(...result.value.items);
          reported += result.value.reported;
          done += 1;
          // WHAT IT IS DOING, not merely that it is doing something. Nine
          // requests take a while, and a button that only says "Reading…" is
          // indistinguishable from one that has died — which is precisely how
          // the failure above was reported.
          setReadProgress(`Reading the sheet — ${done} of ${total} parts…`);
        }
      }
      scannedWordsRef.current = words;
      setWordsRead(words.length);
      setReadReported(reported);
      setReadBlank(blankTiles === total);
    } finally {
      setReading(false);
      setReadProgress(null);
    }
  }, [pageNumber]);

  const onCheckRuns = useCallback(async () => {
    const canvas = canvasRef.current;
    const regroup = regroupRef.current;
    if (!canvas || !regroup) return;
    setChecking(true);
    setCheckError(null);
    try {
      // The visible slice of the canvas, in canvas pixels. Taken from the
      // boxes rather than from the scroll state so it cannot disagree with
      // what is on screen.
      const shown = canvas.getBoundingClientRect();
      const frame = canvas.parentElement?.getBoundingClientRect() ?? shown;
      const toCanvas = canvas.width / Math.max(shown.width, 1);
      const left = Math.max(0, (frame.left - shown.left) * toCanvas);
      const top = Math.max(0, (frame.top - shown.top) * toCanvas);
      const right = Math.min(canvas.width, (frame.right - shown.left) * toCanvas);
      const bottom = Math.min(canvas.height, (frame.bottom - shown.top) * toCanvas);
      const cropW = Math.max(1, right - left);
      const cropH = Math.max(1, bottom - top);

      // The runs whose middle is in view, numbered from 1 in the order they are
      // drawn — the number beside a run in the image IS its id.
      const inView = runsRef.current.filter((run) => {
        const x = ((run.x1 + run.x2) / 2) * canvas.width;
        const y = ((run.y1 + run.y2) / 2) * canvas.width;
        return x >= left && x <= right && y >= top && y <= bottom;
      });
      if (inView.length === 0) {
        setCheckError("No runs are in view. Scroll to a part of the sheet that has some.");
        return;
      }

      const side = 1600;
      const scale = Math.min(side / cropW, side / cropH, 4);
      const out = document.createElement("canvas");
      out.width = Math.round(cropW * scale);
      out.height = Math.round(cropH * scale);
      const ctx = out.getContext("2d");
      if (!ctx) {
        setCheckError("This browser couldn't prepare the image. Nothing was sent.");
        return;
      }
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(canvas, left, top, cropW, cropH, 0, 0, out.width, out.height);

      ctx.lineWidth = Math.max(2, out.width / 500);
      ctx.strokeStyle = "rgba(225,17,17,0.85)";
      ctx.fillStyle = "#e11";
      ctx.font = `bold ${Math.max(11, Math.round(out.width / 110))}px sans-serif`;
      inView.forEach((run, i) => {
        const px = (v: number) => (v * canvas.width - left) * scale;
        const py = (v: number) => (v * canvas.width - top) * scale;
        ctx.beginPath();
        ctx.moveTo(px(run.x1), py(run.y1));
        ctx.lineTo(px(run.x2), py(run.y2));
        ctx.stroke();
        ctx.fillText(
          String(i + 1),
          (px(run.x1) + px(run.x2)) / 2 + 4,
          (py(run.y1) + py(run.y2)) / 2 - 4,
        );
      });

      const base64 = out.toDataURL("image/png").split(",")[1] ?? "";
      const cropFeet = (cropW / canvas.width) * feetAcrossRef.current;
      const result = await classifyWallCandidates(
        base64,
        cropFeet,
        inView.map((run, i) => ({
          id: i + 1,
          thicknessIn: run.thicknessFeet * 12,
          lengthFt: run.lengthFeet,
        })),
      );
      if (!result.ok) {
        setCheckError(result.error);
        return;
      }

      // Applied to the runs by identity, so a run out of view keeps whatever it
      // already had and nothing is re-labelled by scrolling.
      const next = new Map(labels ?? []);
      for (const one of result.value.labels) {
        const run = inView[one.id - 1];
        if (!run) continue;
        const at = runsRef.current.indexOf(run);
        if (at >= 0) next.set(at, { label: one.label, reason: one.reason });
      }
      setLabels(next);
      setMissed(result.value.missing);
      // UNSURE IS KEPT, not dropped. A run the model could not place is a run a
      // person should look at, and the safe direction for a quantity nobody has
      // accepted yet is to leave it on the list.
      setFound(
        regroup(
          runsRef.current.filter((_, at) => {
            const verdict = next.get(at);
            return verdict === undefined || !demotes(verdict.label);
          }),
        ),
      );
    } catch {
      setCheckError("The runs couldn't be checked just now. Nothing changed.");
    } finally {
      setChecking(false);
    }
  }, [labels]);
  /**
   * The demoted runs, for the panel and the overlay — only with the company's
   * switch on and outside labelling mode. Empty otherwise, so nothing below
   * renders and the switch-off behaviour is byte-for-byte what it was.
   */
  const demote = demotedWalls && answerKey === undefined;
  const demoted = demote ? demotedRuns(labels, runsRef.current) : [];
  /** The model the find scores with — a ref, so the find callback need not re-bind on it. */
  const wallModelRef = useRef<{ model: WallModel; cut: number } | null>(null);
  wallModelRef.current = demote ? wallModel : null;
  const [hoveredDemoted, setHoveredDemoted] = useState<number | null>(null);
  /**
   * Taking a run back is its verdict becoming WALL, then the list rebuilt from
   * every run the way the check builds it. Same rule as the check: a run the
   * estimator removed by hand after checking comes back too, because the
   * verdicts are the only record kept and removal is not one of them.
   */
  const onAcceptDemoted = useCallback(
    (at: number) => {
      const regroup = regroupRef.current;
      if (!regroup || labels === null) return;
      const next = new Map(labels);
      next.set(at, { label: "WALL", reason: "you put it back" });
      setLabels(next);
      setFound(
        regroup(
          runsRef.current.filter((_, i) => {
            const verdict = next.get(i);
            return verdict === undefined || !demotes(verdict.label);
          }),
        ),
      );
    },
    [labels, setLabels],
  );

  /**
   * ── THE WALLS FOUND EARLIER, PUT BACK ON THE SHEET ──
   *
   * Detection now runs when a scale is saved, so by the time somebody opens the
   * sheet the groups are usually already stored. This is what makes that
   * visible: without it the work happened and the panel still said to press a
   * button.
   *
   * IT SEEDS THE SAME STATE `onFindWalls` WRITES, deliberately, rather than
   * adding a second source for the panel to read. Every render site, the ghost
   * overlay, accepting a group and Clear all go on working untouched — and the
   * bug that shape avoids is the one `wallsOnThisSheet` was written for: two
   * render sites reading two variables, neither wrong on its own.
   *
   * ONCE PER PAGE. `seeded` means Clear is honoured rather than undone on the
   * next render, and that a sheet somebody has already worked through does not
   * refill itself behind them.
   */
  /**
   * ── PLAN TEXT FOR THIS SHEET, WHEN THE SWITCH IS ON ──
   *
   * One read of the file cache per page view; `null` is the switch being off
   * or nothing read yet, and both render as nothing. Re-read when the groups
   * change, because detection writes the result in the same pass that writes
   * the proposals these groups were loaded from.
   */
  const [planText, setPlanText] = useState<PlanTextView | null>(null);
  useEffect(() => {
    let live = true;
    loadPlanText(jobId, planId, pageNumber)
      .then((result) => {
        if (live) setPlanText(result.ok ? result.value : null);
      })
      .catch(() => {
        if (live) setPlanText(null);
      });
    return () => {
      live = false;
    };
  }, [jobId, planId, pageNumber, storedWallsByPage]);
  const planTextDoors = useMemo(
    () => doorsByGroup(found ?? [], planText?.sheet?.doors?.placed ?? [], feetPerUnit),
    [found, planText, feetPerUnit],
  );

  useEffect(() => {
    if (seeded.current.has(pageNumber)) return;
    const stored = storedWallsFor(storedWallsByPage, pageNumber);
    if (stored === null) return;
    // NOT OVER THE TOP OF A LIVE RESULT. A press of Find the walls on this very
    // sheet is newer than anything on the server and must win.
    if (foundRaw !== null && foundOnPage === pageNumber) return;
    seeded.current.add(pageNumber);
    setFound(stored);
    setFoundOnPage(pageNumber);
    setChosen({});
    setShowingAll(false);
  }, [pageNumber, storedWallsByPage, foundRaw, foundOnPage]);

  /**
   * ── WHAT KIND OF SHEET IS THIS, READ OFF THE DRAWING ITSELF ──
   *
   * `sheetSuitability` is the thing that keeps a mechanical plan's walls out of
   * a bid — an M-101 carries the architectural walls in grey under the ductwork
   * and they are the SAME walls the A-101 already has, so adding them bids the
   * job twice. The takeoff page already runs it, and on a real plan set it says
   * nothing at all: it is fed `effectiveSheetNumber`/`effectiveTitle`, which
   * both return null when the page has no `PlanSheetProposal` row — every sheet
   * of every set uploaded before the ingest shipped. Fifty-two sheets reading
   * "need their numbers typed in" is fifty-two sheets this cannot judge.
   *
   * `sheetNumber.ts` was written for exactly that gap and its own header says
   * so, ending "IT HAS NO PRODUCTION CALLER YET, SAID OUT LOUD" — because the
   * takeoff PAGE reads database rows and cannot open the PDF.
   *
   * THIS SIDE CAN. The viewer has the document open and is already reading the
   * page's text for the wall finder, so the two fields that need no model are
   * one pure call away. No schema, no stage, no allowance, and it works on a
   * set uploaded a year ago.
   *
   * ONLY WHERE THE SERVER HAD NOTHING. A proposal that a model read and a
   * person may have corrected beats a heuristic every time, so this fills a
   * silence rather than competing for the same space.
   *
   * ONLY FOR A SHEET SHOWING WALLS, which is both the cheap option and the
   * honest one: the caution's whole job is to be read beside the quantities it
   * doubts, and a sheet nobody has measured has nothing to doubt yet.
   *
   * IT NEVER THROWS. A caution is a courtesy; a page whose text will not parse
   * keeps the takeoff it already had.
   */
  useEffect(() => {
    if (found === null || found.length === 0) return;
    if (duplicateWallsByPage[pageNumber]) return;
    if (cautionAsked.current.has(pageNumber)) return;
    const doc = docRef.current;
    if (!doc || !pageSize) return;
    cautionAsked.current.add(pageNumber);

    let cancelled = false;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const page = await doc.getPage(pageNumber);
        const items = await pageTextItems(page, pdfjs);
        const reading = sheetNumberFrom({
          pageNumber,
          widthPt: pageSize.widthPt,
          heightPt: pageSize.heightPt,
          // The viewport has already applied the page's own `/Rotate`, so the
          // coordinates above are of the sheet AS DISPLAYED and the angle has
          // nothing left to say. `sheetNumberFrom` reads only x and y.
          rotation: 0,
          items,
        });
        // `regionText` is the title block's whole text, which is the right
        // shape for `sheetSuitability`'s unanchored substring rules and the
        // wrong shape for showing anybody — it carries the project name and the
        // architect's address. It is never rendered.
        const caution = duplicateWallsCaution(
          sheetSuitability(reading.sheetNumber, reading.regionText, null),
          reading.sheetNumber,
        );
        if (!cancelled && caution) setReadCaution((prev) => ({ ...prev, [pageNumber]: caution }));
        // ── AND WHETHER THIS SHEET CARRIES MORE THAN ONE DRAWING ──
        //
        // The same `items` the sheet number was read from, so this costs one
        // more pass over text already in hand and no extra PDF work. It is read
        // in the BROWSER for the same reason the sheet number is: it is
        // available on sets the ingest stage never reached, and it needs no
        // model.
        const scaleCaution = multiScaleCaution(
          printedScalesOnPage(items),
          scalePrefillByPage[pageNumber]?.scaleName ?? null,
        );
        if (!cancelled && scaleCaution) {
          setScaleCautionByPage((prev) => ({ ...prev, [pageNumber]: scaleCaution }));
        }
      } catch {
        // Nothing: the sheet keeps the takeoff it already had.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [found, pageNumber, duplicateWallsByPage, pageSize, scalePrefillByPage]);

  /**
   * ── IS THERE A FLOOR PLAN ON THIS SHEET AT ALL? ──
   *
   * Read when the sheet opens rather than after a find, which is the whole
   * point: the caution effect above runs only once walls exist, and the
   * question here is whether to invite the press in the first place.
   *
   * It costs ONE text pass per sheet, over text this file already knows how to
   * read, and no model. The two sources are the title block — which is what
   * names A130 PARTITION TYPES — and the captions under the drawings, which
   * are what name a sheet whose title block says nothing useful.
   *
   * IT NEVER THROWS, like the caution beside it: a sheet whose text will not
   * parse is offered exactly as it was before this existed.
   */
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !pageSize) return;
    // ── ASKED FOR THIS PAGE *AT THIS SIZE*, AND ONLY WHILE IT SUCCEEDS ──
    //
    // This was keyed on the page alone and marked before the read, and the
    // read never completed for any sheet somebody navigated to. Paging sets a
    // NEW `pageSize` object once the sheet renders, so the effect re-ran, its
    // cleanup cancelled the in-flight read, and the guard then refused to
    // start another — the title block was never read, so an answer key saved
    // on A102 was named `p9.key.json` and the not-a-takeoff-sheet verdict
    // never arrived either.
    //
    // Keyed on the size as well, so the second run is a different question;
    // and released on the way out, so a cancelled read is retried rather than
    // remembered as done.
    const asked = `${pageNumber}:${pageSize.widthPt}x${pageSize.heightPt}`;
    if (askedVerdict.current.has(asked)) return;
    askedVerdict.current.add(asked);

    let done = false;
    let cancelled = false;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const page = await doc.getPage(pageNumber);
        const items = await pageTextItems(page, pdfjs);
        const reading = sheetNumberFrom({
          pageNumber,
          widthPt: pageSize.widthPt,
          heightPt: pageSize.heightPt,
          rotation: 0,
          items,
        });
        if (!cancelled && reading.sheetNumber) {
          onSheetNumber?.(pageNumber, reading.sheetNumber);
        }
        const verdict = takeoffSheetVerdict({
          sheetNumber: reading.sheetNumber,
          title: reading.regionText,
          viewNames: sheetViews(items, pageSize.widthPt).map((view) => view.name),
        });
        if (!cancelled) {
          setTakeoffVerdictByPage((prev) => setOnThisSheet(prev, pageNumber, verdict));
          done = true;
        }
      } catch {
        // The sheet is offered as it always was.
      }
    })();
    return () => {
      cancelled = true;
      // Not finished means not asked: the next run does it properly.
      if (!done) askedVerdict.current.delete(asked);
    };
  }, [pageNumber, pageSize, onSheetNumber]);

  /** What this sheet is, and whether somebody has overruled it. */
  const takeoffVerdict = onThisSheet(takeoffVerdictByPage, pageNumber);
  const notATakeoffSheet =
    takeoffVerdict !== null &&
    !takeoffVerdict.worthMeasuring &&
    onThisSheet(overriddenByPage, pageNumber) === null;

  /**
   * ── FIND THE ROOMS ──
   * From what the last find left behind — every pairing, the kept runs — plus
   * the lines drawn by hand on this sheet, which is how an estimator closes a
   * room the finder left open. Pure and synchronous; no PDF is re-read.
   */
  const [roomCeilings, setRoomCeilings] = useState<Map<number, RoomCeiling> | null>(null);
  async function onFindRooms() {
    if (!pageSize || feetPerUnit === null) return;
    const walls = roomBoundary({
      pairings: pairingsRef.current,
      runs: runsRef.current,
      drawn: sheet?.measurements ?? [],
    });
    const result = roomsFromWalls({ walls, feetPerUnit, text: wordsRef.current, widthPt: pageSize.widthPt });
    setRooms(result);
    setRoomsOnPage(pageNumber);
    setHoveredRoom(null);
    setRoomCeilings(null);
    // ── THE CEILINGS, FROM THIS SHEET AND THE PLAN'S CEILING PAGES ──
    // Read from the open PDF here in the browser, the way the words above were;
    // a page that fails to read is left out rather than failing the rooms.
    try {
      const doc = docRef.current as { getPage: (n: number) => Promise<unknown> } | null;
      const others: CeilingPageText[] = [];
      if (doc) {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        // With no stored title block naming a ceiling page, every page of a small plan is
        // tried by its own text — a two-sheet extract has no index to say which is which.
        const numPages = (doc as unknown as { numPages?: number }).numPages ?? 0;
        const candidates =
          ceilingPages.length > 0 ? ceilingPages : numPages > 0 && numPages <= 40 ? Array.from({ length: numPages }, (_, i) => i + 1) : [];
        for (const n of candidates.filter((p) => p !== pageNumber).slice(0, 40)) {
          try {
            const page = (await doc.getPage(n)) as { getViewport: (o: { scale: number }) => { width: number; height: number } };
            const items = await pageTextItems(page, pdfjs);
            if (ceilingPages.length === 0 && !items.some((i) => /REFLECTED\s+CEILING|\bRCP\b|CEILING\s+PLAN|FINISH\s+SCHEDULE|ROOM\s+FINISH/i.test(i.str))) continue;
            const viewport = page.getViewport({ scale: 1 });
            const asPage = { items, widthPt: viewport.width, heightPt: viewport.height } as unknown as Parameters<typeof tableRowsFromPage>[0];
            others.push({ pageNumber: n, items, widthPt: viewport.width, tableRows: tableRowsFromPage(asPage) });
          } catch {
            // this page did not read; the others still count
          }
        }
      }
      const last = lastDetect.current;
      const strokes =
        last !== null && last.page === pageNumber && last.widthPt > 0
          ? last.segments.map((s) => ({ x1: s.x1 / last.widthPt, y1: s.y1 / last.widthPt, x2: s.x2 / last.widthPt, y2: s.y2 / last.widthPt }))
          : undefined;
      const here = { items: wordsRef.current, widthPt: pageSize.widthPt, heightPt: pageSize.heightPt } as unknown as Parameters<typeof tableRowsFromPage>[0];
      setRoomCeilings(
        ceilingsForRooms({
          rooms: result.rooms,
          current: { pageNumber, items: wordsRef.current, widthPt: pageSize.widthPt, tableRows: tableRowsFromPage(here) },
          strokes,
          feetPerUnit,
          others,
        }),
      );
    } catch {
      setRoomCeilings(new Map());
    }
  }
  /** Every saved room on the job with a ceiling, as square feet by family, for the job summary. */
  const savedRoomCeilings = sheets.flatMap((s) =>
    s.measurements
      .filter((m) => m.ceiling !== null && m.ceiling !== undefined && m.kind === "AREA")
      .map((m) => {
        const span = Math.hypot(m.calibration.x2 - m.calibration.x1, m.calibration.y2 - m.calibration.y1);
        const fpu = span > 0 ? m.calibration.declaredDistanceFeet / span : 0;
        const units = ringArea(m.xs, m.ys) ?? 0;
        return { pageNumber: s.pageNumber, squareFeet: Math.abs(units) * fpu * fpu, family: m.ceiling!.family, code: m.ceiling!.code };
      }),
  );

  async function onFindWalls() {
    const doc = docRef.current;
    if (!doc || !pageSize || feetPerUnit === null) return;
    setFinding(true);
    setFindError(null);
    setFound(null);
    setRooms(null);
    setChosen({});
    setShowingAll(false);
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      // ── WHAT THE DRAFTER CALLED EACH LINE, WHERE THE EXPORT SAYS SO ──
      //
      // Read ONCE for the document, because the names are the same on every
      // sheet and the sampling loop below opens six more of them. `null` on a
      // flattened plot, which is the ordinary case and means every filter
      // downstream behaves exactly as it did before layers existed.
      const layers = await layersOf(doc);
      const page = await (doc as { getPage: (n: number) => Promise<unknown> }).getPage(pageNumber);
      const { segments } = await segmentsFromOpenPage(page, pdfjs, pageNumber, layers);
      setStrokesSeen(segments.length);

      // ── WHERE THE WORDS ARE ──
      //
      // Read here because only this side has the open document; the BASELINE is
      // handed on untouched. `findWallsOnSheet` applies the glyph-height shift
      // itself, once, so the browser and the server cannot disagree about where
      // a word is — which they would, because `planPdf.pageText` stores the
      // baseline and this used to subtract before passing anything on.
      const vectorWords = await pageTextItems(page, pdfjs);
      wordsRef.current = vectorWords;
      // ── A SCAN'S WORDS ENTER EXACTLY HERE ──
      //
      // A scanned sheet has no text layer, so `pageTextItems` returns nothing
      // and every reader downstream — the printed scale, the dimension
      // labels, the lettering filter — has nothing to work with. Read this
      // sheet puts the model's reading in `scannedWordsRef`, in the SAME
      // baseline-y page coordinates this function returns, so nothing below
      // can tell the difference.
      //
      // The vector text wins whenever there is any: a sheet that carries its
      // own words must never be served a model's reading of a picture of
      // them.
      const textItems = vectorWords.length > 0 ? vectorWords : (scannedWordsRef.current ?? []);

      // ── THE SET'S OWN TEMPLATE, READ FROM OTHER SHEETS ──
      //
      // The frame, the title block and the logo are the only geometry at the
      // SAME page position on every sheet of a set. A wall is not. It costs a
      // few extra page parses; `pagesToSample` spreads them across the whole
      // document rather than taking neighbours, which is the identical-floors
      // guard — levels 3 to 10 of a tower repeat their REAL walls, and evenly
      // spaced samples cross disciplines, where nothing but the template
      // survives.
      //
      // THE READING IS HERE AND THE FILTERING IS NOT. Only this side can open
      // another page; what it produces is handed over as data. A page that will
      // not parse yields `null`, which is not an error — the geometric filters
      // still run and the sheet gets exactly what it had before this existed.
      let sampledSheets: StrokeSegment[][] | null = null;
      try {
        const sampled: StrokeSegment[][] = [];
        for (const n of pagesToSample(doc.numPages, pageNumber)) {
          if (n === pageNumber) {
            sampled.push(segments.map(inPageWidthUnits(pageSize.widthPt)));
            continue;
          }
          const other = await (doc as { getPage: (n: number) => Promise<unknown> }).getPage(n);
          const read = await segmentsFromOpenPage(other, pdfjs, n, layers);
          // ITS OWN width, not this sheet's. A set with a mixed page size would
          // otherwise compare one sheet's coordinates against another's scale.
          sampled.push(read.segments.map(inPageWidthUnits(read.widthPt || pageSize.widthPt)));
        }
        sampledSheets = sampled;
      } catch {
        sampledSheets = null;
      }

      // ── ONE PIPELINE, SHARED ──
      //
      // Everything from here to the groups lives in `findWallsOnSheet` so that
      // the bench and the server run the SAME filters in the SAME order. It was
      // inline here, and the bench's copy of it had silently drifted — no
      // scale-bar filter and a dropped `curved` flag, both of which invent
      // walls. See that file's header.
      // ── ONE SHEET CAN CARRY MORE THAN ONE DRAWING, AT MORE THAN ONE SCALE ──
      //
      // Gated on TWO OR MORE views, deliberately. On a single-view sheet this
      // path would clip to the band starting at that view's own caption, and a
      // caption sits at the left margin — so anything drawn to the LEFT of it
      // would be dropped for no gain. 19 of the 20 fixtures are single-view and
      // take exactly the route they took before this existed.
      //
      // `sheetViews.ts` carries why a view must be clipped before it is
      // re-scaled, and why the captions are used as a RATIO against the
      // calibration rather than as absolute scales.
      const views = viewsInRegions(
        sheetViews(textItems, pageSize.widthPt),
        viewRegions(segments, pageSize),
      );
      let found: FoundOnSheet;
      /**
       * Every pairing the finder considered on this sheet, with its feature
       * vector, for answer-key mode.
       *
       * Declared out here because the sheet is measured by one of TWO paths —
       * `wallsPerView` when the sheet carries several plan views, the single
       * call below when it carries one — and a reviewed sheet is training data
       * only if both report. Collecting at just the second one meant Save to
       * labels refused every multi-view sheet, which is most real ones.
       */
      const pairings: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        lengthFeet: number;
        thicknessFeet: number;
        features: number[];
      }[] = [];
      // Always collected now, not only for the answer key: the room step reads
      // the same list. A few thousand small objects per find.
      const collect = (features: number[], wall: WallCandidate) => {
              pairings.push({
                x1: wall.x1,
                y1: wall.y1,
                x2: wall.x2,
                y2: wall.y2,
                lengthFeet: wall.lengthFeet,
                thicknessFeet: wall.thicknessFeet,
                features: [...features],
              });
            };
      void collect;
      let otherViews: ViewWalls[] = [];
      let leftOut: ExcludedView[] = [];
      let primaryShown: { name: string; scaleName: string | null } | null = null;
      /** The parts of the page the measured PLAN views own — see `lastDetect`. */
      let planBoxes: { from: number; to: number; fromY: number; toY: number }[] | null = null;
      if (views.length >= 2) {
        const measured = wallsPerView({
          segments,
          textItems,
          pageSize,
          views,
          wallTypes,
          feetPerUnit,
          sampledSheets,
          onCandidate: collect,
        });
        const picked = primaryView(measured);
        otherViews = picked.others;
        leftOut = excludedViews(views);
        // Every view that was actually measured, which after the view-kind
        // filter is every PLAN on the sheet. `wallsPerView` has already
        // refused the elevations, the sections and the schedules.
        planBoxes = measured.flatMap(
          (one) =>
            one.view.boxes ?? [
              {
                from: one.view.from,
                to: one.view.to,
                fromY: one.view.fromY,
                toY: one.view.toY,
              },
            ],
        );
        primaryShown = picked.primary
          ? { name: picked.primary.view.name, scaleName: picked.primary.view.scaleName }
          : null;
        // ── A SHEET WITH NO PLAN ON IT MEASURES NOTHING ──
        //
        // This used to fall back to measuring the WHOLE SHEET when no view
        // produced a primary, which is the worst possible answer for the sheet
        // that most needs a good one: a page of eight interior elevations has
        // every one of them measured as wall, at an elevation's own scale,
        // with the caution saying they were left out. `excludedViews` names
        // what happened and the quantities stay empty, which is the honest
        // pair.
        found =
          picked.primary?.found ??
          // The real pipeline on NO geometry, rather than a hand-built empty
          // result: every field of `FoundOnSheet` comes out consistent, and
          // nothing here has to be kept in step with that type.
          findWallsOnSheet({
            segments: [],
            textItems,
            pageSize,
            feetPerUnit,
            wallTypes,
            sampledSheets: null,
          });
      } else {
        // ── ONE DRAWING ON THE SHEET STILL IS NOT THE WHOLE SHEET ──
        //
        // `viewRegions` has already separated the title block, the notes and
        // the legend boxes from the drawing; with one caption they were all
        // handed to it, because a region with no caption joins the nearest.
        // That rule is right and stays — it is what keeps a plan's dimension
        // column with its plan — but it meant a one-drawing sheet measured its
        // own title block, and offered its ruled lines as possible walls.
        //
        // `planRegion.ts` carries why this cannot reintroduce the S05/S07
        // scar: it keeps the BUSIEST region and whatever is comparable to it,
        // which is where a building is.
        const drawing = drawingRegions(
          viewRegions(segments, pageSize),
          segments,
          pageSize.widthPt,
        );
        const onTheDrawing = segmentsInRegions(segments, drawing, pageSize.widthPt);
        planBoxes = drawing.length > 0 ? [...drawing] : null;
        // `onCandidate` fires after the sheet-relative columns are filled, so
        // what is reported is what a model would be scored on.
        found = findWallsOnSheet({
          segments: onTheDrawing,
          textItems,
          pageSize,
          feetPerUnit,
          wallTypes,
          sampledSheets,
          onCandidate: collect,
        });
      }
      setOtherViewsByPage((prev) => ({ ...prev, [pageNumber]: otherViews }));
      setExcludedByPage((prev) => ({ ...prev, [pageNumber]: leftOut }));
      setPrimaryViewShown(primaryShown);
      const walls = found.walls;
      const regroup = found.regroup;
      setTemplateStrokes(found.templateDropped);
      setLayerDropped(found.layerDropped);

      // Both measuring paths have run by here, so this is the one place that
      // sees every pairing on the sheet whichever one was taken.
      if (pairings.length > 0) answerKeyRef.current?.onPairings?.(pairings);
      pairingsRef.current = pairings;
      runsRef.current = walls;
      feetAcrossRef.current = feetPerUnit;
      regroupRef.current = regroup;
      // ── THE MODEL'S FIRST OPINION, AT FIND TIME ──
      // Null unless the switch is on, a model file is configured and this is
      // not labelling mode, in which case every run scoring below the cut
      // leaves the list demoted — the same walls the finder's veto would have
      // dropped, kept on screen instead. See `modelVerdicts`.
      const byModel =
        wallModelRef.current !== null
          ? modelVerdicts(wallModelRef.current.model, wallModelRef.current.cut, walls, pairings, feetPerUnit)
          : null;
      const doubted = byModel !== null && byModel.size > 0 ? byModel : null;
      setLabels(doubted);
      setMissed([]);
      setCheckError(null);
      // `found.groups` IS `regroup(walls)`, computed once inside the pipeline
      // rather than twice here. The `void clusters` that used to sit on the
      // next line went with it: `clusterByThickness` was called, assigned and
      // then deliberately discarded, because the real clustering happens inside
      // `regroup`. The pipeline still returns it for the bench.
      setFound(doubted !== null ? regroup(walls.filter((_, at) => !doubted.has(at))) : found.groups);

      // ── AND, FOR A REVIEWER, EVERYTHING THE DETECTOR COULD NOT REACH ──
      //
      // Derived HERE because this is the only place that holds both the
      // detection and the raw geometry it came from. The workspace cannot do
      // it: the segments never leave this component.
      //
      // The unpaired long lines are the half of the question the detector has
      // no opinion about — 7,694 ft of them on one real sheet, 93% of which
      // classify as hatching. A key made without them would be a key about the
      // detector's own output, which is the thing it is supposed to be
      // grading.
      lastDetect.current = {
        page: pageNumber,
        // THE STROKES THE MEASUREMENT USED, not the page's. A candidate built
        // from the raw page is a candidate from the title block as readily as
        // from the plan — see `planRegion.ts`.
        segments: found.inUnits.map((one) => ({
          ...one,
          x1: one.x1 * pageSize.widthPt,
          y1: one.y1 * pageSize.widthPt,
          x2: one.x2 * pageSize.widthPt,
          y2: one.y2 * pageSize.widthPt,
        })),
        feetPerUnit,
        widthPt: pageSize.widthPt,
        walls: [...found.walls],
        planBoxes,
      };
      if (answerKey?.onCandidates) {
        const candidates = candidatesFromLastDetect();
        if (candidates !== null) {
          answerKey.onCandidates(candidates);
          answerKey.onSetAside?.(setAsideRef.current);
        }
      }

      // The sheet this answer is about, recorded WITH the answer. `pageNumber`
      // is read here rather than at render, so a result can never be relabelled
      // by paging — see `wallsOnThisSheet`.
      setFoundOnPage(pageNumber);
    } catch (problem) {
      // The sheet is still on screen and the manual tools still work, so this
      // says what failed and stops — it does not take the page down.
      //
      // A SHEET THAT IS SIMPLY TOO DENSE GETS ITS OWN SENTENCE, because the
      // generic one sends somebody looking for a broken file. Page 7 of a real
      // airport concourse set carries 30,822 lines long enough to be walls —
      // 475 million pairs to test, against about a million on a sheet that
      // works — and before `SheetTooDenseError` the finder simply never
      // returned. "Couldn't be read" would be false: it was read fine and there
      // is too much of it.
      setFindError(
        problem instanceof SheetTooDenseError
          ? problem.message
          : "The lines on this sheet couldn't be read. Trace the walls by hand as usual.",
      );
    } finally {
      setFinding(false);
    }
  }

  /** Accepting a group writes its runs as ordinary LINEAR measurements, which
   *  is the whole point: everything downstream — the measurement list, the wall
   *  type, the height, the priced wall run — already works on those and needs
   *  no part of this. */
  async function onAcceptCluster(index: number) {
    const group = found?.[index];
    if (!group || !sheet) return;
    // "Create a wall type from this group" leaves for the library with the
    // thickness filled in; nothing is written here. Plain measurements are
    // written only when that was the answer chosen, never as the default.
    if (chosen[index] === "create") {
      window.location.assign(`/wall-types?thicknessIn=${group.inches.toFixed(3)}`);
      return;
    }
    const priced = pricedTypeFor(group, chosen[index]);
    // THE LABEL FOLLOWS THE NAME, NOT THE PRICE. A group the drawing calls A1
    // is "A1 wall" in the measurement list whether or not A1 has layers yet —
    // losing the name because the parts are missing would throw away the half
    // of the schedule import that already works.
    const named = namedTypeFor(group, chosen[index]);
    const body = new FormData();
    body.set("pageId", sheet.id);
    // The height the panel asked for, when the type has none of its own.
    const typedHeight = Number(groupHeight[index] ?? "");
    if (priced && priced.defaultHeightFt == null && typedHeight > 0) body.set("heightFt", String(typedHeight));
    // ── THE LABEL CARRIES THE DRAWING'S OWN WORD WHERE THERE IS ONE ──
    //
    // `4⅞" wall` is what the app measured; `W1 wall` is what the drawing calls
    // it, and it is what the estimator will be looking for in the list and on
    // the recap. The thickness stays alongside it, because that is the evidence
    // the match was right.
    body.set(
      "label",
      named ? `${named.code} wall — ${inchLabel(group.inches)}` : `${inchLabel(group.inches)} wall`,
    );
    // AND THE TYPE, so the action posts a priced run instead of bare
    // quantities. Null for every unresolved state: this component must not
    // overrule a refusal, and must not price an ASK group nobody answered.
    if (priced) body.set("wallTypeId", priced.id);
    for (const run of group.runs) {
      body.append("shape", JSON.stringify({ xs: [run.x1, run.x2], ys: [run.y1, run.y2] }));
    }
    const result = await saveTakeoffMeasurements(jobId, body);
    if (!result.ok) return setFindError(result.error);
    // Only the accepted group leaves the list. The rest stay on screen, because
    // an estimator works through them one at a time and re-running the finder
    // to get back to where they were would be a punishment for accepting one.
    setFound((current) => (current ?? []).filter((_, i) => i !== index));
  }

  /**
   * The type a group would be POSTED as, or null for one that is not settled.
   *
   * ONE FUNCTION FOR THE BUTTON AND THE SUBMIT, deliberately. The button's
   * words and the form's `wallTypeId` are two readings of the same question,
   * and the way that goes wrong is a button promising "priced" over a submit
   * that sends nothing — a bid short by a whole group, with the screen saying
   * otherwise.
   */
  function namedTypeFor(group: WallGroup, pick: string | undefined): MatchableWallType | null {
    const verdict = verdictFor(group);
    // AN EXPLICIT PICK FROM THE CHOOSER NAMES ANY UNPRICED GROUP — the
    // chooser lists every type with parts (`groupChoices`), so a type the
    // thickness never matched can still be chosen on purpose. "plain" and
    // "create" are the chooser's other answers and name nothing.
    if (pick && pick !== "plain" && pick !== "create") {
      const picked = wallTypes.find((type) => type.id === pick);
      if (picked && verdict.state !== "NAMED" && verdict.state !== "ONLY_ONE_THAT_THICK") return picked;
    }
    // A SHEET NOTE IS AN OFFER, not an answer: its type leads the ASK picker
    // (`verdict.suggested`) and the group is priced only once a person picks
    // it — see `wallGroups`.
    if (verdict.state === "NAMED" || verdict.state === "ONLY_ONE_THAT_THICK") {
      return verdict.type;
    }
    // An ASK is priced only once a PERSON has answered it. No default, no
    // first-in-the-list: that is the guess this whole module refuses to make.
    if (verdict.state === "ASK") return verdict.types.find((type) => type.id === pick) ?? null;
    return null;
  }

  /**
   * The type a group would be POSTED as, or null for one that is not settled —
   * AND NULL FOR A TYPE WITH NO PARTS, which is the whole of this change.
   *
   * Naming and pricing are two questions and this app used to ask only one of
   * them. The takeoff page handed this component a list already filtered to
   * types with layers, so a schedule-imported type was invisible: on School-01
   * the app tagged a group `A1` off the drawing and said "no wall type you have
   * is 4-7/8 inch thick" in the next breath, with A1 sitting in the library at
   * exactly that thickness. See `MatchableWallType`.
   *
   * Now every type can NAME a group — `namedTypeFor` — and only a type with
   * parts can PRICE one. A layerless match still reaches the label, the row and
   * the sentence, so the estimator learns what the drawing's tag means and what
   * is missing; it just does not reach `wallTypeId`, because posting against it
   * would write a run that produces no line items.
   *
   * THE INVARIANT THE OLD COMMENT PROTECTED IS UNCHANGED: the button's words
   * and the form's `wallTypeId` both read THIS function, so they cannot
   * disagree. What changed is that the label reads the other one.
   */
  function pricedTypeFor(group: WallGroup, pick: string | undefined): MatchableWallType | null {
    const named = namedTypeFor(group, pick);
    return named !== null && named.hasParts ? named : null;
  }

  // ── What the draft currently measures, for the live readout ───────────
  const draftReading = useMemo(() => {
    if (!calibration || draft.xs.length === 0) return null;
    const stored: StoredCalibration = calibration;
    const scale = feetPerPageWidth(stored);
    if (scale === null) return null;
    if (tool === "linear" && draft.xs.length >= 2) {
      return `${(polylineLength(draft.xs, draft.ys) * scale).toFixed(1)} ft`;
    }
    if (tool === "area" && draft.xs.length >= 3) {
      if (ringSelfIntersects(draft.xs, draft.ys)) return "crosses itself";
      const area = ringArea(draft.xs, draft.ys);
      return area === null ? null : `${Math.round(area * scale * scale)} sq ft`;
    }
    if (tool === "count") return `${draft.xs.length}`;
    return null;
  }, [calibration, draft, tool]);

  const calibrationDraft: StoredCalibration | null =
    tool === "calibrate" && draft.xs.length === 2
      ? { x1: draft.xs[0], y1: draft.ys[0], x2: draft.xs[1], y2: draft.ys[1], declaredDistanceFeet: 1 }
      : null;

  const scaleReading = calibration ? readScale(calibration, sheet?.pageWidthPt ?? null) : null;

  return (
    <div className={`flex flex-col gap-3${fill ? " h-full min-h-0" : ""}`}>
      {/* ── Toolbar ───────────────────────────────────────────────── */}
      {/* NOT RENDERED in read-only, rather than each control disabled. A row of
          greyed tools is an invitation that does not work; on a phone the row
          is also most of the screen, and the screen is the point.
          NOT `hidden={readOnly}` either, which is how this was written first:
          the attribute's `display: none` comes from the UA stylesheet and
          Tailwind's own `flex` class beats it, so the row stayed on screen and
          the phone test caught it. */}
      {!readOnly && (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line-card bg-surface-card p-2">
        <div className="flex items-center gap-1">
          {TOOLS.map((entry) => {
            const disabled = entry.id !== "pan" && entry.id !== "calibrate" && !calibration;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTool(entry.id)}
                disabled={disabled}
                title={disabled ? "Set the scale on this sheet first." : entry.hint}
                className={`rounded-md px-2 py-1 text-xs ${
                  tool === entry.id
                    ? "bg-brand text-neutral-900"
                    : "border border-line-card text-ink-label hover:bg-rail-hover"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {entry.label}
              </button>
            );
          })}
        </div>

        <span className="mx-1 h-4 w-px bg-line-card" aria-hidden />

        {/* ── ZOOM, WITH FIT AS A FIRST-CLASS SETTING ──

            − and + step through `ZOOM_STEPS`. From FIT they step off the
            CURRENT rendered size rather than jumping to a remembered index, so
            pressing − on a fitted 42-inch sheet makes it a little smaller
            instead of suddenly enormous. */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom(stepZoom(zoomFactor, -1))}
            disabled={zoomFactor <= ZOOM_STEPS[0]}
            aria-label="Zoom out"
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-rail-hover disabled:opacity-40"
          >
            −
          </button>
          <span className="w-12 text-center text-xs text-ink-muted" data-takeoff="zoom">
            {Math.round(zoomFactor * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom(stepZoom(zoomFactor, 1))}
            disabled={zoomFactor >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            aria-label="Zoom in"
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-rail-hover disabled:opacity-40"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setZoom(FIT)}
            data-takeoff="fit"
            className={`ml-1 rounded-md border px-2 py-1 text-xs ${
              zoom === FIT
                ? "border-tag-amber-ink text-tag-amber-ink"
                : "border-line-card text-ink-label hover:bg-rail-hover"
            }`}
          >
            Fit
          </button>
          {/* ── AND THE WIDTH-ONLY FIT ──
              `Fit` shows the whole sheet; this fills the width and lets the
              height scroll, which is what a tall sheet wants. Two buttons
              rather than one that cycles: a control that changes meaning when
              you press it cannot be aimed at. */}
          <button
            type="button"
            onClick={() => setZoom(FIT_WIDTH)}
            className={
              zoom === FIT_WIDTH
                ? "rounded-md border border-brand px-2 py-1 text-xs text-brand"
                : "rounded-md border border-line-card px-2 py-1 text-xs text-ink-body hover:bg-surface"
            }
            data-takeoff="fit-width"
          >
            Fit width
          </button>
        </div>

        {pageCount !== null && pageCount > 1 && (
          <>
            <span className="mx-1 h-4 w-px bg-line-card" aria-hidden />
            <SheetPager
              pageNumber={pageNumber}
              pageCount={pageCount}
              sheetLabelByPage={sheetLabelByPage}
              onJump={setPageNumber}
            />
          </>
        )}

        {/* FIND THE WALLS — only once the sheet is calibrated, and the reason
            is structural rather than tidy: the finder's bounds are in FEET of
            building ("thinner than 2-1/2in is not a wall"), so without a scale
            there is no feet-per-unit and every bound means nothing. Same guard
            the measuring tools already carry, for the same reason. */}
        {/* ── SHOWN DISABLED WITHOUT A SCALE, NOT HIDDEN ──

            The gate itself is structural and unchanged: `wallVectors` asks "is
            this thinner than 2-1/2in", so without a calibration there is no
            feet-per-point and every bound in it means nothing.

            HIDING it was the mistake, and it was reported the day it shipped —
            somebody opened a sheet, went looking for the button they had been
            told about, and found nothing. No error, no explanation, just an
            absence, which reads as "this feature does not exist" rather than
            "this sheet needs a scale first". Three separate defects this week
            have had that shape; a capability nobody can see is a capability
            nobody has.

            So it is on the toolbar either way, and `title` says what is in the
            way. The measuring tools beside it already take exactly this
            posture — disabled until the sheet is calibrated, never hidden. */}
        <button
          type="button"
          onClick={onFindWalls}
          disabled={finding || !calibration || notATakeoffSheet || !pageSize}
          data-takeoff="find-walls"
          title={
            notATakeoffSheet
              ? (takeoffVerdict?.why ?? undefined)
              : !calibration
                ? "Set the scale on this sheet first — wall thickness is measured in feet of building."
                : !pageSize
                  ? "The sheet is still loading."
                  : undefined
          }
          className="min-h-[36px] rounded-md border border-line-card bg-surface px-3 text-xs font-medium text-ink-body hover:bg-rail-hover disabled:opacity-40"
        >
          {finding ? "Reading the lines…" : "Find the walls"}
        </button>
        {/* ── FIND THE ROOMS, ONLY WITH THE COMPANY SWITCH ON ──
            Absent, not disabled, when the switch is off: the feature was
            measured and switched off once (`takeoffRoomFinder.test.tsx`) and
            a control that reads as "exists but broken" is what that file
            exists to prevent. With the switch on it waits for a find. */}
        {roomFinder && (
          <button
            type="button"
            onClick={onFindRooms}
            disabled={finding || found === null || found.length === 0 || foundOnPage !== pageNumber}
            data-takeoff="find-rooms"
            title={found === null ? "Find the walls first — rooms are what they enclose." : undefined}
            className="min-h-[36px] rounded-md border border-line-card bg-surface px-3 text-xs font-medium text-ink-body hover:bg-rail-hover disabled:opacity-40"
          >
            Find the rooms
          </button>
        )}
        {/* ── WHY IT IS GREY, AND A WAY PAST IT ──
            The reason is on the toolbar and not only in a tooltip, because a
            disabled control with a hover explanation is a control that looks
            broken on a touch screen. And the override is beside it, because a
            set can caption a floor plan anything at all and the person looking
            at the drawing knows better than its title block does. */}
        {notATakeoffSheet && (
          <>
            <span className="text-[11px] text-ink-muted" data-takeoff="not-a-takeoff-sheet">
              {takeoffVerdict?.why}
            </span>
            <button
              type="button"
              onClick={() => setOverriddenByPage((prev) => ({ ...prev, [pageNumber]: true }))}
              data-takeoff="run-anyway"
              className="min-h-[36px] rounded-md border border-line-card bg-surface px-2 text-[11px] text-link hover:text-link-hover"
            >
              Run anyway
            </button>
          </>
        )}

        {/* ── AND THEN: ARE THEY WALLS? ──
            Only once there is something to check, because a control that can
            only refuse is noise on the toolbar. It reads the part of the sheet
            on screen, so what it covers is whatever the estimator has zoomed
            to — which is also why it says "in view". */}
        {found !== null && found.length > 0 && (
          <button
            type="button"
            onClick={onCheckRuns}
            disabled={checking}
            data-takeoff="check-runs"
            title="Looks at the part of the sheet on screen and says which of these runs are walls and which are countertops, fixtures or reference lines. Lengths are measured from the drawing either way."
            className="min-h-[36px] rounded-md border border-line-card bg-surface px-3 text-xs font-medium text-ink-body hover:bg-rail-hover disabled:opacity-40"
          >
            {checking ? "Checking the runs…" : "Check these are walls"}
          </button>
        )}
        {/* ── A SHEET THAT IS A SCAN ──
            Gated on the page having no TEXT LAYER, a fact settled at ingest.
            It deliberately does not wait for Find the walls: that button is
            disabled until the sheet has a scale, a scan's scale can only be
            had by reading the picture, and this is the thing that reads it —
            so gating on it made the feature unreachable on every sheet it was
            built for. See `scannedPages`. */}
        {scannedPages.includes(pageNumber) && (
          <button
            type="button"
            onClick={onReadSheet}
            disabled={reading}
            data-takeoff="read-sheet"
            title="This sheet has no writing in the file, which means it was scanned rather than exported. Reads the room names, dimensions and scale note off the picture so the sheet can be scaled. Lengths are still measured from the drawing."
            className="min-h-[36px] rounded-md border border-line-card bg-surface px-3 text-xs font-medium text-ink-body hover:bg-rail-hover disabled:opacity-40"
          >
            {reading ? (readProgress ?? "Reading the sheet…") : "Read this sheet"}
          </button>
        )}
        {readError !== null && (
          <p data-takeoff="read-error" className="text-xs text-ink-muted">
            {readError}
          </p>
        )}
        {wordsRead !== null && readError === null && (
          <p data-takeoff="read-done" className="text-xs text-ink-muted">
            {wordsRead > 0 ? (
              <>
                Read {wordsRead} {wordsRead === 1 ? "word" : "words"} off this sheet. Press Find the walls again
                to use them.
              </>
            ) : readReported > 0 ? (
              /* ── TWO ZEROES THAT NEED DIFFERENT HELP ──
                 Something was read and none of it could be placed on the
                 sheet, which is a coordinate problem and ours to fix. */
              <>
                Read nothing usable off this sheet — {readReported} pieces of writing were found but none could
                be placed on the drawing. This is a fault on our side; the sheet is unchanged.
              </>
            ) : readBlank ? (
              /* ── EVERY TILE CAME OUT EMPTY ──
                 A drawing is never blank everywhere. This is the page failing
                 to render the sheet, which is ours, and it must not be
                 reported as a faint scan — that sentence sends somebody to
                 find a better copy of a drawing that was fine. */
              <>
                This sheet could not be prepared for reading — every part of it came out blank, which is a
                fault on our side rather than anything wrong with the drawing. Nothing was sent and nothing
                was charged.
              </>
            ) : (
              /* Something was rendered and none of it was legible, which is
                 what a genuinely faint scan looks like. */
              <>
                No writing could be made out on this sheet. If it is a faint or low-resolution scan, the scale
                still has to be set by hand.
              </>
            )}
          </p>
        )}
        {checkError !== null && (
          <p data-takeoff="check-error" className="text-xs text-ink-muted">
            {checkError}
          </p>
        )}
        {labels !== null && checkError === null && !demote && (
          <p data-takeoff="check-done" className="text-xs text-ink-muted">
            {[...labels.values()].filter((one) => demotes(one.label)).length} run(s)
            set aside as casework or reference. Press Find the walls again to start over.
          </p>
        )}
        {/* ── DEMOTE, DON'T HIDE ──
            With the switch on, a set-aside run keeps its row and its line:
            greyed, with the model's reason, out of the total, one press to
            take back. The total above this never includes one, which is the
            "excluded by default" half; the row is the "visible" half. */}
        {demote && labels !== null && checkError === null && demoted.length === 0 && (
          <p data-takeoff="check-done" className="text-xs text-ink-muted">
            Every run checked looks like a wall.
          </p>
        )}
        {demote && labels !== null && checkError === null && demoted.length > 0 && (
          <div data-takeoff="demoted" className="w-full rounded-md border border-line-card bg-surface p-3">
            <p className="text-xs font-medium text-ink">{demotedSentence(demoted)}</p>
            <p className="text-xs text-ink-muted">
              Greyed on the drawing. If one is a wall, put it back — it rejoins the list and the total.
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {demoted.map((d) => (
                <li
                  key={d.at}
                  data-takeoff="demoted-row"
                  onMouseEnter={() => setHoveredDemoted(d.at)}
                  onMouseLeave={() => setHoveredDemoted(null)}
                  className="flex flex-wrap items-center gap-2 text-xs text-ink-muted"
                >
                  <span className="text-ink-body">{feetInches(d.lengthFeet)}</span>
                  <span>
                    {demotedWord(d.label) === null
                      ? `probably not a wall — ${d.reason}`
                      : `probably not a wall — ${demotedWord(d.label)}${d.reason ? `: ${d.reason}` : ""}`}
                  </span>
                  <button
                    type="button"
                    data-takeoff="accept-demoted"
                    onClick={() => onAcceptDemoted(d.at)}
                    className="ml-auto min-h-[36px] rounded-md border border-line-card px-3 text-xs font-medium text-ink-body hover:bg-rail-hover"
                  >
                    It is a wall
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* ── AND WHAT IT SAYS IS MISSING ──
            The other half of the question, and the half nothing else in this
            app can answer: a wall that was never paired is in no cluster and no
            total, so no check downstream can notice it. There is no length
            here on purpose — the estimator traces each one, and the quantity
            comes off the drawing like every other. */}
        {missed.length > 0 && checkError === null && (
          <div data-takeoff="check-missing" className="w-full rounded-md border border-line-card bg-surface p-3">
            <p className="text-xs font-medium text-ink">
              {missed.length} wall{missed.length === 1 ? "" : "s"} on the drawing with no run on {missed.length === 1 ? "it" : "them"} — trace {missed.length === 1 ? "it" : "these"} by hand
            </p>
            <ul className="mt-1 space-y-1">
              {missed.map((one, at) => (
                <li key={`${one.where}-${at}`} className="text-xs text-ink-muted">
                  <span className="text-ink-body">{one.where}</span>
                  {one.why ? ` — ${one.why}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── THERE IS NO "FIND THE ROOMS" BUTTON, AND THAT IS DELIBERATE ──
            #702 shipped one and it was clicked on real sheets the same day.
            It runs, it is fast, and ITS ANSWER IS WRONG in a way that reads as
            right: on a West Herr floor plan it reported 46 rooms and 4,555 sf
            for a building about 290 ft across, having missed Showroom 101,
            Sales 103, Hospitality 105, New Car Delivery 140 and the whole
            right-hand wing — while outlining a parked car, the gaps between
            dimension strings, and two keynote tags.

            That is the worst shape a takeoff can have: a confident number that
            is far too low. An estimator who trusts it bids half a building.

            The cause is known and is not a threshold. `roomAreas.ts` rasterises
            EVERY stroke, so a leader line crossing a room cuts the region in
            half and a dimension string encloses one of its own. The wall finder
            has `wallsNotLettering`, `wallsInTheBuilding` and
            `wallsNotTheSheetBorder` for exactly this; the room finder has none
            of them. See `roomAreas.ts`'s header.

            `roomAreas.ts` and its tests stay: the geometry is right and the fix
            is to what reaches it. The BUTTON is gone until the numbers say it
            is fit to use, and `takeoffRoomFinder.test.tsx` now asserts it is
            absent so it cannot come back without somebody reading this. */}

        {/* WHICH FLOOR THIS SHEET DRAWS, beside the scale because that is the
            other thing about a sheet an estimator has to know before tracing
            it. Silent when the title names no floor — a single-storey job has
            no levels and a label saying "no level" would be noise on every
            sheet of it. See `sheetLevel.ts` for why a sheet naming TWO floors
            is also silent. */}
        {levelByPage?.[pageNumber] !== undefined && (
          <span
            data-takeoff="sheet-level"
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-body"
          >
            {levelByPage[pageNumber]}
          </span>
        )}

        <span className="ml-auto text-xs text-ink-muted" data-takeoff="sheet-scale-state">
          {calibration ? (
            <>
              Scale set{scaleReading?.name ? `: ${scaleReading.name}` : ""}
              {scaleReading ? ` · sheet reads ${Math.round(scaleReading.sheetWidthFeet)} ft across` : ""}
            </>
          ) : (
            <span className="text-tag-amber-ink">Set the scale on this sheet before measuring.</span>
          )}
        </span>
      </div>
      )}

      {findError && (
        <p className="mt-2 rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-tag-amber-ink" data-takeoff="find-error">
          {findError}
        </p>
      )}

      {/* ── WHAT THE SHEET GAVE UP, BIGGEST FOOTAGE FIRST ──

          ── THIS LIST IS LONGER THAN ANYBODY EXPECTS, AND THAT IS THE TRUTH ──

          The obvious design is "here are your three wall types". Seven real
          sheets were measured before this was written and they return 15 to 21
          thickness groups each, with the top three holding only about half the
          footage. Showing three and calling it the answer would hide footage an
          estimator is going to bid.

          So: sorted by FEET, biggest first, the top six shown and the rest
          counted honestly underneath. What the measurement also showed is that
          the big groups are the real ones — 4.88", 4.92" and 4.80" on three
          unrelated projects, every one of them a 4-7/8" partition, which is a
          3-5/8" stud with 5/8" board each side. Noise does not land on 4-7/8".

          That is the actual promise of this feature, and it is smaller and more
          honest than "it does your takeoff": the biggest wall types come for
          free. Accepting one group on one real sheet replaced ninety-nine hand
          traces. Whatever it missed is still traced the way it always was. */}
      {/* ── THE SHEET IS THE INSTRUMENT, SO IT GETS THE ROOM ──
          Found walls used to stack ABOVE the drawing, and the frame reserved a
          fixed 22rem for them whether they were there or not. With six groups
          showing, the panel took the top half of the screen and the sheet was
          left a short strip — and because Fit fits BOTH dimensions, a short
          frame makes a small sheet, so the width beside it went empty. A real
          click-through landed at 11% zoom with a third of the screen black.

          That is backwards for a feature whose entire verification step is
          LOOKING at the drawing: the found walls are a claim, and the sheet is
          the only thing that can check it. So on a wide screen they sit side by
          side and the drawing takes what is left, which is most of it. Narrow
          screens keep the stack, where a column each would make both unusable. */}
      <div
        // ── IN ANSWER-KEY MODE THE FOUND LIST GOES UNDER THE PLAN ──
        //
        // Measured on a 1600 px window with a sheet open for review: the
        // sheet rail took 232, the answer-key rail 384, leaving this region
        // 690 — and the found-walls list then took 368 of THAT, so the canvas
        // got 268 pixels. A sixth of the screen, to look at a plan on.
        //
        // No breakpoint can see that. `xl:` asks how wide the WINDOW is, and
        // the window was wide; what was narrow was the space left over after
        // two rails this component knows nothing about. So the rule is the
        // MODE rather than a width: in answer-key mode the rail is the
        // working surface and this list is a reference, which belongs under
        // the drawing rather than beside it.
        className={`flex gap-3 ${answerKey === undefined ? "xl:flex-row-reverse" : ""}${
          fill
            ? // CANVAS FIRST AT EVERY WIDTH, which is the host's whole promise.
              // Below xl this is a COLUMN and the panel is first in the DOM, so
              // without the reverse the quantities sit above the drawing and
              // take the top half of a tablet — measured, and the reason the
              // spec asserts the canvas's box rather than its classes.
              // `xl:flex-row-reverse` is on the base string; this must NOT
              // restate a flex-direction for xl or it wins and the panel
              // stacks under a 5%-tall drawing — measured at 1440px, and the
              // reason test 11 now runs with the panel OPEN as well as closed.
              ` min-h-0 flex-1 flex-col-reverse${answerKey === undefined ? " xl:items-stretch" : ""}`
            : ` flex-col${answerKey === undefined ? " xl:items-start" : ""}`
        }`}
      >
      {found !== null && panelOpen && (
        <div
          className={`rounded-md border border-line-card bg-surface p-3${
            answerKey === undefined
              ? " xl:w-[23rem] xl:shrink-0 xl:overflow-auto xl:max-h-[calc(var(--shell-port)-11rem)]"
              : // Under the plan, and short: it is a reference here, not the
                // thing being worked on.
                " max-h-[13rem] shrink-0 overflow-auto"
          }`}
          data-takeoff="found-walls"
        >
          {/* ABOVE the groups, because a caution under the thing it is about is
              read after the decision has been made — `PlanSheetReview`'s
              convention and the one the quote reader's cautions follow. */}
          {/* THE SERVER'S ANSWER FIRST. It comes from a proposal a model read
              and a person may have corrected; the one below is read off the
              title block here and only fills a silence. One slot, never two
              cautions saying the same thing in different words. */}
          {sheetCaution && found.length > 0 && (
            <p
              className="mb-3 rounded-md bg-tag-amber p-2 text-xs text-tag-amber-ink"
              data-takeoff="duplicate-walls-caution"
            >
              <span className="font-semibold">Check this is the right sheet. </span>
              {sheetCaution}
            </p>
          )}
          {found.length === 0 ? (
            /* ── TWO KINDS OF EMPTY, AND THIS SAID THE WRONG ONE ──

               It read: "a scanned or image-only sheet has no lines to read."
               That is one reason a sheet yields nothing, and the app had no
               idea whether it was THIS sheet's reason. A click-through found it
               on a drawing made entirely of line work and said so: the sheet
               was plainly not a scan, and the message asserted a cause nobody
               had established.

               The app knows which it is — it has just counted the strokes. A
               sheet with none is genuinely an image; a sheet with fifty
               thousand has lines that did not pair, which is a different fact
               and a different thing for an estimator to do about it. */
            <p className="text-sm text-ink-body" data-takeoff="no-walls">
              {strokesSeen === 0
                ? "No walls found: this sheet has no line work at all, so it is an image or a scan. There is nothing here to read. Trace them by hand as usual."
                : `No walls found. This sheet does have line work — ${strokesSeen.toLocaleString()} lines — but none of it paired up as a wall. That happens when walls are drawn as a single line or as solid fill rather than two faces. Trace them by hand as usual.`}
            </p>
          ) : (
            <>
              <p className="mb-2 text-sm text-ink-body">
                Found {found.reduce((n, c) => n + c.runs.length, 0)} runs of wall. Hover a row to see which
                lines are its — check they sit on real walls before adding them.
              </p>
              {/* WHAT THE TEMPLATE ACCOUNTED FOR, SAID OUT LOUD.
                  A filter that quietly returns a smaller number is how the next
                  unexplained figure gets created — the same rule the drawing-index
                  check learned the hard way. If this number is large and the panel
                  is empty, the filter is the first thing to suspect rather than the
                  sheet.

                  ── IT USED TO NAME WHAT IT HAD REMOVED, AND THAT WAS FALSE ──

                  It read "— the border, the title block and the logo — so they
                  were left out". On a West Herr floor plan clicked on production
                  2026-10-13 it said that of 12,641 lines while about 32 runs sat
                  on the title block and the logo in the overlay below it. The
                  filter knows ONE thing: these lines are at the same page
                  position on other sheets. Which drawing furniture that turned
                  out to be is not something it establishes, and listing three
                  kinds told an estimator all three were handled.

                  Same defect as the no-walls sentence directly below, which
                  asserted "a scanned or image-only sheet" as the cause of an
                  empty panel on a sheet that was plainly not a scan. A message
                  may state what was measured; it may not name a cause nobody
                  checked. */}
              {/* ── WHAT THE DRAWING'S OWN LAYER NAMES REMOVED ──

                  Said for the reason the template count above is said: a filter
                  that quietly returns a smaller number is how somebody stops
                  believing the number. This one can remove a whole discipline's
                  line work, so an estimator looking for the ducts they can see
                  on the sheet has to be able to find out where they went.

                  It names the LAYERS rather than a total, because the layer name
                  is the only part a person can check against the drawing. */}
              {layerDropped.length > 0 && (
                <p className="mb-2 text-xs text-ink-muted">
                  {droppedLayersSentence(layerDropped)} The drawing puts those lines on layers that are not
                  walls, so they were never measured. If something below is missing, that is the first place
                  to look.
                </p>
              )}
              {templateStrokes > 0 && (
                <p className="mb-2 text-xs text-ink-muted">
                  {templateStrokes.toLocaleString()} line{templateStrokes === 1 ? "" : "s"} on this sheet
                  {templateStrokes === 1 ? " is" : " are"} in the same place on other sheets of the set, so
                  {templateStrokes === 1 ? " it was" : " they were"} left out as page furniture. Not all of it
                  recurs closely enough to catch — a border, title block or logo can still show up below, so
                  check the runs against the drawing.
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {ordered.map(({ group, index, heading, inSection }) => {
                  const verdict = verdictFor(group);
                  const priced = pricedTypeFor(group, chosen[index]);
                  // NAMED BUT NOT PRICEABLE: the drawing's tag matched a type
                  // this company has, and that type has no layers yet — the
                  // state a schedule import leaves every type in. Worth its own
                  // sentence, because "Add these" with no explanation is what
                  // sent somebody to the wall-types page to find nothing wrong.
                  const namedOnly = priced === null ? namedTypeFor(group, chosen[index]) : null;
                  return (
                  <Fragment key={`${group.inches}-${index}`}>
                  {heading !== null && (
                    /* ── THE CONDITION, OR THE PILE ──
                       Detection matched this group to a takeoff item, so the
                       estimator reads "3⅝ interior — 4 groups" instead of four
                       thicknesses they have to map back to their own conditions
                       by eye. An unmatched group sits under "Unassigned walls",
                       which is the recoverable state: `proposalMatch` REFUSES a
                       tie rather than picking one of two 3⅝" walls, and this is
                       where that refusal becomes somebody's minute of work. */
                    <li className="mt-2 flex items-baseline gap-2 px-2 pt-1 first:mt-0 first:pt-0">
                      <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                        {heading.name ?? "Unassigned walls"}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {inSection} {inSection === 1 ? "group" : "groups"}
                      </span>
                    </li>
                  )}
                  <li
                    /* Machine-readable, so a browser walk can read a group's
                       thickness instead of parsing "3⅝″" out of the label. The
                       e2e step that proves these headings appear creates a
                       condition at a thickness it reads from right here. */
                    data-takeoff="found-group"
                    data-inches={group.inches}
                    data-item={group.itemId ?? ""}
                    className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1 hover:bg-rail-hover"
                    onMouseEnter={() => setHovered(index)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    {/* ── THE SWATCH IS A LINE NOW, BECAUSE THE MARK IS NOT
                        JUST A COLOUR ──
                        It was a 12px coloured square, which could only ever
                        carry half of a mark that is a colour AND a dash. A
                        square showing the right blue beside a drawing holding
                        three different blues is the disagreement this change
                        exists to end, so the swatch draws what the overlay
                        draws: same colour, same dash, same function. */}
                    <ClusterMark index={index} />
                    {/* ── THE LABEL IS ROUNDED; THE MEASUREMENT IS NOT ──
                        What is shown is the nearest eighth, because that is
                        how partitions are drawn and how a wall type is typed
                        in — and it is the same number the match ran on, so a
                        condition taking this group is a decision somebody can
                        check by reading the screen. The measurement itself is
                        on hover, because an estimator who wants to know why a
                        group landed on 4-3/8" should be able to find out
                        without opening a database. */}
                    <span
                      className="text-sm font-medium text-ink"
                      title={`Measured ${group.inches.toFixed(3)} in`}
                    >
                      {inchLabel(group.inches)}
                    </span>
                    {/* THE TAG IS THE GROUP'S NAME NOW, not a list of every name
                        in a bucket. A group either carries one tag or carries
                        none, because the tags are what split it. */}
                    <ClusterTag names={group.source.kind === "TAG" ? [group.source.tag] : []} />
                    <span className="text-sm text-ink-body">
                      {group.runs.length} {group.runs.length === 1 ? "run" : "runs"} ·{" "}
                      {Math.round(group.feet).toLocaleString()} ft
                      {/* ── THE FOOTAGE IS GROSS, AND IT SAYS SO ──
                          A run joined across a doorway reports the whole wall,
                          which is the correct take-off: `takeoff.ts` deducts
                          nothing under 32 sq ft because a door still costs
                          labour to cut and finish around, and the framing runs
                          through it as a header. But a bigger number with no
                          explanation is the next unexplained figure, so the
                          openings it includes are counted here. */}
                      {(() => {
                        const openings = group.runs.reduce((n, run) => n + (run.openings?.length ?? 0), 0);
                        return openings === 0 ? null : (
                          <span className="text-ink-muted">
                            {" "}
                            · includes {openings} opening{openings === 1 ? "" : "s"}, not deducted
                          </span>
                        );
                      })()}
                      {/* ── THE DOORS THE SCHEDULE NAMES ON THIS WALL ──
                          Only with PLAN_TEXT_READ on: each door the join placed
                          on one of this group's runs, with the SCHEDULE's width
                          rather than the drawn gap's. */}
                      {(() => {
                        const doors = planTextDoors.get(index) ?? [];
                        return doors.length === 0 ? null : (
                          <span className="text-ink-body" data-takeoff="group-doors">
                            {" "}
                            · door{doors.length === 1 ? "" : "s"}{" "}
                            {doors.map((d) => `${d.mark} ${feetInches(d.widthFt)}`).join(", ")}
                            {doors.some((d) => d.widthFrom === "schedule") ? " from the schedule" : ""}
                          </span>
                        );
                      })()}
                    </span>

                    {/* ── THE ONE QUESTION THIS FEATURE IS ALLOWED TO ASK ──
                        Two of the company's types are this thick and nothing on
                        the drawing says which — A1 and A2 on School-01, which
                        differ by fire rating. The app will not choose. It asks
                        ONCE for the group rather than once for each of its
                        runs, and the button stays unpriced until it is
                        answered. */}
                    {/* ── AN UNPRICED GROUP IS ASKED, AND A TYPE IS THE FIRST ANSWER ──
                        "Add these" used to write plain measurements for any
                        group nothing named — 36 of them on one Baker sheet,
                        none of them on the estimate. Now a group with no priced
                        type cannot be added until the estimator says what it
                        is: a type (the verdict's candidates first, the sheet's
                        note before them), a new type from this group, or plain
                        measurements — last, and said in words. */}
                    {priced === null && namedOnly === null && (
                      <select
                        aria-label={`What are the ${inchLabel(group.inches)} walls?`}
                        value={chosen[index] ?? ""}
                        data-takeoff="group-choice"
                        onChange={(event) =>
                          setChosen((current) => ({ ...current, [index]: event.target.value }))
                        }
                        className="min-h-[36px] max-w-[22rem] rounded-md border border-line-card bg-surface px-2 text-xs text-ink-body"
                      >
                        <option value="">What are these?</option>
                        {groupChoices(verdict, wallTypes).map((choice) =>
                          choice.kind === "type" ? (
                            <option
                              key={choice.type.id}
                              value={choice.type.id}
                              data-takeoff={choice.why === "note" ? "uno-option" : undefined}
                            >
                              {typeOptionLabel(choice.type)}
                              {choice.why === "note" ? " · the sheet's note names this" : choice.why === "tag" ? " · the drawing's tag" : ""}
                            </option>
                          ) : choice.kind === "create" ? (
                            <option key="create" value="create">
                              Create a wall type from this group ({inchLabel(group.inches)})…
                            </option>
                          ) : (
                            <option key="plain" value="plain">
                              Add as plain measurements — priced by hand
                            </option>
                          ),
                        )}
                      </select>
                    )}

                    {/* ── WHAT THE BUTTON PROMISES IS WHAT IT DOES ──
                        A group with a type goes straight onto the estimate
                        PRICED, so the button says so and names it. Everything
                        else still writes plain measurements, exactly as before,
                        and says that instead — one of them is finished work and
                        the other is a step. Both read from `pricedTypeFor`, the
                        same function the submit uses, so the words and the form
                        cannot disagree.

                        THE THIRD WORDING IS NEW AND IT IS THE HONEST ONE. A
                        group can now be NAMED by a type that has no layers yet
                        — every type a partition schedule imports is in that
                        state — and "Add these", with no explanation, is what
                        sent somebody to the wall-types page looking for a fault
                        that was not there. It still writes plain measurements;
                        it just says which type they are waiting on. */}
                    {/* ── A TYPE WITH NO DEFAULT HEIGHT ASKS FOR ONE HERE ──
                        The posting refuses a run with no height, and it used
                        to refuse AFTER the runs were written — the error at
                        the top, the group still listed, nowhere to type the
                        figure. The box sits beside the button; the sections
                        or the legend say what to put in it. */}
                    {priced !== null && priced.defaultHeightFt == null && (
                      <label className="flex items-center gap-1 text-xs text-ink-body">
                        Height ft
                        <input
                          inputMode="decimal"
                          value={groupHeight[index] ?? ""}
                          placeholder={`${priced.code} has none`}
                          data-takeoff="group-height"
                          onChange={(event) => setGroupHeight((current) => ({ ...current, [index]: event.target.value }))}
                          className="w-20 rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink-body"
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={() => void onAcceptCluster(index)}
                      disabled={
                        (priced === null && namedOnly === null && !chosen[index]) ||
                        (priced !== null && priced.defaultHeightFt == null && !(Number(groupHeight[index] ?? "") > 0))
                      }
                      data-takeoff="add-group"
                      className={`ml-auto min-h-[36px] rounded-md border px-3 text-xs font-medium disabled:opacity-40 ${
                        priced
                          ? "border-brand bg-tag-brand text-tag-brand-ink hover:opacity-90"
                          : "border-line-card text-ink-body hover:bg-rail-hover"
                      }`}
                    >
                      {priced
                        ? `Add as ${priced.code} — priced`
                        : namedOnly
                          ? `Add as ${namedOnly.code} — not priced yet`
                          : chosen[index] === "create"
                            ? "Create a wall type…"
                            : chosen[index] === "plain"
                              ? "Add as plain measurements"
                              : "Add these"}
                    </button>

                    {/* ── AND WHY, UNDERNEATH ──
                        Every sentence says WHERE the answer came from, because
                        a name read off the drawing and a name inferred from a
                        thickness are different kinds of claim and somebody
                        pricing a bid is entitled to know which they have. */}
                    {groupSentence(group, verdict) !== null && (
                      <p className="w-full text-xs text-ink-muted">{groupSentence(group, verdict)}</p>
                    )}
                  </li>
                  </Fragment>
                  );
                })}
              </ul>
              {/* ── NOTHING IS OUT OF REACH, AND THAT IS THE WHOLE CHANGE ──
                  This was a sentence. A real sheet put 488 ft — 26% of the
                  drawing — behind it, with no row, no colour and no button,
                  and some of what it hid was LARGER than what was shown,
                  because the cut landed by cluster order rather than by size.
                  Both halves are fixed: `wallGroups` orders by footage, and
                  the rest of the list is one press away. */}
              {found.length > SHOWN_AT_FIRST && !showingAll && (
                <button
                  type="button"
                  onClick={() => setShowingAll(true)}
                  className="mt-2 text-xs text-link underline hover:text-link-hover"
                >
                  Show the other {found.length - SHOWN_AT_FIRST}{" "}
                  {found.length - SHOWN_AT_FIRST === 1 ? "group" : "groups"}, holding{" "}
                  {Math.round(found.slice(SHOWN_AT_FIRST).reduce((f, c) => f + c.feet, 0)).toLocaleString()} ft
                </button>
              )}
              {/* ── WHERE THE MARKS RUN OUT, SAID OUT LOUD ──
                  Eighteen distinct marks is not an arbitrary number of groups,
                  and a panel that quietly reuses one is how a reviewer
                  attributes a line to the wrong thickness. Shown only once the
                  list is long enough for it to be true, which on the default
                  twelve it never is. Same rule as the template filter's count:
                  state the limit rather than let somebody discover it. */}
              {showingAll && found.length > DISTINCT_MARKS && (
                <p className="mt-2 text-xs text-ink-muted">
                  The last {found.length - DISTINCT_MARKS}{" "}
                  {found.length - DISTINCT_MARKS === 1 ? "group repeats a mark" : "groups repeat marks"} used
                  above — there are only {DISTINCT_MARKS}. Hover a row to pick its runs out of the drawing.
                </p>
              )}
              <PlanTextPanel view={planText} wallTypes={wallTypes} />
            </>
          )}
          {rooms !== null && roomsOnPage === pageNumber && sheet !== null && feetPerUnit !== null && (
            <TakeoffRoomsPanel
              jobId={jobId}
              pageId={sheet.id}
              result={rooms}
              ceilings={roomCeilings}
              savedRooms={savedRoomCeilings}
              feetPerUnit={feetPerUnit}
              hovered={hoveredRoom}
              onHover={setHoveredRoom}
              onClear={() => setRooms(null)}
            />
          )}
          <button
            type="button"
            onClick={() => setFound(null)}
            className="mt-2 text-xs text-ink-muted underline hover:text-ink-body"
          >
            Clear what was found
          </button>
        </div>
      )}

      {/* ── The sheet ─────────────────────────────────────────────── */}
      {/* The height reserve shrinks to 11rem once the panel is beside rather
          than above; that reserve is the toolbar and the page's own padding,
          and nothing else.

          NO `min-w-0` HERE, though a flex child's default min-width would
          normally demand it: this frame is `overflow-auto`, which establishes a
          scroll container and resets the min-content floor by itself. It was
          written in first, on the usual reasoning, and measured out — identical
          boxes at 1512, 1280, 1024 and 768 with and without it. Unreachable
          code shaped like a safeguard is worse than none. */}
      <div
        ref={frameRef}
        className={
          fill
            ? // The host has decided the height; take all of it. No max-h and
              // no min-h, because both would reintroduce the short frame.
              "relative min-h-0 flex-1 overflow-auto rounded-lg border border-line-card bg-rail"
            : "relative max-h-[calc(var(--shell-port)-22rem)] min-h-[24rem] overflow-auto rounded-lg border border-line-card bg-rail xl:flex-1 xl:max-h-[calc(var(--shell-port)-11rem)]"
        }
        data-testid="takeoff-plan-port"
      >
        {/* ── THE BANNER THAT SAYS TRACING IS ON, AND WHAT TO DO NEXT ──

            Over the plan rather than in the rail, because that is where the
            eyes are while clicking — and because the whole defect being fixed
            was a mode with no visible state. It says the NEXT action rather
            than the current one: a prompt that reads "tracing" leaves somebody
            wondering what to do with it.

            `pointer-events-none` so it can never swallow a click meant for the
            drawing underneath it. */}
        {answerKey?.tracing === true && traceAdded === null && (
          <div
            data-takeoff="key-trace-banner"
            className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-line-card bg-ink px-3 py-1.5 text-xs font-medium text-canvas shadow-lg"
          >
            {traceFrom === null
              ? "Tracing wall: click the start (Esc to cancel)"
              : traceTo === null
                ? "Click the end of the wall (Esc to cancel)"
                : "Press Enter to add, Esc to cancel"}
          </div>
        )}
        {/* And what the last Enter did, which fades on the next action. */}
        {answerKey !== undefined && traceAdded !== null && (
          <div
            data-takeoff="key-trace-added"
            className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-line-card bg-tag-green px-3 py-1.5 text-xs font-medium text-tag-green-ink shadow-lg"
          >
            Wall added, {traceAdded}
          </div>
        )}
        {loadError ? (
          <p className="p-6 text-sm text-tag-rose-ink">{loadError}</p>
        ) : (
          // ── CENTRED IN THE CANVAS, AND STILL SCROLLABLE WHEN ZOOMED ──
          //
          // `min-h-full min-w-full` with centring, rather than `place-content-
          // center` on the scroll container itself: that centres too, and then
          // clips the top-left of anything bigger than the box, so a sheet
          // zoomed in to measure a corner loses the corner. Here the wrapper is
          // at least the size of the frame — so a small sheet sits in the
          // middle — and grows past it when the sheet does, which scrolls
          // normally in both directions.
          // ── CENTRED BY AUTO MARGINS, NOT BY `justify-center` ──
          //
          // Reported from an E Street 421 labelling run: above Fit, the left
          // of the drawing could not be scrolled to — about 600px of it gone
          // at 50%. `justify-center` on a flex container inside an
          // `overflow-auto` frame splits the overflow EVENLY between both
          // ends, and the start-side half is unreachable, because scrollLeft
          // cannot go below zero. The right-hand overflow scrolls fine, which
          // is why it reads as half the sheet being missing rather than as a
          // layout that is wrong.
          //
          // `margin: auto` on the ITEM centres it exactly as well when there
          // is room to spare, and when there is not it leaves the overflow at
          // the end where the scrollbar can reach it.
          <div className={fill ? "flex min-h-full min-w-full" : ""}>
          <div className={`relative w-fit${fill ? " m-auto" : ""}`}>
            <canvas ref={canvasRef} className="block" />
            <svg
              viewBox={`0 0 1 ${aspect}`}
              preserveAspectRatio="none"
              style={{ width: cssWidth ? `${cssWidth}px` : "100%", height: cssWidth ? `${cssWidth * aspect}px` : "100%" }}
              className={`absolute left-0 top-0 ${
                drawing || answerKey !== undefined
                  ? "cursor-crosshair touch-none"
                  : "pointer-events-none"
              }`}
              data-takeoff={answerKey?.tracing === true ? "tracing-surface" : undefined}
              onPointerDown={onPointerDown}
              onPointerMove={(event) => {
                // ── WHERE THE NEXT CLICK WOULD GO ──
                //
                // Before the first click this is the only thing on screen, and
                // it is what makes the snap visible: a reviewer can see the
                // point jump onto the line it will grab rather than discover
                // it afterwards.
                if (answerKey?.tracing === true) {
                  const raw = pointAt(event);
                  if (raw) setTraceHover(placePoint(raw, traceFrom, event.shiftKey));
                  if (traceAdded !== null) setTraceAdded(null);
                  if (traceTo !== null) return;
                }
                if (keyBox !== null) {
                  const raw = pointAt(event);
                  if (raw) setKeyBox({ ...keyBox, x2: raw.x, y2: raw.y });
                  return;
                }
                if (draggingVertex === null || !editDraft) return;
                const raw = pointAt(event);
                if (!raw) return;
                // Snapped like a new point, so an edited corner lands on
                // the drawing as readily as a drawn one — and Shift locks
                // it against the vertex BEFORE it in the shape.
                const from =
                  draggingVertex > 0
                    ? { x: editDraft.xs[draggingVertex - 1], y: editDraft.ys[draggingVertex - 1] }
                    : null;
                const point = placePoint(raw, from, event.shiftKey);
                setEditDraft(moveVertex(editDraft.xs, editDraft.ys, draggingVertex, point));
              }}
              onPointerUp={() => {
                if (keyBox !== null && answerKey !== undefined) {
                  // ── SHIFT-CLICK ACTS ON THE SELECTION, NEVER ON WHAT WAS HIT ──
                  //
                  // Reported from the ELEVEN03 runs: shift-click to split
                  // "gets caught by thin non-candidate lines". It did two
                  // wrong things at once. The split was wired to each
                  // candidate line's own `onClick`, so on a dense plan the
                  // element under the cursor decided which run was cut —
                  // single-line candidates and hairline geometry sit on top of
                  // the run you are looking at. And every pointer-down in this
                  // mode opens a selection box, so the same shift-click also
                  // arrived here as a zero-sized box and ACCEPTED whatever it
                  // caught. One gesture, a split and a verdict, neither aimed.
                  //
                  // So: a shift gesture that did not MOVE cuts the focused
                  // candidate at the point clicked, and nothing else happens.
                  // The reviewer has already selected the run they are judging
                  // — it is the one drawn thick, and the panel is showing its
                  // length — so the selection is the only unambiguous answer
                  // to "which run".
                  const moved = Math.max(
                    Math.abs(keyBox.x2 - keyBox.x1),
                    Math.abs(keyBox.y2 - keyBox.y1),
                  );
                  if (
                    keyShift &&
                    moved <= CLICK_NOT_DRAG &&
                    answerKey.onSplitAt !== undefined &&
                    answerKey.focusedId !== null
                  ) {
                    answerKey.onSplitAt(answerKey.focusedId, { x: keyBox.x2, y: keyBox.y2 });
                    setKeyBox(null);
                    return;
                  }
                  const ids = candidatesInBox(answerKey.state, keyBox);
                  // A box that caught nothing is a CLICK ON NOTHING, which
                  // clears the focus rather than deciding anything — the same
                  // way edit mode treats a click on empty paper.
                  if (ids.length > 0) {
                    // Shift rejects, plain accepts. Two gestures rather than a
                    // mode, because a reviewer sweeping hatching wants the
                    // rejecting one and must not have to remember which mode
                    // they left it in.
                    // ── DRAG REJECTS, SHIFT-DRAG ACCEPTS ──
                    //
                    // The common case is sweeping a schedule, a stair or a
                    // field of hatching off the sheet, so the bare gesture is
                    // the one that does that. Accepting in bulk is rarer and
                    // riskier — a box of walls usually contains something that
                    // is not one — so it asks for a modifier.
                    answerKey.onState(
                      setVerdict(answerKey.state, ids, keyShift ? "wall" : "not-a-wall"),
                    );
                  } else {
                    answerKey.onFocus(null);
                  }
                  setKeyBox(null);
                  return;
                }
                setDraggingVertex(null);
              }}
              onPointerLeave={() => setDraggingVertex(null)}
            >
              {/* ── ANSWER-KEY REVIEW, DRAWN AS QUESTIONS ──
                  Every candidate in the colour of its verdict: amber for
                  undecided, green accepted, grey rejected, blue for a single
                  line nobody has ruled on. Clicking one focuses it; the panel
                  does the deciding. Hidden entirely when the reviewer presses
                  H, which is the only way to read the drawing underneath. */}
              {/* ── TRACING IS AN ACTION, NOT AN OVERLAY OF RESULTS ──

                  Deliberately outside the `overlaysOn` gate below. The old
                  preview was inside it, so a reviewer who had pressed `h` to
                  clear the sheet and then started tracing saw nothing at all —
                  and "nothing at all" is exactly what was reported.

                  EVERY SIZE HERE IS IN SCREEN PIXELS, converted through
                  `cssWidth`, so a dot stays a dot at 500% zoom. The viewBox is
                  one unit wide, so one screen pixel is `1 / cssWidth` of it.
                  Strokes use `vectorEffect` for the same reason. */}
              {answerKey?.tracing === true &&
                (() => {
                  const px = (n: number) => n / Math.max(cssWidth, 1);
                  const end = traceTo ?? traceHover;
                  const live =
                    traceFrom !== null && end !== null
                      ? Math.hypot(end.x - traceFrom.x, end.y - traceFrom.y) * (feetPerUnit ?? 0)
                      : null;
                  return (
                    <g data-takeoff="key-trace-layer">
                      {/* Where the next click lands, snapped. */}
                      {traceFrom === null && traceHover !== null && (
                        <circle
                          data-takeoff="key-trace-snap"
                          cx={traceHover.x}
                          cy={traceHover.y}
                          r={px(6)}
                          fill="none"
                          stroke={VERDICT_COLOURS.wall}
                          strokeWidth={STROKE_PX}
                          vectorEffect="non-scaling-stroke"
                        />
                      )}
                      {/* The rubber band: solid while it follows the pointer,
                          dashed once both ends are down and Enter is next. */}
                      {traceFrom !== null && end !== null && (
                        <line
                          data-takeoff="key-trace-preview"
                          x1={traceFrom.x}
                          y1={traceFrom.y}
                          x2={end.x}
                          y2={end.y}
                          stroke={VERDICT_COLOURS.wall}
                          strokeWidth={STROKE_PX * 2}
                          strokeDasharray={traceTo !== null ? "6 4" : undefined}
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                        />
                      )}
                      {traceFrom !== null && (
                        <circle
                          data-takeoff="key-trace-start"
                          cx={traceFrom.x}
                          cy={traceFrom.y}
                          r={px(4)}
                          fill={VERDICT_COLOURS.wall}
                        />
                      )}
                      {traceTo !== null && (
                        <circle
                          cx={traceTo.x}
                          cy={traceTo.y}
                          r={px(4)}
                          fill={VERDICT_COLOURS.wall}
                        />
                      )}
                      {/* The length as it is drawn, in feet and inches —
                          the number an estimator is actually deciding about. */}
                      {live !== null && live > 0 && end !== null && (
                        <>
                          <rect
                            x={(traceFrom!.x + end.x) / 2 + px(10)}
                            y={(traceFrom!.y + end.y) / 2 - px(17)}
                            width={px(74)}
                            height={px(19)}
                            rx={px(3)}
                            fill="#0f0f0f"
                            opacity={0.85}
                          />
                          <text
                            data-takeoff="key-trace-length"
                            x={(traceFrom!.x + end.x) / 2 + px(16)}
                            y={(traceFrom!.y + end.y) / 2 - px(4)}
                            fill="#ffffff"
                            fontSize={px(13)}
                            fontFamily="ui-sans-serif, system-ui, sans-serif"
                          >
                            {formatFeetInches(live)}
                          </text>
                        </>
                      )}
                    </g>
                  );
                })()}
              {answerKey !== undefined && answerKey.overlaysOn && (
                <g data-takeoff="key-overlay">
                  {answerKey.state.candidates.map((one) => {
                    const verdict = answerKey.state.verdicts[one.id] ?? "unreviewed";
                    const colour =
                      one.from === "single" && verdict === "unreviewed"
                        ? SINGLE_LINE_COLOUR
                        : VERDICT_COLOURS[verdict];
                    const focused = answerKey.focusedId === one.id;
                    return (
                      <line
                        key={one.id}
                        data-takeoff="key-line"
                        data-id={one.id}
                        x1={one.x1}
                        y1={one.y1}
                        x2={one.x2}
                        y2={one.y2}
                        stroke={colour}
                        strokeWidth={focused ? STROKE_PX * 3 : STROKE_PX * 1.5}
                        strokeLinecap="round"
                        opacity={verdict === "not-a-wall" ? 0.35 : 1}
                        vectorEffect="non-scaling-stroke"
                        style={{ cursor: "pointer" }}
                        onClick={(event) => {
                          event.stopPropagation();
                          // Shift-click is handled on the SVG's pointer-up, as
                          // a GESTURE on the selected candidate — see the
                          // "shift-click acts on the selection" note there.
                          // Hit-testing it here meant whichever thin line was
                          // on top won, which is the bug this replaced.
                          //
                          // ── AND A COVERED TWIN NEEDS A SECOND CLICK ──
                          //
                          // Every line is the same few SCREEN pixels wide
                          // (`non-scaling-stroke`), and a duplicate pair is
                          // offset by inches of building — nine, on E Street.
                          // At any sensible zoom they are the same pixels, so
                          // SVG gives every click to whichever it painted
                          // last, and a pre-rejected grey candidate could not
                          // be selected on the drawing at all; only its row in
                          // the panel worked. Clicking the same place again
                          // now takes the next candidate under the pointer.
                          const svg = event.currentTarget.ownerSVGElement;
                          const box = svg?.getBoundingClientRect();
                          if (box === undefined || box.width <= 0) {
                            answerKey.onFocus(one.id);
                            return;
                          }
                          answerKey.onFocus(
                            pickOnClick({
                              candidates: answerKey.state.candidates,
                              x: (event.clientX - box.left) / box.width,
                              y: (event.clientY - box.top) / box.width,
                              focusedId: answerKey.focusedId,
                              clicked: one.id,
                            }),
                          );
                        }}
                      />
                    );
                  })}
                  {answerKey.state.traced.map((one) => (
                    // ── A HIT AREA WIDER THAN THE INK ──
                    //
                    // The visible trace is 4px. Clicking a 4px diagonal line
                    // is hard with a mouse and impossible to do reliably in a
                    // test: the first version of this was selectable in
                    // principle and unselectable in practice, and the click
                    // landed on whatever was painted above it. A transparent
                    // stroke four times as wide underneath takes the click.
                    // ── A TRACE IS SELECTABLE, BECAUSE IT HAS TO BE DELETABLE ──
                    //
                    // These rendered with no click handler and no cursor, and
                    // `removeTraced` was exported and called by nothing —
                    // this repo's own "written, documented, never called"
                    // shape. A reviewer who traced a wall wrongly had no way
                    // back, and on the held-out sheets that led to CORRECT
                    // finder candidates being rejected to work around a
                    // trace, which is a key saying the opposite of what the
                    // reviewer meant.
                    <g key={one.id}>
                    <line
                      data-takeoff="key-traced-hit"
                      x1={one.x1}
                      y1={one.y1}
                      x2={one.x2}
                      y2={one.y2}
                      stroke="transparent"
                      strokeWidth={STROKE_PX * 16}
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: "pointer" }}
                      onClick={(event) => {
                        event.stopPropagation();
                        answerKey.onFocus(one.id);
                      }}
                    />
                    <line
                      data-takeoff="key-traced"
                      data-id={one.id}
                      x1={one.x1}
                      y1={one.y1}
                      x2={one.x2}
                      y2={one.y2}
                      stroke={VERDICT_COLOURS.wall}
                      strokeWidth={answerKey.focusedId === one.id ? STROKE_PX * 4 : STROKE_PX * 2}
                      strokeDasharray={`${STROKE_PX * 2} ${STROKE_PX}`}
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: "pointer" }}
                      onClick={(event) => {
                        event.stopPropagation();
                        answerKey.onFocus(one.id);
                      }}
                    />
                    </g>
                  ))}
                </g>
              )}
              {/* The box being dragged to decide many at once. */}
              {keyBox !== null && (
                <rect
                  data-takeoff="key-box"
                  x={Math.min(keyBox.x1, keyBox.x2)}
                  y={Math.min(keyBox.y1, keyBox.y2)}
                  width={Math.abs(keyBox.x2 - keyBox.x1)}
                  height={Math.abs(keyBox.y2 - keyBox.y1)}
                  fill="#2563eb"
                  fillOpacity={0.08}
                  stroke="#2563eb"
                  strokeWidth={STROKE_PX}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {/* The calibration line, redrawn over the sheet so the scale is
                  something a reviewer can SEE rather than take on faith.

                  ── EXCEPT IN ANSWER-KEY MODE ──

                  There it is the one mark on the sheet that is NOT a candidate,
                  and it looks exactly like one: a straight amber line over the
                  drawing, inside the plan, at a wall-ish length. A reviewer
                  building a key has to decide about every mark they can see,
                  and this one is not theirs to decide about. The scale is
                  already stated in words in the panel. */}
              {calibration && answerKey === undefined && (
                <line
                  x1={calibration.x1}
                  y1={calibration.y1}
                  x2={calibration.x2}
                  y2={calibration.y2}
                  stroke="#f0b429"
                  strokeWidth={STROKE_PX * 1.5}
                  /* ── A DASH-DOT, BECAUSE AN EVEN DASH IS WHAT A WALL RUN IS ──
                     This line was `8 5` amber dashes, and the cluster palette's
                     fifth colour is `#fbbf24` — rgb(251,191,36) against this
                     line's rgb(240,180,41), which is no difference at all — drawn
                     as even dashes too. So on any sheet with five or more
                     thickness groups the scale line and one group's runs were the
                     same mark, and the only way to tell them apart was to know
                     which one you had drawn.

                     It was reported as a bug: an orange dashed run crossing the
                     whole drawing on two unrelated real sheets at about the same
                     height. It was the scale line both times, crossing the
                     drawing because a long calibration is an ACCURATE one.

                     Fixed by shape rather than by colour, because the palette is
                     tuned and tested and because this line is a different KIND of
                     thing from a wall run. A cluster dash is always two numbers
                     (`markFor`: `${on} ${2}`); this is four, which no cluster can
                     produce — and a dash-dot is what a drafter draws for a
                     reference line, so it reads correctly to the people who use
                     this. Pinned by `calibrationMark.test.ts`. */
                  strokeDasharray={CALIBRATION_DASH}
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {(sheet?.measurements ?? []).map((m) => {
                const editing = editingId === m.id;
                const xs = editing && editDraft ? editDraft.xs : m.xs;
                const ys = editing && editDraft ? editDraft.ys : m.ys;
                return (
                  <g key={m.id}>
                    <Shape
                      kind={m.kind}
                      xs={xs}
                      ys={ys}
                      colour={editing ? "#f59e0b" : m.postedAt ? "#6b7280" : "#38bdf8"}
                    />
                    {/* ── OPENINGS TAKEN OFF THIS AREA ──
                        Drawn as their own outlines rather than as a hole in
                        the fill: an estimator has to be able to SEE what was
                        deducted, and a gap in a translucent shape reads as a
                        shape that was drawn wrong. */}
                    {(m.cutouts ?? []).map((hole, index) => (
                      <polygon
                        key={index}
                        points={hole.xs.map((x, i) => `${x},${hole.ys[i]}`).join(" ")}
                        fill="#0f172a"
                        fillOpacity={0.25}
                        stroke="#0ea5e9"
                        strokeWidth={STROKE_PX}
                        strokeDasharray={`${STROKE_PX * 3} ${STROKE_PX * 2}`}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    {/* ── VERTEX HANDLES, only on the shape being edited ──
                        Drawing them on every saved shape would cover a busy
                        sheet in dots and make the drawing unreadable, which is
                        the thing this whole screen is for. */}
                    {editing &&
                      xs.map((x, i) => (
                        <circle
                          key={i}
                          cx={x}
                          cy={ys[i]}
                          r={0.007}
                          fill="#f59e0b"
                          stroke="#0f172a"
                          strokeWidth={STROKE_PX / 2}
                          vectorEffect="non-scaling-stroke"
                          style={{ cursor: "grab" }}
                          data-takeoff="vertex-handle"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            event.preventDefault();
                            setDraggingVertex(i);
                          }}
                        />
                      ))}
                  </g>
                );
              })}

              {/* ── WHAT THE PANEL LISTS, AND NOTHING ELSE ──
                  This was `clusters={found}` and the panel lists `shownGroups`,
                  which is `found.slice(0, 12)`. On a West Herr floor plan that
                  returned 19 groups it meant SEVEN groups' lines were on the
                  drawing with no row beside them — and because the colour came
                  from `index % 6`, they wore the colours of rows 1 to 6. A
                  reviewer looking at a blue line could not tell whether it was
                  row 1's wall, which they can accept, or row 13's, which they
                  could not even see.

                  The overlay is the verification channel for this whole
                  feature — `wallVectors.ts` returns centrelines so that a wrong
                  answer is a line where there is no wall. A line nobody can
                  attribute breaks exactly that, so the overlay now follows the
                  list: "Show the other 7" reveals the rows and their lines
                  together. Nothing is lost, because it was never actionable —
                  only visible. */}
              <FoundWalls clusters={shownGroups} hovered={hovered} />
              {/* The demoted runs: grey and dashed so nobody reads one as found. */}
              {demoted.map((d) => {
                const run = runsRef.current[d.at];
                return run === undefined ? null : (
                  <line
                    key={`demoted-${d.at}`}
                    data-takeoff="demoted-wall"
                    className="text-ink-muted"
                    x1={run.x1}
                    y1={run.y1}
                    x2={run.x2}
                    y2={run.y2}
                    stroke="currentColor"
                    strokeWidth={hoveredDemoted === d.at ? STROKE_PX * 2.5 : STROKE_PX}
                    strokeDasharray="6 4"
                    strokeOpacity={hoveredDemoted === null || hoveredDemoted === d.at ? 0.9 : 0.35}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
              {rooms !== null &&
                roomsOnPage === pageNumber &&
                rooms.rooms.map((room) => (
                  <polygon
                    key={`room-${room.id}`}
                    data-takeoff="room"
                    data-room-named={room.tag ? "1" : "0"}
                    points={room.xs.map((x, i) => `${x},${room.ys[i]}`).join(" ")}
                    fill={room.tag ? "#16a34a" : "#f59e0b"}
                    fillOpacity={hoveredRoom === room.id ? 0.35 : 0.14}
                    stroke={room.tag ? "#15803d" : "#d97706"}
                    strokeWidth={STROKE_PX}
                    vectorEffect="non-scaling-stroke"
                    onMouseEnter={() => setHoveredRoom(room.id)}
                    onMouseLeave={() => setHoveredRoom(null)}
                  />
                ))}

              {draft.xs.length > 0 && (
                <Shape
                  kind={tool === "calibrate" ? "LINEAR" : (kindOf(tool) ?? "LINEAR")}
                  xs={draft.xs}
                  ys={draft.ys}
                  colour="#f0b429"
                  open
                />
              )}
            </svg>
          </div>
          </div>
        )}
        {isRendering && !loadError && (
          <p className="absolute right-3 top-3 rounded bg-rail-hover px-2 py-1 text-xs text-ink-muted">Drawing…</p>
        )}
      </div>

      </div>

      {/* ── What the draft reads, and what to do with it ──────────── */}
      {drawing && (
        <div className="rounded-lg border border-line-card bg-surface-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-ink-body">
              {draft.xs.length === 0
                ? TOOLS.find((t) => t.id === tool)?.hint
                : `${draft.xs.length} point${draft.xs.length === 1 ? "" : "s"}${draftReading ? ` · ${draftReading}` : ""}`}
            </p>
            {draft.xs.length > 0 && (
              <button
                type="button"
                onClick={undoPoint}
                className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-rail-hover"
              >
                Undo point
              </button>
            )}
            {draft.xs.length > 0 && (
              <button
                type="button"
                onClick={() => setDraft(EMPTY)}
                className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-rail-hover"
              >
                Clear
              </button>
            )}

            {/* ── TYPE THE LENGTH THE PLAN PRINTS ──
                A corridor marked 42'-6" often scales at 42'-2", and the
                estimator trusts the paper. Aim the last segment, type the
                figure, and the point moves to that distance along the line
                already aimed. Needs two points, because one has no direction.
                Disabled rather than hidden with no scale, and the title says
                why: a typed length against no scale is a number with no
                length, and a control that vanishes teaches nothing. */}
            {draft.xs.length >= 2 && tool !== "count" && (
              <span className="inline-flex items-center gap-1">
                <input
                  inputMode="decimal"
                  value={typedFeet}
                  onChange={(event) => setTypedFeet(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      applyTypedLength();
                    }
                  }}
                  disabled={feetPerUnit === null}
                  placeholder="ft"
                  aria-label="Set the last segment's length in feet"
                  title={
                    feetPerUnit === null
                      ? "Set the scale on this sheet before typing a length."
                      : "Type what the plan prints, in feet."
                  }
                  data-takeoff="typed-length"
                  className="w-16 rounded-md border border-line-card bg-surface px-1.5 py-1 text-xs text-ink placeholder:text-ink-muted disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={applyTypedLength}
                  disabled={feetPerUnit === null || typedFeet.trim() === ""}
                  data-takeoff="apply-length"
                  className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-rail-hover disabled:opacity-50"
                >
                  Set length
                </button>
              </span>
            )}

            {/* Shift is not discoverable, so the hint says it where the
                drawing is happening rather than only in a cheat sheet. */}
            {draft.xs.length > 0 && tool !== "count" && (
              <span className="text-[11px] text-ink-muted" data-takeoff="shift-hint">
                Hold Shift to keep it straight
                {snapTargets.length > 0 ? " · snapping to the drawing" : ""}
              </span>
            )}
          </div>

          {tool === "calibrate" && (
            <CalibrationForm
              jobId={jobId}
              planId={planId}
              pageNumber={pageNumber}
              pageWidthPt={pageSize?.widthPt ?? null}
              viewScales={viewScalesByPage?.[pageNumber] ?? []}
              printedScale={printedScaleByPage[pageNumber] ?? null}
              prefill={scalePrefillByPage[pageNumber] ?? null}
              declineReason={scaleDeclineByPage?.[pageNumber] ?? null}
              onUsePrefill={(xs, ys) => {
                // Seeds the draft so the proposed line DRAWS ON THE SHEET over
                // the dimension it was read from. That is the verification
                // channel and the reason this is two clicks rather than one:
                // an estimator should see the line sitting on `16' - 4 1/2"`
                // before agreeing to a number that multiplies through every
                // quantity on the sheet.
                setDraft({ xs: [...xs], ys: [...ys] });
              }}
              existingLabel={sheet?.label ?? sheetLabelByPage[pageNumber]?.replace(" · ", " ") ?? ""}
              existingNote={calibration?.note ?? ""}
              draft={calibrationDraft}
              onSaved={() => {
                setDraft(EMPTY);
                setTool("pan");
              }}
            />
          )}

          {tool !== "calibrate" && tool !== "cutout" && tool !== "edit" && sheet && draft.xs.length > 0 && (
            <MeasurementForm
              jobId={jobId}
              pageId={sheet.id}
              kind={kindOf(tool) ?? "LINEAR"}
              draft={draft}
              reading={draftReading}
              activeItemId={activeItemId}
              onSaved={(saved) => {
                setDraft(EMPTY);
                // THE HOST'S UNDO, when there is a host and an id. The viewer
                // keeps no stack of its own: the workspace owns undo because
                // it owns the keyboard, and the takeoff TAB passes nothing,
                // so this is simply inert there.
                if (saved) onMeasurementSaved?.({ id: saved.id, kind: kindOf(tool) ?? "LINEAR" });
              }}
            />
          )}

          {/* ── SAVING AN OPENING ──
              Not a MeasurementForm: a cutout creates nothing, it edits an
              area that already exists. The room it belongs to is worked out
              server-side from the geometry — see `addMeasurementCutout` — so
              there is nothing here to pick and nothing to name. */}
          {/* ── THE EDIT BAR ──
              Only while something is selected. Deleting is two steps and the
              confirm does not land on the delete's pixel — `ConfirmDelete`
              owns that geometry, including the column it becomes below `sm`. */}
          {tool === "edit" && editingId && editDraft && (
            <div className="mt-3 flex flex-wrap items-center gap-2" data-takeoff="edit-bar">
              <p className="text-xs text-ink-body">
                Drag a corner. {editDraft.xs.length} point{editDraft.xs.length === 1 ? "" : "s"}.
              </p>
              <button
                type="button"
                disabled={savingEdit}
                data-takeoff="save-edit"
                onClick={() => {
                  setEditError(null);
                  setSavingEdit(true);
                  void updateMeasurementGeometry(jobId, editingId, [...editDraft.xs], [...editDraft.ys])
                    .then((result) => {
                      if (result.ok) {
                        setEditingId(null);
                        setEditDraft(null);
                      } else {
                        setEditError(result.error);
                      }
                    })
                    .finally(() => setSavingEdit(false));
                }}
                className="rounded-md border border-line-card bg-brand px-2 py-1 text-xs font-medium text-neutral-900 disabled:opacity-50"
              >
                {savingEdit ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner />
                    Saving…
                  </span>
                ) : (
                  "Save shape"
                )}
              </button>
              <RowActions
                destructive={
                  <ConfirmDelete
                    label="Delete"
                    describe="Delete this measurement"
                    onConfirm={() => {
                      setEditError(null);
                      void deleteTakeoffMeasurement(jobId, editingId).then((result) => {
                        if (result.ok) {
                          setEditingId(null);
                          setEditDraft(null);
                        } else {
                          setEditError(result.error);
                        }
                      });
                    }}
                  />
                }
              >
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setEditDraft(null);
                  }}
                  className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-rail-hover"
                >
                  Cancel
                </button>
              </RowActions>
              {editError && (
                <p className="text-xs text-tag-rose-ink" role="alert" data-takeoff="edit-error">
                  {editError}
                </p>
              )}
            </div>
          )}

          {tool === "cutout" && sheet && draft.xs.length >= 3 && (
            <div className="mt-3 flex flex-wrap items-center gap-2" data-takeoff="cutout-save">
              <button
                type="button"
                disabled={cuttingOut}
                onClick={() => {
                  setCutoutError(null);
                  setCuttingOut(true);
                  void addMeasurementCutout(jobId, sheet.id, { xs: [...draft.xs], ys: [...draft.ys] })
                    .then((result) => {
                      if (result.ok) {
                        setDraft(EMPTY);
                      } else {
                        setCutoutError(result.error);
                      }
                    })
                    .finally(() => setCuttingOut(false));
                }}
                className="rounded-md border border-line-card bg-brand px-2 py-1 text-xs font-medium text-neutral-900 disabled:opacity-50"
              >
                {cuttingOut ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner />
                    Taking it off…
                  </span>
                ) : (
                  "Take this opening off the area"
                )}
              </button>
              {cutoutError && (
                <p className="text-xs text-tag-rose-ink" role="alert" data-takeoff="cutout-error">
                  {cutoutError}
                </p>
              )}
            </div>
          )}

          {tool !== "calibrate" && tool !== "cutout" && tool !== "edit" && !sheet && (
            <p className="mt-2 text-xs text-tag-amber-ink">Set the scale on this sheet before measuring it.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** One shape on the overlay. `open` is a polyline still being drawn. */

/**
 * A group's mark, drawn in the panel exactly as the drawing draws it.
 *
 * ── A COMPONENT SO THAT A TEST CAN LOOK AT IT ──
 *
 * The group list only exists after Find-the-walls has run, which needs pdf.js
 * on a canvas and never renders in happy-dom — the same bound `ClusterTag`
 * documents. So the swatch is a component for the same reason: mounted on its
 * own it can be rendered and compared against `FoundWalls`, and the one
 * property that matters — that the panel and the drawing agree about which
 * group is which — becomes something a test can assert rather than something a
 * person has to notice.
 *
 * Its own `strokePx`, because the swatch is 16 CSS pixels wide and the overlay
 * is in page-width units: the dash RATIOS must match, the absolute lengths
 * cannot. A dash scaled for the drawing renders as one solid blob at this size.
 */
export function ClusterMark({ index }: { index: number }) {
  const mark = markFor(index, 2);
  return (
    <svg aria-hidden width="16" height="8" viewBox="0 0 16 8" className="shrink-0">
      <line
        x1="0"
        y1="4"
        x2="16"
        y2="4"
        stroke={mark.stroke}
        strokeWidth="3"
        strokeDasharray={mark.dash}
      />
    </svg>
  );
}


/**
 * THE FOUND WALLS, DRAWN ON THE DRAWING.
 *
 * ── THIS IS THE VERIFICATION CHANNEL, NOT DECORATION ──
 *
 * `wallVectors.ts` returns CENTRELINES rather than a number, and its header
 * says why: a wrong answer is then a line sitting where there is no wall, which
 * an estimator catches in a glance on a drawing they are already looking at. A
 * takeoff that reported "1,284 ft" and nothing else would be asking them to
 * take it on faith, and a confidently wrong number is the failure
 * `symbolCount.eval.ts` refused to ship. These lines ARE the safety argument
 * for the whole feature.
 *
 * ── AND THAT IS WHY IT IS ITS OWN COMPONENT ──
 *
 * Written inline in the viewer's SVG it could be made to render nothing and
 * every test still passed — measured, as a mutation, which is the only reason
 * anybody knew. The ghosts cannot be reached from a test that way, because they
 * only exist after a real PDF has been read. Exported, they can be handed
 * clusters and looked at. Same move as `errorBandText`: a decision inside JSX
 * is a decision no test can reach.
 *
 * Dashed, and painted under the saved measurements, so a proposal never looks
 * like something already counted.
 */
/**
 * WHICH SHEET, AND A WAY TO REACH ANOTHER ONE.
 *
 * ── JUMP, DO NOT WALK ──
 *
 * This was `Sheet 23 of 52` as plain text between Prev and Next, and reaching
 * `A-101` on a real 52-sheet set was measured at TWENTY presses of Next. Blind
 * ones: a position in the file does not tell you which sheet you are near, so
 * there was nothing to aim at. That was the largest single number in a press
 * count of all nine estimating steps on one real bid, and the only one of them
 * that was navigation rather than judgement — every other step's cost was a
 * decision somebody has to make.
 *
 * EVERY PAGE IS AN OPTION, including the ones nothing has read a number off,
 * which keep the old wording. Listing only the named sheets would make a
 * scanned page reachable by nothing but Prev and Next — the control this is
 * here to replace — so the unread pages are exactly the ones that must stay in
 * the list.
 *
 * PREV AND NEXT STAY. Reading a set is often "the next sheet", and a picker is
 * the wrong shape for that. This adds a way to aim; it takes nothing away.
 *
 * ── EXPORTED FOR THE SAME REASON `ClusterTag` BELOW IS ──
 *
 * The pager renders only once the PDF has reported a page count, and pdf.js
 * never runs in happy-dom. A test that mounted the viewer would assert against
 * a sheet reading "Drawing…". So the control is its own component and
 * `sheetPager.test.tsx` renders it — the #665 lesson, that a census proves the
 * code is there and only rendering proves somebody can reach it.
 */
export function SheetPager({
  pageNumber,
  pageCount,
  sheetLabelByPage,
  onJump,
}: {
  pageNumber: number;
  pageCount: number;
  sheetLabelByPage: Record<number, string>;
  onJump: (page: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onJump(Math.max(1, pageNumber - 1))}
        disabled={pageNumber <= 1}
        className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-rail-hover disabled:opacity-40"
      >
        Prev
      </button>
      <label className="flex items-center gap-1 text-xs text-ink-muted">
        <span className="sr-only">Jump to a sheet</span>
        <select
          value={pageNumber}
          onChange={(event) => onJump(Number(event.target.value))}
          data-takeoff="sheet-picker"
          className="min-h-[36px] max-w-[18rem] rounded-md border border-line-card bg-surface px-2 text-xs text-ink-body"
        >
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
            <option key={number} value={number}>
              {sheetLabelByPage[number] ?? `Sheet ${number}`}
            </option>
          ))}
        </select>
        <span>of {pageCount}</span>
      </label>
      <button
        type="button"
        onClick={() => onJump(Math.min(pageCount, pageNumber + 1))}
        disabled={pageNumber >= pageCount}
        className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-rail-hover disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

/**
 * ── THE NAME THE DRAWING GIVES A THICKNESS GROUP ──
 *
 * A thickness is what was MEASURED; a name is what gets mapped to a wall type
 * and priced. Shown beside the thickness rather than instead of it, because the
 * thickness is what an estimator checks against the drawing and the name is
 * what they act on.
 *
 * Renders NOTHING for a group the drawing did not tag, and that is the usual
 * case: only 25-43% of footage carries a tag, because an architect tags
 * representative walls and not every wall. A reassuring phrase on every
 * untagged group would bury the real names.
 *
 * ── EXPORTED BECAUSE THE PANEL CANNOT BE MOUNTED IN A TEST ──
 *
 * The group list only exists after Find-the-walls has run, which needs pdf.js
 * on a canvas — and that never renders in happy-dom, where
 * `getBoundingClientRect` returns zeros. Measured rather than assumed: a probe
 * pressed Set scale, then the port, then the SVG, and the sheet read
 * "Drawing…" throughout. So this is a component so that `wallTags.test.ts`
 * can render it, which is the #665 lesson — a census proves the code is there,
 * only rendering proves somebody can see it.
 */
export function ClusterTag({ names }: { names: readonly string[] }) {
  const sentence = tagSentence(names);
  if (sentence === null) return null;
  // ── A TYPE CARRIED ALONG THE WALL READS WEAKER THAN ONE PRINTED BESIDE IT ──
  // `planTextTags.ts` marks a propagated run's tag; the code is shown plain
  // and the marker becomes words, so an estimator can tell "the drawing says
  // IW-2 here" from "this is the same wall as the one the drawing tagged".
  const carried = names.some(isPropagatedTag);
  return (
    <span
      className="rounded bg-tag-slate px-1.5 py-0.5 text-xs font-medium text-tag-slate-ink"
      data-takeoff="cluster-tag"
      data-carried={carried ? "1" : undefined}
      title={carried ? "Same wall as a run the drawing tagged — the type was carried along the wall" : sentence}
    >
      {names.map(plainTag).join(" / ")}
      {carried && <span className="ml-1 font-normal text-ink-muted">same wall</span>}
    </span>
  );
}

export function FoundWalls({
  clusters,
  hovered,
}: {
  /** Anything with runs on it. A `WallGroup` since the tag split, a
   *  `WallCluster` before it, and the drawing code never cared which. */
  clusters: { runs: { x1: number; y1: number; x2: number; y2: number }[] }[] | null;
  hovered: number | null;
}) {
  if (clusters === null) return null;
  return (
    <>
      {clusters.map((cluster, index) =>
        cluster.runs.map((run, runIndex) => (
          <line
            key={`${index}-${runIndex}`}
            data-found-wall={index}
            x1={run.x1}
            y1={run.y1}
            x2={run.x2}
            y2={run.y2}
            stroke={markFor(index, STROKE_PX).stroke}
            strokeWidth={hovered === index ? STROKE_PX * 2.5 : STROKE_PX}
            strokeDasharray={markFor(index, STROKE_PX).dash}
            strokeOpacity={hovered === null || hovered === index ? 1 : 0.25}
            vectorEffect="non-scaling-stroke"
          />
        )),
      )}
    </>
  );
}

function Shape({
  kind,
  xs,
  ys,
  colour,
  open = false,
}: {
  kind: MeasurementKind;
  xs: number[];
  ys: number[];
  colour: string;
  open?: boolean;
}) {
  const points = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
  if (kind === "COUNT") {
    return (
      <g>
        {xs.map((x, i) => (
          <circle key={i} cx={x} cy={ys[i]} r={0.006} fill={colour} fillOpacity={0.9} />
        ))}
      </g>
    );
  }
  if (kind === "AREA" && !open) {
    return (
      <polygon
        points={points}
        fill={colour}
        fillOpacity={0.18}
        stroke={colour}
        strokeWidth={STROKE_PX}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  return (
    <g>
      <polyline
        points={points}
        fill={kind === "AREA" ? colour : "none"}
        fillOpacity={kind === "AREA" ? 0.12 : 0}
        stroke={colour}
        strokeWidth={STROKE_PX}
        vectorEffect="non-scaling-stroke"
      />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r={0.004} fill={colour} />
      ))}
    </g>
  );
}

/**
 * THE READBACK IS THE SAFEGUARD. The scale is named in the estimator's own
 * vocabulary, and the sheet width is stated in feet, while the drawing is
 * still on screen — so a wrong calibration is caught before a single quantity
 * comes off it. Every sentence here is computed by the same pure module the
 * server re-runs before saving.
 */
/**
 * WHAT THE SHEET SAID ABOUT ITS OWN SCALE, offered rather than applied.
 *
 * It shows its work, and that is the whole design. Never a bare
 * `1/8" = 1'-0"`: the dimensions that agreed are listed, because an estimator
 * can glance at the sheet and see `16' - 4 1/2"` printed where this says it is.
 * A reason nobody can check is a reason nobody can overrule — the sentence
 * `PlanSheetProposal.proposedReason` already insists on, applied to geometry.
 *
 * Pressing it draws the proposed line ON THE DRAWING and fills the box; the
 * estimator then presses the same button they press today. Two clicks against
 * today's find-a-dimension, click, click, type — and nothing reaches a quantity
 * without somebody having looked at the line, which matters because a scale
 * error multiplies through every wall on the sheet.
 */
/**
 * EXPORTED FOR A RENDER TEST, and the reason is a limit rather than a
 * preference. The panel this returns lives inside `CalibrationForm`'s DRAFT
 * branch, which needs a line drawn on the sheet — and the sheet is pdf.js on a
 * canvas, which never renders in happy-dom (`getBoundingClientRect` returns
 * zeros, so no click can become a point). Mounting the whole viewer therefore
 * cannot reach this panel at all, measured rather than assumed: a probe clicked
 * Set scale, then the port, then the SVG, and the sheet read "Drawing…"
 * throughout.
 *
 * So `reducedPrintCaution.test.tsx` renders this directly. That proves the
 * branch and its wording, and it deliberately does NOT claim the panel is
 * navigable — see that file's own note on what it is and is not evidence for.
 */
/**
 * ── A SHEET WITH SEVERAL DRAWINGS ON IT, EACH AT ITS OWN SCALE ──
 *
 * There is no prefill for these and there must not be: one scale would be
 * wrong for every drawing but one, and a calibration the estimator accepts is
 * a calibration they are taken to have checked.
 *
 * `scaleFromPrinted` refuses exactly this page — more than one printed scale,
 * and no way to tell which drawing each belongs to. Reading them per VIEW is
 * how it can be told, because a caption is read against the region its drawing
 * occupies. So this offers the drawings themselves and asks which one is being
 * measured, which is a question the estimator can answer by looking at the
 * sheet and the app cannot answer at all.
 *
 * The scale is still UNCONFIRMED in the sense `ScaleOffer` uses: nothing on the
 * sheet checks a caption. The line it proposes spans the drawing's own region,
 * which is at least something to look at — see `calibrationForView`.
 */
export function ViewScaleOffer({
  views,
  onUse,
}: {
  views: readonly ViewScale[];
  onUse: (view: ViewScale) => void;
}) {
  return (
    <div className="rounded-md border border-line-card bg-surface p-2" data-takeoff="view-scales">
      <p className="mb-2 text-xs text-ink-body">
        This sheet carries{" "}
        <span className="font-semibold text-ink">{views.length} drawings at their own scales</span>, so
        there is no one scale for the page. Pick the drawing you are measuring.
      </p>
      <ul className="flex flex-col gap-1">
        {views.map((view, index) => (
          <li key={`${view.name}-${index}`}>
            <button
              type="button"
              data-takeoff="use-view-scale"
              onClick={() => onUse(view)}
              className="flex w-full items-baseline justify-between gap-3 rounded-md border border-line-card px-2 py-1.5 text-left text-xs text-ink-label hover:bg-rail-hover"
            >
              <span className="font-medium text-ink">{view.name}</span>
              <span className="shrink-0 text-ink-muted">{view.scaleName}</span>
            </button>
          </li>
        ))}
      </ul>
      {/* The same sentence `ScaleOffer` shows for a printed scale, for the same
          reason: a caption is what somebody typed, and nothing on the drawing
          confirms it. An estimator accepting this has to know that. */}
      <p className="mt-2 text-[11px] text-ink-muted">
        These come from the captions under each drawing. Nothing measurable on the sheet confirms
        them — check one against a dimension you can read before relying on it.
      </p>
    </div>
  );
}

export function ScaleOffer({ prefill, onUse }: { prefill: ScalePrefill; onUse: () => void }) {
  // Both of these are PURE and live in `takeoff-plan-view.ts`, where they are
  // tested — the wording of a measured error and the order of the evidence are
  // decisions, and a decision written inline in JSX is one no test can reach.
  const band = errorBandText(prefill.inheritedError);
  const shown = evidenceOrder(prefill.agreed, prefill.declaredText);

  // ── A SCALE OFF THE TITLE BLOCK, WITH NOTHING ON THE SHEET TO CHECK IT ──
  //
  // The sentence is the whole of what makes this path acceptable. A
  // dimension-derived scale is offered with the dimensions it matched and a line
  // drawn over one of them, so an estimator verifies it by looking. A printed
  // one cannot be verified by looking at anything, and #623 declined it for
  // exactly that reason. It ships because a real bid set reads 9 of ~30 sheets
  // from dimensions while 16 more PRINT their scale — but it ships SAYING so,
  // never dressed as the other kind.
  if (prefill.unconfirmed) {
    return (
      <div className="rounded-md border border-line-card bg-surface p-2">
        {/* ── A REDUCED PRINT GOES FIRST, AND IN THE WARNING COLOUR ──
            It is not a footnote to the scale, it is a correction OF the scale:
            the number above it has already been changed, and an estimator who
            reads only the first line has to be the one who learns that. The
            key's page 50 measured every length at half without this. */}
        {prefill.reducedPrintCaution !== undefined && (
          <p
            className="mb-2 rounded bg-tag-amber px-2 py-1 text-[11px] font-medium text-tag-amber-ink"
            data-takeoff="reduced-print-caution"
          >
            {prefill.reducedPrintCaution}
          </p>
        )}
        <p className="text-xs text-ink-body">
          {prefill.reducedPrintCaution === undefined ? (
            <>
              The title block on this sheet says <span className="font-semibold text-ink">{prefill.scaleName}</span>.
            </>
          ) : (
            <>
              Corrected for the reduction, this sheet measures{" "}
              <span className="font-semibold text-ink">{prefill.scaleName}</span>.
            </>
          )}
        </p>
        <p className="mt-1 text-[11px] text-ink-muted">
          {/* Said plainly rather than softened. The estimator is accepting a
              figure with nothing to look at, and that is their decision to make
              knowingly. */}
          Nothing measurable on this sheet confirms it —{" "}
          {/* "DID NOT AGREE" WAS THE WRONG WORD FOR THE COMMON CASE, and a
              click-through caught it: a sheet with 2 printed dimensions cannot
              agree on anything, because three are needed before a scale is
              taken seriously. Saying they disagreed invites somebody to go
              looking for a contradiction that is not there — and on the sheet
              that reported it, one of the two measured correctly. */}
          {prefill.considered === 0
            ? "no printed dimensions could be read here"
            : prefill.considered < 3
              ? `only ${prefill.considered} printed dimension${prefill.considered === 1 ? "" : "s"} could be read, ` +
                `too few to confirm a scale from`
              : `its ${prefill.considered} printed dimensions did not settle on one scale`}
          . Using it sets the scale from the printed figure alone.
        </p>
        <button
          type="button"
          onClick={onUse}
          className="mt-2 rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink-body hover:bg-rail-hover"
        >
          Use the printed scale
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-line-card bg-surface p-2">
      <p className="text-xs text-ink-body">
        This sheet reads <span className="font-semibold text-ink">{prefill.scaleName}</span>
        {prefill.agreed.length > 0 && (
          <>
            {" — matched "}
            {prefill.agreed.length} printed dimension{prefill.agreed.length === 1 ? "" : "s"}
            {prefill.considered > prefill.agreed.length && ` of ${prefill.considered} found`}.
          </>
        )}
      </p>
      {/* THE QUOTED DIMENSION GOES FIRST, and a click-through is why.

          This row used to be `agreed.slice(0, 6)` in whatever order the vote
          produced, while the sentence below quotes the ONE pair being proposed.
          On a sheet with 24 matched dimensions the quoted one was not among the
          six shown — "Within 0.17% on 25' - 0 1/2"" above a row that did not
          contain `25' - 0 1/2"`. Both facts were true and the pair read as a
          contradiction, which is worse than showing less. */}
      {shown.length > 0 && <p className="mt-1 text-[11px] text-ink-muted">{shown.join("   ")}</p>}
      <p className="mt-1 text-[11px] text-ink-muted">
        {/* THE BAND IS MEASURED, AND IT USED TO PRINT A FLOOR AS IF IT WERE THE
            MEASUREMENT. `band < 0.05 ? "0.05" : …` meant a pair accurate to
            0.01% was reported as "Within 0.05%" — while the note written beside
            it said 0.01%, because that one formats the real figure. A
            click-through caught the contradiction.

            Rounding UP to a floor is defensible in a progress bar and indefensible
            in a number about accuracy: it is the figure somebody would rely on,
            and it was overstating the error rather than the precision, which is
            the direction that makes the feature look worse than it is. Either
            way, two places showing one quantity differently is a defect.

            Under a hundredth of a percent now says so as an inequality rather
            than inventing a value — `toFixed(2)` on 0.004 would print "0.00",
            which claims perfection. */}
        Within {band} on {prefill.declaredText || "the dimension it read"}.
      </p>
      <button
        type="button"
        onClick={onUse}
        className="mt-2 rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink-body hover:bg-rail-hover"
      >
        Use this dimension
      </button>
    </div>
  );
}

/**
 * STROKE WIDTH IN SCREEN PIXELS, because `vectorEffect="non-scaling-stroke"`
 * means that is the unit — and these lines were set to 0.002 of one.
 *
 * Found by a click-through of the prefill: the two end dots rendered on the
 * drawing and **the line between them did not**. The dots are plain circles
 * with `r={0.004}` in the viewBox's own units, so they scale and show. Every
 * stroked line carries `non-scaling-stroke`, which makes its width a count of
 * device pixels rather than user units — so `0.002` asked for two thousandths
 * of a pixel.
 *
 * The pairing was incoherent under either reading, which is what makes this a
 * defect rather than a taste: if the vector effect applies, the line is
 * invisible; if it did not apply, the effect was pointless. 2 is the width that
 * matches the intent the attribute was reaching for.
 *
 * This is NOT specific to the prefill — the same renderer draws every
 * hand-clicked draft and every posted measurement, so it was always this thin.
 * Nothing in this repo could have caught it: the screen suite renders in
 * happy-dom, which does no layout.
 */
/** One empty list, so a page with no missed walls does not hand every
 *  consumer a new array on each render. */
const EMPTY_MISSED: { where: string; why: string }[] = [];

/**
 * How far a pointer may move and still count as a CLICK, in page-width units.
 *
 * About eleven pixels on a 2592pt sheet — a hand resting on a trackpad, not a
 * box anybody drew. It only has to separate "I clicked that run" from "I swept
 * an area", and the two gestures are nowhere near each other.
 */
const CLICK_NOT_DRAG = 0.004;

const STROKE_PX = 2;

/**
 * The scale line's dash: long, short, dot — the drafting convention for a
 * reference line, and a shape no cluster mark can take.
 *
 * `markFor` builds every cluster dash as exactly TWO lengths. This is four, so
 * the scale line cannot be mistaken for a wall run however the palette moves.
 * `calibrationMark.test.ts` asserts that across every index.
 */
export const CALIBRATION_DASH = `${STROKE_PX * 7} ${STROKE_PX * 3} ${STROKE_PX} ${STROKE_PX * 3}`;

function CalibrationForm({
  jobId,
  planId,
  pageNumber,
  pageWidthPt,
  printedScale,
  existingLabel,
  existingNote,
  draft,
  prefill,
  viewScales,
  declineReason,
  onUsePrefill,
  onSaved,
}: {
  jobId: string;
  planId: string;
  pageNumber: number;
  pageWidthPt: number | null;
  printedScale: string | null;
  existingLabel: string;
  existingNote: string;
  draft: StoredCalibration | null;
  prefill: ScalePrefill | null;
  /** The drawings on a multi-scale sheet, each with its own captioned scale.
   *  Empty on every ordinary sheet. */
  viewScales: readonly ViewScale[];
  declineReason: string | null;
  onUsePrefill: (xs: readonly [number, number], ys: readonly [number, number]) => void;
  onSaved: () => void;
}) {
  const [typed, setTyped] = useState("");
  /**
   * WHY THIS SCALE IS THE RIGHT ONE, and it has to survive the save.
   *
   * `TakeoffScaleCalibration.note` is described in the schema as "the one thing
   * here that records WHY this scale is the right one". Until now the prefill
   * filled the distance and left this empty, so once a scale was accepted
   * NOTHING recorded where it came from — a scale read off the title block,
   * which nothing on the sheet confirms, became indistinguishable from one
   * matched against five printed dimensions. A click-through caught it: *"the
   * toolbar doesn't show which way the scale was set."*
   *
   * That matters beyond tidiness. If a bid is ever questioned, "this came from
   * the printed figure alone" is the sentence somebody needs, and it is the one
   * sentence the estimator cannot reconstruct a week later.
   *
   * Still editable, because it is the estimator's own note and they may know
   * more than the app does.
   */
  const [note, setNote] = useState("");

  const preview = useMemo(() => {
    if (!draft) return null;
    const parsed = parseDeclared(typed);
    const line: StoredCalibration = { ...draft, declaredDistanceFeet: parsed ?? 1 };
    const notices = calibrationNotices(line, pageWidthPt, null, printedScale);
    return { notices, refusal: calibrationRefusal(notices), parsed };
  }, [draft, typed, pageWidthPt, printedScale]);

  if (!draft) {
    return (
      <div className="mt-2 flex flex-col gap-2">
        {/* WHERE A SAVED SCALE CAME FROM, which was stored and then shown
            nowhere at all.

            Since #655 the automatic reader writes its own account into
            `note` — which dimensions it matched and how closely, or that it
            used the printed scale with nothing confirming it. That is
            provenance for a number multiplying every quantity on the sheet.

            It was only ever rendered INSIDE the draft form, and a sheet with a
            scale already set has no draft — so the moment it was saved it
            became invisible. A click-through went looking for it on two sheets
            that saved successfully and reported, correctly, that nothing on
            screen says which way a scale was set.

            Shown here rather than in the toolbar because the toolbar states
            WHAT the scale is in six words and this is a sentence; this panel is
            where somebody who doubts it has already come to look. */}
        {/* ── WHY THIS SHEET OFFERED NOTHING ──

            The reader has recorded a reason for every decline since #655 — "its
            lettering was saved as line work rather than characters, so there is
            nothing here to read a scale from. Set it by hand." — and it was
            written to the database and shown to NOBODY. An estimator got an
            empty form and no explanation, which reads as a broken feature.

            It matters most on the sets that provoked it. Two whole bid packages
            measured here have their text converted to outlines — 373,377 strokes
            and ZERO text items on one sheet — so EVERY sheet in both declines
            and the app looks broken across an entire project.

            It is not broken, and saying so is the point. The dimensions are
            still printed on those sheets; a person reads `24'-0"` perfectly
            well, it is simply drawn as lines. Setting the scale by hand works as
            it always has, and the wall finder then works too — 150, 135 and 105
            walls on three of those sheets, measured. What was lost is the
            automatic scale, not the takeoff.

            Shown only when there is no prefill: a sheet that offered something
            does not need to explain itself. */}
        {prefill === null && declineReason && (
          <p className="rounded-md border border-line-card bg-surface px-2 py-1.5 text-[11px] text-ink-muted">
            <span className="text-ink-body">C Stream couldn&apos;t read a scale here:</span> {declineReason}
          </p>
        )}

        {existingNote && (
          <p className="rounded-md border border-line-card bg-surface px-2 py-1.5 text-[11px] text-ink-muted">
            <span className="text-ink-body">How this sheet&apos;s scale was set:</span> {existingNote}
          </p>
        )}
        {/* ── THE PER-VIEW OFFER, WHERE A PAGE-WIDE ONE CANNOT EXIST ──
            Only when there is no prefill: a sheet that read a scale of its own
            has one answer and does not need to be asked which drawing. */}
        {!prefill && pageWidthPt !== null && viewScales.length > 0 && (
          <ViewScaleOffer
            views={viewScales}
            onUse={(view) => {
              // A page whose width never arrived cannot have a line placed on
              // it — the ratio has nothing to be a ratio OF. The offer is not
              // shown in that state; this is the type-level echo of that.
              if (pageWidthPt === null) return;
              const line = calibrationForView(view, pageWidthPt);
              onUsePrefill([line.x1, line.x2], [line.y1, line.y2]);
              setNote(
                `From the ${view.scaleName} captioned under ${view.name} on this sheet. ` +
                  `Nothing measurable on the sheet confirmed it.`,
              );
              setTyped(formatFeetInches(line.declaredDistanceFeet));
            }}
          />
        )}
        {prefill && (
          <ScaleOffer
            prefill={prefill}
            onUse={() => {
              onUsePrefill(prefill.xs, prefill.ys);
              // The provenance, in words, so it survives the save — see `note`
              // above for why that is not cosmetic.
              setNote(
                prefill.unconfirmed
                  ? `From the ${prefill.scaleName} printed on this sheet. Nothing measurable on the sheet ` +
                    `confirmed it.`
                  : `Matched ${prefill.agreed.length} printed dimension${prefill.agreed.length === 1 ? "" : "s"}` +
                    ` on this sheet (${prefill.agreed.slice(0, 3).join(", ")}), within ` +
                    `${(prefill.inheritedError * 100).toFixed(2)}%.`,
              );
              // A PRINTED scale's `declaredText` is the scale NAME, not a
              // distance, so typing it into the distance box would be nonsense.
              // The figure there is what the printed scale says the sheet's own
              // width is — see `scaleFromPrinted`.
              setTyped(
                prefill.unconfirmed
                  ? formatFeetInches(prefill.declaredFeet)
                  : prefill.declaredText || formatFeetInches(prefill.declaredFeet),
              );
            }}
          />
        )}
        <p className="text-xs text-ink-muted">Click once at each end of a dimension printed on the drawing.</p>
      </div>
    );
  }

  return (
    <ActionForm
      action={saveTakeoffCalibration.bind(null, jobId)}
      className="mt-3 flex flex-col gap-2"
      onSuccess={onSaved}
    >
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="pageNumber" value={pageNumber} />
      {pageWidthPt !== null && <input type="hidden" name="pageWidthPt" value={pageWidthPt} />}
      <input type="hidden" name="points" value={JSON.stringify({ xs: [draft.x1, draft.x2], ys: [draft.y1, draft.y2] })} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          What does the drawing say that is?
          {/* inputMode is "text", not "decimal", ON PURPOSE: this field takes
              a dimension as printed — 24'-6" — and a decimal keypad has no
              foot or inch mark on it. The figure still goes through the app's
              one number parser, via `parseFeetInches`. */}
          <input
            name="declaredDistanceFeet"
            inputMode="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={"24'-6\""}
            className="w-32 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          Sheet name
          <input
            name="pageLabel"
            defaultValue={existingLabel}
            placeholder="A-101 First Floor"
            className="w-44 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          What you measured (optional)
          <input
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="24'-0&quot; column grid"
            className="w-52 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          />
        </label>
        <SubmitButton
          type="submit"
          disabled={!preview?.parsed || Boolean(preview?.refusal)}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          Set the scale
        </SubmitButton>
      </div>

      {preview && preview.parsed !== null && (
        <ul className="flex flex-col gap-0.5">
          {preview.notices.map((notice, i) => (
            <li
              key={i}
              className={`text-xs ${notice.level === "refuse" ? "text-tag-rose-ink" : "text-ink-body"}`}
            >
              {notice.message}
            </li>
          ))}
          <li className="text-xs text-ink-muted">
            Reading that back: {formatFeetInches(preview.parsed)}.
          </li>
        </ul>
      )}
    </ActionForm>
  );
}

/** Saves one finished shape. The geometry rides as JSON; nothing numeric the
 * person typed goes anywhere but through the app's parser on the server. */
function MeasurementForm({
  jobId,
  pageId,
  kind,
  draft,
  reading,
  activeItemId,
  onSaved,
}: {
  jobId: string;
  pageId: string;
  kind: MeasurementKind;
  draft: Draft;
  reading: string | null;
  activeItemId: string | null;
  /** Carries the new row's id, which is what an undo needs to delete it. */
  onSaved: (saved: { id: string } | null) => void;
}) {
  const problem = verticesProblem(kind, draft.xs, draft.ys);
  const crosses = kind === "AREA" && !problem && ringSelfIntersects(draft.xs, draft.ys);

  return (
    <ActionForm
      action={saveTakeoffMeasurement.bind(null, jobId)}
      className="mt-3 flex flex-col gap-2"
      onSuccess={(result) => {
        // `saveTakeoffMeasurement` returns `ActionResultWith<{ id }>`. Read it
        // defensively rather than cast: `onSuccess` is typed `unknown` for the
        // sixty forms whose actions return nothing, and an undo that cannot
        // find an id must degrade to no undo rather than throw.
        const value =
          typeof result === "object" && result !== null && "value" in result
            ? (result as { value?: { id?: unknown } }).value
            : null;
        onSaved(typeof value?.id === "string" ? { id: value.id } : null);
      }}
    >
      <input type="hidden" name="pageId" value={pageId} />
      {/* Blank when nothing is selected, which the action reads as
          Unassigned rather than as an error. */}
      <input type="hidden" name="itemId" value={activeItemId ?? ""} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="points" value={JSON.stringify(draft)} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          {kind === "COUNT" ? "What are you counting?" : "Name this measurement (optional)"}
          <input
            name="label"
            placeholder={kind === "COUNT" ? "can light" : "North corridor"}
            className="w-56 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          />
        </label>
        {/* ── WHICH PRICING PACKAGE THIS QUANTITY IS IN ──

            Blank is the BASE BID, and the placeholder says so rather than
            leaving it to be inferred from an empty box. That default is the
            safety argument: an estimator who does not think about this puts the
            quantity in the number sent to the GC, which is the recoverable
            error. The opposite default bids LOW, and a low bid is work won at a
            loss and then built.

            `bg-surface` rather than `bg-surface-input` like its neighbour, and
            not a style choice: `surface-input` resolves to nothing on this
            near-black canvas (issue #573) and `colorTokenCensus.test.ts` pins
            the family at exactly 39 uses so it fails when it GROWS. A fortieth
            would red CI. */}
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          Pricing package
          <input
            name="packageLabel"
            placeholder="Base bid"
            data-takeoff="package-label"
            className="w-48 rounded-md border border-line-card bg-surface px-2 py-1 text-sm text-ink-body"
          />
        </label>
        <SubmitButton
          type="submit"
          disabled={Boolean(problem) || crosses}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          Save {reading ? `(${reading})` : "measurement"}
        </SubmitButton>
      </div>
      {problem && <p className="text-xs text-ink-muted">{problem}</p>}
      {crosses && (
        <p className="text-xs text-tag-rose-ink">
          That outline crosses itself, so it has no area. Undo back past the crossing, or clear and draw it again.
        </p>
      )}
    </ActionForm>
  );
}

/** The typed dimension, for the PREVIEW only — the figure that is saved is
 * parsed again on the server by the SAME reader, so the sentence on screen
 * and the number stored cannot disagree. Null while the field is still being
 * typed into, so the readback appears rather than flickering a refusal at
 * every keystroke.
 */
function parseDeclared(typed: string): number | null {
  if (!typed.trim()) return null;
  const parsed = parseFeetInches(typed);
  return parsed.ok ? parsed.n : null;
}
