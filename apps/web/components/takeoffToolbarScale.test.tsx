// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ToolbarScaleOffer } from "./TakeoffPlanViewer";

const viewer = readFileSync(new URL("./TakeoffPlanViewer.tsx", import.meta.url), "utf8");

describe("the printed scale on the toolbar", () => {
  it("names the scale and can be pressed", () => {
    const onUse = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    act(() => createRoot(host).render(createElement(ToolbarScaleOffer, { prefill: { scaleName: '1/8" = 1\'-0"' } as never, onUse })));
    const button = host.querySelector('[data-takeoff="toolbar-scale-offer"]') as HTMLButtonElement;
    expect(button.textContent).toBe('Use the printed scale 1/8" = 1\'-0"');
    act(() => button.click());
    expect(onUse).toHaveBeenCalledOnce();
  });
  it("shows only on a sheet with no scale yet, and a reduced print stops at its caution", () => {
    expect(viewer).toMatch(/!calibration && tool !== "calibrate" && scalePrefillByPage\[pageNumber\] && \(\s*<ToolbarScaleOffer/);
    expect(viewer).toMatch(/prefill\.reducedPrintCaution === undefined\) applyPrefill\(prefill\)/);
  });
  it("a scanned sheet opens no other sheets for its template", () => {
    expect(viewer).toMatch(/for \(const n of raster \? \[\] : pagesToSample\(/);
  });
});
