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
};

export type PlanSheet = {
  id: string;
  pageNumber: number;
  label: string | null;
  pageWidthPt: number | null;
  /** The newest calibration on this sheet, or null when nobody has set one. */
  calibration: PlanViewerCalibration | null;
  measurements: PlanMeasurementRow[];
};

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
