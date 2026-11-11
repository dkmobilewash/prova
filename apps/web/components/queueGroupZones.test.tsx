// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueueGroupConfirm } from "./QueueGroupConfirm";

// By zone within a level is a choice: the sections' heights per part of the building, picked per group.
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));
const zones = [
  { feet: 12, from: "A-512 LOWER BOD 112' 0\"" },
  { feet: 12 + 4 / 12, from: "A-511 ADMIN JBE 112' 4\"" },
  { feet: 16 + 8 / 12, from: "A-422 CENTRAL TOW 116' 8\"" },
];
const press = (key: string) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
const box = () => (host.querySelector("[data-takeoff=queue-height]") as HTMLInputElement).value;
const from = () => host.querySelector("[data-takeoff=queue-height-from]")!.textContent;
function paint(options = zones) {
  const onAccept = vi.fn();
  act(() =>
    root.render(
      createElement(QueueGroupConfirm, { label: "Walls · sheet A-101", codes: ["A", "K"], suggested: { code: "A", from: "tag A" }, heightOf: () => null, heightOptions: (code) => (code === "A" ? options : []), onAccept, onSkip: () => {} }),
    ),
  );
  return onAccept;
}

describe("a group's height by part of the building, chosen in the queue", () => {
  it("offers each zone with what printed it, picks none until asked, and Z steps through them", () => {
    const onAccept = paint();
    expect(host.querySelectorAll("[data-takeoff=queue-zones] button")).toHaveLength(3);
    expect(box()).toBe("");
    press("z");
    expect([box(), from()]).toEqual(["12'-0\"", "A-512 LOWER BOD 112' 0\""]);
    press("z");
    press("Enter");
    expect(onAccept).toHaveBeenCalledWith("A", 12 + 4 / 12, expect.any(Object));
  });

  it("takes a zone by click, and offers none for a type the sections give one height", () => {
    const onAccept = paint();
    act(() => (host.querySelectorAll("[data-takeoff=queue-zones] button")[2] as HTMLButtonElement).click());
    press("Enter");
    expect(onAccept).toHaveBeenCalledWith("A", 16 + 8 / 12, expect.any(Object));
    press("2");
    expect(host.querySelector("[data-takeoff=queue-zones]")).toBeNull();
  });
});

describe("the type picked on a group nothing names, on all of them (walk v6: 13 groups, two keys each)", () => {
  function paintRest(rest: string | null) {
    const onAccept = vi.fn();
    const onAcceptRest = vi.fn();
    act(() =>
      root.render(
        createElement(QueueGroupConfirm, { label: "Walls · sheet A101", codes: ["A", "K"], suggested: null, heightOf: () => ({ feet: 15, from: "general note" }), onAccept, onSkip: () => {}, rest, onAcceptRest }),
      ),
    );
    return { onAccept, onAcceptRest, button: () => host.querySelector("[data-takeoff=queue-accept-rest]") as HTMLButtonElement | null };
  }

  it("waits for a type, then A gives it to every one, at the height shown", () => {
    const { onAccept, onAcceptRest, button } = paintRest("13 groups nothing names on A101");
    expect(button()!.disabled).toBe(true);
    press("a");
    expect(onAcceptRest).not.toHaveBeenCalled();
    press("2");
    expect(button()!.textContent).toBe("K on all 13 groups nothing names on A101 (A)");
    press("a");
    expect(onAcceptRest).toHaveBeenCalledWith("K", 15, expect.any(Object));
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("is not offered when there is nothing else on the sheet to type", () => {
    const { onAcceptRest, button } = paintRest(null);
    expect(button()).toBeNull();
    press("2");
    press("a");
    expect(onAcceptRest).not.toHaveBeenCalled();
  });
});
