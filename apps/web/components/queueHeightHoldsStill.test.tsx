// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueueGroupConfirm } from "./QueueGroupConfirm";

// The height box holds still once somebody is in it: fast-confirm's step 6
// flaked when a save landed after T and pre-filled 10'-0" under the caret, so
// the typed 9'-6" became "10'-0"9'-6"" and was refused.
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));
const box = () => host.querySelector("[data-takeoff=queue-height]") as HTMLInputElement;
const press = (key: string) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
const setValue = (value: string) =>
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(box(), value);
    box().dispatchEvent(new Event("input", { bubbles: true }));
  });
function paint(known: number | null, onAccept = vi.fn()) {
  act(() =>
    root.render(
      createElement(QueueGroupConfirm, {
        label: "Walls · sheet A101",
        codes: ["ZF1", "ZF2"],
        suggested: null,
        heightOf: (code) => (code === "ZF2" && known !== null ? { feet: known, from: "ceiling plan" } : null),
        onAccept,
        onSkip: () => {},
      }),
    ),
  );
  return onAccept;
}

describe("the queue's height box", () => {
  it("is not changed under the caret when a height arrives after T", () => {
    const onAccept = paint(null);
    press("2");
    press("t");
    expect(document.activeElement).toBe(box());
    expect(box().value).toBe("");
    // The save from the group before lands: ZF2 now has 10'-0".
    paint(10, onAccept);
    expect(box().value).toBe("");
    setValue(`9'-6"`);
    act(() => box().form!.requestSubmit());
    expect(onAccept).toHaveBeenCalledWith("ZF2", 9.5);
  });

  it("still follows the type picked when nobody is in it", () => {
    paint(10);
    press("1");
    expect(box().value).toBe("");
    press("2");
    expect(box().value).toBe(`10'-0"`);
  });
});
