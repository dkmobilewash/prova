// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewItem } from "@/lib/takeoff/reviewQueue";

/**
 * Diego's audit order (2026-11-25), coordination/work-area-first.md Amendment 1 (W5b): the review queue's step for a
 * renovation sheet asks for the work area, with the same two exits as the sheet. Setting aside walls drawn like one no
 * longer answers it (W7), so offering only that would bring the step back forever.
 */
const whole = vi.fn(async () => ({ ok: true, value: { ids: ["x"] } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/lib/actions", () => {
  const ok = async () => ({ ok: true, value: {} });
  return { confirmSheetScales: ok, confirmSheetSuggestions: ok, confirmWindows: ok, undoConfirmWindows: ok, priceLineFromCost: ok, reviewWall: ok, setWallGroupHeight: ok, undoSheetSuggestions: ok, markWholeSheetNewWork: (...a: unknown[]) => whole(...(a as [])) };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { TakeoffReviewQueue } = await import("./TakeoffReviewQueue");

const existing: ReviewItem = { kind: "existing", key: "existing:3", pageNumber: 3, sheet: "A-101", walls: 12, feet: 340 };
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  whole.mockClear();
});
function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(TakeoffReviewQueue, { jobId: "job-1", planId: "plan-1", items: [existing], legendCodes: [], planSet: [], onShow: () => {}, onClose: () => {} })));
  return host;
}
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll<HTMLButtonElement>('[data-takeoff="review-queue-existing"] button')].find((b) => b.textContent?.trim() === text);

describe("W5b: the queue's renovation step asks for the work area", () => {
  it("in the order's words, with the two exits", () => {
    const host = mount();
    expect(host.querySelector('[data-takeoff="review-queue-existing"]')?.textContent).toContain("Draw your work area: walls outside it won't be counted");
    expect(button(host, "Draw work area")).toBeDefined();
    expect(button(host, "Whole sheet is new work")).toBeDefined();
  });
  it("Draw work area takes the sheet there with the tool picked", () => {
    const host = mount();
    const seen: unknown[] = [];
    const listen = (e: Event) => seen.push((e as CustomEvent).detail);
    document.addEventListener("takeoff-work-area", listen);
    act(() => button(host, "Draw work area")!.click());
    document.removeEventListener("takeoff-work-area", listen);
    expect(seen).toEqual([{ page: 3 }]);
  });
  it("Whole sheet is new work answers that sheet", async () => {
    const host = mount();
    await act(async () => void button(host, "Whole sheet is new work")!.click());
    expect(whole).toHaveBeenCalledWith("plan-1", 3);
  });
});

describe("W5b follow-up: the queue's Whole sheet button goes busy", () => {
  it("disables at once and ignores a second press while the save runs", async () => {
    let finish: (v: unknown) => void = () => {};
    whole.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)) as never);
    const host = mount();
    await act(async () => void button(host, "Whole sheet is new work")!.click());
    const busy = host.querySelector<HTMLButtonElement>('[data-takeoff="review-queue-whole-sheet"]')!;
    expect(busy.disabled).toBe(true);
    expect(busy.textContent).toContain("Saving…");
    await act(async () => void busy.click());
    expect(whole).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true, value: { ids: ["x"] } }));
  });
});
