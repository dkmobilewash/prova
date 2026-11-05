import { describe, expect, it } from "vitest";
import { areaLine, ceilingOption, heightFrom, legendOption, wallSquareFeet } from "./wallHeight";

const box = (x0: number, y0: number, x1: number, y1: number) => ({ xs: [x0, x1, x1, x0], ys: [y0, y0, y1, y1] });

describe("a wall group's height and square feet", () => {
  it("square feet are length × height × sides, less the openings the company deducts", () => {
    expect(wallSquareFeet({ linearFt: 100, heightFt: 10, sides: 2 })).toBe(2000);
    expect(wallSquareFeet({ linearFt: 100, heightFt: 10, sides: 1 })).toBe(1000);
    // A 6×8 opening (48 sf) comes off each face at a 32 sf threshold; a 3×7 door (21) does not.
    expect(wallSquareFeet({ linearFt: 100, heightFt: 10, sides: 2, openings: [{ widthFt: 6, heightFt: 8 }, { widthFt: 3, heightFt: 7 }], thresholdSqFt: 32 })).toBe(2000 - 96);
    expect(wallSquareFeet({ linearFt: 100, heightFt: null, sides: 2 })).toBeNull();
    expect(areaLine({ linearFt: 120, heightFt: 10, sides: 2, sqFt: 2400 })).toBe(`120 ft × 10'-0" × 2 sides = 2,400 sf`);
    expect(areaLine({ linearFt: 120, heightFt: null, sides: null, sqFt: null })).toBe("120 ft · no height");
  });

  it("the legend option carries the chain the legend read wrote into the type's notes", () => {
    const notes = `Read off sheet A001 of the plan set. Check against the drawing before pricing.\nHeight 14 ft (MEDIUM): "TO DECK"; A301 prints T.O. DECK 14' 0"\nW1 3-5/8" STUD`;
    expect(legendOption({ code: "W1", defaultHeightFt: 14, notes })).toEqual({ kind: "legend", feet: 14, from: `legend W1: "TO DECK"; A301 prints T.O. DECK 14' 0" → 14'-0"` });
    expect(legendOption({ code: "W1", defaultHeightFt: 9.5, notes: "typed in" })?.from).toBe(`W1 in your library: 9'-6"`);
    expect(legendOption({ code: "W1", defaultHeightFt: null, notes })).toBeNull();
  });

  it("the ceiling option is the ceiling over most of the group's length, from the rooms either side of its walls", () => {
    const office = { ...box(0.1, 0.1, 0.3, 0.3), heightFeet: 10, name: "104 OFFICE", from: "tag" };
    const hall = { ...box(0.3, 0.1, 0.4, 0.3), heightFeet: 9, name: "105 HALL", from: "tag" };
    const noCeiling = { ...box(0.5, 0.5, 0.6, 0.6), heightFeet: null, name: "106", from: null };
    // The long wall bounds the office (and nothing on its far side); the short one sits between office and hall.
    const runs = [{ x1: 0.1, y1: 0.1, x2: 0.1, y2: 0.3 }, { x1: 0.3, y1: 0.2, x2: 0.3, y2: 0.25 }];
    expect(ceilingOption(runs, [office, hall, noCeiling])).toEqual({ kind: "ceiling", feet: 10, from: `ceiling plan, room 104 OFFICE: 10'-0"` });
    expect(ceilingOption([{ x1: 0.55, y1: 0.5, x2: 0.55, y2: 0.6 }], [noCeiling])).toBeNull();
    expect(ceilingOption(runs, [{ ...office, from: "schedule" }])?.from).toBe(`finish schedule, room 104 OFFICE: 10'-0"`);
  });

  it("names where a height came from by what it equals, and calls anything else typed", () => {
    const options = [
      { kind: "ceiling" as const, feet: 10, from: "ceiling plan, room 104: 10'-0\"" },
      { kind: "legend" as const, feet: 14, from: "legend W1: TO DECK → 14'-0\"" },
    ];
    expect(heightFrom(14, options)).toBe("legend W1: TO DECK → 14'-0\"");
    expect(heightFrom(10, options)).toBe("ceiling plan, room 104: 10'-0\"");
    expect(heightFrom(12, options)).toBe(`typed: 12'-0"`);
    expect(heightFrom(null, options)).toBeNull();
  });
});
