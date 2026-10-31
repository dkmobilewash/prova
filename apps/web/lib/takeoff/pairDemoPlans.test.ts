import { describe, expect, it } from "vitest";
import { demoEvidence, pairDemoWithNewPlan, type SheetForPairing } from "./pairDemoPlans";

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
  it("the sheet frame every page shares does not count as agreement", () => {
    const frame = [{ x1: 0.02, y1: 0.02, x2: 0.98, y2: 0.02 }, { x1: 0.02, y1: 0.68, x2: 0.98, y2: 0.68 }, { x1: 0.9, y1: 0.1, x2: 0.97, y2: 0.1 }, { x1: 0.9, y1: 0.2, x2: 0.97, y2: 0.2 }, { x1: 0.9, y1: 0.3, x2: 0.97, y2: 0.3 }];
    const set = [sheet(1, "A001", "DEMOLITION PLAN"), sheet(2, "A100", "OVERALL FLOOR PLAN"), sheet(3, "A101", "FLOOR PLAN")];
    const shared = new Map([[1, frame], [2, frame], [3, frame]]);
    expect(pairDemoWithNewPlan(set, { lines: shared, feetPerUnit: FPU })[0].newPage).toBeNull();
    const real = new Map([[1, [...frame, ...walls(0)]], [2, frame], [3, [...frame, ...walls(0.2)]]]);
    expect(pairDemoWithNewPlan(set, { lines: real, feetPerUnit: FPU })[0].newPage).toBe(3);
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
  it("finds a demolition plan on a sheet titled otherwise", () => {
    const set = [{ ...sheet(1, "A001", "KEYNOTE LEGEND"), demoCaption: "DEMO PLAN" }, sheet(2, "A101", "FLOOR PLAN")];
    expect(pairDemoWithNewPlan(set).map((p) => [p.demoPage, p.newPage, p.basis])).toEqual([[1, 2, "title"]]);
    expect(pairDemoWithNewPlan([sheet(1, "A001", "KEYNOTE LEGEND"), sheet(2, "A101", "FLOOR PLAN")])).toEqual([]);
  });
});

describe("demoEvidence", () => {
  const items = (...lines: string[]) => lines.map((str) => ({ str }));
  it("reads a caption, a heading or a legend row, and hands back the caption", () => {
    expect(demoEvidence(items("2 DEMO PLAN", "SCALE: 1/8\" = 1'-0\""))).toBe("2 DEMO PLAN");
    expect(demoEvidence(items("BASEMENT DEMO", "1/8\" = 1'-0\""))).toBeNull();
    expect(demoEvidence(items("DEMOLITION LEGEND"))).toBe("DEMOLITION PLAN");
    expect(demoEvidence(items("EXISTING WALL TO BE DEMOLISHED"))).toBe("DEMOLITION PLAN");
    expect(demoEvidence(items("REMOVE / DEMOLISH"))).toBe("DEMOLITION PLAN");
  });
  it("a drawing list naming a demolition plan is not one", () => {
    const list = ["A000", "A101", "A102", "A103", "A201", "A301", "A401", "A501"];
    const column = list.map((str, i) => ({ str, x: 100, y: i * 12 }));
    expect(demoEvidence([{ str: "DEMOLITION FLOOR PLAN", x: 200 }, ...column])).toBeNull();
    const scattered = list.map((str, i) => ({ str, x: 100 + i * 90 }));
    expect(demoEvidence([{ str: "DEMO PLAN", x: 200 }, ...scattered])).toBe("DEMO PLAN");
  });
  it("is not fooled by notes or an existing-wall legend on a new plan", () => {
    expect(demoEvidence(items("EXISTING WALL TO REMAIN", "NEW WALL"))).toBeNull();
    expect(demoEvidence(items("DEMOLITION: WORK REQUIRED IS NOTED ON PLANS."))).toBeNull();
    expect(demoEvidence(items("REFER TO CIVIL DEMOLITION PLAN FOR SITE"))).toBeNull();
    expect(demoEvidence(items("SEE DEMOLITION PLAN AND PLUMBING DWGS."))).toBeNull();
  });
});
