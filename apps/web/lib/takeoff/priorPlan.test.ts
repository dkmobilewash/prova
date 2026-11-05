import { describe, expect, it } from "vitest";
import { findWallsOnSheet } from "./findWallsOnSheet";
import { offeredCandidates } from "./offeredCandidates";
import { priorPlanFor } from "./priorPlan";
import { autoPairs, pairingFor } from "./priorPlanLoad";
import { takeoffFeatureRows } from "./features";
import type { StrokeSegment } from "./wallVectors";

describe("which demolition plan a new plan is compared with", () => {
  const sheet = (pageNumber: number, sheetNumber: string, title: string) => ({ pageNumber, sheetNumber, title });

  it("pairs by twin sheet number — D100 with A100, AD101 with A101", () => {
    const pairs = autoPairs([sheet(1, "D100", "DEMOLITION FLOOR PLAN - LEVEL 1"), sheet(2, "A100", "FLOOR PLAN - LEVEL 1"), sheet(3, "AD101", "DEMOLITION FLOOR PLAN - LEVEL 2"), sheet(4, "A101", "FLOOR PLAN - LEVEL 2")]);
    expect(pairs.get(2)?.demoPage).toBe(1);
    expect(pairs.get(4)?.demoPage).toBe(3);
  });

  it("pairs by title when the numbers differ — AD1.0 with the one floor plan", () => {
    const pairs = autoPairs([sheet(5, "AD1.0", "DEMOLITION FLOOR PLAN"), sheet(9, "A3.1", "FLOOR PLAN"), sheet(12, "A5.1", "BUILDING SECTIONS")]);
    expect(pairs.get(9)?.demoPage).toBe(5);
    expect(pairs.has(12)).toBe(false);
  });

  it("does not guess between two plans the titles cannot tell apart", () => {
    const pairs = autoPairs([sheet(1, "AD1.0", "DEMOLITION PLAN"), sheet(2, "A2.1", "FLOOR PLAN"), sheet(3, "A2.2", "FLOOR PLAN")]);
    expect(pairs.size).toBe(0);
  });

  it("a person's choice wins: another page, or the pairing removed", () => {
    const auto = new Map([[2, { demoPage: 1, basis: "sheet-number" }]]);
    expect(pairingFor(2, auto, null)).toEqual({ demoPage: 1, source: "auto", basis: "sheet-number" });
    expect(pairingFor(2, auto, { priorPage: 7, choice: "user" })).toEqual({ demoPage: 7, source: "user", basis: "chosen" });
    expect(pairingFor(2, auto, { priorPage: null, choice: "none" })).toBeNull();
    expect(pairingFor(2, auto, { priorPage: null, choice: null })?.source).toBe("auto");
  });
});

