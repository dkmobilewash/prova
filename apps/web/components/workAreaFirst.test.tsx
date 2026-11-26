// @vitest-environment happy-dom
/**
 * Diego's audit order (2026-11-25), coordination/work-area-first.md W1-W4, through the real viewer and bar: a sheet
 * that shows existing work OPENS with the work-area prompt, before Find, and keeps it until a work area exists.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TakeoffPlanViewer } from "./TakeoffPlanViewer";
import { TakeoffExclusionBar } from "./TakeoffExclusionBar";
import type { PlanSheet } from "@/lib/takeoff-plan-view";

const actions = vi.hoisted(() => ({
  addSheetExclusion: vi.fn(async () => ({ ok: true, value: { ids: ["row_new"] } })),
  clearSheetExclusions: vi.fn(async () => ({ ok: true, value: { ids: [] } })),
  removeSheetExclusion: vi.fn(async () => ({ ok: true, value: { ids: [] } })),
}));
vi.mock("@/lib/actions/takeoffExclusions", () => actions);

const WORDS = "Draw your work area: walls outside it won't be counted";
const area = { id: "row_area", kind: "WORK_AREA", xs: [0.1, 0.5, 0.5], ys: [0.1, 0.1, 0.5] };
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
        renovationByPage: { 1: ["(E)", "DEMO"] },
        ...extra,
      } as never),
    );
  });
}
const q = (name: string) => host.querySelector<HTMLElement>(`[data-takeoff="${name}"]`);
const press = (el: HTMLElement) => act(async () => void el.click());

describe("W1: the sheet opens with the work-area prompt", () => {
  it("before Find, in the order's words, with the two exits", () => {
    viewer([]);
    expect(q("found-walls")).toBeNull();
    expect(q("renovation-prompt")?.textContent).toContain(WORDS);
    expect(q("renovation-work-area")?.textContent).toBe("Draw work area");
    expect(q("renovation-whole-sheet")?.textContent).toBe("Whole sheet is new work");
  });
  it("not on a new-build sheet", () => {
    viewer([], { renovationByPage: {} });
    expect(q("renovation-prompt")).toBeNull();
  });
});

describe("W2: it stays until a work area exists", () => {
  it("an exclusion of walls drawn like one does not dismiss it", () => {
    viewer([like]);
    expect(q("renovation-prompt")?.textContent).toContain(WORDS);
  });
  it("a drawn work area does", () => {
    viewer([area]);
    expect(q("renovation-prompt")).toBeNull();
  });
});

describe("W3: Whole sheet is new work", () => {
  it("writes one work area over the whole sheet, and the prompt goes", async () => {
    viewer([]);
    await press(q("renovation-whole-sheet")!);
    expect(actions.addSheetExclusion).toHaveBeenCalledTimes(1);
    const [jobId, pageId, kind, xs, ys] = actions.addSheetExclusion.mock.calls[0] as unknown as [string, string, string, number[], number[]];
    expect([jobId, pageId, kind]).toEqual(["job_1", "page_1", "WORK_AREA"]);
    expect(Math.min(...xs)).toBeLessThanOrEqual(0);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(1.5);
    expect(q("renovation-prompt")).toBeNull();
  });
});

describe("W3-W4: the bar says what the work area did", () => {
  const bar = (props: Partial<Parameters<typeof TakeoffExclusionBar>[0]> = {}) =>
    act(() => {
      root.render(createElement(TakeoffExclusionBar, { feet: 3100, aside: [], excludes: 0, workAreas: 1, readOnly: false, onUndo: vi.fn(), onClear: vi.fn(), ...props } as never));
    });
  it("the feet a drawn area leaves out, live: −1,240 ft not in your work area", () => {
    bar({ outsideFeet: 1240.4 } as never);
    expect(q("not-in-work-area")?.textContent).toBe("−1,240 ft not in your work area");
  });
  it("the whole sheet as new work reads so, with nothing to subtract", () => {
    bar({ wholeSheet: true, outsideFeet: 0 } as never);
    expect(q("whole-sheet-new")?.textContent).toContain("Whole sheet is new work");
    expect(q("not-in-work-area")).toBeNull();
  });
});

describe("W3 follow-up: Whole sheet is new work says it is working, and a second press does nothing", () => {
  // Production, 2026-11-25 (dpl_654pQyLx): the screen did not change for 5-20 s after the press, with no busy state.
  it("goes busy at once and ignores a second press while the save runs", async () => {
    let finish: (v: unknown) => void = () => {};
    actions.addSheetExclusion.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)) as never);
    viewer([]);
    await press(q("renovation-whole-sheet")!);
    const busy = q("renovation-whole-sheet") as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.textContent).toContain("Saving…");
    await press(busy);
    expect(actions.addSheetExclusion).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true, value: { ids: ["row_new"] } }));
  });
});

describe("W1 follow-up: before the sheet has a scale, the prompt says so and its buttons wait", () => {
  // Production, 2026-11-26 (dpl_H6dsLcJ2): with no scale yet the prompt showed and both buttons did nothing, because the
  // viewer has no sheet row until a scale is saved.
  it("keeps the words, says to set the scale first, and both exits are disabled", async () => {
    act(() => {
      root.render(
        createElement(TakeoffPlanViewer, {
          jobId: "job_1",
          planId: "plan_1",
          sheets: [],
          printedScaleByPage: {},
          scannedPages: [],
          scalePrefillByPage: {},
          panelOpen: false,
          renovationByPage: { 1: ["(E)"] },
        } as never),
      );
    });
    const prompt = q("renovation-prompt");
    expect(prompt?.textContent).toContain(WORDS);
    expect(prompt?.textContent).toContain("Set this sheet's scale first");
    expect((q("renovation-work-area") as HTMLButtonElement).disabled).toBe(true);
    expect((q("renovation-whole-sheet") as HTMLButtonElement).disabled).toBe(true);
    await press(q("renovation-whole-sheet")!);
    expect(actions.addSheetExclusion).not.toHaveBeenCalled();
  });
  it("enables both exits as soon as the scale lands, with no reload", () => {
    viewer([], { sheets: [] });
    expect((q("renovation-whole-sheet") as HTMLButtonElement).disabled).toBe(true);
    // The calibration saved: the same viewer, handed the sheet it now has.
    viewer([]);
    expect(q("renovation-prompt")?.textContent).not.toContain("Set this sheet's scale first");
    expect((q("renovation-work-area") as HTMLButtonElement).disabled).toBe(false);
    expect((q("renovation-whole-sheet") as HTMLButtonElement).disabled).toBe(false);
  });
});
