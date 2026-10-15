import { describe, expect, it } from "vitest";
import {
  wallTypesFromSchedule,
  THINNEST_IN,
  THICKEST_IN,
  type PartitionScheduleRow,
} from "./partitionTypes";

/**
 * The cases are written as a partition schedule PRINTS them, because that is the
 * only input this ever gets and every one of these spellings is on a drawing
 * somewhere. The numbers are asserted in inches, because that is what the wall
 * finder measures and what this has to meet it in.
 */

const row = (over: Partial<PartitionScheduleRow>): PartitionScheduleRow => ({
  mark: "A1",
  description: null,
  size: null,
  notes: null,
  ...over,
});

describe("a thickness column is read as the thickness", () => {
  it('reads 4 7/8"', () => {
    const [type] = wallTypesFromSchedule([row({ size: '4 7/8"' })]);
    expect(type.thicknessIn).toBeCloseTo(4.875, 3);
  });

  it("reads a vulgar fraction, which is what a CAD font emits", () => {
    // `4⅞"` is one glyph on the sheet and means exactly what `4 7/8"` means.
    // Dropping the row over a typographic difference would lose a wall type.
    const [type] = wallTypesFromSchedule([row({ size: '4⅞"' })]);
    expect(type.thicknessIn).toBeCloseTo(4.875, 3);
  });

  it('reads a whole number, 6"', () => {
    expect(wallTypesFromSchedule([row({ size: '6"' })])[0].thicknessIn).toBeCloseTo(6, 3);
  });

  it("REFUSES a dimension with no inch mark", () => {
    // `4 7/8` with nothing to say what it is parses as four feet seven and a
    // half inches through the app's reader, which is a wall nobody drew. The
    // mark is required rather than assumed.
    expect(wallTypesFromSchedule([row({ size: "4 7/8" })])).toHaveLength(0);
  });

  it("REFUSES a missing inch mark even where the result would look plausible", () => {
    // Found by mutation: the case above is also caught by the thickness bounds,
    // because four-foot-seven is far too thick to be a wall. `1 1/2` is not —
    // read as FEET it is eighteen inches, which is a believable shaft wall, and
    // the drawing meant an inch and a half. Nothing downstream could tell.
    expect(
      wallTypesFromSchedule([row({ size: "1 1/2" })]),
      "a thickness in feet was accepted as a wall",
    ).toHaveLength(0);
  });

  it("REFUSES a door size that found its way into a partition schedule", () => {
    // `3'-0" x 7'-0"` is a door. A foot mark in a thickness column means the
    // column was read wrongly, and half-reading it would make a 3 ft wall.
    expect(wallTypesFromSchedule([row({ size: '3\'-0" x 7\'-0"' })])).toHaveLength(0);
  });

  it("REFUSES a foot mark even where the inches would be in range", () => {
    // Also found by mutation. The door size above is refused by the parser
    // before the foot-mark rule is reached, so it proves nothing about that
    // rule. `1'-6"` parses cleanly and is eighteen inches, which is a wall this
    // trade builds — so only the foot mark says the column was misread, and
    // only this case tests that it is being read.
    expect(
      wallTypesFromSchedule([row({ size: "1'-6\"" })]),
      "a feet-and-inches cell was taken as a wall thickness",
    ).toHaveLength(0);
  });
});

describe("a thickness inside free text counts ONLY where the schedule calls it the total", () => {
  // ── THE CASE THIS MODULE EXISTS TO GET RIGHT ──
  //
  // A description names several dimensions and one of them is the wall. Take
  // the first and you get the STUD — and the type built from it then matches
  // and prices every 3-5/8" group on the sheet as A1. The footage looks right
  // and the assembly is wrong, which is the expensive direction.

  const ASSEMBLY = '3-5/8" MTL STUD, 5/8" GWB EA SIDE (4-7/8" TOTAL)';

  it("takes the TOTAL and not the stud", () => {
    const [type] = wallTypesFromSchedule([row({ description: ASSEMBLY })]);
    expect(type.thicknessIn, "the stud size was read as the wall thickness").toBeCloseTo(4.875, 3);
  });

  it("DROPS the row when the same assembly states no total", () => {
    // Nothing here says which dimension is the wall, so nobody gets to guess.
    // One line of typing beats a type that prices footage wrongly.
    const noTotal = '3-5/8" MTL STUD, 5/8" GWB EA SIDE';
    expect(wallTypesFromSchedule([row({ description: noTotal })])).toHaveLength(0);
  });

  it("accepts OVERALL, THK and NOMINAL as the same claim", () => {
    for (const word of ["OVERALL", "THK.", "NOMINAL THICKNESS"]) {
      const [type] = wallTypesFromSchedule([row({ description: `STUD WALL — 6 1/8" ${word}` })]);
      expect(type?.thicknessIn, word).toBeCloseTo(6.125, 3);
    }
  });

  it("finds it in the notes when the description has nothing", () => {
    const [type] = wallTypesFromSchedule([row({ description: "SHAFT WALL", notes: '2 HR — 10" TOTAL' })]);
    expect(type.thicknessIn).toBeCloseTo(10, 3);
  });

  it("prefers the SIZE cell over anything in the text", () => {
    // A table with its own thickness column has already answered. The text is
    // the fallback, not a second opinion.
    const [type] = wallTypesFromSchedule([row({ size: '6"', description: ASSEMBLY })]);
    expect(type.thicknessIn).toBeCloseTo(6, 3);
  });
});

