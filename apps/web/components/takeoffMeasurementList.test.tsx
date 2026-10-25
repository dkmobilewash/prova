// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TakeoffMeasurementList } from "./TakeoffMeasurementList";
import type { PlanMeasurementRow, PlanSheet } from "@/lib/takeoff-plan-view";

/**
 * "ADD TO THE ESTIMATE" WITH NOTHING TICKED HAS TO SAY WHY IT WON'T GO.
 *
 * A user walk on 2026-10-19 pressed it with no measured line ticked and got
 * nothing at all — no message — and then a "Leave site?" warning on the way
 * out, because the height they had typed marked the form dirty. The button was
 * disabled the whole time; nothing on screen said so in words, and a 60%
 * opacity yellow button still reads as pressable. A disabled control with no
 * reason is indistinguishable from a broken one.
 *
 * A render test (happy-dom does no layout, so this proves the words and the
 * disabled attribute, not where they sit).
 */

const calibration = { id: "cal_1", x1: 0.1, y1: 0.5, x2: 0.6, y2: 0.5, declaredDistanceFeet: 144, note: null };

const row = (over: Partial<PlanMeasurementRow> = {}): PlanMeasurementRow =>
  ({
    id: "m_1",
    kind: "LINEAR",
    xs: [0.1, 0.3],
    ys: [0.5, 0.5],
    label: "4-7/8\" wall",
    packageLabel: null,
    postedAt: null,
    calibration,
    outOfDate: false,
    scaleLabel: null,
    ...over,
  }) as unknown as PlanMeasurementRow;

const sheet = (measurements: PlanMeasurementRow[]): PlanSheet =>
  ({
    id: "page_1",
    pageNumber: 1,
    label: "",
    pageWidthPt: 3024,
    calibration,
    measurements,
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

function paint(measurements: PlanMeasurementRow[]) {
  act(() => {
    root.render(createElement(TakeoffMeasurementList, { jobId: "job_1", sheet: sheet(measurements), wallTypes: [] }));
  });
  return host;
}

const addButton = () =>
  [...host.querySelectorAll("button")].find((b) => /to the estimate/.test(b.textContent ?? "")) as
    | HTMLButtonElement
    | undefined;
const reason = () => host.querySelector('[data-takeoff="add-needs-lines"]');

describe("adding measured lines to the estimate", () => {
  it("rendered the list, rather than passing against an empty page", () => {
    paint([row()]);
    expect(addButton(), "no Add-to-the-estimate button rendered").toBeDefined();
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  });

  it("is disabled with nothing ticked, and SAYS so beside the button", () => {
    paint([row()]);
    expect(addButton()?.disabled).toBe(true);
    expect(reason()?.textContent).toContain("Tick the lines to add");
    // Tied to the button for a screen reader as well as for an eye.
    const describedBy = addButton()?.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")).toBe(reason());
  });

  it("drops the reason and enables once a line is ticked", () => {
    paint([row()]);
    const box = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => box.click());
    expect(addButton()?.disabled).toBe(false);
    expect(addButton()?.textContent).toContain("Add 1 to the estimate");
    expect(reason()).toBeNull();
  });

  it("says everything is already on the estimate when nothing is left to tick", () => {
    // Every row posted means every checkbox is disabled, so "tick the lines"
    // would be an instruction nobody can follow.
    paint([row({ postedAt: "2026-10-19T00:00:00.000Z" })]);
    expect(addButton()?.disabled).toBe(true);
    expect(reason()?.textContent).toContain("already on the estimate");
    expect(reason()?.textContent).not.toContain("Tick the lines");
  });
});
