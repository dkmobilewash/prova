// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanSheet } from "@/lib/takeoff-plan-view";

// Every root is unmounted after its test, so nothing React scheduled outlives the
// test environment (#936: "window is not defined" in the scheduler after teardown).
const roots: Root[] = [];
const mount = (host: Element) => { const root = createRoot(host); roots.push(root); return root; };
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

const compare = vi.fn(async () => ({
  ok: true as const,
  value: { earlier: "bid set.pdf", added: [{ x1: 0.2, y1: 0.1, x2: 0.2, y2: 0.3 }], removed: [{ x1: 0.4, y1: 0.1, x2: 0.4, y2: 0.3 }], truncated: false, agreement: 0.99, changedItems: [] },
}));
vi.mock("@/lib/actions/takeoffRevisions", () => ({ compareSheetRevision: compare }));
const { TakeoffPlanViewer } = await import("./TakeoffPlanViewer");
const { RevisionOverlay } = await import("./TakeoffRevisionPanel");

const sheet = { id: "page_1", pageNumber: 1, label: "", pageWidthPt: 3024, calibration: null, measurements: [], zoneNotices: [] } as unknown as PlanSheet;
function paint(earlierVersionByPage?: Record<number, string>) {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => mount(host).render(createElement(TakeoffPlanViewer, { jobId: "job_1", planId: "plan_1", sheets: [sheet], printedScaleByPage: {}, scannedPages: [], scalePrefillByPage: {}, earlierVersionByPage } as never)));
  return host;
}

describe("Compare with earlier version", () => {
  it("is not offered for a sheet with no earlier version", () => {
    expect(paint().querySelector('[data-takeoff="compare-revision"]')).toBeNull();
    expect(paint({ 2: "bid set.pdf" }).querySelector('[data-takeoff="compare-revision"]')).toBeNull();
  });
  // The viewer draws its SVG only once a PDF has loaded, which happy-dom cannot do, so the overlay is rendered on its own.
  it("draws removed lines dashed and added lines solid", () => {
    const host = document.createElement("div");
    act(() => mount(host).render(createElement("svg", null, createElement(RevisionOverlay, { result: { added: [{ x1: 0, y1: 0, x2: 1, y2: 0 }], removed: [{ x1: 0, y1: 1, x2: 1, y2: 1 }, { x1: 0, y1: 2, x2: 1, y2: 2 }] }, strokePx: 2 }))));
    expect([...host.querySelectorAll("line")].map((l) => [l.getAttribute("data-change"), l.getAttribute("stroke-dasharray")])).toEqual([["removed", "4 3"], ["removed", "4 3"], ["added", null]]);
  });
  it("opens the panel with what changed", async () => {
    const host = paint({ 1: "bid set.pdf" });
    await act(async () => (host.querySelector('[data-takeoff="compare-revision"]') as HTMLButtonElement).click());
    expect(compare).toHaveBeenCalledWith("job_1", "plan_1", 1);
    expect(host.querySelector('[data-takeoff="revision-panel"]')?.textContent).toContain("Compared with bid set.pdf");
  });
});
