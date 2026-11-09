// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewItem } from "@/lib/takeoff/reviewQueue";
import type { SpecSay } from "@/lib/specs/specTradeFacts";

/**
 * The review queue shows what the spec says that changes a type's price beside the group being
 * typed: for the type the drawing suggests, else the items that hold whatever the type. Mounted
 * as the page mounts it; happy-dom does no layout, so this says the words are on the card and
 * nothing about where they sit.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
// Every action the queue imports, as a no-op. Named, not a catch-all Proxy: a Proxy answers `then`
// and makes the module look like a promise that never settles.
vi.mock("@/lib/actions", () => {
  const ok = async () => ({ ok: true, value: {} });
  return { confirmSheetScales: ok, confirmSheetSuggestions: ok, confirmWindows: ok, undoConfirmWindows: ok, priceLineFromCost: ok, reviewWall: ok, setWallGroupHeight: ok, undoSheetSuggestions: ok };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { TakeoffReviewQueue } = await import("./TakeoffReviewQueue");

const group = (key: string, suggested: string | null): ReviewItem => ({
  kind: "type",
  key,
  pageNumber: 1,
  sheet: "A101",
  inches: 4.875,
  runs: [{ x1: 0, y1: 0, x2: 1, y2: 0 }],
  feet: 40,
  suggested: suggested === null ? null : { code: suggested, from: "printed tag" },
  ceiling: null,
});
const says: Record<string, SpecSay[]> = {
  A1: [
    { text: "Type X board", source: "09 21 16", part: "board" },
    { text: "20 ga studs", source: "09 22 16, sheet A100", part: "framing" },
  ],
  "*": [{ text: "Level 5 finish at the lobby", source: "09 21 16, sheet G001", part: "board" }],
};

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(items: ReviewItem[]): string {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(TakeoffReviewQueue, {
        jobId: "job-1",
        planId: "plan-1",
        items,
        legendCodes: ["A1", "B2"],
        specSays: says,
        planSet: [],
        onShow: () => {},
        onClose: () => {},
      }),
    ),
  );
  return host.querySelector('[data-takeoff="review-queue-spec-says"]')?.textContent ?? "";
}

describe("the review queue's spec-says line", () => {
  it("names the suggested type and what the spec says about it, with each source", () => {
    expect(mount([group("g1", "A1")])).toBe("A1 · Spec says: Type X board (09 21 16); 20 ga studs (09 22 16, sheet A100)");
  });

  it("with no suggested type, says what holds whatever the type; with nothing said, shows no line", () => {
    expect(mount([group("g1", null)])).toBe("Spec says: Level 5 finish at the lobby (09 21 16, sheet G001)");
    act(() => root?.unmount());
    root = null;
    expect(mount([group("g2", "B2")])).toBe("");
  });
});
