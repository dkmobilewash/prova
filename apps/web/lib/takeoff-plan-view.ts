/**
 * The shapes the takeoff page hands its viewer, and the tools the viewer
 * offers.
 *
 * A NEUTRAL MODULE ON PURPOSE. `client-boundary.test.ts` fails the build when
 * a server module imports a plain value out of a `"use client"` module — it
 * typechecks and then 500s in production — so the tool list and these row
 * types live here, where the server page and the client viewer can both read
 * them.
 *
 * Pure types and one constant. No React, no prisma, no pdfjs.
 */

import type { MeasurementKind, StoredCalibration } from "@/lib/takeoff-plan";
import type { ZoneNotice } from "@/lib/takeoff-zones";
import { reducedPrint, setSheetWidth, printedScaleForSheet } from "./takeoff/reducedPrint";

/** A calibration as the viewer needs it: the drawn line plus the distance it
 * was declared to be, with the Decimal already turned into a number by the
 * page that read it. */
export type PlanViewerCalibration = StoredCalibration & {
  id: string;
  /** WHY THE NOTE TRAVELS WITH THE CALIBRATION, when `StoredCalibration` is
   * deliberately geometry alone: since #655 the automatic reader WRITES this
   * field, recording which dimensions it matched and how closely. That made it
   * provenance rather than a free-text remark — and it was stored where nothing
   * could display it, so a saved scale had no visible account of where it came
   * from. A click-through looked for exactly that and found nothing. */
  note: string | null;
};

export type PlanMeasurementRow = {
  id: string;
  kind: MeasurementKind;
  xs: number[];
  ys: number[];
  label: string | null;
  postedAt: string | null;
  /** The calibration THIS shape was drawn to, which is not always the
   * sheet's current one — that is the whole point of the FK. */
  calibration: StoredCalibration;
  /** True when this measurement reads at a scale the sheet has since moved
   * on from. Derived by the page, never stored. */
  outOfDate: boolean;
  /**
   * The scale this shape was traced against, named — `1/8" = 1'-0"` — and
   * ONLY on a sheet that carries more than one scale.
   *
   * Null on an ordinary sheet, where the scale is a property of the page and
   * printing it on every row is noise. `measurementScaleLabel` in
   * `lib/takeoff-zones.ts` makes that decision from the sheet's own notices,
   * so one rule governs the banner and the rows together.
   */
  scaleLabel: string | null;
};

export type PlanSheet = {
  id: string;
  pageNumber: number;
  label: string | null;
  pageWidthPt: number | null;
  /** The newest calibration on this sheet, or null when nobody has set one. */
  calibration: PlanViewerCalibration | null;
  measurements: PlanMeasurementRow[];
  /**
   * What to say about a sheet calibrated at more than one scale. Empty on the
   * ordinary sheet, and that silence is load-bearing.
   *
   * NON-EMPTY ALSO MEANS THE RESCALE OFFER MUST BE WITHDRAWN, which is the
   * half of this that is a bug fix rather than a feature.
   * `rescaleTakeoffMeasurements` repoints every unposted measurement to the
   * NEWEST calibration and leaves the geometry alone — so on a sheet with a
   * plan at 1/8" and a detail at 1-1/2", pressing it multiplies the detail's
   * quantities by twelve. The old "reads at an older scale" banner invited
   * exactly that press, because it could not tell a re-calibration from a
   * second zone. `zoneNotices` is that discriminator.
   */
  zoneNotices: ZoneNotice[];
};

/*
 * `printedScale` WAS A FIELD ON `PlanSheet` AND THAT MADE IT UNREACHABLE.
 * Removed 2026-10-04, after clicking it.
 *
 * A `PlanSheet` is built from a `TakeoffPlanPage` row, and the ONLY thing in
 * the app that creates one of those is the calibration-save upsert
 * (`actions/takeoff.ts`). Plan ingestion does not: it writes `PlanSheetText`
 * and `PlanSheetProposal`, never a page row. So a sheet nobody has calibrated
 * yet has no `PlanSheet` at all — `sheets.find(...)` returns null, and the
 * title-block scale read off it was null exactly when it was needed, which is
 * the FIRST calibration of a sheet.
 *
 * Everything else in the dialog kept working and that is why it looked fine:
 * the scale readback, the sheet width and the error band are computed from the
 * draft line and the live `pageWidthPt`, none of which touch a stored row. The
 * one addition that depended on one was the one nobody could see.
 *
 * It is a prop on the viewer now, keyed by page number — see
 * `PrintedScaleByPage`. The field is deleted rather than fixed in place so the
 * mistake cannot be made again: `sheet?.printedScale` is now a type error.
 */

