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

/** A calibration as the viewer needs it: the drawn line plus the distance it
 * was declared to be, with the Decimal already turned into a number by the
 * page that read it. */
export type PlanViewerCalibration = StoredCalibration & { id: string };

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
};

/**
 * The prefills a page can offer, keyed by page number.
 *
 * A ROW WITH A `declineReason` YIELDS NOTHING, and that is not the same as no
 * row: the reading exists, it says why it could not tell, and the form simply
 * behaves as it does today. Every field is checked rather than assumed present,
 * because a half-written row must not produce a line with one end.
 */
export function scalePrefillsFromReadings(rows: readonly ScaleReadingRowForView[]): ScalePrefillByPage {
  const byPage: ScalePrefillByPage = {};
  for (const row of rows) {
    if (byPage[row.pageNumber] !== undefined) continue;
    if (row.scaleName === null) continue;
    if (row.x1 === null || row.y1 === null || row.x2 === null || row.y2 === null) continue;
    const feet = Number(row.declaredDistanceFeet);
    if (!Number.isFinite(feet) || feet <= 0) continue;
    byPage[row.pageNumber] = {
      scaleName: row.scaleName,
      xs: [row.x1, row.x2],
      ys: [row.y1, row.y2],
      declaredFeet: feet,
      declaredText: row.declaredText ?? "",
      agreed: row.agreedText ? row.agreedText.split("\n").filter((line) => line.trim().length > 0) : [],
      considered: row.consideredCount,
      inheritedError: row.inheritedError ?? 0,
      // Anything that is not an explicit `DIMENSIONS` reading is unconfirmed.
      // Defaulting the UNKNOWN case to "unconfirmed" is deliberate: a row
      // written by a build that did not have this column, or by one that grows a
      // third source later, must not quietly claim to be checkable.
      unconfirmed: row.source !== "DIMENSIONS",
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
