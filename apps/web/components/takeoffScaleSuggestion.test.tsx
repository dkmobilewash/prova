// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TakeoffScaleSuggestion } from "./TakeoffScaleSuggestion";

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
const suggestion = { scaleName: '1/8" = 1\'-0"', feetPerInch: 8, because: "14 doors" };
const q = (name: string) => host.querySelector<HTMLButtonElement>(`[data-takeoff="${name}"]`)!;
function paint(onConfirm = vi.fn(async () => null as string | null), onDismiss = vi.fn()) {
  act(() => root.render(createElement(TakeoffScaleSuggestion, { suggestion, onConfirm, onDismiss })));
  return { onConfirm, onDismiss };
}

describe("the suggested scale", () => {
  it("asks, and saves nothing until it is pressed", () => {
    const { onConfirm } = paint();
    expect(host.textContent).toContain('Suggested 1/8" = 1\'-0" from 14 doors: confirm?');
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it("Confirm saves; Not this does not", async () => {
    const { onConfirm, onDismiss } = paint();
    await act(async () => q("dismiss-suggested-scale").click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    await act(async () => q("confirm-suggested-scale").click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
  it("says why when it did not save, and can be pressed again", async () => {
    paint(vi.fn(async () => "That line is too short."));
    await act(async () => q("confirm-suggested-scale").click());
    expect(host.textContent).toContain("That line is too short.");
    expect(q("confirm-suggested-scale").disabled).toBe(false);
  });
});