/**
 * The title-block scale per page number, independent of whether anybody has
 * calibrated that page.
 *
 * Keyed by page number rather than by sheet id for that exact reason — a page
 * with no calibration has no sheet id to key on.
 */
export type PrintedScaleByPage = Record<number, string>;

/**
 * THE SCALE A SHEET DECLARED ABOUT ITSELF, ready to prefill the calibration
 * form — a line, a printed distance, and the evidence for both.
 *
 * It is a PREFILL and not a calibration, which is the whole safety of it. The
 * estimator sees the proposed line drawn over the dimension it was read from,
 * the figure in the box, and the sentence saying which dimensions agreed; then
 * they press the same button they press today. Nothing reaches a quantity
 * without somebody having agreed to it, and a scale error multiplies through
 * every wall on the sheet.
 */
export type ScalePrefill = {
  /** `1/8" = 1'-0"`. */
  scaleName: string;
  /** The line, in page-width units — the convention
   *  `TakeoffScaleCalibration` stores, so this is a copy and not a conversion. */
  xs: [number, number];
  ys: [number, number];
  /** What the drawing says that line is, in feet. */
  declaredFeet: number;
  /** The figure as PRINTED — `16' - 4 1/2"` — so it can be found on the sheet. */
  declaredText: string;
  /** Every dimension that agreed, as printed. */
  agreed: string[];
  /** How many dimensions were found on the page at all. */
  considered: number;
  /**
   * SET WHEN THIS SHEET IS A REDUCED PRINT AND THE SCALE HAS BEEN CORRECTED FOR
   * IT — the sentence to put on screen, naming both widths and what would have
   * gone wrong.
   *
   * A reduced print carries the FULL-SIZE scale name in its title block, so
   * taking that name at face value measures every length at a fraction of its
   * real size. The answer key's page 50 is exactly this: an 18in sheet in a 36in
   * set, no dimensions of its own to catch it, scored 32% — the worst of all
   * sixty pages. See `takeoff/reducedPrint.ts`.
   *
   * Undefined on every ordinary sheet, which is almost all of them.
   */
  reducedPrintCaution?: string;
  /**
   * WHETHER ANYTHING ON THE SHEET CONFIRMS THIS, and it changes what the screen
   * says rather than being metadata.
   *
   * `false` means the scale was read off a dimension printed on the drawing, and
   * the proposed line is that dimension's own line — so the estimator sees it
   * sitting on `16' - 4 1/2"` and checks it in two seconds.
   *
   * `true` means it came from the scale printed in the title block, and
   * **nothing on the sheet confirms it**. The line in that case is the sheet's
   * own width, which is honest arithmetic and not a dimension anybody drew, so
   * there is nothing to look at. Saying so is the condition this path was
   * approved under.
   */
  unconfirmed: boolean;
  /** How far the proposed line sits from the scale the sheet voted for, as a
   *  fraction. Shown, because a scale nobody can put a band on is one taken on
   *  faith. */
  inheritedError: number;
};

export type ScalePrefillByPage = Record<number, ScalePrefill>;

/** The shape the page query selects. Named so the query cannot drift from what
 *  this function needs. */
export type ScaleReadingRowForView = {
  pageNumber: number;
  scaleName: string | null;
  x1: number | null;
  y1: number | null;
  x2: number | null;
  y2: number | null;
  declaredDistanceFeet: unknown;
  declaredText: string | null;
  agreedText: string | null;
  consideredCount: number;
  inheritedError: number | null;
  source: string;
  /** Why this sheet yielded no scale, when it yielded none. Written by the
   *  reader since #655 and, until now, shown to nobody. */
  declineReason: string | null;
};

/**
 * The prefills a page can offer, keyed by page number.
 *
 * A ROW WITH A `declineReason` YIELDS NOTHING, and that is not the same as no
 * row: the reading exists, it says why it could not tell, and the form simply
 * behaves as it does today. Every field is checked rather than assumed present,
 * because a half-written row must not produce a line with one end.
 */
