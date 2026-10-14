// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TakeoffPlanViewer } from "./TakeoffPlanViewer";
import { storedWallsFor, type WallGroup } from "@/lib/takeoff/wallGroups";
import type { PlanSheet } from "@/lib/takeoff-plan-view";

/**
 * ── THE WALLS FOUND EARLIER ARE ON THE SHEET WITHOUT A PRESS ──
 *
 * The point of storing proposals. Detection runs when a calibration is saved,
 * and if the viewer did not read them back the work would have happened with
 * the panel still telling somebody to press a button — which is the "written,
 * documented, and never called" shape CLAUDE.md names, wearing a table.
 *
 * `takeoffWallFinder.test.tsx` asserts the SOURCE says the right things. This
 * renders it, because a census can tell you the code is there and never that
 * the framework honours it — the expo-router entry, and the lesson that the
 * decisive mutation is "make it render nothing".
 *
 * NOTHING HERE CAN SEE LAYOUT: happy-dom does no layout and returns zeros from
 * `getBoundingClientRect`. These assertions are about which groups are
 * PRESENT, never about where they sit.
 */

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

const calibrated = (pageNumber: number): PlanSheet => ({
  id: `page_${pageNumber}`,
  pageNumber,
  label: `A-10${pageNumber}`,
  pageWidthPt: 2592,
  calibration: {
    id: `cal_${pageNumber}`,
    x1: 0.1,
    y1: 0.1,
    x2: 0.6,
    y2: 0.1,
    declaredDistanceFeet: 24,
    note: null,
  },
  measurements: [],
  zoneNotices: [],
});

const group = (tag: string, feet: number): WallGroup => ({
  inches: 4.875,
  feet,
  runs: [
    {
      x1: 0.1,
      y1: 0.2,
      x2: 0.5,
      y2: 0.2,
      thicknessFeet: 0.40625,
      lengthFeet: feet,
    },
  ],
  source: { kind: "TAG", tag },
  candidates: [{ id: "t-a1", code: tag, name: `${tag} partition`, thicknessIn: 4.875, hasParts: true }],
});

/**
 * THE VIEWER ALWAYS OPENS ON PAGE 1 — `useState(1)`, with no prop to change it.
 *
 * That is why the cross-sheet case below stocks BOTH sheets rather than
 * rendering page 2: an assertion that page 2's walls are absent while page 2 is
 * never rendered at all passes whatever the seeding does. It was written that
 * way first and its own control caught it, which is the cheapest version of
 * this repo's rule that a check must be able to fail.
 */
function paint(sheets: PlanSheet[], storedWallsByPage: Record<number, WallGroup[]>) {
  act(() => {
    root.render(
      createElement(TakeoffPlanViewer, {
        jobId: "job_1",
        planId: "plan_1",
        sheets,
        printedScaleByPage: {},
        scalePrefillByPage: {},
        storedWallsByPage,
      } as never),
    );
  });
  return host;
}

describe("which stored walls a sheet may be seeded with", () => {
  // THE PURE HALF, and it exists because the rendered half CANNOT reach it: the
  // viewer opens on page 1 and its pager only appears once a real PDF reports
  // `numPages`, so no DOM test can put it on sheet 2. A mutation keying the
  // lookup to page 1 instead of to the current page passed every rendered case
  // for exactly that reason.
  const a1 = [group("A1", 120)];
  const ext = [group("EXT-1", 90)];

  it("TAKES THE PAGE IT IS ASKED FOR, which no rendered test can check", () => {
    expect(storedWallsFor({ 1: a1, 2: ext }, 2)).toBe(ext);
    expect(storedWallsFor({ 1: a1, 2: ext }, 1)).toBe(a1);
  });

  it("is null for a sheet with nothing stored", () => {
    expect(storedWallsFor({ 1: a1 }, 2)).toBeNull();
    expect(storedWallsFor(undefined, 1)).toBeNull();
    expect(storedWallsFor({}, 1)).toBeNull();
  });

  it("treats an EMPTY list as nothing to show, not as a finding", () => {
    // Seeding `[]` would swap "press to look for walls" for "none found", which
    // is a claim nobody made.
    expect(storedWallsFor({ 1: [] }, 1)).toBeNull();
  });
});

describe("walls found when the scale was saved are already on the sheet", () => {
  it("SHOWS THEM WITH NOTHING PRESSED, which is the whole point of storing them", () => {
    const body = paint([calibrated(1)], { 1: [group("A1", 120)] }).textContent ?? "";
    expect(body).toContain("A1");
    // And the empty state is gone — "press the button" and "here are the walls"
    // must not both be on screen.
    expect(body).not.toContain("No walls found on this sheet");
  });

  it("shows nothing when the sheet has nothing stored", () => {
    // The ordinary uncalibrated-or-undetected sheet. This is the control: if it
    // showed walls, the case above would prove nothing about the seeding.
    const body = paint([calibrated(1)], {}).textContent ?? "";
    expect(body).not.toContain("A1");
  });

  it("CLEARING THEM STICKS — the seeding does not undo it on the next render", () => {
    // The once-per-page guard, and the reason it is a ref rather than state:
    // without it the effect re-seeds the moment Clear empties the list, so the
    // button would visibly do nothing. React also double-invokes effects in
    // development, which is the other half of why a ref.
    const body = paint([calibrated(1)], { 1: [group("A1", 120)] });
    expect(body.textContent ?? "").toContain("A1");

    const clear = [...body.querySelectorAll("button")].find((button) =>
      (button.textContent ?? "").includes("Clear what was found"),
    );
    expect(clear, "the Clear control is not on screen").toBeDefined();
    act(() => clear!.click());

    expect(body.textContent ?? "", "the walls came back after Clear").not.toContain("A1");
  });

  it("TAKES THIS SHEET'S WALLS AND NOT THE NEXT SHEET'S", () => {
    // The #665 bug from the other direction: one press put the same dashed
    // overlay on three unrelated sheets, two of them drawn at 3" = 1'-0", so
    // the footage those lines implied was nonsense. Stored proposals are keyed
    // per page and must stay that way.
    //
    // BOTH SHEETS ARE STOCKED, which is what makes this able to fail: the
    // viewer opens on page 1, so a seeding that ignored the page key would put
    // EXT-1 on screen beside A1.
    const body =
      paint([calibrated(1), calibrated(2)], {
        1: [group("A1", 120)],
        2: [group("EXT-1", 90)],
      }).textContent ?? "";
    expect(body, "this sheet's own walls are missing").toContain("A1");
    expect(body, "the next sheet's walls were seeded onto this one").not.toContain("EXT-1");
  });
});
