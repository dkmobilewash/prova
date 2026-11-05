import { describe, expect, it } from "vitest";
import { buildingsOf, ceilingNotesFromLines, heightBasis, heightFactsFromText, labelledWallHeights, lettersNotesFromLines, relativeToFloor, resolveHeight, type HeightFact } from "./wallHeights";

/** Invented phrases in every SHAPE the sixteen training legends print (measured 2026-10-22); no real line is quoted. */
describe("the words a legend uses for a wall's height", () => {
  it("reads 'to the structure' in its many spellings", () => {
    for (const phrase of [
      "TO DECK",
      "TO DECK ABOVE",
      "Bottom of structure",
      "FRAMING TO UNDERSIDE OF EXISTING BEAM",
      "UNDERSIDE OF CONCRETE FLOOR OR ROOF",
      "UNDERSIDE OF STRUCTURAL CEILING ABOVE",
      "FULL HEIGHT - TO STRUCTURE",
      '(2) LAYERS 5/8" GYP. BOARD, CONT. TO ROOF DECK',
      "ALL PARTITIONS EXTEND TO DECK ABOVE UNLESS NOTED OTHERWISE.",
    ]) {
      expect(heightBasis(phrase)?.kind, phrase).toBe("to-structure");
    }
  });

  it("reads a printed figure, and a figure with the ceiling named", () => {
    expect(heightBasis("4' - 0\"")).toEqual({ kind: "fixed", feet: 4, phrase: "4' - 0\"" });
    expect((heightBasis("10' - 6\"") as { feet: number }).feet).toBeCloseTo(10.5, 6);
    expect(heightBasis("9'-0\", BOTTOM OF CEILING")).toMatchObject({ kind: "fixed", feet: 9 });
    expect(heightBasis("8' HIGH")).toMatchObject({ kind: "fixed", feet: 8 });
  });

  it("reads 'above the ceiling' with its inches, and 'to the ceiling' without", () => {
    expect(heightBasis('6" ABOVE CEILING')).toMatchObject({ kind: "above-ceiling", inches: 6 });
    expect(heightBasis("TO UNDERSIDE OF CEILING")?.kind).toBe("to-ceiling");
  });

  it("reads a reference as a reference, not as a height", () => {
    expect(heightBasis("SEE NOTE A")).toMatchObject({ kind: "see", target: "NOTE A" });
    expect(heightBasis("SEE SHEET A7.1 FOR WALL HEIGHTS")).toMatchObject({ kind: "see", target: "SHEET A7.1" });
    expect(heightBasis("MATCH ADJACENT WALL HEIGHT - SEE ELEVATIONS")?.kind).toBe("see");
    // Printed beside a masonry core on more than one legend; it says nothing about height.
    expect(heightBasis("SEE STRUCTURAL")).toBeNull();
  });

  it("keeps two heights for two sides as two, never one", () => {
    const got = heightBasis("9' HIGH (SHOP SIDE); TO DECK ABOVE (OFFICE SIDE)");
    expect(got?.kind).toBe("mixed");
    expect((got as { parts: { kind: string }[] }).parts.map((p) => p.kind)).toEqual(["fixed", "to-structure"]);
  });

  it("refuses a figure that is a spacing or a stud, not a height", () => {
    expect(heightBasis("ABOVE 9'-0\", STUDS AT 12\" O.C.")).toBeNull();
    expect(heightBasis('3 5/8" MTL. STUD AT 16" O.C.')).toBeNull();
    expect(heightBasis('5/8" TYPE X GYPSUM BOARD EACH SIDE')).toBeNull();
    expect(heightBasis("")).toBeNull();
  });
});