export function scalePrefillsFromReadings(
  rows: readonly ScaleReadingRowForView[],
  /**
   * Every page's sheet width, from `PlanSheetText`. Given it, a sheet that is a
   * clean fraction of the size the set is issued at has its PRINTED scale
   * corrected for the reduction — see `reducedPrintCaution`. Omitted, nothing
   * is corrected and the behaviour is exactly as before.
   */
  widthByPage: Readonly<Record<number, number>> = {},
): ScalePrefillByPage {
  const byPage: ScalePrefillByPage = {};
  // The size the office issues at, over whatever widths the caller supplied.
  const setWidth = setSheetWidth(Object.values(widthByPage));
  for (const row of rows) {
    if (byPage[row.pageNumber] !== undefined) continue;
    if (row.scaleName === null) continue;
    if (row.x1 === null || row.y1 === null || row.x2 === null || row.y2 === null) continue;
    const feet = Number(row.declaredDistanceFeet);
    if (!Number.isFinite(feet) || feet <= 0) continue;

    // Anything that is not an explicit `DIMENSIONS` reading is unconfirmed.
    // Defaulting the UNKNOWN case to "unconfirmed" is deliberate: a row written
    // by a build that did not have this column, or by one that grows a third
    // source later, must not quietly claim to be checkable.
    const unconfirmed = row.source !== "DIMENSIONS";

    // ── THE REDUCED-PRINT CORRECTION, AND ONLY ON AN UNCONFIRMED ROW ──
    //
    // A DIMENSIONS row was measured off the drawing, and a dimension cannot be
    // fooled by a reduction — reduce the sheet and both the line and its own
    // stated length come down together. So a measured scale is never touched
    // here, and the correction only ever improves a reading taken from a title
    // block with nothing checking it.
    let scaleName = row.scaleName;
    let declaredFeet = feet;
    let reducedPrintCaution: string | undefined;
    if (unconfirmed) {
      const print = reducedPrint(widthByPage[row.pageNumber] ?? 0, setWidth);
      if (print.factor !== 1) {
        // The printed row's own line IS the sheet width and its distance is the
        // feet across it, so the reduction multiplies the distance and leaves
        // the line alone. Recovering feet-per-inch from those two is what lets
        // the check work on a scale NAME without re-reading the page.
        const widthPt = widthByPage[row.pageNumber] ?? 0;
        const printedFeetPerInch = widthPt > 0 ? (feet / widthPt) * 72 : 0;
        const checked = printedScaleForSheet(printedFeetPerInch, print);
        if (checked.ok && checked.corrected) {
          scaleName = checked.scaleName;
          declaredFeet = feet * checked.factor;
          reducedPrintCaution = checked.caution;
        } else if (!checked.ok) {
          // The paper says reduced and the arithmetic lands on no real scale.
          // Neither reading is offered — a wrong scale is worse than none, and
          // the estimator is told to click a known distance.
          continue;
        }
      }
    }

    byPage[row.pageNumber] = {
      scaleName,
      xs: [row.x1, row.x2],
      ys: [row.y1, row.y2],
      declaredFeet,
      declaredText: row.declaredText ?? "",
      agreed: row.agreedText ? row.agreedText.split("\n").filter((line) => line.trim().length > 0) : [],
      considered: row.consideredCount,
      inheritedError: row.inheritedError ?? 0,
      unconfirmed,
      ...(reducedPrintCaution === undefined ? {} : { reducedPrintCaution }),
    };
  }
  return byPage;
}

/**
 * Build that map from plan-sheet proposals, NEWEST FIRST.
 *
 * The caller orders by `createdAt desc` and this keeps the first scale it sees
 * per page, because a re-run inserts rather than overwrites — proposals are
 * append-only, so the newest row is the current reading. There is no
 * `acceptedScale` to prefer: accepting a sheet writes only its number and
 * title, by design, so the proposal is the only record of what was printed.
 *
 * A proposal with no scale is skipped rather than stored as an empty string —
 * `standardScaleFromText` would return null for it anyway, but a key that
 * exists with nothing behind it invites a caller to treat presence as an
 * answer.
 */
export function printedScalesFromProposals(
  proposals: readonly { pageNumber: number; proposedScale: string | null }[],
): PrintedScaleByPage {
  const byPage: PrintedScaleByPage = {};
  for (const proposal of proposals) {
    if (proposal.proposedScale !== null && !(proposal.pageNumber in byPage)) {
      byPage[proposal.pageNumber] = proposal.proposedScale;
    }
  }
  return byPage;
}

export type ToolId = "pan" | "calibrate" | "linear" | "area" | "count";

