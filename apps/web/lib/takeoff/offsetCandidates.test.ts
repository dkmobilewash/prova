import { describe, expect, it } from "vitest";
import { OFFSET_INCHES, offsetCandidates } from "./offsetCandidates";
import type { StrokeSegment } from "./wallVectors";

/**
 * ── A RUN PAIRED WITH A SHELF INSTEAD OF THE WALL'S FAR FACE ──
 *
 * The defect the ELEVEN03 labelling found: the finder pairs two parallel lines
 * and calls their midline a wall, and in a closet the second line is sometimes
 * a shelf or a shelf end. The run is a few inches off the real wall, its
 * length is right, and the panel shows an ordinary thickness.
 *
 * Everything below is in page-width units at a scale of 240 ft per page width,
 * so one inch of building is 1/2880 of the page. The numbers are written as
 * `in(n)` rather than as decimals, because a fixture whose constants cannot be
 * read is a fixture nobody will correct.
 */
const FEET_PER_UNIT = 240;
const in_ = (inches: number) => inches / 12 / FEET_PER_UNIT;
const ft = (feet: number) => feet / FEET_PER_UNIT;

/** A horizontal stroke at height y, from x1 to x2. */
function line(y: number, x1: number, x2: number): StrokeSegment {
  return { x1, y1: y, x2, y2: y };
}

