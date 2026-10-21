import { describe, expect, it } from "vitest";
import {
  GAP_TOLERANCE,
  joinOpeningsToSchedule,
  sizeToFeet,
  widthAndHeight,
  type DrawnOpening,
  type PlacedMark,
  type ScheduledOpening,
} from "./openingMarks";

/**
 * The marks are Camp Bow Wow's own — its door schedule on p26 lists 100, 101A,
 * 101B, 102 … 119, and its floor plan on p8 prints the same strings. That
 * overlap is what makes the join possible and what makes it dangerous: a floor
 * plan numbers its ROOMS in the same series, so `102` appears twice on the
 * sheet and only one of them is a door.
 */
const FEET_PER_UNIT = 288;
const ft = (feet: number) => feet / FEET_PER_UNIT;

function opening(atX: number, atY: number, widthFeet: number): DrawnOpening {
  return {
    x1: ft(atX),
    y1: ft(atY),
    x2: ft(atX + widthFeet),
    y2: ft(atY),
    widthFeet,
  };
}
function mark(text: string, atX: number, atY: number): PlacedMark {
  return { text, x: ft(atX), y: ft(atY) };
}
const row = (
  mark: string,
  widthFt: number | null,
  heightFt: number | null = 7,
): ScheduledOpening => ({ mark, widthFt, heightFt, description: "HOLLOW METAL" });

describe("joining a door schedule to the openings on a plan", () => {
  it("uses the schedule's width, not the drawn gap", () => {
    // The gap is the ROUGH opening — frame and shims — and the schedule states
    // the door. 3ft-2in drawn, 3ft scheduled.
    const got = joinOpeningsToSchedule({
      openings: [opening(10, 10, 3.17)],
      marks: [mark("102", 11, 11)],
      rows: [row("102", 3)],
      feetPerUnit: FEET_PER_UNIT,
    });
    expect(got.openings[0].widthFt).toBe(3);
    expect(got.openings[0].widthFrom).toBe("schedule");
    expect(got.openings[0].mark).toBe("102");
    expect(got.matched).toBe(1);
    expect(got.matchRate).toBe(1);
    expect(got.openings[0].mismatch, "a frame allowance is not a mismatch").toBeNull();
  });

  it("ignores a room number sitting in the middle of the room", () => {
    // THE CASE THE WHOLE DESIGN IS FOR. `102` is printed twice on Camp Bow
    // Wow's A101: once beside the door and once in the floor of room 102. Text
    // alone cannot tell them apart; distance to an opening can.
    const got = joinOpeningsToSchedule({
      openings: [opening(10, 10, 3.2)],
      marks: [mark("102", 40, 40)],
      rows: [row("102", 3)],
      feetPerUnit: FEET_PER_UNIT,
    });
    expect(got.matched).toBe(0);
    expect(got.openings[0].widthFrom).toBe("drawn");
    expect(got.openings[0].widthFt).toBeCloseTo(3.2, 2);
  });

  it("takes the NEAREST mark when a room number and a door mark both sit close", () => {
    // The FAR mark is listed first, deliberately: with the near one first,
    // "nearest wins" and "first wins" give the same answer and the comparison
    // can be deleted without a test noticing. A mutant proved exactly that.
    const got = joinOpeningsToSchedule({
      openings: [opening(10, 10, 3.2)],
      marks: [mark("102", 14, 14), mark("103", 10.5, 10.5)],
      rows: [row("102", 3), row("103", 3.5)],
      feetPerUnit: FEET_PER_UNIT,
    });
    expect(got.openings[0].mark).toBe("103");
    expect(got.openings[0].widthFt).toBe(3.5);
  });

  it("keeps the drawn gap when no row claims the opening", () => {
    // Not an error: a door whose schedule page nobody read still has to be
    // deducted. Dropping it would silently stop deducting for every door on
    // such a sheet.
    const got = joinOpeningsToSchedule({
      openings: [opening(10, 10, 3.2), opening(30, 10, 6.1)],
      marks: [mark("102", 11, 11)],
      rows: [row("102", 3)],
      feetPerUnit: FEET_PER_UNIT,
    });
    expect(got.matched).toBe(1);
    expect(got.matchRate).toBe(0.5);
    const unmatched = got.openings[1];
    expect(unmatched.widthFrom).toBe("drawn");
    expect(unmatched.widthFt).toBeCloseTo(6.1, 2);
    expect(unmatched.matched).toBeNull();
  });

  it("will not let one mark label two openings", () => {
    const got = joinOpeningsToSchedule({
      openings: [opening(10, 10, 3.2), opening(10, 12, 3.2)],
      marks: [mark("102", 10, 11)],
      rows: [row("102", 3)],
      feetPerUnit: FEET_PER_UNIT,
    });
    expect(got.matched).toBe(1);
    expect(got.openings.filter((o) => o.mark === "102")).toHaveLength(1);
  });

  it("ignores a mark the schedule has never heard of", () => {
    // A grid bubble or a detail reference beside a doorway names no row.
    const got = joinOpeningsToSchedule({
      openings: [opening(10, 10, 3.2)],
      marks: [mark("A501", 10.5, 10.5)],
      rows: [row("102", 3)],
      feetPerUnit: FEET_PER_UNIT,
    });
    expect(got.matched).toBe(0);
    expect(got.openings[0].widthFrom).toBe("drawn");
    // THE ASSERTION THAT ACTUALLY HOLDS THE GUARD. Without it, removing the
    // "is this mark in the schedule" test left both lines above true — an
    // unknown mark resolves to a null row, so nothing counts as matched and
    // the width stays drawn — while the opening was labelled `A501` on
    // screen. A mutant proved it, which is why this line exists.
    expect(got.openings[0].mark, "a detail bubble must not label the door").toBeNull();
  });

  it("matches a mark case-insensitively without rewriting it", () => {
    const got = joinOpeningsToSchedule({
      openings: [opening(10, 10, 3.2)],
      marks: [mark("101a", 10.5, 10.5)],
      rows: [row("101A", 3)],
      feetPerUnit: FEET_PER_UNIT,
    });
    expect(got.matched).toBe(1);
    expect(got.openings[0].mark, "reported as printed on the plan").toBe("101a");
  });

  it("counts how many schedule rows were placed on this sheet", () => {
    const got = joinOpeningsToSchedule({
      openings: [opening(10, 10, 3.2)],
      marks: [mark("102", 10.5, 10.5)],
      rows: [row("102", 3), row("103", 3), row("104", 3)],
      feetPerUnit: FEET_PER_UNIT,
    });
    expect(got.rowsPlaced).toBe(1);
    expect(got.rowsTotal).toBe(3);
  });
});