/**
 * The measuring vocabulary, and it is deliberately the same three primitives
 * `takeoff-recipes.ts` consumes — plus the two that are not measurements at
 * all: moving around, and setting the scale.
 *
 * THERE IS NO CEILING TOOL. A traced polygon has an area, not a length and a
 * width, and inventing them from a bounding box is the guess this codebase
 * refuses everywhere else. Ceilings are typed on the estimate tab's own
 * takeoff form, and the page says so.
 */
export const TOOLS: { id: ToolId; label: string; hint: string }[] = [
  { id: "pan", label: "Move", hint: "Scroll and zoom the sheet without drawing on it." },
  {
    id: "calibrate",
    label: "Set scale",
    hint: "Click each end of a dimension printed on the drawing, then type what it says.",
  },
  { id: "linear", label: "Line", hint: "Click along a run. Every click adds a point; the length adds up as you go." },
  { id: "area", label: "Area", hint: "Click around the outline. It closes back to the first point." },
  { id: "count", label: "Count", hint: "Click each one. The name you give it becomes the line item." },
];

/**
 * HOW THE MEASURED ERROR IS WORDED, and it used to print a FLOOR as though it
 * were the measurement.
 *
 * The offer said `Within {band < 0.05 ? "0.05" : band.toFixed(2)}%`, so a pair
 * accurate to 0.01% was reported as "Within 0.05%" — while the note written
 * beside it said 0.01%, because that one formatted the real figure. A
 * click-through caught the two disagreeing and reported it as a defect, which
 * it is: one quantity shown two ways.
 *
 * Rounding up to a floor is fine in a progress bar and wrong in a number about
 * accuracy — it is the figure somebody decides on, and it overstated the error,
 * which makes the reader trust the feature less than the evidence warrants.
 *
 * Below a hundredth of a percent it says so as an INEQUALITY rather than
 * inventing a value, because `toFixed(2)` of 0.004 is "0.00" and that claims
 * perfection. It returns a string for exactly that reason: there is no decimal
 * expansion of "smaller than my precision".
 */
export function errorBandText(inheritedError: number): string {
  const band = inheritedError * 100;
  return band < 0.005 ? "under 0.01%" : `${band.toFixed(2)}%`;
}

/**
 * THE QUOTED DIMENSION GOES FIRST IN THE EVIDENCE ROW.
 *
 * The row shows the first few of what can be dozens of matched dimensions,
 * while the sentence under it quotes the ONE pair being proposed. On a sheet
 * with 24 matches the quoted dimension was not among the six shown — "Within
 * 0.17% on 25' - 0 1/2"" above a row that did not contain `25' - 0 1/2"`.
 *
 * Both halves were true and the pair read as a contradiction, which is worse
 * than showing fewer. Found by a click-through, which flagged it as a mismatch
 * rather than as a list being truncated — that is how it reads.
 */
export function evidenceOrder(agreed: readonly string[], declaredText: string, limit = 6): string[] {
  return [
    ...agreed.filter((text) => text === declaredText),
    ...agreed.filter((text) => text !== declaredText),
  ].slice(0, limit);
}

/**
 * ── THE ZOOM LADDER, AND WHY ITS BOTTOM MOVED ──
 *
 * These multiply the viewer's `BASE_SCALE` of 1.5, so the old floor of 0.5
 * rendered at 0.75 of full size. A 42-inch ARCH E sheet is 3,024pt wide, which
 * is about 2,270 CSS px at that scale — wider than the box it sits in. The
 * control read "50%" and the drawing still ran off the edge, with nothing
 * further out to press.
 *
 * Reported from a real plan set on 2026-10-07: "the area that displays the
 * plans is too small and cuts off most of the plans even when you zoom all the
 * way out to 50%". The percentage shown is this number and not the render
 * scale, which is why 50% was never half of anything.
 *
 * HERE RATHER THAN IN THE VIEWER because `TakeoffPlanViewer.tsx` is
 * `"use client"`, and such a module may export components, not plain values —
 * the client/server boundary census says so, and said so about `inchLabel` the
 * same way one commit earlier.
 */
