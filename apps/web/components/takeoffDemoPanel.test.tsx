// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/actions", () => ({ saveDemoTakeoff: vi.fn() }));
const { TakeoffDemoPanel } = await import("./TakeoffDemoPanel");
const run = (lengthFeet: number) => ({ x1: lengthFeet / 1000, y1: 0, x2: 0.5, y2: 0, lengthFeet, thicknessIn: 5 });

function panel(props: object) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const base = { jobId: "j", pageId: "p", dropped: new Set<number>(), onToggle: () => {}, onClear: () => {}, onSaved: () => {} };
  act(() => root.render(createElement(TakeoffDemoPanel, { ...base, ...props } as never)));
  return host;
}

describe("the demolition panel", () => {
  it("totals only the runs still ticked, and Save can be pressed", () => {
    const host = panel({ state: { busy: false, error: null, read: { runs: [run(10), run(20)], doors: [{ x: 0, y: 0, code: "20" }], doorsTypical: false, skippedViews: [] } }, dropped: new Set([1]) });
    expect(host.querySelector('[data-takeoff="demo-total"]')?.textContent).toBe("1 wall to remove, 10 ft · 1 door");
    expect((host.querySelector('[data-takeoff="demo-save"]') as HTMLButtonElement).disabled).toBe(false);
  });
  it("says when doors must be counted by hand, and what TYP. means", () => {
    expect(panel({ state: { busy: false, error: null, read: { runs: [run(10)], doors: [], doorsTypical: false, skippedViews: [] } } }).textContent).toMatch(/No keynote names a door/);
    expect(panel({ state: { busy: false, error: null, read: { runs: [], doors: [{ x: 0, y: 0, code: "20" }], doorsTypical: true, skippedViews: [] } } }).textContent).toMatch(/more doors than tags/);
  });
  it("Save is off when nothing is kept", () => {
    const host = panel({ state: { busy: false, error: null, read: { runs: [run(10)], doors: [], doorsTypical: false, skippedViews: [] } }, dropped: new Set([0]) });
    expect((host.querySelector('[data-takeoff="demo-save"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
