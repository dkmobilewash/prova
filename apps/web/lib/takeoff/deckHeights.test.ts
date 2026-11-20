import { describe, expect, it } from "vitest";
import { deckHeightAt, deckValues, deckZones } from "./deckHeights";

/**
 * ── TO-DECK HEIGHTS FROM THE STRUCTURAL AND SECTION ELEVATIONS (H4', prereg-type-heights.md) ──
 *
 * The corpus is Chrome's Round 36 words, as Diego quoted them: 114026, K-4, Joplin, Camp Clark,
 * Camp Bow Wow. Points are page-width units (1 = the sheet's width); 100 ft per page width here.
 */
const item = (str: string, x = 0.5, y = 0.5) => ({ str, x, y, height: 0.004 });

describe("reading deck, bearing, eave and ridge elevations off a framing plan or section", () => {
  it("114026: \"T.O.S. SECOND 114'-2 1/2\"\" is a top of steel, fraction kept", () => {
    expect(deckValues([item("T.O.S. SECOND 114'-2 1/2\"")])).toEqual([expect.objectContaining({ kind: "top-of-steel", elevation: 114 + 2.5 / 12, uno: false })]);
  });
  it("K-4: \"JOIST BRG EL = 114'-0\" (UON)\" is a joist bearing, the default for the plan", () => {
    expect(deckValues([item('JOIST BRG EL = 114\'-0" (UON)')])).toEqual([expect.objectContaining({ kind: "bearing", elevation: 114, uno: true })]);
  });
  it("Joplin: \"BOTTOM OF ROOF DECK ELEVATION = 112'-6\" UNLESS NOTED OTHERWISE\" is the bottom of deck, by default", () => {
    expect(deckValues([item('BOTTOM OF ROOF DECK ELEVATION = 112\'-6" UNLESS NOTED OTHERWISE')])).toEqual([expect.objectContaining({ kind: "bottom-of-deck", elevation: 112.5, uno: true })]);
  });
  it("Camp Clark: \"T.O. LOW EAVE EL. 112'-0\"\" and \"T.O. RIDGE EL. 120'-1 1/2\"\" are an eave and a ridge", () => {
    const got = deckValues([item("T.O. LOW EAVE EL. 112'-0\"", 0.2, 0.5), item("T.O. RIDGE EL. 120'-1 1/2\"", 0.4, 0.5)]);
    expect(got.map((v) => [v.kind, v.elevation])).toEqual([["eave", 112], ["ridge", 120 + 1.5 / 12]]);
  });
  it("Camp Bow Wow: \"B.O. DECK (@ B.1) 19'-0\"\" is a bottom of deck at grid B.1, already relative to the floor", () => {
    expect(deckValues([item("B.O. DECK (@ B.1) 19'-0\"")])).toEqual([expect.objectContaining({ kind: "bottom-of-deck", elevation: 19, grid: "B.1" })]);
  });
  it("reads a label with its figure stacked under it, as a section's level marker prints it (CBW A301)", () => {
    expect(deckValues([item("B.O. DECK (@ B.1)", 0.5, 0.5), item("19' - 0\"", 0.498, 0.509)])).toEqual([expect.objectContaining({ kind: "bottom-of-deck", elevation: 19, grid: "B.1" })]);
  });
  it("reads a label whose figure is printed beside it, and truss bearing", () => {
    expect(deckValues([item("TRUSS BEARING", 0.5, 0.5), item("110'-0\"", 0.52, 0.5)])).toEqual([expect.objectContaining({ kind: "bearing", elevation: 110 })]);
  });
  it("is nothing for a ceiling, a sill or a door head", () => {
    expect(deckValues([item("CLG 9'-0\" A.F.F."), item("T.O. SILL 3'-0\""), item("HEAD HT 7'-0\"")])).toEqual([]);
  });
});

describe("zones: a to-deck wall's height from where it stands", () => {
  const floor = { floorElevation: 100 };
  it("subtracts the floor from absolute elevations, and leaves relative ones (CBW's 19'-0\" over FINISH FLOOR 0\")", () => {
    expect(deckZones(deckValues([item('BOTTOM OF ROOF DECK ELEVATION = 112\'-6" UNO')]), floor).defaultFeet).toBe(12.5);
    expect(deckZones(deckValues([item("B.O. DECK (@ B.1) 19'-0\"")]), { floorElevation: null }).points[0]!.feet).toBe(19);
  });
  it("a printed spot value rules near it; the UNO default rules elsewhere (Joplin's 12'-6\" except where noted)", () => {
    const z = deckZones(deckValues([item('BOTTOM OF ROOF DECK ELEVATION = 112\'-6" UNO', 0.05, 0.05), item("B.O. DECK 116'-0\"", 0.7, 0.7)]), floor);
    expect(deckHeightAt(z, { x: 0.71, y: 0.7 }, 100)).toMatchObject({ feet: 16 });
    expect(deckHeightAt(z, { x: 0.2, y: 0.2 }, 100)).toMatchObject({ feet: 12.5 });
  });
  it("with no default, a wall far from every printed value is a question, not the nearest guess", () => {
    const z = deckZones(deckValues([item("B.O. DECK 116'-0\"", 0.7, 0.7), item("B.O. DECK 114'-0\"", 0.75, 0.7)]), floor);
    expect(deckHeightAt(z, { x: 0.1, y: 0.1 }, 100)).toBeNull();
  });
  it("one value printed for the whole plan is that value everywhere", () => {
    const z = deckZones(deckValues([item("T.O.S. 114'-0\"", 0.7, 0.7)]), floor);
    expect(deckHeightAt(z, { x: 0.1, y: 0.1 }, 100)).toMatchObject({ feet: 14 });
  });
  it("under a slope, the height runs from the eave to the ridge with the wall's position (Camp Clark)", () => {
    const z = deckZones(deckValues([item("T.O. LOW EAVE EL. 112'-0\"", 0.2, 0.5), item("T.O. RIDGE EL. 120'-0\"", 0.4, 0.5)]), floor);
    expect(deckHeightAt(z, { x: 0.2, y: 0.5 }, 100)!.feet).toBeCloseTo(12, 3);
    expect(deckHeightAt(z, { x: 0.3, y: 0.5 }, 100)!.feet).toBeCloseTo(16, 3);
    expect(deckHeightAt(z, { x: 0.4, y: 0.5 }, 100)!.feet).toBeCloseTo(20, 3);
  });
});

