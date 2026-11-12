// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewItem } from "@/lib/takeoff/reviewQueue";

/**
 * Totem Lake's legend makes every wall not tagged a type 1, in outlined letters no reader can see,
 * so its untagged groups were asked one by one. Now one question per sheet: "The rest of A2.1's
 * untagged walls: N groups, F ft = which of your types?" — nothing preselected, one press applies
 * the person's answer to all of them in one save (one Undo).
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
const saved: unknown[][] = [];
vi.mock("@/lib/actions", () => {
  const ok = async () => ({ ok: true, value: {} });
  return {
    confirmSheetScales: ok,
    confirmSheetSuggestions: async (_job: string, groups: unknown[]) => {
      saved.push(groups);
      return { ok: true, value: { accepted: groups.length, failed: [], undo: { moved: [], created: [], items: [] } } };
    },
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

const group = (key: string, inches: number, y: number): ReviewItem => ({ kind: "type", key, pageNumber: 5, sheet: "A2.1", inches, runs: [{ x1: 0.1, y1: y, x2: 0.6, y2: y }], feet: 40, suggested: null, ceiling: null });

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  saved.length = 0;
});
const render = (items: ReviewItem[]) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(TakeoffReviewQueue, { jobId: "job-1", planId: "plan-1", items, legendCodes: ["W1", "W2"], planSet: [], onShow: () => {}, onClose: () => {} })));
};
const q = (hook: string) => document.querySelector<HTMLElement>(`[data-takeoff="${hook}"]`);

describe("one question per sheet: the rest of its untagged walls = which type?", () => {
  it("asks once with the count and feet, nothing preselected; the answer types all of them in one save", async () => {
    render([group("g1", 4.75, 0.2), group("g2", 2.5, 0.4), group("g3", 12.4, 0.6)]);
    expect(q("review-queue-rest")?.textContent).toContain("The rest of A2.1’s untagged walls: 3 groups, 120 ft");
    const apply = q("review-queue-rest-apply") as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(document.querySelectorAll('[data-takeoff="review-queue-rest-code"][aria-pressed="true"]').length).toBe(0);
    const w2 = [...document.querySelectorAll<HTMLButtonElement>('[data-takeoff="review-queue-rest-code"]')].find((b) => b.textContent === "W2")!;
    act(() => w2.click());
    expect(apply.textContent).toBe("W2 on all 3 (120 ft)");
    await act(async () => apply.click());
    expect(saved).toHaveLength(1);
    expect((saved[0] as { code: string }[]).map((g) => g.code)).toEqual(["W2", "W2", "W2"]);
    expect(q("review-queue-rest")).toBeNull();
  });
  it("'One by one' leaves them to the rows, and a sheet with one untagged group is not asked", () => {
    render([group("g1", 4.75, 0.2), group("g2", 2.5, 0.4)]);
    act(() => q("review-queue-rest-dismiss")!.click());
    expect(q("review-queue-rest")).toBeNull();
    expect(saved).toHaveLength(0);
    act(() => root?.unmount());
    root = null;
    render([group("solo", 4.75, 0.2)]);
    expect(q("review-queue-rest")).toBeNull();
  });
});