describe("what the demolition plan sets aside", () => {
  // A floor of walls, 6 in thick, in points on a 1224 × 792 sheet at 136 ft across.
  const P = 1224 / 136;
  const T = 0.5 * P;
  const wall = (x1: number, y1: number, x2: number, y2: number): StrokeSegment[] => {
    const vertical = x1 === x2;
    const o = T / 2;
    return vertical
      ? [{ x1: x1 * P - o, y1: y1 * P, x2: x2 * P - o, y2: y2 * P, width: 1 }, { x1: x1 * P + o, y1: y1 * P, x2: x2 * P + o, y2: y2 * P, width: 1 }]
      : [{ x1: x1 * P, y1: y1 * P - o, x2: x2 * P, y2: y2 * P - o, width: 1 }, { x1: x1 * P, y1: y1 * P + o, x2: x2 * P, y2: y2 * P + o, width: 1 }];
  };
  const existing = [wall(20, 20, 100, 20), wall(20, 70, 100, 70), wall(20, 20, 20, 70), wall(100, 20, 100, 70), wall(50, 20, 50, 70), wall(75, 20, 75, 45), wall(20, 45, 50, 45), wall(75, 45, 100, 45)].flat();
  const fresh = [wall(60, 50, 60, 70), wall(60, 50, 75, 50)].flat();
  // Short marks a real sheet carries everywhere — dimension ticks, hatching — so it reads as a drawing.
  const ticks: StrokeSegment[] = Array.from({ length: 120 }, (_, i) => ({ x1: (110 + (i % 12)) * P, y1: (20 + Math.floor(i / 12) * 4) * P, x2: (110.4 + (i % 12)) * P, y2: (20.4 + Math.floor(i / 12) * 4) * P, width: 0.5 }));
  const W = 1224;
  const feetPerUnit = 136;
  const runsOf = (segments: StrokeSegment[]) => findWallsOnSheet({ segments, textItems: [], pageSize: { widthPt: W, heightPt: 792 }, feetPerUnit, wallTypes: [], sampledSheets: null }).walls;
  const newSegments = [...existing, ...fresh, ...ticks];
  const newRuns = runsOf(newSegments);
  const demo = (segments: StrokeSegment[]) => ({ segments, textItems: [], widthPt: W, heightPt: 792 });
  const offer = (priorPlan?: { lines: NonNullable<ReturnType<typeof priorPlanFor>["lines"]>; sheet: string }) =>
    offeredCandidates({ walls: newRuns, segments: newSegments, widthPt: W, feetPerUnit, planBoxes: null, ...(priorPlan === undefined ? {} : { priorPlan }) });

  it("a wall on the demolition plan too is set aside as existing; the new walls are offered", () => {
    const prior = priorPlanFor({ demo: demo([...existing, ...ticks]), newPage: { segments: newSegments, widthPt: W }, newRuns, feetPerUnit });
    expect(prior.lines).not.toBeNull();
    const before = offer();
    const after = offer({ lines: prior.lines!, sheet: "AD101" });
    const asideFeet = after.setAsideLines.filter((l) => l.kind === "on-prior-plan").reduce((n, l) => n + l.lengthFeet, 0);
    const freshFeet = after.offeredRuns.reduce((n, w) => n + w.lengthFeet, 0);
    expect(asideFeet).toBeGreaterThan(300);
    // What stays is the new work: the two walls only the new plan draws (35 ft), give or take the joins.
    expect(freshFeet).toBeGreaterThan(25);
    expect(freshFeet).toBeLessThan(50);
    expect(after.setAside.find((a) => a.kind === "on-prior-plan")?.why).toContain("AD101");
    expect(before.offeredRuns.length).toBeGreaterThan(after.offeredRuns.length);
  });

  it("a demolition plan that does not line up sets nothing aside, and says why", () => {
    const elsewhere = [wall(5, 5, 9, 5), wall(5, 9, 9, 9)].flat();
    const prior = priorPlanFor({ demo: demo([...elsewhere, ...Array.from({ length: 60 }, () => elsewhere).flat()]), newPage: { segments: newSegments, widthPt: W }, newRuns, feetPerUnit });
    expect(prior.lines).toBeNull();
    if (prior.lines === null) expect(prior.why).toMatch(/does not line up|no drawing/);
  });

  it("a demolition plan sharing one wall is not the same layout: under the vote floor, nothing is compared", () => {
    // One of the eight walls in common — a shared corridor wall, not this floor.
    const few = wall(20, 20, 100, 20);
    const prior = priorPlanFor({ demo: demo([...few, ...ticks]), newPage: { segments: newSegments, widthPt: W }, newRuns, feetPerUnit });
    expect(prior.lines).toBeNull();
    if (prior.lines === null) expect(prior.why).toMatch(/of 5 walls agree/);
  });

  it("a wall the demolition plan removes is not existing to remain", () => {
    // The demolition plan draws the middle partition dashed: to be removed.
    const dashed: StrokeSegment[] = [];
    for (let y = 20; y < 70; y += 2) dashed.push({ x1: 50 * P - T / 2, y1: y * P, x2: 50 * P - T / 2, y2: (y + 1) * P, width: 1 }, { x1: 50 * P + T / 2, y1: y * P, x2: 50 * P + T / 2, y2: (y + 1) * P, width: 1 });
    const kept = [wall(20, 20, 100, 20), wall(20, 70, 100, 70), wall(20, 20, 20, 70), wall(100, 20, 100, 70), wall(75, 20, 75, 45), wall(20, 45, 50, 45), wall(75, 45, 100, 45)].flat();
    const prior = priorPlanFor({ demo: demo([...kept, ...dashed, ...ticks]), newPage: { segments: newSegments, widthPt: W }, newRuns, feetPerUnit });
    expect(prior.lines).not.toBeNull();
    const after = offer({ lines: prior.lines!, sheet: "AD101" });
    const middle = after.offeredRuns.filter((w) => Math.abs(w.x1 * feetPerUnit - 50) < 1 && Math.abs(w.x2 * feetPerUnit - 50) < 1);
    expect(middle.length).toBeGreaterThan(0);
  });
});

describe("the company switch", () => {
  it("is off until the owner turns it on, and says where", () => {
    const rows = takeoffFeatureRows({ roomFinderOn: false, demotedWallsOn: false, ai: { aiEnabled: false, planTextReadOptedIn: false }, anthropicConfigured: false, planCompareOn: false });
    const row = rows.find((r) => r.key === "planCompare");
    expect(row?.status).toEqual({ kind: "off" });
    expect(row?.where.href).toContain("#plan-compare");
    expect(row?.field).toBe("planCompareOn");
  });
});
