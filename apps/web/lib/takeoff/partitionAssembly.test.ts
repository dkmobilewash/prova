import { describe, expect, it } from "vitest";
import { fraction, inchesFrom, readPartitionAssembly } from "./partitionAssembly";

/**
 * ── EVERY FIXTURE HERE IS TEXT OFF A REAL SHEET ──
 *
 * Read from Camp Bow Wow A130 p16 — the only partition legend in any of the
 * five real sets — on 2026-10-20, with `zzPartitionText.eval.ts`. Writing
 * plausible-looking assembly text instead would test a vocabulary no architect
 * used: the real lines say `MTL.` and `GYP. BD.` and `@ 16" O.C.`, abbreviate
 * differently on consecutive lines of the same sheet, and arrive split across
 * columns because five details sit side by side.
 */

/** The five partition types on A130, as their callout lines actually read. */
const A130 = {
  typeOne: ['3 5/8" MTL. STUD AT 16" O.C.', '5/8" GYP. BD. EACH SIDE, PAINT'],
  typeTwo: ['6" MTL. STUD AT 16" O.C.', 'PAINTED 5/8" GYPSUM BOARD EACH SIDE'],
  withBatts: [
    '3 5/8" METAL STUDS @ 16" O.C.',
    'PAINTED 5/8" GYPSUM BOARD EACH SIDE',
    "WITH SOUND INSULATION BATTS, NO RATING",
  ],
  toDeck: [
    '6" METAL STUDS @ 16" O.C. W/ (1) LAYERS OF GYP. BD. ON EA. SIDE TO UNDERSIDE OF METAL DECK',
    '5/8" GYPSUM BOARD EACH SIDE',
  ],
};

const WHERE = "Camp Bow Wow A130 p16, partition type 1";

describe("reading a partition type's assembly", () => {
  it("reads studs, track and board off a real two-line callout", () => {
    const got = readPartitionAssembly({ lines: A130.typeOne, where: WHERE });
    expect(got.flags).toEqual([]);
    expect(got.read.studWidthIn).toBeCloseTo(3.625, 3);
    expect(got.read.studSpacingIn).toBe(16);
    expect(got.read.boardThicknessIn).toBeCloseTo(0.625, 3);
    expect(got.read.layersPerSide).toBe(1);

    const kinds = got.components.map((c) => c.basis);
    expect(kinds).toContain("STUDS");
    expect(kinds).toContain("LINEAR_FT");
    expect(kinds).toContain("BOARDED_SQFT");
    expect(got.components.find((c) => c.basis === "STUDS")?.description).toBe(
      '3-5/8in metal stud at 16in o.c.',
    );
  });

  it("gives track a factor of two, for the top and the bottom", () => {
    const got = readPartitionAssembly({ lines: A130.typeOne, where: WHERE });
    const track = got.components.find((c) => c.basis === "LINEAR_FT");
    expect(track?.factor).toBe(2);
    expect(track?.description).toContain("track");
  });

  it("counts board layers PER SIDE, because the basis already counts sides", () => {
    // `BOARDED_SQFT` is `boardedArea` with the type's own `sides`, so a factor
    // of 2 here for "each side" would buy four times the board on a two-sided
    // wall. One layer each side is a factor of 1.
    const one = readPartitionAssembly({ lines: A130.typeTwo, where: WHERE });
    expect(one.components.find((c) => c.basis === "BOARDED_SQFT")?.factor).toBe(1);

    const two = readPartitionAssembly({
      lines: ['6" METAL STUDS @ 16" O.C. W/ (2) LAYERS OF 5/8" GYP. BD. ON EA. SIDE'],
      where: WHERE,
    });
    expect(two.components.find((c) => c.basis === "BOARDED_SQFT")?.factor).toBe(2);
    expect(two.read.layersPerSide).toBe(2);
  });

  it("puts insulation on ONE face area, not on the boarded area", () => {
    // A cavity is filled once. `BOARDED_SQFT` counts both sides, so insulation
    // on that basis buys twice the batts for every wall in the building.
    const got = readPartitionAssembly({ lines: A130.withBatts, where: WHERE });
    const batts = got.components.find((c) => c.description.includes("insulation"));
    expect(batts?.basis).toBe("FACE_SQFT");
    expect(batts?.factor).toBe(1);
    expect(got.read.hourlyRating, "NO RATING is zero, not unknown").toBe(0);
  });

  it("never proposes a price field of any kind", () => {
    // The rule the whole feature rests on. A drawing states what a wall IS; it
    // says nothing about what your supplier charges or what your crew hangs in
    // an hour. Asserted over the component's own keys so a field added later
    // cannot slip through.
    const priceFields = ["catalogEntryId", "costCategory", "productionRate", "craftClassificationId", "unitCost", "price"];
    for (const lines of Object.values(A130)) {
      for (const component of readPartitionAssembly({ lines, where: WHERE }).components) {
        for (const field of priceFields) {
          expect(Object.keys(component), `${field} must never be proposed`).not.toContain(field);
        }
      }
    }
  });

  it("carries the phrase and the sheet onto every proposal", () => {
    const got = readPartitionAssembly({ lines: A130.withBatts, where: WHERE });
    expect(got.components.length).toBeGreaterThan(0);
    for (const component of got.components) {
      expect(component.from.where).toBe(WHERE);
      expect(component.from.phrase.length).toBeGreaterThan(0);
    }
  });

  it("reads the gauge from a general note and puts it in the description", () => {
    const got = readPartitionAssembly({
      lines: [...A130.typeOne, "ALL LOAD BEARING STUDS TO BE 14 GAUGE."],
      where: WHERE,
    });
    expect(got.read.studGauge).toBe(14);
    expect(got.components.find((c) => c.basis === "STUDS")?.description).toContain("14 ga");
  });
});

