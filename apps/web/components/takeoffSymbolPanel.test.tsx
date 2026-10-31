// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const saveAcross = vi.fn(async () => ({ ok: true, value: { saved: [{ pageNumber: 54, count: 21, measurementId: "m" }, { pageNumber: 52, count: 5, measurementId: "n" }], skipped: [], total: 26 } }));
vi.mock("@/lib/actions", () => ({ saveSymbolCountAcrossSheets: saveAcross, saveTakeoffMeasurement: vi.fn() }));
const { TakeoffSymbolPanel } = await import("./TakeoffSymbolPanel");

describe("saving a count across the set", () => {
  it("keeps the panel up, so the sentence saying what was saved can be read", async () => {
    const onSaved = vi.fn();
    const across = { scope: "discipline", fromNumber: "EL1.01", running: false, looked: 12, total: 12, done: true, error: null, rows: [{ page: 54, number: "EL1.01", count: 21, ms: 1, scaling: "paper", xs: [0.1], ys: [0.1] }, { page: 52, number: "E0.03", count: 5, ms: 1, scaling: "paper", xs: [0.2], ys: [0.2] }] };
    const state = { matches: [{ box: { x1: 0, y1: 0, x2: 1, y2: 1 } }], dropped: new Set(), ms: 1, busy: false, error: null };
    const host = document.createElement("div");
    document.body.append(host);
    act(() => createRoot(host).render(createElement(TakeoffSymbolPanel, { jobId: "j", planId: "p", pageId: "g", itemId: null, state, across, pageCount: 12, onAcross: () => {}, onCancelAcross: () => {}, onClear: () => {}, onSaved } as never)));
    const label = host.querySelector('[data-takeoff="symbol-label"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(label, "ZZ");
      label.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { (host.querySelector('[data-takeoff="symbol-across-save"]') as HTMLButtonElement).click(); });
    expect(onSaved).toHaveBeenCalledWith({ id: "m" }, true);
    expect(host.querySelector('[data-takeoff="symbol-across-saved"]')?.textContent).toMatch(/Saved 26 on 2 sheets as one count/);
  });
  it("says 1 sheet, not 1 sheets", async () => {
    saveAcross.mockResolvedValueOnce({ ok: true, value: { saved: [{ pageNumber: 54, count: 21, measurementId: "m" }], skipped: [], total: 21 } } as never);
    const across = { scope: "discipline", fromNumber: "EL1.01", running: false, looked: 12, total: 12, done: true, error: null, rows: [{ page: 54, number: "EL1.01", count: 21, ms: 1, scaling: "paper", xs: [0.1], ys: [0.1] }] };
    const state = { matches: [{ box: { x1: 0, y1: 0, x2: 1, y2: 1 } }], dropped: new Set(), ms: 1, busy: false, error: null };
    const host = document.createElement("div");
    document.body.append(host);
    act(() => createRoot(host).render(createElement(TakeoffSymbolPanel, { jobId: "j", planId: "p", pageId: "g", itemId: null, state, across, pageCount: 12, onAcross: () => {}, onCancelAcross: () => {}, onClear: () => {}, onSaved: () => {} } as never)));
    const label = host.querySelector('[data-takeoff="symbol-label"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(label, "ZZ");
      label.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = host.querySelector('[data-takeoff="symbol-across-save"]') as HTMLButtonElement;
    expect(save.textContent).toBe("Save 21 across 1 sheet");
    expect(host.querySelector('[data-takeoff="symbol-across-total"]')?.textContent).toMatch(/21 across 1 sheet\b/);
    await act(async () => { save.click(); });
    expect(host.querySelector('[data-takeoff="symbol-across-saved"]')?.textContent).toMatch(/Saved 21 on 1 sheet as one count/);
  });
});
