import { describe, expect, it } from "vitest";
import { startReview } from "./answerKeyReview";
import { SHORTEST_HALF_FEET, crossingPoint, splitCandidate } from "./splitCandidate";
import type { Candidate } from "./answerKeyReview";

/**
 * Cutting a candidate where it stops being a wall.
 *
 * The case throughout is Camp Bow Wow A101's north wall: 160 ft, of which the
 * last 30 ft crosses an outdoor play yard, with the building's east wall
 * crossing it at the boundary.
 */
const FEET_PER_UNIT = 288;

const run = (id: string, x1: number, y1: number, x2: number, y2: number): Candidate => ({
  id,
  x1: x1 / FEET_PER_UNIT,
  y1: y1 / FEET_PER_UNIT,
  x2: x2 / FEET_PER_UNIT,
  y2: y2 / FEET_PER_UNIT,
  lengthFeet: Math.hypot(x2 - x1, y2 - y1),
  thicknessIn: 7.5,
  from: "pair",
  note: "",
});

const ft = (n: number) => n / FEET_PER_UNIT;

/** The north wall, and the east wall crossing it 129 ft along. */
const sheet = () => [run("north", 0, 0, 160, 0), run("east", 129, -40, 129, 40)];

describe("splitting a candidate", () => {
  it("CUTS AT THE ACCEPTED WALL THAT CROSSES IT", () => {
    let state = startReview(sheet(), FEET_PER_UNIT);
    state = { ...state, verdicts: { ...state.verdicts, east: "wall" } };

    const at = crossingPoint(state, "north");
    expect(at, "no crossing found").not.toBeNull();
    expect(at!.x).toBeCloseTo(ft(129), 5);

    const { halves, state: after } = splitCandidate(state, "north", at!, FEET_PER_UNIT);
    expect(halves).not.toBeNull();
    const [west, east] = halves!;
    const byId = new Map(after.candidates.map((c) => [c.id, c]));
    expect(byId.get(west)!.lengthFeet).toBeCloseTo(129, 1);
    expect(byId.get(east)!.lengthFeet).toBeCloseTo(31, 1);
    // The two halves add back up to the whole, which is the one arithmetic
    // guarantee a reviewer will check by eye.
    expect(byId.get(west)!.lengthFeet + byId.get(east)!.lengthFeet).toBeCloseTo(160, 4);
  });

  it("only crosses at a wall the reviewer ACCEPTED", () => {
    // An unreviewed or rejected run is not a building boundary — it is a
    // candidate like any other, and cutting at one would move the decision
    // into a place nobody has decided anything about.
    const state = startReview(sheet(), FEET_PER_UNIT);
    expect(crossingPoint(state, "north"), "cut at an unreviewed run").toBeNull();

    const rejected = { ...state, verdicts: { ...state.verdicts, east: "not-a-wall" as const } };
    expect(crossingPoint(rejected, "north"), "cut at a rejected run").toBeNull();
  });

  it("ignores a wall running ALONGSIDE rather than across", () => {
    const state = startReview(
      [run("north", 0, 0, 160, 0), run("parallel", 10, 2, 150, 2)],
      FEET_PER_UNIT,
    );
    const accepted = { ...state, verdicts: { ...state.verdicts, parallel: "wall" as const } };
    expect(crossingPoint(accepted, "north")).toBeNull();
  });

  it("ignores a wall that stops short of it", () => {
    // Its line would cross, but the wall itself ends 20 ft away.
    const state = startReview(
      [run("north", 0, 0, 160, 0), run("stops", 129, 20, 129, 60)],
      FEET_PER_UNIT,
    );
    const accepted = { ...state, verdicts: { ...state.verdicts, stops: "wall" as const } };
    expect(crossingPoint(accepted, "north")).toBeNull();
  });

  it("picks the crossing nearest the middle when several cross", () => {
    const state = startReview(
      [
        run("north", 0, 0, 160, 0),
        run("near-end", 8, -20, 8, 20),
        run("middle", 85, -20, 85, 20),
      ],
      FEET_PER_UNIT,
    );
    const accepted = {
      ...state,
      verdicts: { ...state.verdicts, "near-end": "wall" as const, middle: "wall" as const },
    };
    expect(crossingPoint(accepted, "north")!.x).toBeCloseTo(ft(85), 5);
  });

  it("CUTS AT A POINT THE REVIEWER CLICKS, for a yard with no wall at its edge", () => {
    const state = startReview([run("north", 0, 0, 160, 0)], FEET_PER_UNIT);
    const { halves, state: after } = splitCandidate(
      state,
      "north",
      { x: ft(100), y: 0 },
      FEET_PER_UNIT,
    );
    expect(halves).not.toBeNull();
    const byId = new Map(after.candidates.map((c) => [c.id, c]));
    expect(byId.get(halves![0])!.lengthFeet).toBeCloseTo(100, 1);
    expect(byId.get(halves![1])!.lengthFeet).toBeCloseTo(60, 1);
  });

  it("REFUSES a cut that would leave a stub, rather than making one", () => {
    const state = startReview([run("north", 0, 0, 160, 0)], FEET_PER_UNIT);
    for (const x of [0.2, 159.8]) {
      const { halves, state: after } = splitCandidate(
        state,
        "north",
        { x: ft(x), y: 0 },
        FEET_PER_UNIT,
      );
      expect(halves, `cut at ${x} ft made a stub`).toBeNull();
      expect(after.candidates).toHaveLength(1);
    }
    expect(SHORTEST_HALF_FEET).toBeGreaterThan(0);
  });

  it("refuses a point off the end", () => {
    const state = startReview([run("north", 0, 0, 160, 0)], FEET_PER_UNIT);
    expect(splitCandidate(state, "north", { x: ft(200), y: 0 }, FEET_PER_UNIT).halves).toBeNull();
    expect(splitCandidate(state, "north", { x: ft(-5), y: 0 }, FEET_PER_UNIT).halves).toBeNull();
  });

  it("leaves both halves UNREVIEWED and keeps everything else as it was", () => {
    let state = startReview(sheet(), FEET_PER_UNIT);
    state = { ...state, verdicts: { ...state.verdicts, east: "wall" } };
    const { halves, state: after } = splitCandidate(
      state,
      "north",
      crossingPoint(state, "north")!,
      FEET_PER_UNIT,
    );
    expect(after.verdicts[halves![0]]).toBe("unreviewed");
    expect(after.verdicts[halves![1]]).toBe("unreviewed");
    // The wall that was the boundary keeps its own verdict.
    expect(after.verdicts.east).toBe("wall");
    // And the parent is gone, so it cannot be judged twice.
    expect(after.candidates.some((c) => c.id === "north")).toBe(false);
    expect(after.verdicts.north).toBeUndefined();
  });

  it("drops a duplicate pair that named the candidate it just removed", () => {
    // Otherwise the panel offers a decision about a candidate that no longer
    // exists, and clicking it focuses nothing.
    const state = startReview(
      [run("long", 0, 0, 60, 0), run("copy", 0, 0.8, 60, 0.8), run("cross", 30, -20, 30, 20)],
      FEET_PER_UNIT,
    );
    expect(state.duplicates.length).toBeGreaterThan(0);
    const accepted = { ...state, verdicts: { ...state.verdicts, cross: "wall" as const } };
    const { state: after } = splitCandidate(
      accepted,
      "long",
      crossingPoint(accepted, "long")!,
      FEET_PER_UNIT,
    );
    expect(after.duplicates.every((p) => p.keep !== "long" && p.drop !== "long")).toBe(true);
  });

  it("does nothing to a candidate that is not there", () => {
    const state = startReview(sheet(), FEET_PER_UNIT);
    const { halves, state: after } = splitCandidate(state, "nobody", { x: 0, y: 0 }, FEET_PER_UNIT);
    expect(halves).toBeNull();
    expect(after).toBe(state);
  });
});
