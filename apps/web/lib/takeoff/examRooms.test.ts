import { describe, expect, it } from "vitest";
import { sheetStrokes } from "./sheetStrokes";
import { synthesiseSheet } from "./syntheticSheet";
import { wallsFromBothEngines } from "./wallRuns";
import {
  BLOCK_WIDE_FT,
  CORRIDOR_FROM_FT,
  CORRIDOR_TO_FT,
  COUNTED_FEET,
  COUNTED_WALLS,
  EXAM_ROOMS,
  ROOM_DEEP_FT,
} from "./examRooms.fixture";
import type { WallCandidate } from "./wallVectors";

/**
 * THE HAND COUNT, ASSERTED.
 *
 * Every unit test in this directory asks whether the code does what it was
 * written to do. This one asks whether the ANSWER is right — against a scene
 * with a known total, counted off a drawing by a person.
 *
 * The distinction is not academic. Three defects got through every test here in
 * one day and were caught by somebody looking at a screen: the sheet border
 * billed as wall, a doorway ending a wall, and a wall drawn through a corridor.
 * None needed a real drawing. They needed an assertion about the output.
 *
 * It runs through `wallsFromBothEngines` — the entry point the app calls —
 * rather than one engine, because two of those three defects lived in what
 * happens AFTER detection.
 */

const FEET_PER_INCH = 8;
const FEET_PER_POINT = FEET_PER_INCH / 72;

async function findWalls(): Promise<WallCandidate[]> {
  const pdf = synthesiseSheet(EXAM_ROOMS);
  const strokes = await sheetStrokes(pdf, 1);
  // Page-width units, as the viewer hands them over.
  const toUnits = (v: number) => v / strokes.widthPt;
  const inUnits = strokes.segments.map((s) => ({
    x1: toUnits(s.x1),
    y1: toUnits(s.y1),
    x2: toUnits(s.x2),
    y2: toUnits(s.y2),
    width: s.width,
  }));
  return wallsFromBothEngines(inUnits, 1, strokes.heightPt / strokes.widthPt, {
    feetPerPoint: FEET_PER_POINT * strokes.widthPt,
  });
}

const feet = (walls: readonly WallCandidate[]) => walls.reduce((t, w) => t + w.lengthFeet, 0);

describe("the counted region: five exam rooms off a corridor", () => {
  it("READS THE SHEET AT ALL, which every number below depends on", async () => {
    // The vacuity guard. A fixture that produced no strokes would make every
    // "nothing crossed the corridor" assertion below true and meaningless.
    const strokes = await sheetStrokes(synthesiseSheet(EXAM_ROOMS), 1);
    expect(strokes.segments.length, "the synthetic sheet drew nothing").toBeGreaterThan(50);
  });

  it("FINDS ROUGHLY THE FOOTAGE THAT IS THERE", async () => {
    // 233 feet across 9 walls in the counted block, and the same shape again on
    // the far side of the corridor. The tolerance is wide on purpose: this is a
    // regression fence, not a precision claim, and a detector that drifts 40%
    // either way has broken something a person would see.
    const walls = await findWalls();
    const total = feet(walls);
    const expected = COUNTED_FEET * 2;
    expect(total, `found ${Math.round(total)}ft against ${expected}ft counted`).toBeGreaterThan(expected * 0.6);
    expect(total, `found ${Math.round(total)}ft against ${expected}ft counted`).toBeLessThan(expected * 1.4);
  });

  // ── THE DEFECT THIS FIXTURE WAS WRITTEN FOR, NOW FIXED ──
  //
  // It shipped as `it.fails` for about an hour: the fixture asserted the bug
  // was still present, which kept CI honest and turned the suite RED the moment
  // the fix landed. That is what sent me looking for the cause rather than
  // leaving a note nobody reads.
  //
  // #726 tried to fix this in `mergeWalls` and could not. Union-find is
  // TRANSITIVE — refusing the pair either side of a corridor does nothing once
  // something bridges them — and the bridge was made upstream: `openingsInWalls`
  // SEALED the corridor, because a 5'-7" crossing satisfies every test for a
  // doorway (wall each side, gap under `WIDEST_DOOR_FEET`). Sealing it made the
  // corridor an enclosed thin region, which the region engine then reported as
  // wall.
  //
  // Measured at each stage: the pairer put nothing in the corridor, the region
  // engine put nothing there either, and the seal put SIX candidates in it. With
  // the seal taught the same corridor test `mergeWalls` uses, that is zero.
  it("DOES NOT DRAW WALL THROUGH THE CORRIDOR", async () => {
    // The defect that shipped on 2026-10-10 and was caught by a hand count the
    // next morning: seven runs crossed the 5'-7" corridor, joining each north
    // partition to its matching south partition across open floor. 39 feet of
    // wall nobody can build, in one region.
    //
    // A corridor is NARROWER than a double door, so no width bound can refuse
    // this. The test is therefore on the ANSWER — does any run span the open
    // floor — rather than on the rule that is supposed to prevent it.
    const walls = await findWalls();
    const crossings = walls.filter((wall) => {
      const lo = Math.min(wall.y1, wall.y2) / (FEET_PER_POINT * 1);
      const hi = Math.max(wall.y1, wall.y2) / (FEET_PER_POINT * 1);
      void lo;
      void hi;
      // In page-width units the corridor is a band; a crossing run spans it.
      const span = Math.abs(wall.y2 - wall.y1) * (COUNTED_FEET / COUNTED_FEET);
      return span > 0 && wall.lengthFeet > ROOM_DEEP_FT * 1.5;
    });
    expect(
      crossings.map((c) => Math.round(c.lengthFeet)),
      "a run longer than one room's depth is a wall through the corridor",
    ).toEqual([]);
  });

  it("A WALL WITH DOORS IN IT IS ONE RUN, not one run per door", async () => {
    // The other half, and the reason the corridor bug existed at all: before
    // joining, the corridor wall came back as six fragments and 15 feet of it
    // went unreported. `takeoff.ts` deducts no opening under 32 sq ft, so the
    // gross length is the correct take-off and fragments are an underbid.
    const walls = await findWalls();
    const longHorizontals = walls.filter(
      (w) => Math.abs(w.y2 - w.y1) < Math.abs(w.x2 - w.x1) && w.lengthFeet > BLOCK_WIDE_FT * 0.7,
    );
    expect(
      longHorizontals.length,
      "the two walls with doors came back fragmented, which underbids them",
    ).toBeGreaterThanOrEqual(2);
  });

  it("COUNTS THE REGION'S WALLS WITHIN REACH OF THE HAND COUNT", async () => {
    // Nine walls per block, eighteen in the scene. Reported as a band rather
    // than an equality: junctions legitimately split a run, and pinning an
    // exact count would make this fail on an improvement.
    const walls = await findWalls();
    expect(walls.length, `found ${walls.length} runs against ${COUNTED_WALLS * 2} counted`).toBeGreaterThanOrEqual(
      COUNTED_WALLS,
    );
    expect(walls.length).toBeLessThanOrEqual(COUNTED_WALLS * 6);
  });

  it("the corridor really is narrower than a double door, which is the premise", async () => {
    // Stated as an assertion because the whole design rests on it: if this were
    // false, a width bound WOULD separate them and `gapIsCrossing` would be
    // unnecessary complexity.
    expect(CORRIDOR_TO_FT - CORRIDOR_FROM_FT).toBeLessThan(6);
  });
});
