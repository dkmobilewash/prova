// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ToolbarScaleOffer } from "./TakeoffPlanViewer";

const viewer = readFileSync(`${process.cwd()}/components/TakeoffPlanViewer.tsx`, "utf8");

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
    // A sheet with no scale yet — or the one whose Sure scale was just saved here, so it can show it and offer Undo.
    expect(viewer).toMatch(/\(!calibration \|\| oneTapScalePage === pageNumber\) && tool !== "calibrate" && scalePrefillByPage\[pageNumber\] && \(\s*<ToolbarScaleOffer/);
    expect(viewer).toMatch(/prefill\.reducedPrintCaution === undefined\) applyPrefill\(prefill\)/);
  });
  it("is wired to save and undo through the server actions", () => {
    expect(viewer).toMatch(/save=\{\(\) => saveSureScale\(jobId, planId, pageNumber\)\}/);
    expect(viewer).toMatch(/undo=\{\(calibrationId\) => undoSheetScale\(jobId, planId, calibrationId\)\}/);
  });
  it("a scanned sheet opens no other sheets for its template", () => {
    expect(viewer).toMatch(/for \(const n of raster \? \[\] : pagesToSample\(/);
  });
});

// ── A SURE SCALE SAVES IN ONE PRESS (Diego, 2026-11-12) ──
// Joplin's A-101 (1/8", 70 of 223 printed dimensions) took three presses: this button, "Use this
// dimension", "Set the scale". A Sure reading now saves here and shows what it saved, with Undo.
const SURE = { scaleName: '1/8" = 1\'-0"', xs: [0.46, 0.715], ys: [0.066, 0.066], declaredFeet: 73.5, declaredText: "73'-6\"", agreed: Array(70).fill("x"), considered: 223, unconfirmed: false, inheritedError: 0.0006 };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
function mount(prefill: object) {
  const calls = { onUse: vi.fn(), save: vi.fn(async () => ({ ok: true as const, value: { calibrationId: "cal1" } })), undo: vi.fn(async () => ({ ok: true as const })), onSaved: vi.fn(), onUndone: vi.fn() };
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(createElement(ToolbarScaleOffer, { prefill: prefill as never, ...calls })));
  const q = (hook: string) => host.querySelector(`[data-takeoff="${hook}"]`) as HTMLButtonElement | null;
  return { calls, host, q };
}

describe("a Sure scale saves from the toolbar in one press", () => {
  it("saves on the press — no Set scale panel — and says the scale and the dimension it came from", async () => {
    const { calls, q } = mount(SURE);
    act(() => q("toolbar-scale-offer")!.click());
    await flush();
    expect(calls.save).toHaveBeenCalledOnce();
    expect(calls.onUse).not.toHaveBeenCalled();
    expect(calls.onSaved).toHaveBeenCalledOnce();
    const said = q("toolbar-scale-saved")!.textContent!;
    expect(said).toContain('1/8" = 1\'-0"');
    expect(said).toContain("73'-6\"");
    expect(said).toContain("70 of 223");
  });

  it("Undo takes that scale back and offers the scale again", async () => {
    const { calls, q } = mount(SURE);
    act(() => q("toolbar-scale-offer")!.click());
    await flush();
    act(() => q("toolbar-scale-undo")!.click());
    await flush();
    expect(calls.undo).toHaveBeenCalledWith("cal1");
    expect(calls.onUndone).toHaveBeenCalledOnce();
    expect(q("toolbar-scale-offer")).not.toBeNull();
  });

  it("a refused Undo (the scale is in use) keeps the saved scale and says why", async () => {
    const { calls, q, host } = mount(SURE);
    calls.undo.mockResolvedValueOnce({ ok: false, error: "That scale is already in use on this sheet, so it stays." } as never);
    act(() => q("toolbar-scale-offer")!.click());
    await flush();
    act(() => q("toolbar-scale-undo")!.click());
    await flush();
    expect(q("toolbar-scale-saved")).not.toBeNull();
    expect(host.textContent).toContain("already in use");
  });

  it.each([
    ["a printed scale (nothing on the sheet confirms it)", { unconfirmed: true }],
    ["a reduced print", { reducedPrintCaution: "This sheet is a half-size print." }],
    ["a snap (#1130)", { unconfirmed: true, snapDimensions: 6 }],
  ])("%s keeps today's flow: it opens Set scale and saves nothing", async (_, more) => {
    const { calls, q } = mount({ ...SURE, ...more });
    act(() => q("toolbar-scale-offer")!.click());
    await flush();
    expect(calls.onUse).toHaveBeenCalledOnce();
    expect(calls.save).not.toHaveBeenCalled();
  });
});