describe("the feet, from facts read elsewhere", () => {
  const deck: HeightFact = { kind: "structure-elevation", feet: 14, sheet: "A301", phrase: "T.O. ROOF FRAMING 14' 0\"" };
  const ceiling: HeightFact = { kind: "ceiling-height", feet: 10, sheet: "A111", phrase: "10'-0\" A.F.F." };
  const noteA: HeightFact = {
    kind: "note",
    feet: null,
    label: "A",
    text: "ALL PARTITIONS EXTEND TO DECK ABOVE UNLESS NOTED OTHERWISE.",
    sheet: "A601",
    phrase: "A. ALL PARTITIONS EXTEND TO DECK ABOVE UNLESS NOTED OTHERWISE.",
  };

  it("the Baker shape: SEE NOTE A → the note says to deck → the section prints the deck: one hop, MEDIUM", () => {
    const got = resolveHeight({ code: "P1", heightNote: "SEE NOTE A", ownPhrases: ["RATING: 2 HR"], generalNote: noteA, facts: [noteA, deck, ceiling] });
    expect(got.feet).toBe(14);
    expect(got.confidence).toBe("MEDIUM");
    expect(got.generalNoteOnly).toBe(false);
    expect(got.from?.sheet).toBe("A301");
    expect(got.why).toContain("SEE NOTE A →");
    expect(got.why).toContain("T.O. ROOF FRAMING");
  });

  it("a type that says nothing: the general note applies, LOW, and flagged as general-note-only", () => {
    const got = resolveHeight({ code: "P2", ownPhrases: ["NON-RATED INTERIOR WALL", "1 LAYER GYP. PER SIDE"], generalNote: noteA, facts: [noteA, deck, ceiling] });
    expect(got.feet).toBe(14);
    expect(got.confidence).toBe("LOW");
    expect(got.generalNoteOnly).toBe(true);
  });

  it("a printed figure in the legend's HEIGHT field is HIGH and needs no fact", () => {
    const got = resolveHeight({ code: "D", heightNote: "10' - 0\"", ownPhrases: [], generalNote: noteA, facts: [] });
    expect(got).toMatchObject({ feet: 10, confidence: "HIGH", generalNoteOnly: false });
  });

  it("a bare figure on an ordinary legend line is NOT a height — a furring dimension on one training legend read as a one-foot wall", () => {
    expect(resolveHeight({ code: "A", ownPhrases: ["2\" - 1' - 4\"", "5/8\" GYP BD"], generalNote: null, facts: [] }).feet).toBeNull();
    expect(resolveHeight({ code: "B", ownPhrases: ["WALL HEIGHT 9'-0\""], generalNote: null, facts: [] }).feet).toBe(9);
  });

  it("above the ceiling adds the inches to the COMMONEST ceiling tag, not a soffit's", () => {
    const soffit: HeightFact = { kind: "ceiling-height", feet: 1, sheet: "A111", phrase: "1'-0\" A.F.F." };
    const got = resolveHeight({ code: "P1", ownPhrases: ['6" ABOVE CEILING'], generalNote: null, facts: [soffit, ceiling, ceiling] });
    expect(got.feet).toBeCloseTo(10.5, 6);
    expect(got.from?.sheet).toBe("A111");
  });

  it("refuses to pick between two deck heights — both are options — and offers a lone bearing line only as a LOW floor", () => {
    const low: HeightFact = { kind: "structure-elevation", feet: 10, sheet: "A130", phrase: "T.O. JOIST 10'" };
    const high: HeightFact = { kind: "structure-elevation", feet: 16.5, sheet: "A115", phrase: "B.O. ROOF DECK 16'-6\" AFF" };
    const two = resolveHeight({ code: "A1", ownPhrases: ["TO DECK"], generalNote: null, facts: [low, high] });
    expect(two.feet).toBeNull();
    expect(two.options?.map((f) => f.feet)).toEqual([10, 16.5]);
    const bearing: HeightFact = { kind: "bearing-elevation", feet: 10, sheet: "A300", phrase: "T.O. WALL 10' - 0\"" };
    const floor = resolveHeight({ code: "P09", ownPhrases: ["TO DECK"], generalNote: null, facts: [bearing] });
    expect(floor).toMatchObject({ feet: 10, confidence: "LOW" });
    expect(floor.why).toContain("bearing line");
  });

  it("one level per part of the building: a zone's deck, else its bearing line, sections over a framing plan's spots (Joplin, Bunkie)", () => {
    const fact = (kind: HeightFact["kind"], feet: number, zone: string, sheet = "A-301", framing = false): HeightFact => ({ kind, feet, zone, sheet, phrase: `${zone} ${feet}`, ...(framing ? { framing } : {}) });
    const joplin = resolveHeight({
      code: "A",
      ownPhrases: ["BOTTOM OF STRUCTURE"],
      generalNote: null,
      facts: [fact("structure-elevation", 12, "LOWER"), fact("bearing-elevation", 12 + 4 / 12, "ADMIN"), fact("bearing-elevation", 16 + 8 / 12, "CENTRAL"), fact("structure-elevation", 24.6, "", "S-102", true)],
    });
    expect(joplin.options?.map((f) => f.zone)).toEqual(["LOWER", "ADMIN", "CENTRAL"]);
    // A zone with a deck does not also offer its bearing line.
    const deckWins = resolveHeight({ code: "A", ownPhrases: ["TO DECK"], generalNote: null, facts: [fact("structure-elevation", 15, ""), fact("bearing-elevation", 14, "")] });
    expect(deckWins.feet).toBe(15);
    // With no section level at all, the framing plan's spot is what there is.
    expect(resolveHeight({ code: "A", ownPhrases: ["TO DECK"], generalNote: null, facts: [fact("structure-elevation", 13, "", "S-102", true)] }).feet).toBe(13);
  });

  it("GUESSES NOTHING: a basis with no fact behind it stays unresolved and says what is missing", () => {
    expect(resolveHeight({ code: "A", ownPhrases: ["TO DECK"], generalNote: null, facts: [ceiling] })).toMatchObject({ feet: null, confidence: "LOW" });
    expect(resolveHeight({ code: "B", ownPhrases: [], generalNote: null, facts: [deck] }).why).toContain("nothing on the legend");
    expect(resolveHeight({ code: "C", heightNote: "SEE SHEET A7.1 FOR WALL HEIGHTS", ownPhrases: [], generalNote: noteA, facts: [deck] }).feet).toBeNull();
    expect(resolveHeight({ code: "P07", heightNote: "9' HIGH (SHOP SIDE); TO DECK ABOVE (OFFICE SIDE)", ownPhrases: [], generalNote: null, facts: [deck] }).why).toContain("more than one height");
  });
});

