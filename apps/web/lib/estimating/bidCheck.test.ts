import { describe, expect, it } from "vitest";
import { bidChecks, bidCheckSummary, boardSqFtOf, type BidCheckFacts } from "./bidCheck";

const clear: BidCheckFacts = {
  jobId: "j1",
  heights: { queueGroups: 0, runs: [] },
  unpriced: [],
  laborMissing: [],
  review: { type: 0, wall: 0, windows: 0, scale: 0 },
  specConflicts: [],
  // 2,000 LF over 10,000 SF = 0.20; 28,000 SF of board over 20,000 SF of face = 1.40.
  quantities: { grossAreaSqFt: 10_000, wallLf: 2_000, wallFaceSqFt: 20_000, boardSqFt: 28_000 },
  existing: { compareOn: true, sheets: [] },
};
const check = (f: BidCheckFacts, key: string) => bidChecks(f).find((c) => c.key === key)!;

describe("the bid check", () => {
  it("has seven checks, all clear on a finished bid, and says so", () => {
    const checks = bidChecks(clear);
    expect(checks.map((c) => c.key)).toEqual(["heights", "prices", "rates", "review", "spec", "quantities", "existing"]);
    expect(checks.filter((c) => c.open)).toEqual([]);
    expect(checks.every((c) => c.fix === null)).toBe(true);
    expect(bidCheckSummary(checks)).toBe("All 7 checks clear");
  });

  it("counts the open ones", () => {
    const f = { ...clear, unpriced: ["S6B — joint tape"], laborMissing: ["framing (lin ft per hour)"], review: { type: 2, wall: 0, windows: 0, scale: 0 } };
    expect(bidCheckSummary(bidChecks(f))).toBe("3 checks open");
    expect(bidCheckSummary(bidChecks({ ...clear, unpriced: ["x"] }))).toBe("1 check open");
  });

  it("heights: queue groups go to the review queue, runs alone to the wall schedule", () => {
    const q = check({ ...clear, heights: { queueGroups: 3, runs: ["Corridor (S6B)"] } }, "heights");
    expect(q.open).toBe(true);
    expect(q.lines).toEqual(["3 wall groups on the takeoff with no height", "Corridor (S6B): no height on the run or its type"]);
    expect(q.fix).toEqual({ label: "Set the heights", href: "/takeoff/j1?open=review", newTab: true });
    expect(check({ ...clear, heights: { queueGroups: 0, runs: ["Corridor (S6B)"] } }, "heights").fix?.href).toBe("/jobs/j1/estimate#wall-schedule");
  });

  it("prices: names the first five and counts the rest", () => {
    const c = check({ ...clear, unpriced: ["a", "b", "c", "d", "e", "f", "g"] }, "prices");
    expect(c.lines).toEqual(["7 lines with no price or cost:", "a", "b", "c", "d", "e", "and 2 more"]);
    expect(c.fix?.href).toBe("/jobs/j1/estimate");
  });

  it("rates: lists what is missing and links to the rates form", () => {
    const c = check({ ...clear, laborMissing: ["framing (lin ft per hour)", "the crew rate ($ per hour)"] }, "rates");
    expect(c.open).toBe(true);
    expect(c.lines[0]).toContain("framing (lin ft per hour), the crew rate ($ per hour)");
    expect(c.fix?.href).toBe("/wall-types#production-rates");
  });

  it("review: one line per kind left, none for an empty kind", () => {
    const c = check({ ...clear, review: { type: 1, wall: 14, windows: 0, scale: 2 } }, "review");
    expect(c.lines).toEqual(["1 wall group to type", "14 walls held off the estimate to confirm", "2 floor plans with no scale"]);
  });

  it("spec: says what each side says and where", () => {
    const c = check({ ...clear, specConflicts: [{ code: "S6A", what: "Board on a rated wall", legend: "not Type X", spec: "Type X", sectionNumber: "09 21 16" }] }, "spec");
    expect(c.lines).toEqual(["S6A: Board on a rated wall — the legend says not Type X, 09 21 16 says Type X"]);
    expect(c.fix?.href).toBe("/jobs/j1/specs");
  });

  describe("quantities", () => {
    it("shows both ratios when they are in range", () => {
      const c = check(clear, "quantities");
      expect(c.open).toBe(false);
      expect(c.lines[0]).toBe("0.20 LF of wall per SF of floor (2,000 LF over 10,000 SF). Within the usual 0.05–0.4.");
      expect(c.lines[1]).toBe("1.40 SF of board per SF of wall face (28,000 SF of board over 20,000 SF of wall). Within the usual 0.9–4.5.");
    });

    it("too much wall for the floor: the ratio and the usual reasons", () => {
      const c = check({ ...clear, quantities: { ...clear.quantities, wallLf: 6_000 } }, "quantities");
      expect(c.open).toBe(true);
      expect(c.lines[0]).toMatch(/^0\.60 LF of wall per SF of floor \(6,000 LF over 10,000 SF\)\. .*counted twice/);
      expect(c.fix?.href).toBe("/takeoff/j1");
    });

    it("too little wall for the floor", () => {
      const c = check({ ...clear, quantities: { ...clear.quantities, wallLf: 300 } }, "quantities");
      expect(c.open).toBe(true);
      expect(c.lines[0]).toMatch(/^0\.03 .*walls the takeoff missed/);
    });

    it("board out of range either way", () => {
      const over = check({ ...clear, quantities: { ...clear.quantities, boardSqFt: 100_000 } }, "quantities");
      expect(over.open).toBe(true);
      expect(over.lines[1]).toMatch(/^5\.00 SF of board .*counted twice/);
      expect(over.fix?.href).toBe("/jobs/j1/estimate");
      const under = check({ ...clear, quantities: { ...clear.quantities, boardSqFt: 10_000 } }, "quantities");
      expect(under.open).toBe(true);
      expect(under.lines[1]).toMatch(/^0\.50 .*no board on the estimate/);
    });

    it("no floor area is OPEN — a check that cannot be made is not a pass", () => {
      const c = check({ ...clear, quantities: { ...clear.quantities, grossAreaSqFt: null } }, "quantities");
      expect(c.open).toBe(true);
      expect(c.lines[0]).toBe("2,000 LF of wall, and no floor area on the job to check it against.");
      expect(c.fix?.href).toBe("/jobs/j1#job-details");
    });

    it("no walls at all: nothing to check, clear", () => {
      const c = check({ ...clear, quantities: { grossAreaSqFt: null, wallLf: 0, wallFaceSqFt: 0, boardSqFt: null } }, "quantities");
      expect(c.open).toBe(false);
    });
  });

  it("existing: names each sheet; the fix is the switch when it is off, the sheet when it is on", () => {
    const sheets = [{ pageNumber: 4, sheet: "A2.1", walls: 84 }];
    const off = check({ ...clear, existing: { compareOn: false, sheets } }, "existing");
    expect(off.open).toBe(true);
    expect(off.lines[0]).toMatch(/^A2\.1: shows existing work, 84 walls taken off/);
    expect(off.fix?.href).toBe("/settings?tab=estimating#plan-compare");
    expect(check({ ...clear, existing: { compareOn: true, sheets } }, "existing").fix?.href).toBe("/takeoff/j1?page=4");
  });

  it("board square feet off a line: sheets by printed size, 4x8 by default, SF as is", () => {
    expect(boardSqFtOf({ description: "5/8in type X gypsum board, 4x8 sheets", quantity: 10, unit: "SHT" })).toBe(320);
    expect(boardSqFtOf({ description: "5/8in gypsum board, 4x12 sheets", quantity: 10, unit: "SHT" })).toBe(480);
    expect(boardSqFtOf({ description: "5/8in gypsum board", quantity: 10, unit: "SHT" })).toBe(320);
    expect(boardSqFtOf({ description: "gypsum board", quantity: 500, unit: "SF" })).toBe(500);
    expect(boardSqFtOf({ description: "gypsum board", quantity: 5, unit: "LF" })).toBeNull();
  });
});
