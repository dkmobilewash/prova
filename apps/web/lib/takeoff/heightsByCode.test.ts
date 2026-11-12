import { describe, expect, it } from "vitest";
import { setHeightRule, wallHeightByCode, wallHeightChain } from "./heightsByCode";
import type { HeightFact } from "./wallHeights";
import { itemGeometry } from "@/lib/estimating/takeoff-item-lines";
import { bidChecks } from "@/lib/estimating/bidCheck";

const note = (text: string): HeightFact => ({ kind: "note", feet: null, text, sheet: "A001", phrase: text });
const fact = (kind: HeightFact["kind"], feet: number): HeightFact => ({ kind, feet, sheet: "A301", phrase: `${feet} ft` });

describe("level 1: the rule the drawing prints", () => {
  it("all walls to deck, one structure elevation: every wall that height (Baker)", () => {
    const rule = setHeightRule(note("ALL WALLS WILL BE TO DECK ABOVE UNLESS OTHERWISE NOTED."), [fact("structure-elevation", 15), fact("ceiling-height", 10)]);
    expect(rule).toMatchObject({ kind: "to-structure", feet: 15 });
    expect(wallHeightByCode(rule, [10, null])?.feet).toBe(15);
  });
  it("to deck with two structure elevations: by the roof over each wall's rooms, and none where the roof plan says nothing", () => {
    expect(setHeightRule(note("ALL WALLS TO DECK ABOVE U.N.O."), [fact("structure-elevation", 12)])).toMatchObject({ kind: "to-structure" });
    const two = setHeightRule(note("ALL WALLS TO DECK ABOVE U.N.O."), [fact("structure-elevation", 12), fact("structure-elevation", 16)]);
    expect(two).toMatchObject({ kind: "to-structure-by-roof", pitchedFeet: 16, flatFeet: 12 });
    expect(wallHeightByCode(two, [10, 10], [null, null])).toBeNull();
  });
  it("8\" above the highest adjacent ceiling: the higher room's ceiling, else the set's one ceiling (Green Bay)", () => {
    const rule = setHeightRule(note('TERMINATE ALL PARTITIONS 8" ABOVE HIGHEST ADJACENT CEILING'), [fact("ceiling-height", 8)]);
    expect(wallHeightByCode(rule, [9, 10])?.feet).toBeCloseTo(10 + 8 / 12, 5);
    expect(wallHeightByCode(rule, [null, null])?.feet).toBeCloseTo(8 + 8 / 12, 5);
    expect(wallHeightByCode(setHeightRule(note('TERMINATE ALL PARTITIONS 8" ABOVE HIGHEST ADJACENT CEILING'), []), [null, null])).toBeNull();
  });
  it("all studs to the ceiling structure under two roofs: the roof the rooms sit under, the higher where they differ (Joplin)", () => {
    const rule = setHeightRule(null, [note("ALL STUDS ARE CONTINUOUS FROM FLOOR STRUCTURE TO CEILING STRUCTURE UNLESS"), fact("bearing-elevation", 16 + 8 / 12), fact("bearing-elevation", 12 + 4 / 12)]);
    expect(rule?.kind).toBe("to-structure-by-roof");
    expect(wallHeightByCode(rule, [], [false, true])?.feet).toBeCloseTo(16 + 8 / 12, 5);
    expect(wallHeightByCode(rule, [], [false, null])?.feet).toBeCloseTo(12 + 4 / 12, 5);
    expect(wallHeightByCode(rule, [], [null, null])).toBeNull();
  });
  it("no general rule: nothing", () => {
    expect(setHeightRule(null, [fact("structure-elevation", 15)])).toBeNull();
  });
});

describe("the chain: the drawing first, else the company default, assumed", () => {
  it("what the drawing prints is not assumed", () => {
    const rule = setHeightRule(note("ALL WALLS TO DECK ABOVE"), [fact("structure-elevation", 15)]);
    expect(wallHeightChain(rule, [], [], 10)).toMatchObject({ feet: 15, assumed: false });
  });
  it("nothing printed: the default, assumed, and never the room's ceiling (level 2 measured 98.6% wrong on held-out)", () => {
    expect(wallHeightChain(null, [9, 9], [], 10)).toEqual({ feet: 10, from: "assumed: your default wall height, 10 ft", assumed: true });
  });
  it("nothing printed and no default: no height", () => {
    expect(wallHeightChain(null, [9], [], null)).toBeNull();
  });
});

describe("a wall's own height on the bid", () => {
  const wall = (id: string, x2: number, heightFt: number | null, heightAssumed = false) => ({ id, pageNumber: 1, kind: "LINEAR" as const, xs: [0, x2], ys: [0, 0], feetPerPageWidth: 100, heightFt, heightAssumed });
  const item = (heightFt: number | null, measurements: ReturnType<typeof wall>[]) => ({ id: "i", name: "Walls", type: "LINEAR" as const, heightFt, sides: 2, wastePercent: null, depthIn: null, wallTypeId: "w", measurements });
  it("an item with no height boards each wall at its own: 10 ft at 15 + 20 ft at 10, two sides", () => {
    const g = itemGeometry(item(null, [wall("a", 0.1, 15), wall("b", 0.2, 10)]));
    expect(g.boardedSqFt).toBeCloseTo(2 * (10 * 15 + 20 * 10), 5);
    expect(g.heightFt).toBeCloseTo((10 * 15 + 20 * 10) / 30, 5);
  });
  it("an item's own height always wins over its walls'", () => {
    expect(itemGeometry(item(12, [wall("a", 0.1, 15)])).boardedSqFt).toBeCloseTo(2 * 10 * 12, 5);
  });
  it("a wall with no height adds no board, as before", () => {
    expect(itemGeometry(item(null, [wall("a", 0.1, null)])).boardedSqFt).toBe(0);
  });
});

describe("bid check asks about an assumed height", () => {
  const facts = (assumed?: { walls: number; feet: number | null }) =>
    ({ jobId: "j", heights: { queueGroups: 0, runs: [], assumed }, unpriced: [], laborMissing: [], review: { type: 0, wall: 0, windows: 0, scale: 0 }, specConflicts: [], quantities: { grossAreaSqFt: null, faceSqFt: 0, boardSqFt: 0 }, existing: { compareOn: true, sheets: [] } }) as unknown as Parameters<typeof bidChecks>[0];
  it("14 walls on the default: open, saying so", () => {
    const heights = bidChecks(facts({ walls: 14, feet: 10 })).find((c) => c.key === "heights")!;
    expect(heights.open).toBe(true);
    expect(heights.lines).toContain("14 walls use your default height (10 ft), not one read from the drawing: confirm");
  });
  it("none: clear", () => {
    expect(bidChecks(facts({ walls: 0, feet: 10 })).find((c) => c.key === "heights")!.open).toBe(false);
  });
});