describe("facts read off a sheet's text", () => {
  it("pairs an elevation label with the figure beside it, split into two items as a PDF prints it", () => {
    const items = [
      { str: "T.O. ROOF FRAMING", x: 1900, y: 1260, height: 8 },
      { str: "14'", x: 1990, y: 1259, height: 8 },
      { str: "0\"", x: 2010, y: 1259, height: 8 },
      { str: "T.O. PARAPET", x: 1900, y: 1210, height: 8 },
      { str: "18'", x: 1990, y: 1210, height: 8 },
      { str: "10'-0\" A.F.F.", x: 900, y: 1400, height: 8 },
    ];
    const facts = heightFactsFromText({ sheet: "A301", items });
    expect(facts.find((f) => f.kind === "structure-elevation" && f.phrase.startsWith("T.O. ROOF"))?.feet).toBe(14);
    expect(facts.find((f) => f.kind === "ceiling-height")?.feet).toBe(10);
  });

  it("reads a bearing line as a bearing line, 'B.O. STRUCT.' as structure, a 'CLG.' tag with its figure, and not a 'BELOW' offset", () => {
    const facts = heightFactsFromText({
      sheet: "A5.03",
      items: [
        { str: "T.O. WALL", x: 100, y: 500, height: 8 },
        { str: "10' - 0\"", x: 180, y: 500, height: 8 },
        { str: "B.O. STRUCT. ABOVE", x: 100, y: 700, height: 8 },
        { str: "12'-0\"", x: 190, y: 701, height: 8 },
        { str: "CLG.", x: 900, y: 300, height: 8 },
        { str: "9'", x: 930, y: 300, height: 8 },
        { str: "0\"", x: 945, y: 300, height: 8 },
        { str: "CLG.", x: 600, y: 100, height: 8 },
        { str: "1'", x: 630, y: 100, height: 8 },
        { str: "0\" BELOW", x: 645, y: 100, height: 8 },
        { str: "(E) TOP OF WALL", x: 100, y: 900, height: 8 },
        { str: "14'", x: 190, y: 900, height: 8 },
        { str: "4\"", x: 212, y: 900, height: 8 },
      ],
    });
    expect(facts.find((f) => f.kind === "bearing-elevation" && f.phrase.startsWith("T.O. WALL"))?.feet).toBe(10);
    expect(facts.find((f) => f.kind === "structure-elevation")?.feet).toBe(12);
    expect(facts.filter((f) => f.kind === "ceiling-height").map((f) => f.feet)).toEqual([9]);
    expect(facts.find((f) => f.phrase.startsWith("(E) TOP OF WALL"))?.feet).toBeCloseTo(14 + 4 / 12, 6);
  });

  it("reads a lettered general note whose letter and words are separate cells", () => {
    const notes = lettersNotesFromLines("A601", ["GYPSUM BOARD | A. | ALL PARTITIONS EXTEND TO DECK ABOVE UNLESS NOTED OTHERWISE.", "B. | CARPET DIRECTION TO BE CONSISTENT."]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ label: "A", sheet: "A601" });
    expect(heightBasis(notes[0].text ?? "")?.kind).toBe("to-structure");
  });
});