describe("a gap that does not agree with its door", () => {
  it("flags a gap far wider than the scheduled door, and still uses the schedule", () => {
    const got = joinOpeningsToSchedule({
      openings: [opening(10, 10, 8)],
      marks: [mark("102", 10.5, 10.5)],
      rows: [row("102", 3)],
      feetPerUnit: FEET_PER_UNIT,
    });
    expect(got.mismatches).toBe(1);
    expect(got.openings[0].mismatch?.drawnFeet).toBe(8);
    expect(got.openings[0].mismatch?.scheduledFeet).toBe(3);
    expect(got.openings[0].mismatch?.why).toContain("wrong opening");
    // Reported, not resolved: which of the two is wrong is a question about
    // the drawing, and the schedule is the better witness for a door.
    expect(got.openings[0].widthFt).toBe(3);
  });

  it("flags a door wider than the hole it sits in", () => {
    const got = joinOpeningsToSchedule({
      openings: [opening(10, 10, 1.4)],
      marks: [mark("102", 10.5, 10.5)],
      rows: [row("102", 3)],
      feetPerUnit: FEET_PER_UNIT,
    });
    expect(got.openings[0].mismatch?.why).toContain("check the size cell");
  });

  it("does not flag an ordinary frame allowance", () => {
    // 3ft-2in of gap for a 3ft door is a frame, not a finding. Flagging it
    // would put a warning on every door in the building.
    const got = joinOpeningsToSchedule({
      openings: [opening(10, 10, 3.17)],
      marks: [mark("102", 10.5, 10.5)],
      rows: [row("102", 3)],
      feetPerUnit: FEET_PER_UNIT,
    });
    expect(got.mismatches).toBe(0);
    expect(GAP_TOLERANCE).toBe(0.5);
  });

  it("keeps the drawn gap when the row has no readable width", () => {
    const got = joinOpeningsToSchedule({
      openings: [opening(10, 10, 3.2)],
      marks: [mark("102", 10.5, 10.5)],
      rows: [row("102", null)],
      feetPerUnit: FEET_PER_UNIT,
    });
    expect(got.openings[0].widthFrom).toBe("drawn");
    expect(got.openings[0].matched, "the door is still named").not.toBeNull();
    expect(got.openings[0].mismatch).toBeNull();
  });
});

