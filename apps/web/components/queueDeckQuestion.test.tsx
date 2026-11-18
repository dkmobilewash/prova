// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewItem } from "@/lib/takeoff/reviewQueue";
import type { UndoEntry } from "@/lib/takeoff/undoStack";

/**
 * "Walls go to deck: deck height?" (Diego, 2026-11-18): first in the queue, pre-filled with what
 * C-Stream read and its source shown, ONE press puts it on every to-deck wall of the job, and the
 * Undo it leaves puts back exactly what it replaced.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
const setJobDeckHeight = vi.fn(async (_jobId: string, _feet: number | null) => ({ ok: true as const, value: { was: null as number | null, walls: 42 } }));
vi.mock("@/lib/actions", () => {
  const ok = async () => ({ ok: true, value: {} });
  return {
    confirmDoors: ok, confirmSheetScales: ok, confirmSheetSuggestions: ok, recordQueueSkip: ok, confirmWindows: ok, undoAutoPost: ok, undoConfirmDoors: ok,
    undoConfirmWindows: ok, priceLineFromCost: ok, reviewWall: ok, setWallGroupHeight: ok, undoSheetSuggestions: ok,
    setJobDeckHeight: (jobId: string, feet: number | null) => setJobDeckHeight(jobId, feet),
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { TakeoffReviewQueue } = await import("./TakeoffReviewQueue");
const { reviewQueue } = await import("@/lib/takeoff/reviewQueue");

const deck: ReviewItem = { kind: "deck", key: "deck:job-1", walls: 42, prefill: { feet: 14.5, from: "floor to floor 14.5 ft, read from the sections' level marks" } };
const group: ReviewItem = { kind: "type", key: "g1", pageNumber: 1, sheet: "A2.1", inches: 4.75, runs: [{ x1: 0.1, y1: 0.2, x2: 0.6, y2: 0.2 }], feet: 40, suggested: null, ceiling: null };

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  setJobDeckHeight.mockClear();
});
const q = (s: string) => document.querySelector<HTMLElement>(`[data-takeoff="${s}"]`);

describe("the deck question", () => {
  it("first, pre-filled with its source; one press answers every to-deck wall, and Undo puts the read back", async () => {
    const undos: UndoEntry[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(createElement(TakeoffReviewQueue, { jobId: "job-1", planId: "plan-1", items: reviewQueue([group, deck]), legendCodes: ["W1"], planSet: [], onShow: () => {}, onClose: () => {}, onUndoable: (e: UndoEntry) => void undos.push(e) })),
    );
    expect(q("review-queue-item")?.dataset.kind).toBe("deck");
    expect((q("review-queue-deck-height") as HTMLInputElement).value).toBe(`14'-6"`);
    expect(q("review-queue-deck-source")?.textContent).toContain("floor to floor 14.5 ft");
    expect(q("review-queue-deck-accept")?.textContent).toContain("all 42 to-deck walls");
    await act(async () => void q("review-queue-deck")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(setJobDeckHeight).toHaveBeenCalledWith("job-1", 14.5);
    // The queue moved on to the group.
    expect(q("review-queue-item")?.dataset.kind).toBe("type");
    expect(undos).toHaveLength(1);
    await act(async () => void (await undos[0]!.undo()));
    expect(setJobDeckHeight).toHaveBeenLastCalledWith("job-1", null);
    expect(q("review-queue-item")?.dataset.kind).toBe("deck");
  });
});
