import { describe, expect, it } from "vitest";
import { startPages, type StartFacts } from "./startPage";

const sheet = (pageNumber: number, score: number, more: Partial<StartFacts> = {}): StartFacts => ({ pageNumber, score, scaled: false, lastMeasuredAt: null, held: 0, ...more });

describe("the sheet the workspace opens on", () => {
  // A cover (-100), a demolition sheet (-250), two floor plans, an elevation.
  const set = [sheet(1, -100), sheet(2, -250), sheet(3, 105), sheet(4, 85), sheet(5, -200)];

  it("is the best floor plan on a fresh set, never the cover or the demolition sheet", () => {
    expect(startPages(set).work).toBe(3);
  });

  it("is the sheet last worked on once there is one", () => {
    const worked = set.map((s) => (s.pageNumber === 4 ? { ...s, lastMeasuredAt: 2 } : s.pageNumber === 3 ? { ...s, lastMeasuredAt: 1 } : s));
    expect(startPages(worked).work).toBe(4);
  });

  it("for Scale, the first sheet in page order with no scale that is not something else", () => {
    expect(startPages(set).scale).toBe(3);
    expect(startPages(set.map((s) => (s.pageNumber === 3 ? { ...s, scaled: true } : s))).scale).toBe(4);
  });

  it("for Review, the first sheet holding a wall to confirm, else the work sheet", () => {
    expect(startPages(set).review).toBe(3);
    expect(startPages(set.map((s) => (s.pageNumber === 4 ? { ...s, held: 2 } : s))).review).toBe(4);
  });

  it("falls back to the first page when every title says something else", () => {
    expect(startPages([sheet(7, -100), sheet(8, -200)])).toEqual({ work: 7, scale: 7, review: 7 });
  });
});
