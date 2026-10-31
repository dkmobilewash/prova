// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { TakeoffPlanViewer } from "./TakeoffPlanViewer";

function viewer(label: string | undefined) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(TakeoffPlanViewer, { jobId: "j", planId: "p", sheets: [], printedScaleByPage: {}, scannedPages: [], scalePrefillByPage: {}, sheetLabelByPage: label ? { 1: label } : {} } as never)));
  const button = host.querySelector('[data-takeoff="find-demolition"]') as HTMLButtonElement | null;
  const out = { shown: button !== null, disabled: button?.disabled, title: button?.title };
  act(() => root.unmount());
  host.remove();
  return out;
}

describe("Find demolition on the toolbar", () => {
  it("shows on a demolition sheet, and waits for a scale with the reason in its title", () => {
    const seen = viewer("AD101 · FIRST FLOOR - DEMOLITION");
    expect(seen.shown).toBe(true);
    expect(seen.disabled).toBe(true);
    expect(seen.title).toMatch(/Set the scale/);
  });
  it("is absent on a floor plan", () => {
    expect(viewer("A101 · FLOOR PLAN").shown).toBe(false);
  });
});