describe("ambiguity is left out and flagged, never guessed", () => {
  it("omits the stud when two sizes are named", () => {
    // This is the real shape of A130's text when the five details' callouts
    // arrive interleaved: one line genuinely carries two types' studs.
    const got = readPartitionAssembly({
      lines: ['6" MTL. STUD AT 16" O.C. | 3 5/8 MTL. STUDS AT 16" O.C.'],
      where: WHERE,
    });
    expect(got.read.studWidthIn).toBeNull();
    expect(got.components.some((c) => c.basis === "STUDS")).toBe(false);
    expect(got.components.some((c) => c.basis === "LINEAR_FT"), "no stud, no track").toBe(false);
    expect(got.flags).toHaveLength(1);
    expect(got.flags[0].why).toContain("two stud sizes");
    expect(got.flags[0].phrase).toContain("STUD");
  });

  it("omits the board when two thicknesses are named", () => {
    const got = readPartitionAssembly({
      lines: ['3 5/8" MTL. STUD AT 16" O.C.', '5/8" GYP. BD. EACH SIDE', '1/2" GYP. BD.'],
      where: WHERE,
    });
    expect(got.read.boardThicknessIn).toBeNull();
    expect(got.components.some((c) => c.basis === "BOARDED_SQFT")).toBe(false);
    expect(got.flags.some((f) => f.why.includes("two board thicknesses"))).toBe(true);
    // The studs are still proposed: one ambiguity does not poison the rest.
    expect(got.components.some((c) => c.basis === "STUDS")).toBe(true);
  });

  it("flags a contradictory layer count", () => {
    const got = readPartitionAssembly({
      lines: ['6" METAL STUDS @ 16" O.C. W/ (1) LAYERS', "(2) LAYERS OF 5/8\" GYP. BD."],
      where: WHERE,
    });
    expect(got.flags.some((f) => f.why.includes("contradicts itself"))).toBe(true);
  });

  it("does NOT flag something merely absent", () => {
    // A partition with no insulation line has no insulation. Calling that
    // ambiguous teaches a reviewer to click past the flags that matter.
    const got = readPartitionAssembly({ lines: A130.typeOne, where: WHERE });
    expect(got.flags).toEqual([]);
    expect(got.read.insulation).toBeNull();
    expect(got.read.hourlyRating, "no rating stated is unknown, not zero").toBeNull();
  });

  it("flags one-sided board rather than halving the factor", () => {
    const got = readPartitionAssembly({
      lines: ['3 5/8" MTL. STUD AT 16" O.C.', '5/8" GYP. BD. ONE SIDE ONLY'],
      where: WHERE,
    });
    expect(got.flags.some((f) => f.why.includes("one side only"))).toBe(true);
    // The factor stays at the layer count: sides belong to the TYPE.
    expect(got.components.find((c) => c.basis === "BOARDED_SQFT")?.factor).toBe(1);
  });

  it("returns nothing at all from words that describe no assembly", () => {
    const got = readPartitionAssembly({
      lines: ["FINISH AS SCHEDULED", "CEILING AS SCHEDULED", "SEE BUILDING SECTIONS"],
      where: WHERE,
    });
    expect(got.components).toEqual([]);
    expect(got.flags).toEqual([]);
  });
});

