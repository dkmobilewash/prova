// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TakeoffPlanViewer } from "./TakeoffPlanViewer";
import type { PlanSheet } from "@/lib/takeoff-plan-view";

/**
 * THERE IS NO ROOM FINDER ON THE TAKEOFF TOOLBAR, AND THIS HOLDS IT THERE.
 *
 * #702 shipped one. It was clicked on real sheets the same day and its answer
 * was wrong in the way that matters most — confidently low. On a West Herr
 * floor plan it reported **46 rooms and 4,555 sf** for a building about 290 ft
 * across, having missed Showroom 101, Sales 103, Hospitality 105, New Car
 * Delivery 140 and the whole right-hand wing, while outlining a parked car,
 * the gaps between dimension strings, and two keynote tags.
 *
 * An estimator who trusts that bids half a building.
 *
 * ── WHY THIS FILE INVERTED INSTEAD OF BEING DELETED ──
 *
 * The old version of this file asserted the button WAS reachable, hidden
 * neither by an attribute nor a class, with a census of its call site. Every
 * one of those assertions was true the whole time the feature was broken,
 * because a control being reachable says nothing about whether its answer is
 * right. Deleting the file would leave nothing between the next person and
 * re-adding a button that is three lines of JSX away.
 *
 * `roomAreas.ts` and its own tests stay: the geometry is correct and the fix
 * is to WHAT REACHES IT — the room finder rasterises every stroke, including
 * the leader lines that cut a room in half and the dimension strings that
 * enclose one of their own. See its header and `wallsNotLettering` for the
 * filtering the wall finder has and this does not.
 *
 * When the numbers say it is fit to use, this file flips back.
 */

const sheet = (over: Partial<PlanSheet> = {}): PlanSheet =>
  ({
    id: "page_1",
    pageNumber: 1,
    label: "",
    pageWidthPt: 3024,
    calibration: {
      id: "cal_1",
      x1: 0.1,
      y1: 0.5,
      x2: 0.6,
      y2: 0.5,
      declaredDistanceFeet: 144,
      note: null,
    },
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

function paint(sheets: PlanSheet[]) {
  act(() => {
    root.render(
      createElement(TakeoffPlanViewer, {
        jobId: "job_1",
        planId: "plan_1",
        sheets,
        printedScaleByPage: {},
        scalePrefillByPage: {},
      } as never),
    );
  });
  return host;
}

describe("the room finder is off the toolbar", () => {
  it("OFFERS NO BUTTON, so nobody can take a wrong number off it", () => {
    const el = paint([sheet()]);
    expect(el.querySelector('[data-takeoff="find-rooms"]')).toBeNull();
    expect(el.textContent).not.toContain("Find the rooms");
    expect(el.textContent).not.toContain("Drag a box round the plan");
  });

  it("shows no results panel and no way to accept rooms", () => {
    const el = paint([sheet()]);
    expect(el.querySelector('[data-takeoff="rooms-panel"]')).toBeNull();
    expect(el.querySelector('[data-takeoff="accept-rooms"]')).toBeNull();
  });

  it("LEAVES THE WALL FINDER WORKING, which is the point of taking only this out", () => {
    // Wall detection is measured at 94.5% recall on real sheets and is not
    // affected: it has the stroke filtering the room finder lacks.
    const el = paint([sheet()]);
    const walls = el.querySelector('[data-takeoff="find-walls"]') as HTMLButtonElement | null;
    expect(walls).not.toBeNull();
    expect(walls?.disabled).toBe(false);
  });

  it("leaves the manual measuring tools alone", () => {
    // Tracing an area by hand is how this was done before #702 and how it is
    // done now. Nothing about that changed.
    const el = paint([sheet()]);
    expect(el.textContent).toContain("Area");
  });
});
