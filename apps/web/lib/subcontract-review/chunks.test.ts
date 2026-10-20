import { describe, expect, it } from "vitest";
import { chargeablePages, newPagesInChunk, planChunks } from "./chunks";

const page = (characters: number) => ["x".repeat(characters)];

describe("planChunks", () => {
  it("covers every readable page, overlapping consecutive chunks by one page", () => {
    const pages = Array.from({ length: 20 }, () => page(100));
    const plan = planChunks(pages, { maxPages: 8, overlap: 1 });
    expect(plan).toEqual([
      [1, 2, 3, 4, 5, 6, 7, 8],
      [8, 9, 10, 11, 12, 13, 14, 15],
      [15, 16, 17, 18, 19, 20],
    ]);
    expect(new Set(plan.flat()).size).toBe(20);
  });

  it("never sends an unread page and keeps real page numbers across the gap", () => {
    const plan = planChunks([page(100), null, page(100), null, null, page(100)], { maxPages: 8 });
    expect(plan).toEqual([[1, 3, 6]]);
  });

  it("splits on characters as well as pages, and always takes at least one page however long", () => {
    const plan = planChunks([page(50_000), page(10), page(10)], { maxCharacters: 30_000 });
    // A one-page chunk has nothing to overlap with that would not repeat it whole.
    expect(plan).toEqual([[1], [2, 3]]);
  });

  it("returns no chunks when nothing is readable", () => {
    expect(planChunks([null, null])).toEqual([]);
  });

  it("refuses limits that could never advance", () => {
    expect(() => planChunks([page(1)], { maxPages: 2, overlap: 2 })).toThrow();
  });
});

describe("charging", () => {
  it("charges each readable page once, not once per chunk it was sent in", () => {
    const plan = [[1, 2, 3], [3, 4, 5], [5, 6]];
    expect(chargeablePages(plan)).toBe(6);
    expect(plan.map((_, index) => newPagesInChunk(plan, index))).toEqual([3, 2, 1]);
  });
});
