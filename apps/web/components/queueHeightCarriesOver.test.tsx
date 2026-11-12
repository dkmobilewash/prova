// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewItem } from "@/lib/takeoff/reviewQueue";

/**
 * The Totem Lake flow walk (plan reading off): 13 wall groups nothing names, all typed W1, and the
 * height was asked on the first THREE: the accept is optimistic, so the next groups render before
 * the server's heights know the 10 ft just typed. C-Stream knows it already: a height a person types
 * for a type is the one the next groups of that type start with. Same type, same height, same
 * quantities; one question instead of three.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
// The save never answers here: what the next group shows cannot have come from the server.
const pending = () => new Promise(() => {});
vi.mock("@/lib/actions", () => {
  const ok = async () => ({ ok: true, value: {} });
  return {
    confirmSheetScales: ok,
    confirmSheetSuggestions: pending,
    recordQueueSkip: ok,
    confirmWindows: ok,
    undoAutoPost: ok,
    undoConfirmWindows: ok,
    priceLineFromCost: ok,
    reviewWall: ok,
    setWallGroupHeight: ok,
    undoSheetSuggestions: ok,
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { TakeoffReviewQueue } = await import("./TakeoffReviewQueue");

const group = (key: string, y: number): ReviewItem => ({
  kind: "type",
  key,
  pageNumber: 1,
  sheet: "A2.1",
  inches: 4.75,
  runs: [{ x1: 0.1, y1: y, x2: 0.6, y2: y }],
  feet: 40,
  suggested: null,
  ceiling: null,
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});
const press = (key: string) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
const box = () => document.querySelector<HTMLInputElement>('[data-takeoff="queue-height"]')!;
const typeHeight = (value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box(), value);
    box().dispatchEvent(new Event("input", { bubbles: true }));
  });
const label = () => document.querySelector('[data-takeoff="queue-group"]')?.textContent ?? "";

describe("a height typed for a type carries to the next groups of that type", () => {
  it("W1 at 10 ft on the first group: the second group, picked W1, starts at 10 ft before the server answers", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        createElement(TakeoffReviewQueue, { jobId: "job-1", planId: "plan-1", items: [group("g1", 0.2), group("g2", 0.5)], legendCodes: ["W1", "W2"], planSet: [], onShow: () => {}, onClose: () => {} }),
      ),
    );
    // The first group: nothing names it, no height known. Pick W1, type 10, accept.
    press("1");
    expect(box().value).toBe("");
    typeHeight("10");
    await act(async () => void box().closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    // The second group is on screen now, its type not yet picked; pick W1 and its height is already there.
    expect(label()).toContain("4-3/4");
    expect(box().value).toBe("");
    press("1");
    expect(box().value).toBe(`10'-0"`);
    // A different type knows nothing of it.
    press("2");
    expect(box().value).toBe("");
  });
});
