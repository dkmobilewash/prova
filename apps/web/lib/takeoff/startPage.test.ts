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

  it("IS THE FLOOR PLAN THE WHOLE-SET RUN COUNTS, over an overall plan or a ceiling plan the titles rank as high (new-customer run v2, M2)", () => {
    // Baker: A100 OVERALL FLOOR PLAN p12 and A101 FLOOR PLAN p13 rank alike, the RCP p20 near them; the run counts A101.
    const baker = [sheet(12, 105, { scaled: true }), sheet(13, 105, { scaled: true }), sheet(20, 100, { scaled: true })];
    expect(startPages(baker).work).toBe(12);
    expect(startPages(baker, [13]).work).toBe(13);
    // Before its scale is saved it has no page row yet, and it is still where the work is.
    expect(startPages([sheet(20, 100, { scaled: true })], [13]).work).toBe(13);
    // A sheet a person worked on still wins.
    expect(startPages(baker.map((s) => (s.pageNumber === 20 ? { ...s, lastMeasuredAt: 5 } : s)), [13]).work).toBe(20);
  });

  it("TAKES THE COUNTED FLOOR PLANS BEST-RANKED FIRST, for work and for Scale: E Street opened on A0.4's paving, not A2.1 (Chrome's re-test)", () => {
    // Page order and scores as E Street's: A0.4 paving 23 (5), A1.2 slab 25 (45), A2.1 FLOOR PLAN 28 (95), A2.4 skylight 31 (5).
    const eStreet = [sheet(1, -100), sheet(23, 5), sheet(25, 45), sheet(28, 95), sheet(31, 5)];
    const counted = [23, 25, 28, 31];
    expect(startPages(eStreet, counted)).toEqual({ work: 28, scale: 28, review: 28 });
    // Once A2.1 is scaled, Scale goes to the next-best counted plan, not back to the paving.
    expect(startPages(eStreet.map((s) => (s.pageNumber === 28 ? { ...s, scaled: true } : s)), counted)).toMatchObject({ work: 28, scale: 25 });
  });
});
