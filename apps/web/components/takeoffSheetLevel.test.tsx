// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TakeoffPlanViewer } from "./TakeoffPlanViewer";
import type { PlanSheet } from "@/lib/takeoff-plan-view";

/**
 * THE SHEET'S FLOOR HAS TO BE ON THE SCREEN SOMEBODY TRACES FROM.
 *
 * A RENDER test per #665 — a label computed in a server component, threaded
 * through two props and rendered in no branch anybody reaches is the exact
 * shape that PR shipped. The value is derived at read time and stored nowhere,
 * so there is no row to look at afterwards and notice it missing.
 */

const sheet = (pageNumber = 1): PlanSheet =>
  ({
    id: `page_${pageNumber}`,
    pageNumber,
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

function paint(levelByPage?: Record<number, string>) {
  act(() => {
    root.render(
      createElement(TakeoffPlanViewer, {
        jobId: "job_1",
        planId: "plan_1",
        sheets: [sheet(1)],
        printedScaleByPage: {},
        scalePrefillByPage: {},
        levelByPage,
      } as never),
    );
  });
  return host;
}

const label = (el: HTMLElement) => el.querySelector('[data-takeoff="sheet-level"]');

describe("the sheet's floor on the takeoff toolbar", () => {
  it("is shown when the sheet's title named one", () => {
    const found = label(paint({ 1: "Level 2" }));
    expect(found).not.toBeNull();
    expect(found?.textContent).toBe("Level 2");
    expect((found as HTMLElement).hidden).toBe(false);
  });

  it("IS SILENT WHEN NO FLOOR WAS READ, rather than saying so on every sheet", () => {
    // A single-storey job has no levels, and "no level" printed on every sheet
    // of it is noise. Silence is also what a sheet naming TWO floors gets —
    // see `sheetLevel.ts` for why that is a decline rather than a guess.
    expect(label(paint({}))).toBeNull();
    expect(label(paint())).toBeNull();
  });

  it("shows this sheet's floor, not another sheet's", () => {
    expect(label(paint({ 2: "Level 7" }))).toBeNull();
  });

  it("LOOKS THE FLOOR UP BY THE PAGE BEING VIEWED, which only a census can check", () => {
    // Found by mutation: hardcoding the lookup to page 1 passed every render
    // test here, and on a 50-page set would print the first sheet's floor on
    // every sheet — mislabelling quantities with total confidence.
    //
    // A RENDER test cannot catch it. The pager only exists once a PDF has
    // loaded its page count, happy-dom cannot load a PDF, so the viewer is
    // stuck on page 1 and `[pageNumber]` and `[1]` are the same expression.
    // This is a census standing in for a browser, and it says so: it can see
    // that the key is the variable, and it cannot see that the variable is
    // right.
    const source = readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8");
    expect(source).toContain("levelByPage?.[pageNumber] !== undefined");
    expect(source).toContain("{levelByPage[pageNumber]}");
  });

  it("leaves the rest of the toolbar alone", () => {
    const el = paint({ 1: "Roof" });
    expect(el.querySelector('[data-takeoff="find-walls"]')).not.toBeNull();
    // The room finder is deliberately NOT on the toolbar — it shipped in #702
    // and was taken off the same day for reporting 4,555 sf on a building
    // about 290 ft across. `takeoffRoomFinder.test.tsx` holds it off.
    expect(el.querySelector('[data-takeoff="find-rooms"]')).toBeNull();
  });
});

describe("the call site", () => {
  it("PASSES levelByPage, or the label is on no screen at all", () => {
    // #665, one prop deep: every test above passes while the single place the
    // viewer is rendered forgets to hand the value over. The page is a server
    // component with database queries in it and cannot be rendered here, so
    // this reads it.
    const source = readFileSync(
      resolve(process.cwd(), "app/(app)/jobs/[id]/(tabs)/takeoff/page.tsx"),
      "utf8",
    );
    expect(source).toContain("levelByPage={levelByPage}");
    // And it is actually computed, not an empty object somebody left behind.
    expect(source).toContain("levelsByPage(");
  });
});
