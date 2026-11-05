// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WallGroup } from "@/lib/takeoff/wallGroups";
import type { PlanSheet } from "@/lib/takeoff-plan-view";

// "Set type" on an untyped group: one press per legend code, the group's runs
// sent, and the group leaves the list. Rendered, not read off the source.
const setWallGroupType = vi.fn(async () => ({ ok: true as const }));
vi.mock("@/lib/actions", async (original) => ({ ...(await original<object>()), setWallGroupType }));
const { TakeoffPlanViewer } = await import("./TakeoffPlanViewer");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  setWallGroupType.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const sheet: PlanSheet = { id: "page_1", pageNumber: 1, label: "A-101", pageWidthPt: 2592, calibration: { id: "cal_1", x1: 0.1, y1: 0.1, x2: 0.6, y2: 0.1, declaredDistanceFeet: 24, note: null }, measurements: [], zoneNotices: [] };
const run = { x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.2, thicknessFeet: 7 / 12, lengthFeet: 19.2 };
const untyped: WallGroup = { inches: 7, feet: 19.2, runs: [run], source: { kind: "REMAINDER" }, candidates: [] } as unknown as WallGroup;

function paint(legendCodes: string[]) {
  act(() => {
    root.render(createElement(TakeoffPlanViewer, { jobId: "job_1", planId: "plan_1", sheets: [sheet], printedScaleByPage: {}, scannedPages: [], scalePrefillByPage: {}, storedWallsByPage: { 1: [untyped] }, legendCodes, wallTypes: [] } as never));
  });
  return host;
}
const chips = () => [...host.querySelectorAll('[data-takeoff="set-type-code"]')] as HTMLButtonElement[];

describe("Set type", () => {
  it("offers the set's legend codes on an untyped group, and one press saves the group as that type", async () => {
    paint(["A", "B", "C8"]);
    expect(chips().map((b) => b.textContent)).toEqual(["A", "B", "C8"]);
    await act(async () => chips()[2]!.click());
    expect(setWallGroupType).toHaveBeenCalledWith("job_1", { planId: "plan_1", pageNumber: 1, code: "C8", inches: 7, runs: [{ x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.2 }] });
    expect(host.querySelector('[data-takeoff="found-group"]')).toBeNull();
  });

  it("offers nothing when no legend was read", () => {
    paint([]);
    expect(host.querySelector('[data-takeoff="found-group"]')).not.toBeNull();
    expect(chips()).toHaveLength(0);
  });
});