describe("levels printed as absolute elevations, measured from the floor (Joplin's sections and roof framing)", () => {
  // A section's level markers: a zone word, an abbreviation, and the figure
  // split into three items; a framing plan's "B/DECK EL = …" in one item.
  const section = heightFactsFromText({
    sheet: "A-301",
    items: [
      { str: "FIRST FLOOR", x: 100, y: 900, height: 8 },
      { str: "100'", x: 100, y: 912, height: 8 },
      { str: "-", x: 120, y: 912, height: 8 },
      { str: "0\"", x: 128, y: 912, height: 8 },
      { str: "LOWER BOD", x: 100, y: 500, height: 8 },
      { str: "112'", x: 100, y: 512, height: 8 },
      { str: "-", x: 120, y: 512, height: 8 },
      { str: "0\"", x: 128, y: 512, height: 8 },
      { str: "ADMIN JBE", x: 100, y: 460, height: 8 },
      { str: "112'-4\"", x: 100, y: 472, height: 8 },
      { str: "CENTRAL TOW", x: 100, y: 300, height: 8 },
      { str: "116'-8\"", x: 100, y: 312, height: 8 },
    ],
  });
  const framing = heightFactsFromText({ sheet: "S-102", items: [{ str: "B/DECK EL = 110' - 9 7/8\"", x: 400, y: 400, height: 8 }] });
  const notes = heightFactsFromText({ sheet: "C-101", items: [{ str: "ARCHITECTURAL FFE = 100'-0\"", x: 50, y: 50, height: 8 }] });

  it("reads the abbreviations a section uses, with the zone word in front, and the floor as a datum", () => {
    expect(section.find((f) => f.phrase.startsWith("LOWER BOD"))).toMatchObject({ kind: "structure-elevation", feet: 112 });
    expect(section.find((f) => f.phrase.startsWith("ADMIN JBE"))?.kind).toBe("bearing-elevation");
    expect(section.find((f) => f.phrase.startsWith("CENTRAL TOW"))?.kind).toBe("bearing-elevation");
    expect(section.find((f) => f.kind === "floor-datum")?.feet).toBe(100);
    expect(framing[0]).toMatchObject({ kind: "structure-elevation" });
    expect(framing[0]!.feet).toBeCloseTo(110 + (9 + 7 / 8) / 12, 6);
    expect(notes[0]).toMatchObject({ kind: "floor-datum", feet: 100 });
  });

  it("turns an elevation into a height above its sheet's floor, else the set's, and drops one with no floor", () => {
    const heights = relativeToFloor([...section, ...framing, ...notes]);
    expect(heights.find((f) => f.phrase.startsWith("LOWER BOD"))?.feet).toBe(12);
    expect(heights.find((f) => f.sheet === "S-102")?.feet).toBeCloseTo(10 + (9 + 7 / 8) / 12, 3);
    expect(heights.some((f) => f.kind === "floor-datum")).toBe(false);
    expect(relativeToFloor(framing)).toEqual([]);
    // A figure already above the floor is left as it is.
    const plain: HeightFact = { kind: "structure-elevation", feet: 15, sheet: "A301", phrase: "T.O. ROOF FRAMING 15' 0\"" };
    expect(relativeToFloor([plain])).toEqual([plain]);
  });
});

describe("\"see sheet X\" is followed (Grand Junction's types send every height to its interior elevations)", () => {
  const elevations = labelledWallHeights({
    sheet: "A300",
    items: [
      { str: "8'-0\"", x: 600, y: 1000, height: 8 },
      { str: "\"T\" WALL", x: 615, y: 1012, height: 8 },
      { str: "12'-0\"", x: 700, y: 950, height: 8 },
      { str: "AT SALES", x: 715, y: 960, height: 8 },
      // an opening's dimension, with nothing named beside it
      { str: "7'-0\"", x: 900, y: 1400, height: 8 },
      { str: "SEE WALL TYPES", x: 905, y: 1405, height: 8 },
    ],
  });

  it("reads a dimension only where a wall is named beside it", () => {
    expect(elevations.map((f) => [f.feet, f.phrase])).toEqual([[8, "8'-0\" \"T\" WALL"], [12, "12'-0\" AT SALES"]]);
  });

  it("gives the named sheet's heights as options to pick, and one height when it prints one", () => {
    const many = resolveHeight({ code: "A1", ownPhrases: ["SEE SHEET A300 FOR WALL HEIGHTS"], generalNote: null, facts: elevations });
    expect(many.feet).toBeNull();
    expect(many.options?.map((f) => f.feet)).toEqual([8, 12]);
    const one = resolveHeight({ code: "A1", ownPhrases: ["SEE SHEET A-300 FOR WALL HEIGHTS"], generalNote: null, facts: elevations.slice(0, 1) });
    expect(one).toMatchObject({ feet: 8, confidence: "MEDIUM" });
    expect(one.why).toContain("A300 prints 8'-0\" \"T\" WALL");
    const elsewhere = resolveHeight({ code: "A1", ownPhrases: ["SEE SHEET A400 FOR WALL HEIGHTS"], generalNote: null, facts: elevations });
    expect(elsewhere.feet).toBeNull();
    expect(elsewhere.options).toBeUndefined();
  });
});

