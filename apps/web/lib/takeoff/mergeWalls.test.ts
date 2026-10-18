import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeWalls } from "./mergeWalls";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

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

describe("a corridor is not a doorway, and is NARROWER than a double door", () => {
  // ── WHAT THE FIRST VERSION DID, COUNTED ON THE DRAWING ──
  //
  // School-01 A-101, the region hand-counted the day before: seven runs crossed
  // the 5'-7" corridor in front of exam rooms 110-114, joining each north
  // partition to its matching south partition across open floor. About 39 feet
  // of wall nobody can build, in one region, and the same again on the south
  // side. The grid B wall became one 91-foot run from exterior to exterior.
  //
  // THE BOUND CANNOT FIX THIS. An egress corridor runs to 3'-8" and a double
  // door is 6'-0", so no width separates them. What does is on the drawing: a
  // corridor has its own two walls running across the ends of the gap.

  /** Two exam partitions either side of a corridor, with the corridor's own
   *  two walls running across. Lengths in feet, one unit per foot. */
  const corridorScene = () => [
    // The two partitions, north and south of the corridor, on one line.
    wall(50, 0, 50, 20), // south partition
    wall(50, 25.58, 50, 45), // north partition, 5'-7" away
    // The corridor's own walls, running perpendicular across both ends.
    wall(20, 20, 90, 20),
    wall(20, 25.58, 90, 25.58),
  ];

  it("REFUSES to join two partitions across a corridor", () => {
    const merged = mergeWalls(corridorScene(), 1);
    const vertical = merged.filter((m) => Math.abs(m.x2 - m.x1) < 0.01);
    expect(vertical, "the partitions were joined through open floor").toHaveLength(2);
    for (const run of vertical) {
      expect(run.lengthFeet, "a run spans the corridor").toBeLessThan(25);
    }
  });

  /**
   * ── THE SAME CORRIDOR, WITH THE DRAWING UNDER IT ──
   *
   * Everything above hands `mergeWalls` walls and no strokes, so a rule that
   * reads the drawing to decide whether a gap is a doorway is not exercised by
   * any of it. That is not hypothetical: such a rule was built on 2026-10-17,
   * passed all 42 tests in this file including every corridor case, and took
   * the bench from 111 missed walls to 271 by bridging corridors 253 times.
   *
   * These two scenes are the drawing the rule has to be wrong about. They pass
   * today because a bounded gap is refused outright and the strokes are
   * ignored; they exist for the day something reads them.
   */
  /** A flattened quarter-circle: the shape a door swing arrives as. */
  const swing = (
    cx: number,
    cy: number,
    radius: number,
    fromDeg: number,
    pieces = 12,
  ): StrokeSegment[] => {
    const out: StrokeSegment[] = [];
    for (let i = 0; i < pieces; i += 1) {
      const a = ((fromDeg + (i * 90) / pieces) * Math.PI) / 180;
      const b = ((fromDeg + ((i + 1) * 90) / pieces) * Math.PI) / 180;
      out.push({
        x1: cx + radius * Math.cos(a),
        y1: cy + radius * Math.sin(a),
        x2: cx + radius * Math.cos(b),
        y2: cy + radius * Math.sin(b),
        width: 0.5,
        curved: true,
      });
    }
    return out;
  };

  // PROVEN AGAINST THE REVERTED RULE: re-applying it turns the mouth scene
  // below RED and leaves this one green. So this scene is a legitimate
  // regression case and is NOT yet known to distinguish a wrong rule from a
  // right one — the swing sits far enough from the gap that the reverted rule
  // ignored it anyway. Kept rather than tuned until it bites, because a
  // fixture adjusted until one particular wrong rule fails it is fitted to
  // that rule rather than to the hazard.
  it("REFUSES THE CORRIDOR EVEN WITH A DOOR SWING DRAWN BESIDE IT", () => {
    // A door in the corridor's south wall, hinged at (62,20) and swinging into
    // the room below. It is near the corridor gap and has nothing to do with
    // it — which is exactly the arc a careless rule reads as "a door is drawn
    // in this gap".
    const merged = mergeWalls(corridorScene(), 1, undefined, [
      ...swing(62, 20, 3, 180),
      ...swing(62, 20, 3, 180).map((one) => ({ ...one, y1: one.y1, y2: one.y2 })),
    ]);
    const vertical = merged.filter((m) => Math.abs(m.x2 - m.x1) < 0.01);
    expect(vertical, "a swing beside the corridor opened it").toHaveLength(2);
  });

  // THIS IS THE ONE THAT BITES. Re-applying the reverted door-evidence rule
  // turns it red: 1 failed, 43 passed. It is the scene that makes this whole
  // block non-vacuous.
  it("REFUSES A CORRIDOR WITH A DOOR AT ITS MOUTH", () => {
    // The dangerous case named when the reverted rule was written: a door at
    // the END of a corridor is hinged at the corridor's own end and swings a
    // leaf about as wide as the corridor, so a rule asking only "is there an
    // arc hinged near one end of this gap, about this wide" says yes.
    //
    // The corridor gap runs (50,20) to (50,25.58) — 5.58 ft. This door is
    // hinged at (50,20), the gap's own end, with a 5.5 ft leaf.
    const merged = mergeWalls(corridorScene(), 1, undefined, swing(50, 20, 5.5, 0));
    const vertical = merged.filter((m) => Math.abs(m.x2 - m.x1) < 0.01);
    expect(vertical, "a door at the corridor mouth opened the corridor").toHaveLength(2);
    for (const run of vertical) {
      expect(run.lengthFeet, "a run spans the corridor").toBeLessThan(25);
    }
  });

  it("STILL JOINS A DOORWAY in a wall with no corridor crossing it", () => {
    // The same geometry with the corridor walls taken away is a door, and the
    // whole point of this change is that it joins. Without this the fix would
    // be a revert wearing a test.
    const merged = mergeWalls(
      [wall(50, 0, 50, 20), wall(50, 25.58, 50, 45)],
      1,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].lengthFeet).toBeCloseTo(45, 4);
  });

  it("JOINS ACROSS A T-JUNCTION, where ONE wall meets but nothing crosses", () => {
    // The case that makes "any perpendicular wall nearby" the wrong rule. A
    // wall meeting this one side-on does not stop it, and refusing here would
    // put back the fragmentation this change exists to remove.
    const merged = mergeWalls(
      [wall(50, 0, 50, 20), wall(50, 23, 50, 45), wall(20, 20, 50, 20)],
      1,
    );
    const vertical = merged.filter((m) => Math.abs(m.x2 - m.x1) < 0.01);
    expect(vertical).toHaveLength(1);
    expect(vertical[0].lengthFeet).toBeCloseTo(45, 4);
  });

  it("JOINS ACROSS A COLUMN, which has no perpendicular wall at all", () => {
    // The grid B case from the same count: "the stretch near the column".
    const merged = mergeWalls([wall(50, 0, 50, 20), wall(50, 21.5, 50, 45)], 1);
    expect(merged).toHaveLength(1);
    expect(merged[0].lengthFeet).toBeCloseTo(45, 4);
  });

  it("needs TWO DIFFERENT walls — a DOORWAY AT A T-JUNCTION still joins", () => {
    // The `atFrom !== atTo` branch, and it is reachable: a 2ft gap is short
    // enough that ONE perpendicular wall crossing it sits within the bounding
    // distance of BOTH ends. That is a door right where another wall meets —
    // common at a corridor return — and the wall plainly continues through it.
    //
    // The first version of this test used a PARALLEL wall, which the
    // perpendicularity filter discards before any of this runs, so it passed
    // without exercising the branch at all.
    const merged = mergeWalls(
      [wall(50, 0, 50, 20), wall(50, 22, 50, 45), wall(20, 21, 50, 21)],
      1,
    );
    const vertical = merged.filter((m) => Math.abs(m.x2 - m.x1) < 0.01);
    expect(vertical, "a door at a T-junction was refused as a corridor").toHaveLength(1);
    expect(vertical[0].lengthFeet).toBeCloseTo(45, 4);
  });

  it("IGNORES WALLS PARALLEL TO THE RUN, which are not the sides of a corridor", () => {
    // Found by mutation: dropping the perpendicularity filter left every test
    // green, because every scene above only has perpendicular walls near a
    // gap. A chase or a furring wall running ALONGSIDE a doorway is two walls
    // near the two ends and is not a crossing — the corridor's defining
    // feature is that its walls run ACROSS.
    const merged = mergeWalls(
      [
        wall(50, 0, 50, 20),
        wall(50, 25.58, 50, 45),
        // Two separate stubs, parallel to the run, one beside each jamb.
        wall(48.8, 17, 48.8, 20.5),
        wall(48.8, 25, 48.8, 28),
      ],
      1,
    );
    const inLine = merged.filter((m) => Math.abs(m.x2 - m.x1) < 0.01 && Math.abs(m.x1 - 50) < 0.3);
    expect(inLine, "a parallel wall beside the door was read as a corridor").toHaveLength(1);
    expect(inLine[0].lengthFeet).toBeCloseTo(45, 4);
  });

  it("MEASURES TO THE SEGMENT, not to the line it lies on", () => {
    // Also found by mutation. A perpendicular wall somewhere else in the
    // building can lie on a line that passes right through this gap — gridlines
    // make that the normal case, not a freak one. Without clamping to the
    // segment, a wall fifty feet away refuses a doorway here.
    const merged = mergeWalls(
      [
        wall(50, 0, 50, 20),
        wall(50, 25.58, 50, 45),
        // Perpendicular, on lines through both gap ends, but far to the east.
        wall(120, 20, 170, 20),
        wall(120, 25.58, 170, 25.58),
      ],
      1,
    );
    const inLine = merged.filter((m) => Math.abs(m.x2 - m.x1) < 0.01);
    expect(inLine, "a wall fifty feet away refused this doorway").toHaveLength(1);
    expect(inLine[0].lengthFeet).toBeCloseTo(45, 4);
  });

  it("DEGRADES THE SAFE WAY when the corridor's walls were never detected", () => {
    // Nothing bounds the gap, so the join goes ahead — the same answer as
    // before this existed, rather than refusing everything on a missing input.
    const merged = mergeWalls([wall(50, 0, 50, 20), wall(50, 25.58, 50, 45)], 1);
    expect(merged).toHaveLength(1);
  });

  it("refuses a corridor at a coarse scale too, where it is narrow in page units", () => {
    // Four feet per unit: the corridor is 1.4 units across and still a
    // corridor. A test that only worked at one foot per unit would pass on a
    // detail sheet and fail on a plan.
    const scene = [
      wall(50, 0, 50, 5),
      wall(50, 6.4, 50, 11),
      wall(20, 5, 90, 5),
      wall(20, 6.4, 90, 6.4),
    ];
    const merged = mergeWalls(scene, 4);
    const vertical = merged.filter((m) => Math.abs(m.x2 - m.x1) < 0.01);
    expect(vertical).toHaveLength(2);
  });
});

