// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewItem } from "@/lib/takeoff/reviewQueue";

/**
 * Baker A101's new-customer walk: the existing-walls question skipped, then "Tag C8B = W1" answered
 * on its groups — and the queue went back to its first item, the question just skipped, instead of
 * on to the next one. The walk read that as "only the skipped question is left" and stopped with 24
 * items to go, never reaching the sheet's 9 windows.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/lib/actions", () => {
  const ok = async () => ({ ok: true, value: {} });
  return {
    confirmSheetScales: ok,
    confirmSheetSuggestions: async (_job: string, groups: unknown[]) => ({ ok: true, value: { accepted: groups.length, failed: [], undo: { moved: [], created: [], items: [] } } }),
    recordQueueSkip: ok,
    confirmWindows: ok,
    confirmDoors: ok,
    undoConfirmDoors: ok,
    undoAutoPost: ok,
    undoConfirmWindows: ok,
    priceLineFromCost: ok,
    reviewWall: ok,
    setWallGroupHeight: async () => ({ ok: true, value: { was: { heightFt: null, sides: null } } }),
    undoSheetSuggestions: ok,
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { TakeoffReviewQueue } = await import("./TakeoffReviewQueue");

const group = (key: string, y: number, tag?: string): ReviewItem => ({ kind: "type", key, pageNumber: 13, sheet: "A101", inches: 4.75, runs: [{ x1: 0.1, y1: y, x2: 0.6, y2: y }], feet: 40, suggested: null, ceiling: null, ...(tag ? { tag } : {}) });
const items: ReviewItem[] = [
  { kind: "existing", key: "existing:13", pageNumber: 13, sheet: "A101", walls: 36, feet: 669 },
  group("c8b-1", 0.2, "C8B"),
  group("c8b-2", 0.3, "C8B"),
  group("plain-1", 0.5),
  group("plain-2", 0.6),
];

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});
const q = (hook: string) => document.querySelector<HTMLElement>(`[data-takeoff="${hook}"]`);
const kind = () => q("review-queue-item")?.getAttribute("data-kind");

describe("after an answer the queue goes on, not back to the item just skipped", () => {
  it("Skip the existing-walls question, answer Tag C8B: the next item is the sheet's other groups, not the existing question", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(createElement(TakeoffReviewQueue, { jobId: "job-1", planId: "plan-1", items, legendCodes: ["W1", "W2"], planSet: [], onShow: () => {}, onClose: () => {} })));
    expect(kind()).toBe("existing");
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[data-takeoff="review-queue-item"] button')].find((b) => b.textContent === "Skip")!.click());
    expect(q("review-queue-tag")?.getAttribute("data-tag")).toBe("C8B");
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[data-takeoff="review-queue-tag-code"]')].find((b) => b.textContent === "W1")!.click());
    await act(async () => (q("review-queue-tag-apply") as HTMLButtonElement).click());
    expect(kind()).toBe("type");
    expect(q("review-queue-rest")?.textContent).toContain("2 groups");
  });

  // ── THE SERVER'S RE-RENDER AFTER THE ANSWER MUST NOT CHANGE THE QUESTION ON SCREEN ──
  // The new-customer walk on main (#1157+), 5 runs each: Falafel 2/5, Baker 1/5. A bulk answer left the
  // cursor on a group it had just saved; the server's refresh then dropped that group, the cursor's key
  // was nowhere, and the queue fell back to its FIRST item — under the person's pointer, mid-click.
  const render = (list: ReviewItem[]) =>
    act(() => root!.render(createElement(TakeoffReviewQueue, { jobId: "job-1", planId: "plan-1", items: list, legendCodes: ["W1", "W2"], planSet: [], onShow: () => {}, onClose: () => {} })));

  it("Baker: after Tag C8B, the refresh without its groups keeps the rest question, not the skipped existing walls", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    render(items);
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[data-takeoff="review-queue-item"] button')].find((b) => b.textContent === "Skip")!.click());
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[data-takeoff="review-queue-tag-code"]')].find((b) => b.textContent === "W1")!.click());
    await act(async () => (q("review-queue-tag-apply") as HTMLButtonElement).click());
    expect(q("review-queue-rest")?.textContent).toContain("2 groups");
    // The server saved C8B's groups: they are no longer in its items.
    render(items.filter((i) => !i.key.startsWith("c8b")));
    expect(kind()).toBe("type");
    expect(q("review-queue-rest")?.textContent).toContain("2 groups");
  });

  it("Falafel: the doors question on screen stays when the refresh brings new height items ahead of it", async () => {
    const doors: ReviewItem = { kind: "doors", key: "doors:13", pageNumber: 13, sheet: "A2.00", runs: [{ x1: 0.1, y1: 0.1, x2: 0.12, y2: 0.1 }], tags: ["door"], at: null };
    const height: ReviewItem = { kind: "height", key: "height:w1", itemId: "w1", name: "W1 walls", pageNumber: 13, sheet: "A2.00", runs: [{ x1: 0.1, y1: 0.5, x2: 0.6, y2: 0.5 }], feet: 208, options: [] };
    const list = [group("plain-1", 0.5), group("plain-2", 0.6), doors];
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    render(list);
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[data-takeoff="review-queue-rest-code"]')].find((b) => b.textContent?.startsWith("W1"))!.click());
    await act(async () => (q("review-queue-rest-apply") as HTMLButtonElement).click());
    expect(kind()).toBe("doors");
    render([height, doors]);
    expect(kind()).toBe("doors");
  });

  // ── AND AN UNDO STILL BRINGS ITS QUESTION BACK (set-type-undo.spec.ts step 8) ──
  // Undo points the cursor at an item the server has not sent back yet. Pinning the cursor to what
  // was on screen in that moment lost the item when it arrived: the height question never came back.
  it("a height answered, then undone: the height question is back once the server sends it again", async () => {
    const height: ReviewItem = { kind: "height", key: "height:zu2", itemId: "zu2", name: "ZU2 walls", pageNumber: 13, sheet: "A101", runs: [{ x1: 0.1, y1: 0.5, x2: 0.6, y2: 0.5 }], feet: 40, options: [] };
    const other = group("plain-1", 0.6);
    const undos: { undo: () => Promise<unknown> }[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const show = (list: ReviewItem[]) =>
      act(() => root!.render(createElement(TakeoffReviewQueue, { jobId: "job-1", planId: "plan-1", items: list, legendCodes: ["W1", "W2"], planSet: [], onShow: () => {}, onClose: () => {}, onUndoable: (e: { undo: () => Promise<unknown> }) => void undos.push(e) })));
    show([height, other]);
    expect(kind()).toBe("height");
    const box = q("queue-height") as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, "9");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => (q("queue-accept") as HTMLButtonElement).click());
    expect(kind()).toBe("type");
    // The server saved the height: no height item now.
    show([other]);
    await act(async () => void (await undos[0]!.undo()));
    // The server's next render has the height item again.
    show([height, other]);
    expect(kind()).toBe("height");
  });

  // ── A BULK UNDO BRINGS BACK WHAT IT TOOK, AND SHOWS IT (accept-sheet.spec.ts step 5) ──
  // "The rest of A101 = W1" types both groups nothing names; its Undo must put the queue back on them.
  // The bulk Undo never pointed the cursor at them: main showed them only because the queue fell to its
  // first item, and holding what was on screen kept the doors question up instead.
  it("the rest typed, then Undo: the two groups are back on screen once the server sends them again", async () => {
    const doors: ReviewItem = { kind: "doors", key: "doors:13", pageNumber: 13, sheet: "A101", runs: [{ x1: 0.1, y1: 0.1, x2: 0.12, y2: 0.1 }], tags: ["door"], at: null };
    const two = [group("plain-1", 0.5), group("plain-2", 0.6)];
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    render([...two, doors]);
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[data-takeoff="review-queue-rest-code"]')].find((b) => b.textContent?.startsWith("W1"))!.click());
    await act(async () => (q("review-queue-rest-apply") as HTMLButtonElement).click());
    expect(kind()).toBe("doors");
    render([doors]);
    await act(async () => (q("review-queue-accepted-undo") as HTMLButtonElement).click());
    render([...two, doors]);
    expect(kind()).toBe("type");
    expect(q("queue-accept-rest")?.textContent).toContain("2 groups");
  });
});

