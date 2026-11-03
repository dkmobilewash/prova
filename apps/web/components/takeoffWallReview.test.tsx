// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TakeoffWallReview } from "./TakeoffWallReview";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function paint(extra: { busy?: boolean; current?: { feet: number; why: string } | null; counter?: string } = {}) {
  const calls = { onKeep: vi.fn(), onDrop: vi.fn(), onUndo: vi.fn(), onClose: vi.fn() };
  act(() => root.render(createElement(TakeoffWallReview, { counter: "12 of 48 reviewed", current: { feet: 23.4, why: "model score 0.12" }, busy: false, error: null, ...calls, ...extra })));
  return calls;
}
const press = (key: string, init: KeyboardEventInit = {}) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })));

describe("review walls", () => {
  it("shows the counter and the run", () => {
    paint();
    expect(host.textContent).toContain("12 of 48 reviewed");
    expect(host.textContent).toContain("23 ft");
  });
  it("K keeps, D drops, U undoes, Escape closes", () => {
    const p = paint();
    press("k");
    press("D");
    press("u");
    press("Escape");
    expect([p.onKeep.mock.calls.length, p.onDrop.mock.calls.length, p.onUndo.mock.calls.length, p.onClose.mock.calls.length]).toEqual([1, 1, 1, 1]);
  });
  it("takes the key from the workspace, where K is the previous page", () => {
    // Registered first, as the workspace's listener is in the app.
    const page = vi.fn();
    window.addEventListener("keydown", page);
    paint();
    press("k");
    window.removeEventListener("keydown", page);
    expect(page).not.toHaveBeenCalled();
  });
  it("ignores the keys while a decision is saving, and with a modifier", () => {
    const p = paint({ busy: true });
    press("k");
    press("d", { metaKey: true });
    expect(p.onKeep).not.toHaveBeenCalled();
    expect(p.onDrop).not.toHaveBeenCalled();
  });
  it("says when every run is reviewed", () => {
    paint({ current: null, counter: "48 of 48 reviewed" });
    expect(host.textContent).toContain("Every run is reviewed.");
    expect(host.querySelector('[data-takeoff="review-keep"]')).toBeNull();
  });
});
