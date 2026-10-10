import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

describe("a doorway is not the end of the wall", () => {
  // ── MEASURED, NOT ARGUED ──
  //
  // School-01 A-101, 2026-10-10: five exam rooms counted off the drawing by
  // hand. 233 feet of real wall, 197 found — 84%. EVERY missing stretch was a
  // door opening or a column; the acoustic walls between the rooms, which have
  // neither, came back at 92-100%.
  //
  // And a door should not be deducted anyway. `takeoff.ts` deducts nothing
  // under 32 sq ft because "a door or a window still costs labour to cut and
  // finish around, and deducting it underbids the work" — a 3'-0" × 7'-0" door
  // is 21 sq ft. The framing runs through it as a header. So GROSS is the
  // correct take-off and two fragments either side is the underbid.

  it("JOINS ACROSS A DOOR-SIZED GAP and reports the gross length", () => {
    // 18ft of wall, a 3ft door, 19ft of wall. One 40ft run.
    const merged = mergeWalls([wall(0, 10, 18, 10), wall(21, 10, 40, 10)], 1);
    expect(merged).toHaveLength(1);
    expect(merged[0].lengthFeet, "gross, including the opening").toBeCloseTo(40, 4);
  });

  it("RECORDS THE OPENING ITS WIDTH, so it is reported and not merely swallowed", () => {
    const merged = mergeWalls([wall(0, 10, 18, 10), wall(21, 10, 40, 10)], 1);
    expect(merged[0].openings).toHaveLength(1);
    expect(merged[0].openings?.[0].widthFt).toBeCloseTo(3, 4);
  });

  it("records EVERY opening along a wall, which is the corridor case", () => {
    // The corridor wall in that region came back 85% covered, and the gaps
    // were its five doors.
    const merged = mergeWalls(
      [wall(0, 10, 10, 10), wall(13, 10, 23, 10), wall(26, 10, 36, 10), wall(39, 10, 50, 10)],
      1,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].lengthFeet).toBeCloseTo(50, 4);
    expect(merged[0].openings).toHaveLength(3);
    for (const opening of merged[0].openings ?? []) expect(opening.widthFt).toBeCloseTo(3, 4);
  });

  it("carries NO openings key when the run has no gaps in it", () => {
    // An acoustic wall between two rooms. The field exists to report something,
    // not to decorate every run with an empty array.
    const merged = mergeWalls([wall(0, 10, 17, 10)], 1);
    expect(merged[0].openings).toBeUndefined();
  });

  // ── THE BOUND, which is the half the old rule got right ──

  it("REFUSES a gap too wide to be an opening", () => {
    // Past a certain width a gap is not a door, it is where the wall stops: a
    // corridor crossing, another room, the far side of the building. Joining
    // invents wall nobody can build, and it overbids.
    const merged = mergeWalls([wall(0, 10, 18, 10), wall(30, 10, 48, 10)], 1);
    expect(merged, "a 12ft gap is not an opening").toHaveLength(2);
  });

  it("the bound is a width in FEET, not in page units", () => {
    // Same geometry, half a foot per unit: the gap is now 1.5ft of building
    // rather than 3, and still an opening. A bound that moved with the scale
    // would join doors on one sheet and refuse them on the next.
    const merged = mergeWalls([wall(0, 10, 18, 10), wall(21, 10, 40, 10)], 0.5);
    expect(merged).toHaveLength(1);
    expect(merged[0].openings?.[0].widthFt).toBeCloseTo(1.5, 4);
  });

  it("AND AT A COARSE SCALE THE BOUND STILL BITES, which the case above cannot see", () => {
    // Found by mutation: the case above passes whether the bound is divided by
    // the scale or not, because at half a foot per unit both forms answer
    // "join". The two only disagree when a gap is SMALL in page units and LARGE
    // in feet — four feet per unit, three units apart, is twelve feet of
    // building through which no wall runs.
    const merged = mergeWalls([wall(0, 10, 18, 10), wall(21, 10, 40, 10)], 4);
    expect(merged, "a 12ft gap joined because the bound was read in page units").toHaveLength(2);
  });

  it("STILL REFUSES a gap-join between runs that are not quite on one line", () => {
    // The guard the old test was right about. Two OVERLAPPING findings of one
    // wall legitimately sit a third of a foot apart — two engines estimating a
    // centreline. Two runs with a GAP making the same claim is weaker: if they
    // are one wall either side of a door, the offset is a hair.
    //
    // Without this a jog in a wall joins and is then rebuilt on one line,
    // sliding part of it across the drawing.
    const merged = mergeWalls([wall(0, 10, 18, 10), wall(21, 10.3, 40, 10.3)], 1);
    expect(merged).toHaveLength(2);
    const ys = merged.map((m) => m.y1).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(10, 3);
    expect(ys[1]).toBeCloseTo(10.3, 3);
  });

  it("can be turned off, and then behaves exactly as it used to", () => {
    // `maxOpeningFeet: 0` is the old rule. Kept reachable so the change is a
    // parameter rather than a rewrite, and so a caller that must not join can
    // say so.
    const merged = mergeWalls([wall(0, 10, 18, 10), wall(21, 10, 40, 10)], 1, 0);
    expect(merged).toHaveLength(2);
    expect(feet(merged)).toBeCloseTo(37, 4);
  });
});

describe("the panel says the footage is gross, because no test can see a screen", () => {
  // A CENSUS. Joining across openings makes every affected group REPORT MORE
  // FEET than before, and a bigger number with no explanation beside it is the
  // next unexplained figure — the thing the drawing-index check learned the
  // hard way. The sentence is the whole mitigation, so it is pinned.
  //
  // It can see the words are there. It cannot see them rendered, which is why
  // the click-list ends with somebody reading the panel.
  const viewer = readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8");

  it("counts the openings in the group and names them", () => {
    expect(viewer).toContain("run.openings?.length ?? 0");
    expect(viewer).toContain("not deducted");
  });

  it("says nothing when a group has no openings in it", () => {
    // A permanent "includes 0 openings" on every group is the noise this app's
    // own rule calls the thing that teaches people to stop reading notices.
    expect(viewer).toContain("openings === 0 ? null :");
  });
});