describe("accepted runs that sit off the wall", () => {
  it("flags a run paired with a shelf instead of the far face", () => {
    // A real 6in wall with faces at y=0 and y=6in, and a shelf line 8in INSIDE
    // the room below it. The finder paired the wall's lower face with the
    // shelf, so the run's centreline sits at 10in — 7in below the wall's true
    // centre of 3in.
    //
    // The first version of this fixture put the shelf at 11in, giving an
    // offset of 5.5in: a real defect, correctly measured, and BELOW the
    // six-inch threshold — so the case reported nothing and read exactly like
    // a broken detector. The margin is deliberate now, and the threshold has
    // a case of its own below.
    const wallTop = 0;
    const wallBottom = in_(6);
    const shelf = in_(14);
    const segments = [
      line(wallTop, ft(0), ft(20)),
      line(wallBottom, ft(0), ft(20)),
      // The shelf spans the closet, which is most of this run.
      line(shelf, ft(2), ft(18)),
    ];
    const runY = (wallBottom + shelf) / 2;
    const found = offsetCandidates({
      runs: [{ id: "bad", x1: ft(3), y1: runY, x2: ft(17), y2: runY, lengthFeet: 14 }],
      segments,
      feetPerUnit: FEET_PER_UNIT,
    });
    expect(found).toHaveLength(1);
    // The wall's centre is at 3in and the run is at 10in.
    expect(found[0].offsetInches).toBeGreaterThan(6.5);
    expect(found[0].offsetInches).toBeLessThan(7.5);
    expect(found[0].pairThicknessInches).toBeCloseTo(6, 0);
  });

  it("leaves a run sitting correctly between two faces alone", () => {
    // The control, and the half that matters most: if this flagged, the list
    // would be every wall on the sheet and would be ignored.
    const segments = [line(0, ft(0), ft(20)), line(in_(6), ft(0), ft(20))];
    const y = in_(3);
    expect(
      offsetCandidates({
        runs: [{ x1: ft(3), y1: y, x2: ft(17), y2: y, lengthFeet: 14 }],
        segments,
        feetPerUnit: FEET_PER_UNIT,
      }),
    ).toHaveLength(0);
  });

  it("is not fooled by a wall on the other side of the building", () => {
    // ── THE BOUND THAT THE FIRST VERSION DID NOT HAVE ──
    //
    // Without a perpendicular limit the search pairs a run with any parallel
    // pair that overlaps its span, anywhere on the sheet. On three real sheets
    // that produced offsets of 2,359 INCHES — 196 feet — and flagged a third
    // of every accepted run. Each pair was real and none was the run's wall.
    const y = in_(3);
    const segments = [
      // The run's own wall, correctly straddled.
      line(0, ft(0), ft(20)),
      line(in_(6), ft(0), ft(20)),
      // Another wall 40 ft away, just as parallel and just as long.
      line(ft(40), ft(0), ft(20)),
      line(ft(40) + in_(6), ft(0), ft(20)),
    ];
    expect(
      offsetCandidates({
        runs: [{ x1: ft(3), y1: y, x2: ft(17), y2: y, lengthFeet: 14 }],
        segments,
        feetPerUnit: FEET_PER_UNIT,
      }),
    ).toHaveLength(0);
  });

  it("ignores a short line that does not run the length of the run", () => {
    // A shelf END, or a door jamb: it is parallel and close, and it is not a
    // face. Pairing with it would invent an offset for a correct run.
    const y = in_(3);
    const segments = [
      line(0, ft(0), ft(20)),
      line(in_(6), ft(0), ft(20)),
      line(in_(10), ft(9), ft(10)),
    ];
    expect(
      offsetCandidates({
        runs: [{ x1: ft(3), y1: y, x2: ft(17), y2: y, lengthFeet: 14 }],
        segments,
        feetPerUnit: FEET_PER_UNIT,
      }),
    ).toHaveLength(0);
  });

  it("says nothing about a run with no face pair near it at all", () => {
    // A different defect — a run along something that is not a wall — and
    // folding it in here would make the list unreadable.
    const y = in_(3);
    expect(
      offsetCandidates({
        runs: [{ x1: ft(3), y1: y, x2: ft(17), y2: y, lengthFeet: 14 }],
        segments: [line(0, ft(0), ft(20))],
        feetPerUnit: FEET_PER_UNIT,
      }),
    ).toHaveLength(0);
  });

  it("ignores a crossing wall, however close", () => {
    const y = in_(3);
    const segments = [
      line(0, ft(0), ft(20)),
      line(in_(6), ft(0), ft(20)),
      // Perpendicular, through the middle of the run.
      { x1: ft(10), y1: ft(-5), x2: ft(10), y2: ft(5) },
      { x1: ft(10) + in_(6), y1: ft(-5), x2: ft(10) + in_(6), y2: ft(5) },
    ];
    expect(
      offsetCandidates({
        runs: [{ x1: ft(3), y1: y, x2: ft(17), y2: y, lengthFeet: 14 }],
        segments,
        feetPerUnit: FEET_PER_UNIT,
      }),
    ).toHaveLength(0);
  });

  it("reports the worst first, so a long list can be read from the top", () => {
    const segments = [
      line(0, ft(0), ft(20)),
      line(in_(6), ft(0), ft(20)),
      line(in_(11), ft(2), ft(18)),
      line(ft(30), ft(0), ft(20)),
      line(ft(30) + in_(6), ft(0), ft(20)),
      line(ft(30) + in_(14), ft(2), ft(18)),
    ];
    const found = offsetCandidates({
      runs: [
        // 5.5in off its wall.
        { id: "smaller", x1: ft(3), y1: in_(8.5), x2: ft(17), y2: in_(8.5), lengthFeet: 14 },
        // 7in off its wall, so it has to come first.
        {
          id: "bigger",
          x1: ft(3),
          y1: ft(30) + in_(10),
          x2: ft(17),
          y2: ft(30) + in_(10),
          lengthFeet: 14,
        },
      ],
      segments,
      feetPerUnit: FEET_PER_UNIT,
      minInches: 1,
    });
    expect(found.length).toBe(2);
    expect(found[0].run.id).toBe("bigger");
    for (let i = 1; i < found.length; i += 1) {
      expect(found[i - 1].offsetInches).toBeGreaterThanOrEqual(found[i].offsetInches);
    }
  });

  it("refuses a scale it cannot use rather than returning a tidy empty list", () => {
    // `feetPerUnit` of 0 or NaN would make every offset 0 and every sheet
    // clean. It returns empty either way — the point of this case is that the
    // reason is a guard rather than an accident, so the next person reading
    // an empty list checks the scale.
    const y = in_(3);
    expect(
      offsetCandidates({
        runs: [{ x1: ft(3), y1: y, x2: ft(17), y2: y, lengthFeet: 14 }],
        segments: [line(0, ft(0), ft(20)), line(in_(6), ft(0), ft(20))],
        feetPerUnit: 0,
      }),
    ).toHaveLength(0);
  });

  it("does not flag a run just under the threshold, and does just over", () => {
    // 5.5in and 7in off the same wall, the first below Diego's six inches.
    // This is the case the fixture above was accidentally testing.
    const segments = [
      line(0, ft(0), ft(20)),
      line(in_(6), ft(0), ft(20)),
      line(in_(11), ft(2), ft(18)),
      line(in_(14), ft(2), ft(18)),
    ];
    const at = (y: number) => ({ x1: ft(3), y1: y, x2: ft(17), y2: y, lengthFeet: 14 });
    const run = (y: number) =>
      offsetCandidates({ runs: [at(y)], segments, feetPerUnit: FEET_PER_UNIT });
    expect(run(in_(8.5)), "5.5in off is under the threshold").toHaveLength(0);
    expect(run(in_(10)), "7in off is over it").toHaveLength(1);
  });

  it("uses six inches as the default, which is Diego's number", () => {
    expect(OFFSET_INCHES).toBe(6);
  });
});