describe("what is not a wall thickness", () => {
  it(`refuses anything under ${THINNEST_IN}in — a stud spacing or a rating`, () => {
    expect(wallTypesFromSchedule([row({ size: '0.5"' })])).toHaveLength(0);
  });

  it(`refuses anything over ${THICKEST_IN}in`, () => {
    // 16" here is a stud SPACING sitting in the wrong column; 48" is a sheet
    // width. Either would be a wall this trade does not build.
    expect(wallTypesFromSchedule([row({ size: '48"' })])).toHaveLength(0);
  });

  it("still admits a shaft wall at the top of the range", () => {
    // The bound has to clear a real double-stud shaft wall or it is rejecting
    // the assemblies it exists to price.
    expect(wallTypesFromSchedule([row({ size: '18"' })])[0].thicknessIn).toBeCloseTo(18, 3);
  });
});

describe("a height is taken only where the schedule prints one", () => {
  it("reads 10'-6\" from the notes", () => {
    const [type] = wallTypesFromSchedule([row({ size: '4 7/8"', notes: "TO 10'-6\" AFF" })]);
    expect(type.defaultHeightFt).toBeCloseTo(10.5, 2);
  });

  it("leaves it NULL when the schedule says nothing", () => {
    // `WallType.defaultHeightFt` is nullable for exactly this: a type with no
    // default and a run with no height produce nothing, rather than a guessed
    // ten feet that quietly becomes square footage.
    expect(wallTypesFromSchedule([row({ size: '4 7/8"' })])[0].defaultHeightFt).toBeNull();
  });

  it("REFUSES THE WHOLE ROW when the size cell holds a height", () => {
    // Restated after a mutation showed the old name was claiming more than the
    // code does. Reading a height out of `size` is not merely declined — it is
    // UNREACHABLE, because a cell carrying a foot mark never yields a thickness
    // and the row is gone before any height is looked for. That is the stronger
    // guarantee and it is the one worth asserting.
    expect(wallTypesFromSchedule([row({ size: "10'-6\"", notes: "X" })])).toHaveLength(0);
  });

  it("refuses an implausible height rather than storing it", () => {
    expect(wallTypesFromSchedule([row({ size: '4 7/8"', notes: "SEE 3'-0\" DETAIL" })])[0].defaultHeightFt).toBeNull();
  });
});

describe("the mark is an identity and is copied, never tidied", () => {
  it("keeps the mark exactly as printed", () => {
    expect(wallTypesFromSchedule([row({ mark: "EXT-1", size: '8 7/8"' })])[0].code).toBe("EXT-1");
  });

  it("keeps the FIRST row when a mark repeats", () => {
    // A long schedule repeats its headings where it breaks across the sheet,
    // and a mark above and below the break is one type, not two.
    const types = wallTypesFromSchedule([
      row({ mark: "A1", size: '4 7/8"' }),
      row({ mark: "a1", size: '9"' }),
    ]);
    expect(types).toHaveLength(1);
    expect(types[0].thicknessIn).toBeCloseTo(4.875, 3);
  });

  it("drops a row with no mark", () => {
    expect(wallTypesFromSchedule([row({ mark: "   ", size: '4 7/8"' })])).toHaveLength(0);
  });

  it("names a type after its mark when the schedule gives no description", () => {
    expect(wallTypesFromSchedule([row({ mark: "B1", size: '6"' })])[0].name).toBe("B1 partition");
  });
});

describe("a whole schedule, as School-01 would print one", () => {
  it("reads every row it can and drops the one it cannot", () => {
    const schedule: PartitionScheduleRow[] = [
      { mark: "A1", description: '3-5/8" STUD, 5/8" GWB EA SIDE', size: '4 7/8"', notes: "TO 10'-6\" AFF" },
      { mark: "A2", description: '3-5/8" STUD, 5/8" GWB EA SIDE', size: '4 7/8"', notes: "1 HR" },
      { mark: "B1", description: '6" STUD, 5/8" GWB EA SIDE', size: '7 1/4"', notes: null },
      { mark: "C1", description: "SEE DETAIL 3/A-501", size: null, notes: null },
      { mark: "EXT-1", description: "BRICK VENEER ON STUD", size: '8 7/8"', notes: null },
    ];
    const types = wallTypesFromSchedule(schedule);
    expect(types.map((t) => t.code)).toEqual(["A1", "A2", "B1", "EXT-1"]);

    // A1 and A2 at the SAME thickness is the ordinary case, not a defect — they
    // differ by fire rating, which a floor plan cannot show. It is why matching
    // by thickness alone has to ask rather than pick.
    expect(types[0].thicknessIn).toBeCloseTo(types[1].thicknessIn, 3);
    expect(types[0].defaultHeightFt).toBeCloseTo(10.5, 2);
    expect(types[1].defaultHeightFt).toBeNull();
  });

  it("returns nothing for an empty schedule rather than throwing", () => {
    expect(wallTypesFromSchedule([])).toEqual([]);
  });
});
