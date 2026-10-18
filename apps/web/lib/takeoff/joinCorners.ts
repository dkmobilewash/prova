import type { WallCandidate } from "./wallVectors";

/**
 * ── A WALL ENDS AT A CORNER, NOT AT ITS OWN FACES' OVERLAP ──
 *
 * `wallFromPair` builds a centreline over the span where BOTH faces exist,
 * which is right for the middle of a wall and wrong at every end of one. At an
 * L-corner the outer face runs on to the outside corner while the inner face
 * stops at the other wall's inner face, so the overlap is the shorter of the
 * two and the centreline is cut back by about half a wall thickness.
 *
 * It is small, it is systematic, and it is at EVERY corner. S01 is the clearest
 * case because it is the smallest: one room, four walls, 24 x 16 at centreline,
 * so the generator's own key says 80.0 ft. The pipeline reported 78.0 — eight
 * ends, each short by half of a 6.5in wall:
 *
 *     8 x 0.27 = 2.2 ft,  and  80.0 - 2.2 = 77.8  against 78.0 found.
 *
 * On a plan with interior partitions the same loss is there and is buried
 * under the partitions' own footage, which is why it took the smallest sheet in
 * the set to make it legible.
 *
 * ── THE RULE IS THE GENERATOR'S OWN, NOT AN INVENTION ──
 *
 * `fixtures/generator/README.md`: *"At an L-corner the centerlines meet at the
 * corner point, so nothing is counted twice. At a T-intersection the branch
 * stops at the centerline of the wall it meets."*
 *
 * Both are the SAME operation — extend an end to where the two centrelines
 * cross — which is why there is one function here and not two. At an L both
 * walls extend to the same point; at a T only the branch has an end there, so
 * only the branch moves and the through wall is untouched. Nothing is ever
 * shortened, so this cannot turn a real wall into a shorter one.
 */

/** How far an end may travel to reach a corner, as a multiple of the wall's
 *  own thickness.
 *
 *  Half a thickness is the geometry; 1.5 is the bound, which leaves room for a
 *  pair of walls of unequal thickness meeting (the reach is the branch's own
 *  half plus the through wall's half) without letting an end hunt across a
 *  doorway for something to join. Measured: on the twenty fixtures no join
 *  travels further than 0.9 thicknesses. */
const REACH_THICKNESSES = 1.5;

/** Below this the two lines are parallel and have no usable crossing. */
const MIN_SIN = 0.2;

type Pt = { x: number; y: number };

/** Where two infinite lines cross, or null when they are near-parallel. */
function crossing(a: WallCandidate, b: WallCandidate): Pt | null {
  const ax = a.x2 - a.x1;
  const ay = a.y2 - a.y1;
  const bx = b.x2 - b.x1;
  const by = b.y2 - b.y1;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la === 0 || lb === 0) return null;
  const denominator = ax * by - ay * bx;
  // |sin| between the two directions. Two walls of the same run are parallel
  // and must never be "joined" at an imaginary crossing far off the sheet.
  if (Math.abs(denominator) / (la * lb) < MIN_SIN) return null;
  const t = ((b.x1 - a.x1) * by - (b.y1 - a.y1) * bx) / denominator;
  return { x: a.x1 + ax * t, y: a.y1 + ay * t };
}

/**
 * Extend every wall end that stops just short of another wall's centreline.
 *
 * In PAGE-WIDTH UNITS, like the candidates themselves; `feetPerUnit` is only
 * used to read a thickness back into those units, so the reach is a wall
 * thickness on the drawing rather than a fixed page distance that would mean
 * different things at different scales.
 */
export function joinAtCorners(
  walls: readonly WallCandidate[],
  feetPerUnit: number,
): WallCandidate[] {
  if (walls.length < 2 || !(feetPerUnit > 0)) return [...walls];

  return walls.map((wall) => {
    const thicknessUnits = wall.thicknessFeet / feetPerUnit;
    const reach = thicknessUnits * REACH_THICKNESSES;
    if (!(reach > 0)) return wall;

    const ends: Pt[] = [
      { x: wall.x1, y: wall.y1 },
      { x: wall.x2, y: wall.y2 },
    ];
    const moved = ends.map((end, which) => {
      // The FAR end of this wall, so an extension is only ever outward: moving
      // an end past its own partner would shorten the wall, and nothing here
      // may shorten anything.
      const other = ends[1 - which];
      let best: Pt | null = null;
      let bestTravel = reach;
      for (const neighbour of walls) {
        if (neighbour === wall) continue;
        const hit = crossing(wall, neighbour);
        if (hit === null) continue;
        const travel = Math.hypot(hit.x - end.x, hit.y - end.y);
        if (travel > bestTravel) continue;
        // OUTWARD ONLY. The crossing must lie beyond this end, away from the
        // rest of the wall, or this is a wall crossing another in its middle —
        // an X, where neither end belongs at the crossing.
        const outward =
          (hit.x - end.x) * (end.x - other.x) + (hit.y - end.y) * (end.y - other.y) >= 0;
        if (!outward) continue;
        // And the crossing must be ON the neighbour, not off the end of it:
        // two walls on opposite sides of a room have a crossing in the corner
        // of a rectangle neither of them reaches.
        const nx = neighbour.x2 - neighbour.x1;
        const ny = neighbour.y2 - neighbour.y1;
        const nlen2 = nx * nx + ny * ny;
        const along =
          nlen2 === 0 ? -1 : ((hit.x - neighbour.x1) * nx + (hit.y - neighbour.y1) * ny) / nlen2;
        const slack = reach / Math.sqrt(nlen2 || 1);
        if (along < -slack || along > 1 + slack) continue;
        best = hit;
        bestTravel = travel;
      }
      return best ?? end;
    });

    const x1 = moved[0].x;
    const y1 = moved[0].y;
    const x2 = moved[1].x;
    const y2 = moved[1].y;
    const before = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
    const after = Math.hypot(x2 - x1, y2 - y1);
    if (!(before > 0) || !(after > 0)) return wall;
    return {
      ...wall,
      x1,
      y1,
      x2,
      y2,
      // ── THE EXTENSION IS ADDED, NOT MULTIPLIED IN ──
      //
      // This read `(wall.lengthFeet * after) / before`, scaling the length by
      // how much the ends moved. For a straight run the two are the same
      // number, because its length IS its span. For a run whose length is not
      // its span they are not, and the ratio is unbounded.
      //
      // FOUND ON A REAL PERMIT SET, and it is the worst number this engine has
      // produced: `FLOOR PLAN LEVEL 1` reported **2,324,222 ft** of wall — 440
      // miles — from one run whose two endpoints were the same point. A curved
      // run carries its ARC in `lengthFeet` and its CHORD in its endpoints
      // (see `curvedWalls.ts`), so a nearly-closed arc has a chord near zero,
      // and `after / before` on a near-zero `before` is a millionfold.
      //
      // Adding the extension is identical for a straight run — where
      // `lengthFeet` equals `before * feetPerUnit`, the two expressions agree
      // to the bit — and bounded for every run, because the move itself is
      // bounded by `REACH_THICKNESSES`. A corner adds inches of wall; it
      // cannot add miles.
      lengthFeet: wall.lengthFeet + (after - before) * feetPerUnit,
    };
  });
}