describe("the measurements themselves", () => {
  it("reads the fractions an architect writes", () => {
    expect(inchesFrom('3 5/8')).toBeCloseTo(3.625, 4);
    expect(inchesFrom('5/8')).toBeCloseTo(0.625, 4);
    expect(inchesFrom('2-1/2')).toBeCloseTo(2.5, 4);
    expect(inchesFrom('6')).toBe(6);
    expect(inchesFrom("nothing here")).toBeNull();
    expect(inchesFrom("1/0"), "a zero denominator is not a measurement").toBeNull();
  });

  it("writes them back the way the drawing does", () => {
    expect(fraction(3.625)).toBe("3-5/8");
    expect(fraction(0.625)).toBe("5/8");
    expect(fraction(6)).toBe("6");
    expect(fraction(2.5)).toBe("2-1/2");
  });

  it("refuses a board thickness that is really a layer count or a room number", () => {
    // "(3) LAYERS" must not read as a 3in board, and "ROOM 101 GYP BD" must
    // not read as a 101in one.
    const got = readPartitionAssembly({
      lines: ["(3) LAYERS OF GYP. BD.", "ROOM 101 GYP. BD."],
      where: WHERE,
    });
    expect(got.read.boardThicknessIn).toBeNull();
  });
});


describe("a partition schedule drawn as a LABEL | VALUE table", () => {
  /**
   * Central Bank of the Midwest, A090, read 2026-10-20: ten types, each a
   * column of labelled cells. The first parser read only the word INSULATION
   * out of `INSULATION THICKNESS | -` and proposed batts for all ten.
   */
  const centralBank = [
    'BASE PARTITION THICKNESS | 4 7/8"',
    'STUD SPACING (O.C.) | 16"',
    'STUD SIZE | 3 5/8"',
    'GWB THICKNESS | 5/8"',
    "FIRE RATING (HRS) | -",
    "INSULATION THICKNESS | -",
  ];

  it("reads the stud, the spacing and the board from their labelled cells", () => {
    const got = readPartitionAssembly({ lines: centralBank, where: "test" });
    expect(got.read.studWidthIn).toBe(3.625);
    expect(got.read.studSpacingIn).toBe(16);
    expect(got.read.boardThicknessIn).toBe(0.625);
    expect(got.components.map((c) => c.description)).toEqual([
      "3-5/8in metal stud at 16in o.c.",
      "3-5/8in track, top and bottom",
      "5/8in gypsum board",
    ]);
  });

  it("does NOT propose insulation from a row that says there is none", () => {
    const got = readPartitionAssembly({ lines: centralBank, where: "test" });
    expect(got.components.some((c) => c.description.startsWith("cavity insulation"))).toBe(false);
    const insulated = readPartitionAssembly({
      lines: [...centralBank.slice(0, 5), 'INSULATION THICKNESS | 3 1/2"'],
      where: "test",
    });
    expect(insulated.components.some((c) => c.description.startsWith("cavity insulation"))).toBe(true);
  });
});

