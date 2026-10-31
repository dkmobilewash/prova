// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TakeoffPlanViewer } from "./TakeoffPlanViewer";
import type { PlanSheet, ScalePrefill } from "@/lib/takeoff-plan-view";

/**
 * THE SCALE THE SHEET ALREADY READ HAS TO BE OFFERED WHERE THE PERSON IS LOOKING.
 *
 * A user walk on 2026-10-19 opened fixture S03, which prints 1/8" = 1'-0" and
 * whose PAGE_INVENTORY reading matches five printed dimensions at that scale,
 * and the toolbar said only "Set the scale on this sheet before measuring" until
 * it was set by hand. The reading's offer (`ScaleOffer`) lived only INSIDE the
 * Set scale tool, so nothing on the sheet said one was waiting.
 *
 * The shortcut is a CONFIRMATION, not an apply: one press seeds the same line,
 * distance and provenance note the offer's own button does, and the person still
 * presses "Set the scale" — nothing is saved by this control.
 */

// S03's own reading, as `pageInventoryWork` produces it (run through the bench
// harness on 2026-10-25): source DIMENSIONS, 5 of 6 dimensions agreeing.
const s03: ScalePrefill = {
  scaleName: '1/8" = 1\'-0"',
  xs: [0.2847732843137255, 0.5828737745098039],
  ys: [0.46293913398692815, 0.46293913398692815],
  declaredFeet: 40.541666666666664,
  declaredText: "40'-6 1/2\"",
  agreed: ["16'-3 1/4\"", "24'-3 1/4\"", "40'-6 1/2\"", "12'-3 1/4\"", "28'-6 1/2\""],
  considered: 6,
  inheritedError: 0,
  unconfirmed: false,
} as ScalePrefill;

const sheet = (over: Partial<PlanSheet> = {}): PlanSheet =>
  ({
    id: "page_1",
    pageNumber: 1,
    label: "",
    pageWidthPt: 1224,
    calibration: null,
    measurements: [],
    zoneNotices: [],
    ...over,
  }) as unknown as PlanSheet;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function paint(sheets: PlanSheet[], scalePrefillByPage: Record<number, ScalePrefill>) {
  act(() => {
    root.render(
      createElement(TakeoffPlanViewer, {
        jobId: "job_1",
        planId: "plan_1",
        sheets,
        printedScaleByPage: {},
        scannedPages: [],
        scalePrefillByPage,
      } as never),
    );
  });
  return host;
}

const shortcut = () => host.querySelector('[data-takeoff="use-sheet-scale"]') as HTMLButtonElement | null;
const input = (name: string) => host.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;

describe("the sheet's own scale, offered from the toolbar", () => {
  it("rendered a real viewer, rather than passing against an empty page", () => {
    paint([sheet()], {});
    expect(host.querySelector("canvas")).not.toBeNull();
    expect(host.textContent).toContain("Set the scale on this sheet before measuring.");
  });

  it("names the scale the sheet read, on an uncalibrated sheet", () => {
    paint([sheet()], { 1: s03 });
    expect(shortcut(), "no shortcut to the sheet's own scale").not.toBeNull();
    expect(shortcut()?.textContent).toContain('1/8" = 1\'-0"');
  });

  it("is absent with no reading, and absent once a scale is set", () => {
    paint([sheet()], {});
    expect(shortcut()).toBeNull();
    paint(
      [
        sheet({
          calibration: { id: "cal_1", x1: 0.1, y1: 0.5, x2: 0.6, y2: 0.5, declaredDistanceFeet: 144, note: null },
        } as Partial<PlanSheet>),
      ],
      { 1: s03 },
    );
    expect(shortcut()).toBeNull();
  });

  it("one press fills the scale form for confirmation — and saves nothing by itself", () => {
    paint([sheet()], { 1: s03 });
    expect(input("declaredDistanceFeet"), "the scale form was open before the press").toBeNull();
    act(() => shortcut()?.click());
    // The same figures the offer's own "Use this dimension" seeds.
    expect(input("declaredDistanceFeet")?.value).toBe("40'-6 1/2\"");
    expect(input("note")?.value).toContain("Matched 5 printed dimensions");
    expect(input("points")?.value).toBe(JSON.stringify({ xs: s03.xs, ys: s03.ys }));
    // Still the person's press to make.
    const save = [...host.querySelectorAll("button")].find((b) => b.textContent === "Set the scale");
    expect(save, "the confirming Set the scale button is not on screen").toBeDefined();
    expect(shortcut(), "the shortcut stays up while the form it opened is showing").toBeNull();
  });

  it("says a title-block scale is the PRINTED one when nothing confirmed it", () => {
    paint([sheet()], { 1: { ...s03, unconfirmed: true, agreed: [], considered: 0, declaredText: s03.scaleName } });
    expect(shortcut()?.textContent).toContain('Use printed scale 1/8" = 1\'-0"');
    act(() => shortcut()?.click());
    expect(input("note")?.value).toContain("Nothing measurable on the sheet confirmed it");
  });
});
