// @vitest-environment happy-dom
/**
 * Chrome on Baker A100: walls removed, and no total, sentence or way back,
 * because all of it lived in a panel that starts closed under 1440 px. So this
 * drives the real viewer with `panelOpen: false`.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TakeoffPlanViewer } from "./TakeoffPlanViewer";
import { TakeoffExclusionBar } from "./TakeoffExclusionBar";
import type { PlanSheet } from "@/lib/takeoff-plan-view";

const actions = vi.hoisted(() => ({
  addSheetExclusion: vi.fn(),
  clearSheetExclusions: vi.fn(async () => ({ ok: true, value: { ids: [] } })),
  removeSheetExclusion: vi.fn(async () => ({ ok: true, value: { ids: [] } })),
}));
vi.mock("@/lib/actions/takeoffExclusions", () => actions);

const area = { id: "row_area", kind: "WORK_AREA", xs: [0, 1, 1], ys: [0, 0, 1] };
const like = { id: "row_like", kind: "EXCLUDE_LIKE", xs: [0, 1], ys: [0, 0] };
const sheet = (exclusions: unknown[]): PlanSheet =>
  ({
    id: "page_1",
    pageNumber: 1,
    label: "",
    pageWidthPt: 3024,
    calibration: { id: "cal_1", x1: 0.1, y1: 0.5, x2: 0.6, y2: 0.5, declaredDistanceFeet: 144, note: null },
    measurements: [],
    zoneNotices: [],
    exclusions,
  }) as unknown as PlanSheet;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function viewer(exclusions: unknown[], extra: Record<string, unknown> = {}) {
  act(() => {
    root.render(
      createElement(TakeoffPlanViewer, {
        jobId: "job_1",
        planId: "plan_1",
        sheets: [sheet(exclusions)],
        printedScaleByPage: {},
        scannedPages: [],
        scalePrefillByPage: {},
        panelOpen: false,
        ...extra,
      } as never),
    );
  });
}
const q = (name: string) => host.querySelector<HTMLButtonElement>(`[data-takeoff="${name}"]`);
const press = (el: HTMLElement) => act(async () => void el.click());

describe("the way back from an exclusion, with the Quantities panel closed", () => {
  it("offers both controls on a sheet that loaded with exclusions, before anything is found", () => {
    viewer([area, like]);
    expect(q("found-walls")).toBeNull();
    expect(q("remove-work-area")?.textContent).toBe("Remove work area");
    expect(q("clear-exclusions")?.textContent).toBe("Clear exclusions");
  });
  it("offers Remove work area on the sheet's first paint, with no Find pressed", () => {
    // Server markup, because no effect runs in it: this IS the first paint.
    const html = renderToStaticMarkup(
      createElement(TakeoffPlanViewer, { jobId: "job_1", planId: "plan_1", sheets: [sheet([area])], printedScaleByPage: {}, scannedPages: [], scalePrefillByPage: {}, panelOpen: false } as never),
    );
    expect(html).toContain('data-takeoff="remove-work-area"');
  });
  it("removes the work area and leaves the exclusions", async () => {
    viewer([area, like]);
    await press(q("remove-work-area")!);
    expect(actions.clearSheetExclusions).toHaveBeenCalledWith("job_1", "page_1", "WORK_AREA");
    expect(q("remove-work-area")).toBeNull();
    expect(q("clear-exclusions")).not.toBeNull();
  });
  it("keeps the control when the save fails, and says so", async () => {
    actions.clearSheetExclusions.mockResolvedValueOnce({ ok: false, error: "Nope." } as never);
    viewer([area]);
    await press(q("remove-work-area")!);
    expect(q("remove-work-area")).not.toBeNull();
    expect(host.textContent).toContain("Nope.");
  });
  it("shows nothing on a sheet with no walls and no exclusions, or a phone's buttons", () => {
    viewer([]);
    expect(q("exclusion-bar")).toBeNull();
    viewer([area], { readOnly: true });
    expect(q("remove-work-area")).toBeNull();
  });
});

describe("the bar", () => {
  const bar = (props: Partial<Parameters<typeof TakeoffExclusionBar>[0]> = {}) => {
    const onUndo = vi.fn();
    act(() => {
      root.render(createElement(TakeoffExclusionBar, { feet: 1234.4, aside: [], excludes: 0, workAreas: 0, readOnly: false, onUndo, onClear: vi.fn(), ...props }));
    });
    return onUndo;
  };
  it("shows the total, also at zero, which is what removing every wall leaves", () => {
    bar();
    expect(q("wall-total")?.textContent).toBe("Walls on this sheet: 1,234 ft");
    bar({ feet: 0 });
    expect(q("wall-total")?.textContent).toBe("Walls on this sheet: 0 ft");
  });
  it("says what was set aside, and Undo takes back that kind", async () => {
    const onUndo = bar({
      excludes: 1,
      workAreas: 1,
      aside: [
        { kind: "excluded-like", why: "drawn like the wall you clicked", n: 3 },
        { kind: "outside-work-area", why: "outside the work area you drew", n: 1 },
      ],
    });
    expect(q("excluded-like")?.textContent).toContain("3 walls drawn like the wall you clicked.");
    expect(q("outside-work-area")?.textContent).toContain("1 wall outside the work area you drew.");
    await press(q("outside-work-area")!.querySelector("button")!);
    expect(onUndo).toHaveBeenCalledWith("WORK_AREA");
  });
});
