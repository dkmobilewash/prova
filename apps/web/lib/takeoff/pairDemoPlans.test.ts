import { describe, expect, it } from "vitest";
import { pairDemoWithNewPlan, type SheetForPairing } from "./pairDemoPlans";

const sheet = (pageNumber: number, sheetNumber: string, title: string): SheetForPairing => ({ pageNumber, sheetNumber, title });
const FPU = 288;
const walls = (dx: number) => [0.1, 0.2, 0.3].map((y, i) => ({ x1: 0.1 + dx, y1: y, x2: 0.2 + 0.05 * i + dx, y2: y }));

describe("pairDemoWithNewPlan", () => {
  it("a twin sheet number decides, across the ways a set writes it", () => {
    const pairs = pairDemoWithNewPlan([sheet(1, "AD101", "FIRST FLOOR - DEMOLITION"), sheet(2, "A101", "FIRST FLOOR PLAN"), sheet(3, "DA2.1", "BUILDING A"), sheet(4, "AA2.1", "BUILDING A")]);
    expect(pairs.map((p) => [p.demoPage, p.newPage, p.basis])).toEqual([[1, 2, "sheet-number"], [3, 4, "sheet-number"]]);
  });
  it("matches level and area by title, and keeps floors, ceilings and disciplines apart", () => {
    const set = [sheet(1, "A1.1", "DEMOLITION PLAN - LEVEL 2 EAST"), sheet(2, "A2.1", "LEVEL 2 EAST FLOOR PLAN"), sheet(3, "A2.2", "LEVEL 2 WEST FLOOR PLAN"), sheet(4, "A2.3", "LEVEL 3 EAST FLOOR PLAN"), sheet(5, "A3.1", "LEVEL 2 EAST REFLECTED CEILING PLAN"), sheet(6, "E2.1", "LEVEL 2 EAST ELECTRICAL PLAN")];
    expect(pairDemoWithNewPlan(set).map((p) => [p.newPage, p.basis, p.level, p.area])).toEqual([[2, "title", "Level 2", "EAST"]]);
  });
  it("lets the drawing's lines choose among several, and reports the shift", () => {
    const set = [sheet(1, "A001", "DEMOLITION PLAN"), sheet(2, "A100", "OVERALL FLOOR PLAN"), sheet(3, "A101", "FLOOR PLAN")];
    const lines = new Map([[1, walls(0)], [2, [{ x1: 0, y1: 0, x2: 0.01, y2: 0 }]], [3, walls(0.3)]]);
    const [pair] = pairDemoWithNewPlan(set, { lines, feetPerUnit: FPU });
    expect([pair.newPage, pair.basis, pair.alternatives]).toEqual([3, "grid", [2]]);
    expect(pair.shift?.dx).toBeCloseTo(0.3);
  });
  it("refuses to guess: several candidates and nothing to choose by gives no pair, with the candidates named", () => {
    const [pair] = pairDemoWithNewPlan([sheet(1, "A001", "DEMOLITION PLAN"), sheet(2, "A100", "OVERALL FLOOR PLAN"), sheet(3, "A101", "FLOOR PLAN")]);
    expect([pair.newPage, pair.basis, pair.alternatives]).toEqual([null, "none", [2, 3]]);
  });
  it("prefers the whole floor to an enlarged plan, and leaves a site demolition plan out", () => {
    const pairs = pairDemoWithNewPlan([sheet(1, "A1.1", "FIRST FLOOR DEMOLITION PLAN"), sheet(2, "A5.1", "ENLARGED FIRST FLOOR PLAN"), sheet(3, "A2.1", "FIRST FLOOR PLAN"), sheet(4, "A0.1", "SITE PLAN - DEMOLITION")]);
    expect(pairs.map((p) => [p.demoPage, p.newPage])).toEqual([[1, 3]]);
  });
  it("a twin number decides even when the titles are noise, and noise alone pairs nothing", () => {
    const set = [sheet(1, "AD101", "BID DOCUMENTS"), sheet(2, "A101", "BID DOCUMENTS"), sheet(3, "D7", "BUILDING A"), sheet(4, "A1.2", "TRASH ENCLOSURE PLAN"), sheet(5, "A2.1", "FLOOR PLAN")];
    expect(pairDemoWithNewPlan(set).map((p) => [p.demoPage, p.newPage])).toEqual([[1, 2], [3, null]]);
  });
  it("a slab or finish plan of the floor is not the floor plan, however well it aligns", () => {
    const set = [sheet(1, "A1.1", "DEMOLITION - FLOOR PLAN"), sheet(2, "A1.2", "SLAB EXISTING CONDITION PLAN"), sheet(3, "A9.1", "FINISH PLAN"), sheet(4, "A2.1", "FLOOR PLAN")];
    expect(pairDemoWithNewPlan(set).map((p) => [p.newPage, p.basis])).toEqual([[4, "title"]]);
  });
});
