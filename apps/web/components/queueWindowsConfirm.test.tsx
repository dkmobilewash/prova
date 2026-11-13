// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueueWindowsConfirm } from "./QueueWindowsConfirm";
import type { ReviewItem } from "@/lib/takeoff/reviewQueue";

// Counted windows are confirmed as one count; a false hit goes with one key.
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));
const run = (x: number) => ({ x1: x, y1: 0.2, x2: x + 0.04, y2: 0.2 });
const item = { kind: "windows", key: "windows:4", pageNumber: 4, sheet: "A101", runs: [run(0.1), run(0.2), run(0.3)], tags: ["A", "A", "B"], at: null } as Extract<ReviewItem, { kind: "windows" }>;
const press = (key: string) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
const text = () => host.querySelector("[data-takeoff=queue-windows-count]")!.textContent;
function paint() {
  const onAccept = vi.fn(), onShow = vi.fn(), onSkip = vi.fn();
  act(() => root.render(createElement(QueueWindowsConfirm, { item, onAccept, onShow, onSkip })));
  return { onAccept, onShow, onSkip };
}

describe("a sheet's counted windows in the review queue", () => {
  it("shows the count by type, and Enter confirms them all", () => {
    const { onAccept } = paint();
    expect(text()).toBe("3 windows · sheet A101 · A ×2, B ×1");
    press("Enter");
    expect(onAccept).toHaveBeenCalledWith([0, 1, 2]);
  });

  it("drops the window looked at with one key, takes it off the plan, and confirms the rest", () => {
    const { onAccept, onShow } = paint();
    press("ArrowRight");
    press("ArrowRight");
    expect(onShow).toHaveBeenLastCalledWith(expect.objectContaining({ at: 1 }));
    press("d");
    expect(text()).toBe("2 windows · sheet A101 · A ×1, B ×1");
    expect(onShow).toHaveBeenLastCalledWith(expect.objectContaining({ runs: [run(0.1), run(0.3)], tags: ["A", "B"], at: 1 }));
    press("Enter");
    expect(onAccept).toHaveBeenCalledWith([0, 2]);
  });

  it("drops the first window when none is looked at, and N skips without deciding", () => {
    const { onAccept, onSkip } = paint();
    press("Delete");
    press("n");
    expect(onSkip).toHaveBeenCalled();
    press("Enter");
    expect(onAccept).toHaveBeenCalledWith([1, 2]);
  });
});

describe("the same item confirms a sheet's found doors with no printed mark", () => {
  const doors = { kind: "doors", key: "doors:4", pageNumber: 4, sheet: "A101", runs: [run(0.1), run(0.2), run(0.3)], tags: ["door", "door", "door"], at: null } as Extract<ReviewItem, { kind: "doors" }>;
  it("says doors, D drops the one looked at, Enter keeps the rest", () => {
    const onAccept = vi.fn(), onShow = vi.fn(), onSkip = vi.fn();
    act(() => root.render(createElement(QueueWindowsConfirm, { item: doors, noun: "door", onAccept, onShow, onSkip })));
    const count = () => host.querySelector("[data-takeoff=queue-doors-count]")!.textContent;
    expect(count()).toBe("3 doors with no printed mark · sheet A101");
    expect(host.querySelector("[data-takeoff=queue-doors-drop]")!.textContent).toBe("Not a door (D)");
    press("ArrowRight");
    press("ArrowRight");
    press("d");
    expect(count()).toBe("2 doors with no printed mark · sheet A101");
    press("Enter");
    expect(onAccept).toHaveBeenCalledWith([0, 2]);
  });
});