describe("the longer stud spellings real sets use", () => {
  it("reads Baker's gauge-first steel stud", () => {
    const got = readPartitionAssembly({
      lines: ['LAYER 5/8" TYPE X GYPSUM WALLBOARD APPLIED PARALLEL TO EACH SIDE OF 6", 18 MIL (25GA.), STEEL STUDS 24" O.C.'],
      where: "test",
    });
    expect(got.read.studWidthIn).toBe(6);
    expect(got.read.studSpacingIn).toBe(24);
  });

  it("reads ELEVEN03's C-shape metal stud", () => {
    const got = readPartitionAssembly({
      lines: ["- 2 ROWS OF 1-5/8X C-SHAPED STUDS AT 24\" O.C."],
      where: "test",
    });
    expect(got.read.studWidthIn).toBe(1.625);
  });

  it("reads a stud whose size and name wrapped onto separate lines", () => {
    // NG Green Bay A3.2 p10, read 2026-10-20: the partition types sit in a
    // narrow column beside the plan, so the model returns the cell's wrapped
    // lines as they print. No single line holds both `3 5/8"` and `STUD`, and
    // the first reader proposed board and nothing else for eight of ten types.
    const got = readPartitionAssembly({
      lines: ['5/8" GYPSUM', "BOARD, EACH", "SIDE", '3 5/8" 20 GA. MTL.', "STUD", "FRAMING @", '16" O.C.', 'ASSEMBLY WIDTH 4 7/8"'],
      where: "test",
    });
    expect(got.read.studWidthIn).toBe(3.625);
    expect(got.read.studSpacingIn).toBe(16);
    expect(got.read.studGauge).toBe(20);
    expect(got.flags).toEqual([]);
  });

  it("reads Murray's `20 GAUGE METAL STUDS`, and takes the studs' own spacing over the track fasteners'", () => {
    // IFBREBID Murray Towers p26, Wall Types detail: the bottom track is
    // `FASTENED AT 24" O.C.` two lines below `STUDS AT 16" O.C.`. Counting every
    // O.C. flagged the type as ambiguous when the drawing said which is which.
    const got = readPartitionAssembly({
      lines: [
        "CONTINUOUS 20 GAUGE METAL TOP TRACK",
        '5/8" THICK TYPE "X" GYPSUM BOARD (BOTH SIDES) ON 3 5/8" 20 GAUGE METAL STUDS AT 16" O.C.',
        'CONTINUOUS 20 GAUGE METAL BOTTOM TRACK FASTENED AT 24" O.C.',
      ],
      where: "test",
    });
    expect(got.read.studWidthIn).toBe(3.625);
    expect(got.read.studSpacingIn).toBe(16);
    expect(got.flags).toEqual([]);
  });

  it("flags a stud spacing under a foot instead of doubling the count", () => {
    // NG Green Bay A3.2, IW-5: `FRAMING @ 6" O.C.` on the drawing, beside
    // eight sister types at 16. A dropped digit, read as a module, would put
    // twice the studs in a quantity.
    const got = readPartitionAssembly({
      lines: ['5/8" GYPSUM BOARD,', "EACH SIDE", '6" 20 GA. MTL. STUD', 'FRAMING @ 6" O.C.', "SOUND ATTENUATION", "BATTS"],
      where: "test",
    });
    expect(got.read.studWidthIn).toBe(6);
    expect(got.read.studSpacingIn).toBeNull();
    expect(got.flags.map((f) => f.why)).toEqual([expect.stringContaining("6in o.c. is not a framing module")]);
  });

  it("never reads a board thickness that precedes the word STUD as a stud", () => {
    // Joining wrapped lines is what makes this reachable: `5/8" GYP. BD.` ends
    // one line and `STUDS AT 16" O.C.` begins the next.
    const got = readPartitionAssembly({
      lines: ['GYP. BD. 5/8"', 'STUDS AT 16" O.C.'],
      where: "test",
    });
    expect(got.read.studWidthIn).toBeNull();
    expect(got.components.some((c) => c.basis === "STUDS")).toBe(false);
  });

  it("does not join a table's rows into one another", () => {
    // Central Bank's `WALL THICKNESS | 4 7/8"` row sits above `STUD SPACING |
    // 16"`; joined, that is a 4-7/8in stud beside the 3-5/8in the STUD SIZE
    // row states, and the type is flagged for a contradiction the sheet does
    // not contain.
    const got = readPartitionAssembly({
      lines: ['WALL THICKNESS | 4 7/8"', 'STUD SPACING (O.C.) | 16"', 'STUD SIZE | 3 5/8"'],
      where: "test",
    });
    expect(got.read.studWidthIn).toBe(3.625);
    expect(got.flags).toEqual([]);
  });

  it("reads nominal lumber as its actual width, and flags a 2X with no size", () => {
    const sized = readPartitionAssembly({ lines: ["2X4 WOOD STUDS AT 16\" O.C."], where: "test" });
    expect(sized.read.studWidthIn).toBe(3.5);
    const unsized = readPartitionAssembly({ lines: ["2X WOOD STUD FRAMING"], where: "test" });
    expect(unsized.read.studWidthIn).toBeNull();
    expect(unsized.flags.some((f) => /no nominal size/.test(f.why))).toBe(true);
  });
});