export const ZOOM_STEPS = [0.15, 0.25, 0.33, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

/**
 * One step in or out from whatever is on screen NOW.
 *
 * Takes the CURRENT factor rather than an index, which is what lets − work
 * sensibly from a fitted sheet: a fitted 42-inch drawing sits at about 0.3, so
 * stepping out finds 0.25 rather than jumping to whichever index was last
 * selected. Fit is a computed scale and is not in this list, so an index could
 * not describe it at all.
 */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction === -1) {
    const smaller = ZOOM_STEPS.filter((step) => step < current - 0.001);
    // ── ALREADY SMALLER THAN THE SMALLEST STEP: STAY PUT ──
    //
    // This returned `ZOOM_STEPS[0]`, and on a big sheet that ZOOMS IN. A fitted
    // 42-inch drawing in a narrow window sits at 11%, below the 15% floor, so
    // pressing − took it to 15% — bigger — and then greyed the control out.
    // Reported from a real plan set the hour it shipped.
    //
    // Fit is a computed scale and can legitimately be below every step; the
    // honest answer there is that there is nothing further out.
    return smaller.length > 0 ? smaller[smaller.length - 1] : current;
  }
  const bigger = ZOOM_STEPS.filter((step) => step > current + 0.001);
  return bigger.length > 0 ? bigger[0] : current;
}

/**
 * THE SCALE THAT PUTS A WHOLE SHEET IN VIEW.
 *
 * ── BOTH DIMENSIONS, AND THE FIRST VERSION ONLY DID WIDTH ──
 *
 * That was a deliberate choice with a stated reason — sheets are landscape, so
 * width binds, and fitting height too would shrink a 42x30 on a laptop. It was
 * wrong, and reported within the hour of shipping: in a wide window Fit chose
 * 28%, matched the sheet's width exactly, and left a 724px drawing in a 382px
 * box with the top half cut off — labelled "Fit" the whole time.
 *
 * A control called Fit has one job. Whichever dimension binds, binds.
 *
 * PURE AND HERE rather than inline in the viewer, because a decision written
 * inside a component is a decision no test can reach — `errorBandText` and
 * `stepZoom` are here for the same reason, and a mutation proved this one
 * untestable where it was.
 *
 * `inset` is the scrollbar and the container's own padding, so a fit does not
 * leave a scrollbar that makes it look like it did not work.
 */
export function fitZoom(
  frame: { width: number; height: number },
  page: { widthPt: number; heightPt: number },
  baseScale: number,
  inset = 24,
): number {
  if (page.widthPt <= 0 || baseScale <= 0 || frame.width <= 0) return 1;
  const forWidth = (frame.width - inset) / (page.widthPt * baseScale);
  const forHeight =
    frame.height > 0 && page.heightPt > 0 ? (frame.height - inset) / (page.heightPt * baseScale) : forWidth;
  // Never zero or negative in a very small frame: the sheet would vanish.
  return Math.max(0.05, Math.min(forWidth, forHeight));
}

/** What a sheet says about why it has no scale, keyed by page number. */
export type ScaleDeclineByPage = Record<number, string>;

/**
 * ── WHY THIS SHEET OFFERED NOTHING, IN WORDS, ON THE SCREEN ──
 *
 * The reader has recorded a reason for every decline since #655 — "its lettering
 * was saved as line work rather than characters, so there is nothing here to
 * read a scale from. Set it by hand." — and it has been written to the database
 * and shown to NOBODY. The estimator got an empty form and no explanation.
 *
 * That matters more than it sounds on the sets that provoked it. Two whole bid
 * packages measured here have their text converted to outlines: 373,377 strokes
 * and ZERO text items on one sheet. Every sheet in both declines, so the app
 * looks broken on an entire project.
 *
 * It is not broken, and that is the point of saying so. The dimensions are still
 * PRINTED on those sheets — a person reads `24'-0"` perfectly well, it is simply
 * drawn as lines — so setting the scale by hand works exactly as it always has,
 * and the wall finder then works too: 150, 135 and 105 walls on three of those
 * sheets, measured. What was lost was the automatic scale, not the takeoff, and
 * an estimator who is told that will carry on in two clicks.
 *
 * A row with no reason yields nothing: silence is the right answer for a sheet
 * that simply has not been read yet, which is not the same as one that could not
 * be.
 */
export function scaleDeclinesFromReadings(rows: readonly ScaleReadingRowForView[]): ScaleDeclineByPage {
  const byPage: ScaleDeclineByPage = {};
  for (const row of rows) {
    if (byPage[row.pageNumber] !== undefined) continue;
    const reason = row.declineReason?.trim();
    if (!reason) continue;
    byPage[row.pageNumber] = reason;
  }
  return byPage;
}
