// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewItem } from "@/lib/takeoff/reviewQueue";

/**
 * Totem Lake's exceptions (1A, 2A, 2B, 3B) are printed tags no company type carries; the sheet's
 * "rest" answer would have typed them as the default. Each printed tag is asked once, across the
 * set, before the rest — nothing preselected, one save (one Undo).
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

const group = (key: string, page: number, sheet: string, y: number, tag?: string): ReviewItem => ({
  kind: "type", key, pageNumber: page, sheet, inches: 4.75, runs: [{ x1: 0.1, y1: y, x2: 0.6, y2: y }], feet: 40, suggested: null, ceiling: null, ...(tag ? { tag } : {}),
});

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
const code = (hook: string, c: string) => [...document.querySelectorAll<HTMLButtonElement>(`[data-takeoff="${hook}"]`)].find((b) => b.textContent === c)!;

describe("one question per printed tag, across the set, before the rest", () => {
  it("asks tag 2A for both sheets' groups first, nothing preselected; then the rest of the sheet", async () => {
    render([group("a", 5, "A2.1", 0.2, "2A"), group("b", 5, "A2.1", 0.4), group("c", 5, "A2.1", 0.5), group("d", 6, "A2.2", 0.6, "2A")]);
    expect(q("review-queue-rest")).toBeNull();
    expect(q("review-queue-tag")?.textContent).toContain("Tag 2A (2 groups, 80 ft on 2 sheets) = which of your types?");
    const apply = q("review-queue-tag-apply") as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(document.querySelectorAll('[data-takeoff="review-queue-tag-code"][aria-pressed="true"]').length).toBe(0);
    act(() => code("review-queue-tag-code", "W2").click());
    await act(async () => apply.click());
    expect(saved).toHaveLength(1);
    expect((saved[0] as { code: string; pageNumber: number }[]).map((g) => `${g.pageNumber}:${g.code}`)).toEqual(["5:W2", "6:W2"]);
    // Tag answered: the sheet's rest question now, for the two untagged groups.
    expect(q("review-queue-tag")).toBeNull();
    expect(q("review-queue-rest")?.textContent).toContain("2 groups, 80 ft");
  });
  it("'Ask with the rest' folds the tag's groups into the rest question", () => {
    render([group("a", 5, "A2.1", 0.2, "3B"), group("b", 5, "A2.1", 0.4)]);
    act(() => q("review-queue-tag-dismiss")!.click());
    expect(q("review-queue-tag")).toBeNull();
    expect(q("review-queue-rest")?.textContent).toContain("2 groups");
    expect(saved).toHaveLength(0);
  });
});
