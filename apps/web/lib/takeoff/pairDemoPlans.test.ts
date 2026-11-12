import { describe, expect, it } from "vitest";
import { demoPlansFor, demoEvidence, pairDemoWithNewPlan, type SheetForPairing } from "./pairDemoPlans";

const sheet = (pageNumber: number, sheetNumber: string, title: string): SheetForPairing => ({ pageNumber, sheetNumber, title });
const FPU = 288;
const walls = (dx: number) => [0.1, 0.2, 0.3].map((y, i) => ({ x1: 0.1 + dx, y1: y, x2: 0.2 + 0.05 * i + dx, y2: y }));

describe("pairDemoWithNewPlan", () => {
  it("Bluetooth: an interiors series (AI101) is architectural, so its demolition plan AD101 pairs by number, and AD102 with the ceiling plan", () => {
    const set = [sheet(4, "AD101", "DEMOLITION PLAN"), sheet(5, "AD102", "CEILING DEMOLITION PLAN"), sheet(6, "AI101", "CONSTRUCTION PLAN"), sheet(7, "AI101", "CONSTRUCTION PLAN"), sheet(8, "AI131", "REFLECTED CEILING PLAN"), sheet(10, "AF101", "FINISH PLAN")];
    expect(pairDemoWithNewPlan(set).filter((p) => p.primary).map((p) => [p.demoPage, p.newPage, p.basis])).toEqual([[4, 6, "sheet-number"], [5, 8, "title"]]);
  });
  it("Falafel Fresh: ED2.20 'EXISTING / DEMO PLANS' in a set with no E sheets is the architect's existing plan, and pairs with A2.20", () => {
    const set = [sheet(6, "ED2.20", "EXISTING / DEMO PLANS FOR DEMOLITION PLAN LEGEND"), sheet(7, "A2.00", "OVERALL BUILDING PLAN - LOWER LEVEL FOR FLOOR PLAN LEGEND"), sheet(8, "A2.10", "OVERALL BUILDING PLAN - MAIN LEVEL FOR FLOOR PLAN LEGEND"), sheet(9, "A2.20", "ENLARGED FLOOR PLANS FOR"), sheet(14, "A6.20", "REFLECTED CEILING PLANS FOR")];
    expect(pairDemoWithNewPlan(set).filter((p) => p.primary).map((p) => [p.demoPage, p.newPage, p.basis])).toEqual([[6, 9, "sheet-number"]]);
  });
  it("an electrical demolition plan in a set with E sheets stays electrical, never the architect's plan of the same number", () => {
    const set = [sheet(1, "ED101", "ELECTRICAL DEMOLITION PLAN"), sheet(2, "A101", "FLOOR PLAN"), sheet(3, "E102", "ELECTRICAL POWER PLAN")];
    expect(pairDemoWithNewPlan(set).filter((p) => p.primary && p.newPage !== null).map((p) => p.newPage)).not.toContain(2);
    // And with no trade in its title but E sheets in the set, the E is still electrical.
    const quiet = [sheet(1, "ED101", "DEMOLITION PLAN"), sheet(2, "A101", "FLOOR PLAN"), sheet(3, "E101", "POWER PLAN")];
    expect(pairDemoWithNewPlan(quiet).filter((p) => p.primary && p.newPage !== null).map((p) => p.newPage)).not.toContain(2);
  });
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
  it("gives every plan that truly aligns its own row, so either sheet can ask for its demolition plan", () => {
    const many = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5].map((y, i) => ({ x1: 0.1, y1: y, x2: 0.2 + 0.03 * i, y2: y }));
    const moved = (dx: number) => many.map((l) => ({ ...l, x1: l.x1 + dx, x2: l.x2 + dx }));
    const set = [sheet(1, "AD101", "FIRST FLOOR - DEMOLITION"), sheet(2, "A101", "FIRST FLOOR PLAN"), sheet(3, "A100", "FIRST FLOOR PLAN"), sheet(4, "A102", "SECOND FLOOR PLAN")];
    const lines = new Map([[1, many], [2, moved(0.1)], [3, moved(0.2)], [4, moved(0.3)]]);
    const pairs = pairDemoWithNewPlan(set, { lines, feetPerUnit: FPU });
    expect(pairs.map((p) => [p.newPage, p.basis, p.primary])).toEqual([[2, "sheet-number", true], [3, "grid", false]]);
    expect(pairs[1].shift?.dx).toBeCloseTo(0.2);
    expect(pairs.filter((p) => p.primary)).toHaveLength(1);
  });
  it("a plan that barely agrees gets no row of its own", () => {
    const lines = new Map([[1, walls(0)], [2, walls(0.1)], [3, walls(0.2)]]);
    const pairs = pairDemoWithNewPlan([sheet(1, "AD101", "FIRST FLOOR - DEMOLITION"), sheet(2, "A101", "FIRST FLOOR PLAN"), sheet(3, "A100", "FIRST FLOOR PLAN")], { lines, feetPerUnit: FPU });
    expect(pairs.map((p) => p.newPage)).toEqual([2]);
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

describe("the demolition plans OFFERED to a sheet nothing paired (demoPlansFor)", () => {
  it("by title when the titles say what the sheets draw", () => {
    const sheets = [
      { pageNumber: 2, sheetNumber: "D101", title: "LEVEL 1 DEMOLITION PLAN" },
      { pageNumber: 3, sheetNumber: "D102", title: "LEVEL 2 DEMOLITION PLAN" },
      { pageNumber: 5, sheetNumber: "A101", title: "LEVEL 1 FLOOR PLAN" },
    ];
    expect(demoPlansFor(sheets, 5)).toEqual([2]);
  });

  it("a sheet drawing the site AND a demolition plan is offered as the demolition plan", () => {
    const sheets = [
      { pageNumber: 3, sheetNumber: "D201", title: "SITE PLAN & LEVEL 1 DEMOLITION PLAN" },
      { pageNumber: 4, sheetNumber: "A201", title: "LEVEL 1 FLOOR PLAN" },
    ];
    expect(demoPlansFor(sheets, 4)).toEqual([3]);
  });

  it("titles that say nothing: the demolition sheets of the same discipline, by number — never another trade's", () => {
    const noise = [
      { pageNumber: 6, sheetNumber: "AD1.0", title: null },
      { pageNumber: 30, sheetNumber: "MD1.1", title: null },
      { pageNumber: 40, sheetNumber: "ED1.0", title: null },
      { pageNumber: 9, sheetNumber: "A3.1", title: null },
      { pageNumber: 12, sheetNumber: "A2.0", title: "BID DOCUMENTS" },
    ];
    expect(demoPlansFor(noise, 9)).toEqual([6]);
    expect(demoPlansFor(noise, 12)).toEqual([6]);
  });

  it("a sheet whose title says it is a plan is never offered a demolition plan the titles rule out", () => {
    const sheets = [
      { pageNumber: 2, sheetNumber: "AD101", title: "LEVEL 2 DEMOLITION PLAN" },
      { pageNumber: 5, sheetNumber: "A101", title: "LEVEL 1 FLOOR PLAN" },
    ];
    expect(demoPlansFor(sheets, 5)).toEqual([]);
  });
});
