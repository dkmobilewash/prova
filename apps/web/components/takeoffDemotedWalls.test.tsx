// @vitest-environment happy-dom
/**
 * The switch's two states on the viewer, before any check has run. What a
 * verdict does with the switch on is `lib/takeoff/demotedRuns.test.ts` (the
 * rule) and `e2e/specs/takeoff-demoted.spec.ts` (the wiring, in a browser):
 * the check crops a canvas, which happy-dom cannot do, so it is not driven
 * from here — and a test that stubbed the canvas to make it run would be
 * measuring the stub.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TakeoffPlanViewer } from "./TakeoffPlanViewer";
import type { PlanSheet } from "@/lib/takeoff-plan-view";

const sheet = (): PlanSheet =>
  ({
    id: "page_1",
    pageNumber: 1,
    label: "",
    pageWidthPt: 3024,
    calibration: { id: "cal_1", x1: 0.1, y1: 0.5, x2: 0.6, y2: 0.5, declaredDistanceFeet: 144, note: null },
    measurements: [],
    zoneNotices: [],
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
function paint(extra: Record<string, unknown> = {}) {
  act(() => {
    root.render(
      createElement(TakeoffPlanViewer, {
        jobId: "job_1",
        planId: "plan_1",
        sheets: [sheet()],
        printedScaleByPage: {},
        scannedPages: [],
        scalePrefillByPage: {},
        ...extra,
      } as never),
    );
  });
  return host;
}

describe("demote, don't hide — before a check", () => {
  it("shows no demoted panel and no grey line with the switch on, because nothing has been checked", () => {
    const el = paint({ demotedWalls: true });
    expect(el.querySelector('[data-takeoff="demoted"]')).toBeNull();
    expect(el.querySelector('[data-takeoff="demoted-wall"]')).toBeNull();
    expect(el.textContent).not.toContain("probably not a wall");
  });
  it("is absent with the switch off (the default), and the wall finder is untouched", () => {
    const el = paint();
    expect(el.querySelector('[data-takeoff="demoted"]')).toBeNull();
    const walls = el.querySelector('[data-takeoff="find-walls"]') as HTMLButtonElement | null;
    expect(walls).not.toBeNull();
    // Held only by the sheet's rendering (happy-dom draws no PDF), never by
    // the demote switch: the title names the sheet, not the switch.
    expect(walls?.disabled).toBe(true);
    expect(walls?.getAttribute("title")).toBe("The sheet is still loading.");
  });
});
