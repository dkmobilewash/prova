// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { EraseAreaConfirm, eraseAreaQuestion } from "./EraseAreaConfirm";
import { eraseInBoxes } from "@/lib/takeoff/userExclusions";

/** P5 (coordination/erase-area-tool.md E4): the question counts what the shared predicate takes; Cancel writes nothing. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(props: Parameters<typeof EraseAreaConfirm>[0]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(EraseAreaConfirm, props)));
  return { host, root };
}

describe("P5: the erase confirm", () => {
  it("asks with the predicate's own count and feet", () => {
    const runs = [{ x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.1, lengthFeet: 30 }, { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.2, lengthFeet: 20 }, { x1: 0.1, y1: 0.9, x2: 0.4, y2: 0.9, lengthFeet: 30 }];
    const taken = eraseInBoxes(runs, [{ xs: [0, 0.5, 0.5, 0], ys: [0, 0, 0.5, 0.5] }]).erased;
    expect(eraseAreaQuestion(taken.length, taken.reduce((s, r) => s + r.lengthFeet, 0))).toBe("Erase 2 walls, 50 ft?");
    expect(eraseAreaQuestion(1, 1234.4)).toBe("Erase 1 wall, 1,234 ft?");
  });
  it("offers no Erase when nothing is wholly inside, only Cancel", () => {
    const { host, root } = mount({ n: 0, feet: 0, saving: false, onErase: () => {}, onCancel: () => {} });
    expect(host.textContent).toContain("No found walls are wholly inside this box.");
    expect(host.querySelector('[data-takeoff="erase-area-go"]')).toBeNull();
    act(() => root.unmount());
  });
  it("Cancel calls only onCancel; Erase calls onErase once; a busy Erase is disabled", () => {
    const calls: string[] = [];
    const { host, root } = mount({ n: 3, feet: 163, saving: false, onErase: () => calls.push("erase"), onCancel: () => calls.push("cancel") });
    act(() => (host.querySelector('[data-takeoff="erase-area-cancel"]') as HTMLButtonElement).click());
    expect(calls).toEqual(["cancel"]);
    act(() => (host.querySelector('[data-takeoff="erase-area-go"]') as HTMLButtonElement).click());
    expect(calls).toEqual(["cancel", "erase"]);
    act(() => root.render(createElement(EraseAreaConfirm, { n: 3, feet: 163, saving: true, onErase: () => calls.push("erase"), onCancel: () => {} })));
    const go = host.querySelector('[data-takeoff="erase-area-go"]') as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    expect(go.textContent).toContain("Erasing…");
    act(() => root.unmount());
  });
});