describe("reading a size cell", () => {
  it("reads the sizes a door schedule prints", () => {
    expect(sizeToFeet(`3'-0"`)).toBe(3);
    expect(sizeToFeet(`3' - 6"`)).toBe(3.5);
    expect(sizeToFeet(`3'-6 1/2"`)).toBeCloseTo(3 + 6.5 / 12, 4);
    expect(sizeToFeet(`36"`)).toBe(3);
    expect(sizeToFeet("")).toBeNull();
    expect(sizeToFeet(null)).toBeNull();
    expect(sizeToFeet("HOLLOW METAL")).toBeNull();
  });

  it("takes width before height, which is how a schedule writes it", () => {
    expect(widthAndHeight(`3'-0" x 7'-0"`)).toEqual({ widthFt: 3, heightFt: 7 });
    expect(widthAndHeight(`6'-0" X 8'-0"`)).toEqual({ widthFt: 6, heightFt: 8 });
    expect(widthAndHeight(`3'-0"`), "a lone size is the width").toEqual({
      widthFt: 3,
      heightFt: null,
    });
    expect(widthAndHeight(null)).toEqual({ widthFt: null, heightFt: null });
  });

  it("does not read a zero denominator as a size", () => {
    expect(sizeToFeet(`3'-6 1/0"`)).toBeCloseTo(3.5, 4);
  });
});

describe("the empty cases say nothing confident", () => {
  it("reports a zero match rate rather than a perfect one on an empty sheet", () => {
    const got = joinOpeningsToSchedule({
      openings: [],
      marks: [],
      rows: [row("102", 3)],
      feetPerUnit: FEET_PER_UNIT,
    });
    expect(got.matchRate, "no openings is not a 100% match").toBe(0);
    expect(got.rowsPlaced).toBe(0);
  });

  it("falls back to the drawn gap for every opening when there is no schedule", () => {
    const got = joinOpeningsToSchedule({
      openings: [opening(10, 10, 3.2), opening(20, 10, 6)],
      marks: [mark("102", 10.5, 10.5)],
      rows: [],
      feetPerUnit: FEET_PER_UNIT,
    });
    expect(got.openings.every((o) => o.widthFrom === "drawn")).toBe(true);
    expect(got.matched).toBe(0);
  });

  it("matches nothing when the scale is unusable", () => {
    // Reach is in FEET, so a zero scale makes it zero units and no mark can
    // reach anything. Silent agreement with a nonsense scale would attach the
    // schedule to whatever happened to be nearest.
    const got = joinOpeningsToSchedule({
      openings: [opening(10, 10, 3.2)],
      marks: [mark("102", 10, 10)],
      rows: [row("102", 3)],
      feetPerUnit: 0,
    });
    expect(got.matched).toBe(0);
  });
});

