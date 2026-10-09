// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TakeoffPlanViewer } from "./TakeoffPlanViewer";
import type { PlanSheet } from "@/lib/takeoff-plan-view";

/**
 * THE ROOM FINDER'S CONTROL HAS TO BE ON THE SCREEN AN ESTIMATOR IS ON.
 *
 * Same shape as `takeoffWallFinder.test.tsx` and the same reason — #665 shipped
 * a button that existed, called the right action, sat in the right branch and
 * appeared on no screen anybody used. A census proves the code is THERE; only
 * rendering proves somebody can reach it.
 *
 * What this does NOT cover is the detection, which needs a real PDF and pdf.js.
 * That is measured in `roomAreas.test.ts` and against real drawings — the
 * numbers are in the changelog. This covers the seam: the button is reachable
 * when it can work, says why when it cannot, and ARMS A BOX rather than
 * running, which is the one thing about this feature a reader would not guess.
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

const findRooms = (el: HTMLElement) => el.querySelector('[data-takeoff="find-rooms"]') as HTMLButtonElement | null;

describe("the room finder's control", () => {
  it("is on the toolbar once the sheet is calibrated, AND NOT HIDDEN", () => {
    // `querySelector` finds a node with `hidden` on it just as happily as a
    // visible one — found by mutation: adding `hidden` to this button left
    // every assertion in this file green, which is #665 exactly, in the test
    // written to prevent #665.
    //
    // happy-dom does no layout, so this cannot see a button pushed off
    // screen or covered by something; it can see the ways a control gets
    // hidden IN THE SOURCE, which is how it has actually happened here.
    const button = findRooms(paint([sheet()]));
    expect(button).not.toBeNull();
    expect(button?.hidden).toBe(false);
    expect(button?.getAttribute("aria-hidden")).toBeNull();
    expect(button?.className).not.toContain("hidden");
  });

  it("is SHOWN BUT DISABLED with no scale set — visible, not hidden", () => {
    // The button beside it shipped hidden and was reported the same day: an
    // absence reads as "this feature does not exist", never as "this sheet
    // needs a scale first". The gate is structural either way — a room's size
    // bound is in square feet of building, so without a calibration it means
    // nothing.
    const button = findRooms(paint([sheet({ calibration: null } as Partial<PlanSheet>)]));
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
  });

  it("says WHY it is disabled rather than leaving somebody to guess", () => {
    const button = findRooms(paint([sheet({ calibration: null } as Partial<PlanSheet>)]));
    expect(button?.getAttribute("title")).toContain("Set the scale");
  });

  it("is enabled once the sheet has a scale", () => {
    expect(findRooms(paint([sheet()]))?.disabled).toBe(false);
  });

  it("says what it does in words an estimator reads, not a tool name", () => {
    expect(findRooms(paint([sheet()]))?.textContent).toBe("Find the rooms");
  });

  it("ARMS A BOX rather than running, and says so on the button", () => {
    // The one thing about this feature nobody would guess, so it is the one
    // thing the button has to say. Pressing it does not detect anything: it
    // waits for a box, because run over a whole sheet the region finder
    // cannot tell a floor plan from a notes panel — see `roomAreas.ts`, which
    // carries the three discriminators that were measured and failed.
    const el = paint([sheet()]);
    act(() => {
      findRooms(el)?.click();
    });
    expect(findRooms(el)?.textContent).toBe("Drag a box round the plan");
    // And nothing was detected by pressing it.
    expect(el.querySelector('[data-takeoff="rooms-panel"]')).toBeNull();
  });

  it("disarms when pressed again, so it is not a trap", () => {
    const el = paint([sheet()]);
    act(() => findRooms(el)?.click());
    act(() => findRooms(el)?.click());
    expect(findRooms(el)?.textContent).toBe("Find the rooms");
  });

  it("shows no results panel until it has been asked", () => {
    expect(paint([sheet()]).querySelector('[data-takeoff="rooms-panel"]')).toBeNull();
    expect(paint([sheet()]).querySelector('[data-takeoff="accept-rooms"]')).toBeNull();
  });

  it("leaves the wall finder alone", () => {
    // Both buttons sit on the same toolbar and the room one was added beside
    // it; a regression here is somebody deleting the wrong line.
    expect(paint([sheet()]).querySelector('[data-takeoff="find-walls"]')).not.toBeNull();
  });
});
