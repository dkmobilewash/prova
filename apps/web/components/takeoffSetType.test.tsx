// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WallGroup } from "@/lib/takeoff/wallGroups";
import type { PlanSheet } from "@/lib/takeoff-plan-view";

// "Set type" on an untyped group: one press per legend code, the group's runs
// sent, and the group leaves the list. Rendered, not read off the source.
const setWallGroupType = vi.fn(async () => ({ ok: true as const }));
const clearWallGroupType = vi.fn(async () => ({ ok: true as const, value: { moved: [] } }));
vi.mock("@/lib/actions", async (original) => ({ ...(await original<object>()), setWallGroupType, clearWallGroupType }));
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

let undoable: { label: string; undo: () => Promise<{ ok: boolean }>; inPlace?: boolean }[] = [];
function paint(legendCodes: string[]) {
  undoable = [];
  act(() => {
    root.render(createElement(TakeoffPlanViewer, { jobId: "job_1", planId: "plan_1", sheets: [sheet], printedScaleByPage: {}, scannedPages: [], scalePrefillByPage: {}, storedWallsByPage: { 1: [untyped] }, legendCodes, wallTypes: [], onUndoable: (entry: (typeof undoable)[number]) => undoable.push(entry) } as never));
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
    // It stays, typed, with Clear type (Chrome's re-test: it vanished until a reload).
    expect(host.querySelector('[data-takeoff="found-group"]')).not.toBeNull();
    expect(host.querySelector('[data-takeoff="group-typed-as"]')?.textContent).toBe("C8");
    expect(chips()).toHaveLength(0);
  });

  it("Clear type takes the type off: the action runs and the codes are offered again", async () => {
    paint(["A", "B", "C8"]);
    await act(async () => chips()[2]!.click());
    await act(async () => (host.querySelector('[data-takeoff="group-clear-type"]') as HTMLButtonElement).click());
    expect(clearWallGroupType).toHaveBeenCalledWith("job_1", { planId: "plan_1", pageNumber: 1, runs: [{ x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.2 }] });
    expect(host.querySelector('[data-takeoff="group-typed"]')).toBeNull();
    expect(chips().map((b) => b.textContent)).toEqual(["A", "B", "C8"]);
  });

  it("a type set by mistake is undone: Set type pushes an Undo, and Undo clears it in place", async () => {
    paint(["A", "B", "C8"]);
    await act(async () => chips()[2]!.click());
    expect(undoable.map((e) => [e.label, e.inPlace])).toEqual([["Set type C8", true]]);
    clearWallGroupType.mockClear();
    await act(async () => void (await undoable[0]!.undo()));
    expect(clearWallGroupType).toHaveBeenCalledTimes(1);
    expect(chips().map((b) => b.textContent)).toEqual(["A", "B", "C8"]);
  });

  it("offers nothing when no legend was read", () => {
    paint([]);
    expect(host.querySelector('[data-takeoff="found-group"]')).not.toBeNull();
    expect(chips()).toHaveLength(0);
  });
});