describe("the floor's printed elevation, in a note's sentence", async () => {
  const { floorElevationIn } = await import("./deckHeights");
  it("114026: \"ARCHITECTURAL FINISH FLOOR ELEVATION OF 100'-0\" EQUALS ACTUAL SITE REFERENCE ELEVATION OF\"", () => {
    expect(floorElevationIn("17. ARCHITECTURAL FINISH FLOOR ELEVATION OF 100'-0\" EQUALS ACTUAL SITE REFERENCE ELEVATION OF")).toBe(100);
  });
  it("\"FIRST FLOOR EL. 100'-0\"\" and \"FINISH FLOOR = 98'-6\"\"", () => {
    expect(floorElevationIn("FIRST FLOOR EL. 100'-0\"")).toBe(100);
    expect(floorElevationIn("FINISH FLOOR = 98'-6\"")).toBe(98.5);
  });
  it("K-4 \"T O SLAB EL=100'-0\"\" and Camp Clark \"FINISH FLOOR EL. = 100'-0\" (SITE PLAN EQUIVALENT = 892.00')\"", () => {
    expect(floorElevationIn("T O SLAB EL=100'-0\"")).toBe(100);
    expect(floorElevationIn("PROPERLY PREPARED SUBGRADE. FINISH FLOOR EL. = 100'-0\" (SITE PLAN EQUIVALENT = 892.00').")).toBe(100);
  });
  it("is nothing for a floor-to-floor, a slab thickness or a relative 0\"", () => {
    expect(floorElevationIn("FLOOR TO FLOOR 14'-0\"")).toBeNull();
    expect(floorElevationIn('4" CONCRETE SLAB ON GRADE')).toBeNull();
    expect(floorElevationIn('FINISH FLOOR 0"')).toBeNull();
  });
});

describe("a sloped roof: the roof plan says where the eave and ridge are, the sections say how high (Camp Clark)", async () => {
  const { slopeFromRoofPlan } = await import("./deckHeights");
  const roofPlan = [item("LOW EAVE", 0.2, 0.5), item("RIDGE", 0.4, 0.5), item("LOW EAVE", 0.6, 0.5)];
  const sections = deckValues([item("T.O. LOW EAVE EL. 112'-0\"", 0.1, 0.1), item("T.O. RIDGE EL. 120'-1 1/2\"", 0.3, 0.1)]);
  it("places the sections' one eave and one ridge elevation at the roof plan's labels", () => {
    const placed = slopeFromRoofPlan(roofPlan, sections);
    expect(placed.map((v) => [v.kind, v.elevation, v.x])).toEqual([["eave", 112, 0.2], ["ridge", 120 + 1.5 / 12, 0.4], ["eave", 112, 0.6]]);
    const z = deckZones(placed, { floorElevation: 100 });
    expect(deckHeightAt(z, { x: 0.3, y: 0.5 }, 100)!.feet).toBeCloseTo(16.06, 1);
  });
  it("places nothing when the sections disagree on the eave, or print no ridge", () => {
    expect(slopeFromRoofPlan(roofPlan, [...sections, ...deckValues([item("T.O. LOW EAVE EL. 110'-0\"")])])).toEqual([]);
    expect(slopeFromRoofPlan(roofPlan, sections.filter((v) => v.kind === "eave"))).toEqual([]);
  });
});

describe("which walls a framing plan carries: the level below it (114026's two storeys)", async () => {
  const { framingLevel } = await import("./deckHeights");
  it("a floor's framing plan carries the walls of the floor below; the roof's carries the top floor's", () => {
    expect(framingLevel("SECOND FLOOR FRAMING PLAN")).toBe(2);
    expect(framingLevel("LEVEL 3 FRAMING PLAN")).toBe(3);
    expect(framingLevel("ROOF FRAMING PLAN")).toBe("roof");
    expect(framingLevel("LOW ROOF FRAMING PLAN - AREA A")).toBe("roof");
    expect(framingLevel("ROOF PLAN")).toBe("roof");
    expect(framingLevel("FOOTING & FOUNDATION PLAN")).toBeNull();
  });
});