/**
 * ── TWO PIECES OF ONE WALL MUST AGREE ABOUT ITS LINE, TO WITHIN A QUARTER OF
 *    ITS THICKNESS ──
 *
 * Bridging a gap used to allow a flat inch and a half whatever the wall.
 * Measured on a held-out library plan by logging every gap decision on the
 * sheet: 150 gaps bridged, and a 78 ft wall lost 7.68 ft because its pieces
 * were **1.60 inches** apart against the 1.50 allowed. Seven and a half feet
 * of wall to a tenth of an inch.
 *
 * The same sheet is why it cannot simply be widened. Two other pairs on that
 * wall sit 3.96 inches apart, and the wall is 8 inches thick — so 3.96 is HALF
 * A THICKNESS, which is one piece measured on the centreline and the other on
 * a face. Merging those would put the wall half a thickness off its own line.
 *
 * A quarter of the thickness sits between the two with room on both sides, and
 * being a share rather than a length is what makes it a rule: the same
 * sentence gives a 4 inch partition an inch and a 12 inch block wall three.
 */
describe("how far two pieces may disagree about their shared line", () => {
  // An 8 inch wall, the thickness the measurements above were taken on.
  const EIGHT = 8 / 12;
  const inches = (n: number) => n / 12;

  /** Two pieces of one wall with a 4 ft doorway between them, the second
   *  offset across the line by `offIn` inches. */
  const twoPieces = (offIn: number) => [
    wall(0, 20, 18, 20, EIGHT),
    wall(22, 20 + inches(offIn), 33, 20 + inches(offIn), EIGHT),
  ];

  it("BRIDGES AT 1.60 INCHES — the wall the old bound lost", () => {
    const merged = mergeWalls(twoPieces(1.6), 1);
    expect(merged, "the two pieces did not join").toHaveLength(1);
    // Gross: the doorway is part of the wall, so 0 to 33.
    expect(merged[0].lengthFeet).toBeCloseTo(33, 1);
  });

  it("REFUSES AT 3.96 INCHES — half a thickness is a different line", () => {
    expect(mergeWalls(twoPieces(3.96), 1), "a face was merged with a centreline").toHaveLength(2);
  });

  it("scales with the wall: a thin partition gets a thin tolerance", () => {
    // 1.60 inches is fine on an 8 inch wall and is half the thickness of a
    // 3 inch one, so the same offset must be refused there. This is the whole
    // point of a share rather than a length, and a fixed 1.5 inch bound could
    // not express it.
    const thin = [
      wall(0, 20, 18, 20, inches(3)),
      wall(22, 20 + inches(1.6), 33, 20 + inches(1.6), inches(3)),
    ];
    expect(mergeWalls(thin, 1), "a 3 inch partition took an 8 inch wall's slack").toHaveLength(2);
  });

  it("NEVER TIGHTENS: a thin wall keeps the old inch and a half", () => {
    // A quarter of a 4 inch partition is one inch, which would be TIGHTER than
    // the flat bound this replaced — so the old bound stays as a floor and
    // this change can only ever bridge more, never less. Without the floor
    // this 1.2 inch offset would be refused and a wall that merged before
    // would stop merging, which is a regression wearing an improvement's
    // clothes.
    const partition = [
      wall(0, 20, 18, 20, inches(4)),
      wall(22, 20 + inches(1.2), 33, 20 + inches(1.2), inches(4)),
    ];
    expect(mergeWalls(partition, 1), "a thin wall lost tolerance it used to have").toHaveLength(1);
  });

  it("still bridges a thick wall whose pieces are further apart in inches", () => {
    // A 16 inch block wall gets 4 inches of slack, so an offset that a
    // partition must refuse is nothing on this.
    const thick = [
      wall(0, 20, 18, 20, inches(16)),
      wall(22, 20 + inches(3.2), 33, 20 + inches(3.2), inches(16)),
    ];
    expect(mergeWalls(thick, 1)).toHaveLength(1);
  });
});
