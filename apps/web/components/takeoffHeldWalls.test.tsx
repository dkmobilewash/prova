// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TakeoffHeldWalls } from "./TakeoffHeldWalls";

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
const paint = (walls: { id: string; feet: number }[], onConfirm = vi.fn(async (_id: string) => null as string | null)) => {
  act(() => root.render(createElement(TakeoffHeldWalls, { walls, onConfirm })));
  return onConfirm;
};

describe("walls held off the estimate", () => {
  it("says how much is left out", () => {
    paint([{ id: "a", feet: 40 }, { id: "b", feet: 12.4 }]);
    expect(host.textContent).toContain("2 runs to confirm, 52 ft: not on the estimate");
  });
  it("shows nothing when nothing is held", () => {
    paint([]);
    expect(host.querySelector('[data-takeoff="held-walls"]')).toBeNull();
  });
  it("includes one run on one click, and says why if it did not save", async () => {
    const onConfirm = paint([{ id: "a", feet: 40 }, { id: "b", feet: 12 }], vi.fn(async () => "Nope."));
    await act(async () => host.querySelectorAll<HTMLButtonElement>('[data-takeoff="confirm-held-wall"]')[1]!.click());
    expect(onConfirm).toHaveBeenCalledWith("b");
    expect(host.textContent).toContain("Nope.");
  });
});
