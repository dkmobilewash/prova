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
