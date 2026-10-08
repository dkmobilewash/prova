import { describe, expect, it } from "vitest";
import { mergeWalls } from "./mergeWalls";
import type { WallCandidate } from "./wallVectors";

/**
 * THE SAME WALL, FOUND TWICE, REPORTED ONCE.
 *
 * Two engines run because they fail in opposite ways — pairing needs two faces,
 * the room engine needs rooms that close — and the moment both run, a real wall
 * arrives twice. These feet become a bid, so a double count is money, and a
 * missed merge is the failure mode this file exists to prevent. Most of what is
 * tested here is therefore the REFUSALS: what must NOT be merged.
 *
 * One unit is one foot.
 */

const wall = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thicknessFeet = 0.4,
): WallCandidate => ({
  x1,
  y1,
  x2,
  y2,
  thicknessFeet,
  lengthFeet: Math.hypot(x2 - x1, y2 - y1),
});

const feet = (ws: WallCandidate[]) => ws.reduce((t, w) => t + w.lengthFeet, 0);

describe("merging what is the same wall", () => {
  it("collapses the SAME wall found by both engines into one", () => {
    const merged = mergeWalls([wall(0, 10, 40, 10), wall(0, 10.02, 40, 10.02)], 1);
    expect(merged).toHaveLength(1);
    expect(merged[0].lengthFeet).toBeCloseTo(40, 4);
  });

  it("does NOT double the footage, which is the money bug", () => {
    expect(feet(mergeWalls([wall(0, 10, 40, 10), wall(0, 10.02, 40, 10.02)], 1))).toBeCloseTo(40, 4);
  });

  it("merges the same wall reported in OPPOSITE directions", () => {
    // One engine walks a wall start-to-end, the other end-to-start. Without
    // normalising the orientation they read as two walls 180 degrees apart.
    const merged = mergeWalls([wall(0, 10, 40, 10), wall(40, 10, 0, 10)], 1);
    expect(merged).toHaveLength(1);
    expect(merged[0].lengthFeet).toBeCloseTo(40, 4);
  });

  it("takes the UNION when the two findings cover different stretches", () => {
    // Each engine stops short at a different place. The wall is the whole run.
    const merged = mergeWalls([wall(0, 10, 25, 10), wall(15, 10, 40, 10)], 1);
    expect(merged).toHaveLength(1);
    expect(merged[0].lengthFeet).toBeCloseTo(40, 4);
  });

  it("joins the FRAGMENTS one engine makes of a single wall", () => {
    // Half the value of this file: both engines cut a long wall at junctions,
    // so one partition arrives as three overlapping runs.
    const merged = mergeWalls(
      [wall(0, 10, 15, 10), wall(14, 10, 29, 10), wall(28, 10, 40, 10)],
      1,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].lengthFeet).toBeCloseTo(40, 4);
  });

  it("REFUSES two walls on the same line with a gap between them", () => {
    // Either side of a doorway. Merging them would run a wall through the
    // opening and bill the door as partition.
    const merged = mergeWalls([wall(0, 10, 18, 10), wall(22, 10.3, 40, 10.3)], 1);
    expect(merged).toHaveLength(2);
    expect(feet(merged)).toBeCloseTo(36, 4);
    // AND EACH KEEPS ITS OWN LINE. Grouping them would rebuild both on the
    // leader's line, sliding one of them a third of a foot across the drawing —
    // two runs of the right length in the wrong places, which no total catches.
    const ys = merged.map((m) => m.y1).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(10, 3);
    expect(ys[1]).toBeCloseTo(10.3, 3);
  });

  it("REFUSES two parallel walls far enough apart to be different walls", () => {
    // The two skins of a shaft wall, or either side of a chase. Merging them
    // halves the footage of a real pair.
    const merged = mergeWalls([wall(0, 10, 40, 10), wall(0, 12, 40, 12)], 1);
    expect(merged).toHaveLength(2);
    expect(feet(merged)).toBeCloseTo(80, 4);
  });

  it("REFUSES two walls that cross at an angle", () => {
    const merged = mergeWalls([wall(0, 10, 40, 10), wall(20, 0, 20, 40)], 1);
    expect(merged).toHaveLength(2);
  });

  it("REFUSES two walls at an angle that START AT THE SAME POINT", () => {
    // A corner. Both centrelines pass through it, so they are zero apart and
    // the same-line test cannot be what separates them — only the ANGLE can.
    // With the walls crossing in the middle instead, the offset test rejects
    // them anyway and the angle test could be deleted without a test noticing.
    const merged = mergeWalls([wall(0, 10, 40, 10), wall(0, 10, 30, 40)], 1);
    expect(merged).toHaveLength(2);
  });

  it("keeps the thickness of the LONGEST contributor, not an average", () => {
    // A short fragment at a junction reads thick, where walls widen into each
    // other. Averaging that in pushes a 4-7/8in partition into the next wall
    // type and prices it wrong.
    const merged = mergeWalls(
      [wall(0, 10, 40, 10, 0.4), wall(38, 10, 42, 10, 1.4)],
      1,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].thicknessFeet).toBeCloseTo(0.4, 5);
  });

  it("gives the merged run the same line as the wall, not a shifted one", () => {
    // The merged geometry becomes a measurement an estimator looks at on the
    // sheet. If it is rebuilt wrong it lands somewhere else entirely.
    const [merged] = mergeWalls([wall(0, 10, 25, 10), wall(15, 10.02, 40, 10.02)], 1);
    expect(merged.x1).toBeCloseTo(0, 3);
    expect(merged.x2).toBeCloseTo(40, 3);
    expect(merged.y1).toBeCloseTo(10, 1);
    expect(merged.y2).toBeCloseTo(10, 1);
  });

  it("handles a DIAGONAL wall, where a y-only comparison would fail", () => {
    const k = Math.SQRT1_2;
    const merged = mergeWalls(
      [wall(0, 0, 40 * k, 40 * k), wall(20 * k, 20 * k, 60 * k, 60 * k)],
      1,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].lengthFeet).toBeCloseTo(60, 3);
  });

  it("takes its DIRECTION from the longest member, not a short fragment", () => {
    // A short fragment's angle is the noisiest thing in a group — it is a few
    // cells of raster, and a degree of error over forty feet is most of a foot
    // at the far end. The long member is the better estimate of where the wall
    // actually runs.
    const merged = mergeWalls([wall(0, 10, 40, 10), wall(38, 10, 42, 10.12)], 1);
    expect(merged).toHaveLength(1);
    // The run must stay horizontal: a fragment-led direction tilts it.
    expect(Math.abs(merged[0].y2 - merged[0].y1)).toBeLessThan(0.2);
  });

  it("does not depend on the order it is given", () => {
    const a = [wall(0, 10, 25, 10), wall(15, 10, 40, 10), wall(60, 10, 80, 10)];
    const forward = mergeWalls(a, 1);
    const backward = mergeWalls([...a].reverse(), 1);
    expect(forward).toHaveLength(backward.length);
    expect(feet(forward)).toBeCloseTo(feet(backward), 5);
  });

  it("scales its tolerance with the sheet, not the page", () => {
    // Two centrelines 0.4 units apart are 0.2ft apart at half a foot per unit —
    // the same wall — and 1.6ft apart at four, which is two walls.
    expect(mergeWalls([wall(0, 10, 40, 10), wall(0, 10.4, 40, 10.4)], 0.5)).toHaveLength(1);
    expect(mergeWalls([wall(0, 10, 40, 10), wall(0, 10.4, 40, 10.4)], 4)).toHaveLength(2);
  });

  it("returns nothing rather than throwing on an empty list or no scale", () => {
    expect(mergeWalls([], 1)).toEqual([]);
    expect(mergeWalls([wall(0, 10, 40, 10)], 0)).toEqual([]);
  });

  it("passes a single wall through unchanged", () => {
    const [merged] = mergeWalls([wall(0, 10, 40, 10, 0.4)], 1);
    expect(merged.lengthFeet).toBeCloseTo(40, 4);
    expect(merged.thicknessFeet).toBeCloseTo(0.4, 5);
  });
});