describe("round 14: a part of the building, a plan sheet's building, and a ceiling plan's rule", () => {
  it("reads the zone a level line is drawn for: Joplin's LOWER BOD, Bunkie's T.O. WALL 2", () => {
    const facts = heightFactsFromText({
      sheet: "A301",
      items: [
        { str: "LOWER BOD", x: 100, y: 100, height: 8 },
        { str: "12'-0\"", x: 100, y: 112, height: 8 },
        { str: "T.O. WALL 2", x: 400, y: 100, height: 8 },
        { str: "14' - 4\"", x: 400, y: 112, height: 8 },
        { str: "ANGLE ATTACHMENT TO JOIST", x: 700, y: 100, height: 8 },
        { str: "9' - 2\"", x: 700, y: 112, height: 8 },
      ],
    });
    expect(facts.map((f) => [f.kind, f.zone, f.feet])).toEqual([["structure-elevation", "LOWER", 12], ["bearing-elevation", "2", 14 + 4 / 12]]);
  });

  it("names a drawing's building from its caption, and takes the plan sheet's own zone", () => {
    expect(buildingsOf(["FLOOR PLAN - WAREHOUSE", "FINISH FLOOR (ADDITION)", "NORTH ELEVATION 1", "FLOOR PLAN - DEMOLITION"])).toEqual(["WAREHOUSE", "ADDITION"]);
    const main: HeightFact = { kind: "bearing-elevation", feet: 10, zone: "", sheet: "A300", phrase: "T.O. WALL 10'-0\"" };
    const warehouse: HeightFact = { kind: "bearing-elevation", feet: 14 + 4 / 12, zone: "2", sheet: "A201", phrase: "T.O. WALL 2 14'-4\"", buildings: ["WAREHOUSE"] };
    const ask = (buildings?: string[]) => resolveHeight({ code: "P08", ownPhrases: ["TO DECK"], generalNote: null, facts: [main, warehouse], ...(buildings ? { buildings } : {}) });
    expect(ask().options?.map((f) => f.feet)).toEqual([10, 14 + 4 / 12]);
    expect(ask(["WAREHOUSE"]).feet).toBeCloseTo(14 + 4 / 12, 6);
    // The addition's plan names a building no level sheet does: the zone that names none is its.
    expect(ask(["ADDITION"]).feet).toBe(10);
  });

  it("takes a ceiling plan's own 'ALL DROPPED CEILINGS ARE 8'-0\"' over its tags, and a bulkhead's A.F.F. is no ceiling (Green Bay A4.0)", () => {
    const stated = ceilingNotesFromLines("A4.0", ["ACOUSTIC TILE CEILING | 2. | ALL DROPPED CEILINGS ARE 8' | - | 0\" ABOVE FINISH FLOOR, UNLESS OTHERWISE NOTED."]);
    expect(stated).toHaveLength(1);
    expect(stated[0]).toMatchObject({ kind: "ceiling-height", feet: 8, label: "U.N.O." });
    const tags = heightFactsFromText({ sheet: "A4.0", items: [1, 2, 3].map((n) => ({ str: "9'-0\" A.F.F.", x: 100 * n, y: 100, height: 8 })) });
    const rule = resolveHeight({ code: "IW-1", ownPhrases: [], generalNote: { kind: "note", feet: null, label: "9", text: "TERMINATE ALL PARTITIONS 8\" ABOVE HIGHEST ADJACENT CEILING PER", sheet: "A4.0", phrase: "9." }, facts: [...tags, ...stated] });
    expect(rule.feet).toBeCloseTo(8 + 8 / 12, 6);
    const bulkhead = heightFactsFromText({ sheet: "A11.2", items: [{ str: "8' - 0\" AFF", x: 100, y: 100, height: 8 }, { str: "B.O BULKHEAD", x: 100, y: 90, height: 8 }] });
    expect(bulkhead).toEqual([]);
  });
});