describe("a scheduled mark with no detected gap", () => {
  const ftPt = 1 / 288;
  const run = { x1: 0.1, y1: 0.5, x2: 0.3, y2: 0.5 };
  const rows = [{ mark: "114", widthFt: 3, heightFt: 7, description: null }];

  it("is placed on the nearest run at the mark, with the schedule's width, and says so", () => {
    const got = joinOpeningsToSchedule({
      openings: [],
      marks: [{ text: "114", x: 0.2, y: 0.5 + 2 * ftPt }],
      rows,
      feetPerUnit: 288,
      walls: [run],
    });
    expect(got.placedByMark).toBe(1);
    expect(got.rowsPlaced).toBe(1);
    const door = got.openings[0];
    expect(door.placedBy).toBe("mark");
    expect(door.widthFrom).toBe("schedule");
    expect(door.widthFt).toBe(3);
    expect(door.opening.widthFeet).toBe(3);
    // Centred where the mark projects onto the run, three feet along it.
    expect((door.opening.x1 + door.opening.x2) / 2).toBeCloseTo(0.2, 6);
    expect(door.opening.y1).toBeCloseTo(0.5, 6);
    expect(Math.hypot(door.opening.x2 - door.opening.x1, door.opening.y2 - door.opening.y1) * 288).toBeCloseTo(3, 6);
    // The rate over drawn openings is untouched: nothing was drawn.
    expect(got.matchRate).toBe(0);
  });

  it("is not placed when the mark is out of reach of every run, or when no runs were given", () => {
    const far = joinOpeningsToSchedule({
      openings: [],
      marks: [{ text: "114", x: 0.2, y: 0.5 + 20 * ftPt }],
      rows,
      feetPerUnit: 288,
      walls: [run],
    });
    expect(far.placedByMark).toBe(0);
    expect(far.openings).toHaveLength(0);
    const none = joinOpeningsToSchedule({
      openings: [],
      marks: [{ text: "114", x: 0.2, y: 0.5 + 2 * ftPt }],
      rows,
      feetPerUnit: 288,
    });
    expect(none.placedByMark).toBe(0);
  });

  it("prefers a detected gap: a mark that claimed an opening is not placed twice", () => {
    const got = joinOpeningsToSchedule({
      openings: [{ x1: 0.19, y1: 0.5, x2: 0.21, y2: 0.5, widthFeet: 2.6 }],
      marks: [{ text: "114", x: 0.2, y: 0.5 + 2 * ftPt }],
      rows,
      feetPerUnit: 288,
      walls: [run],
    });
    expect(got.openings).toHaveLength(1);
    expect(got.openings[0].placedBy).toBe("opening");
    expect(got.placedByMark).toBe(0);
  });

  it("places the printing nearest a wall and never the room's copy, and never twice", () => {
    // `109` at the door, 1 ft off the run, and `109` under the room name,
    // 2 ft off another run. One door, at the first.
    const other = { x1: 0.1, y1: 0.7, x2: 0.3, y2: 0.7 };
    const got = joinOpeningsToSchedule({
      openings: [],
      marks: [
        { text: "109", x: 0.25, y: 0.7 - 2 * ftPt },
        { text: "109", x: 0.15, y: 0.5 + 1 * ftPt },
      ],
      rows: [{ mark: "109", widthFt: 3, heightFt: 7, description: null }],
      feetPerUnit: 288,
      walls: [run, other],
    });
    expect(got.placedByMark).toBe(1);
    expect(got.openings).toHaveLength(1);
    expect(got.openings[0].opening.y1).toBeCloseTo(0.5, 6);
  });

  it("does not place a mark that sits in open floor, farther than a jamb from any run", () => {
    const got = joinOpeningsToSchedule({
      openings: [],
      marks: [{ text: "114", x: 0.2, y: 0.5 + 4 * ftPt }],
      rows,
      feetPerUnit: 288,
      walls: [run],
    });
    expect(got.placedByMark).toBe(0);
  });

  it("cannot place a row whose width the schedule did not give", () => {
    const got = joinOpeningsToSchedule({
      openings: [],
      marks: [{ text: "114", x: 0.2, y: 0.5 + 2 * ftPt }],
      rows: [{ mark: "114", widthFt: null, heightFt: null, description: null }],
      feetPerUnit: 288,
      walls: [run],
    });
    expect(got.placedByMark).toBe(0);
  });
});

describe("a mark the gap join already used", () => {
  it("is spent: its second printing near a wall is not placed as another door", () => {
    const ftPt = 1 / 288;
    const run = { x1: 0.1, y1: 0.5, x2: 0.3, y2: 0.5 };
    const other = { x1: 0.1, y1: 0.8, x2: 0.3, y2: 0.8 };
    const got = joinOpeningsToSchedule({
      openings: [{ x1: 0.19, y1: 0.5, x2: 0.21, y2: 0.5, widthFeet: 2.6 }],
      marks: [
        { text: "102", x: 0.2, y: 0.5 + 2 * ftPt },
        { text: "102", x: 0.2, y: 0.8 + 1 * ftPt },
      ],
      rows: [{ mark: "102", widthFt: 3, heightFt: 7, description: null }],
      feetPerUnit: 288,
      walls: [run, other],
    });
    expect(got.openings).toHaveLength(1);
    expect(got.placedByMark).toBe(0);
    expect(got.rowsPlaced).toBe(1);
  });
});
