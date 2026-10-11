import { describe, expect, it } from "vitest";
import { ringSelfIntersects } from "../sheet-geometry";
import { dropCollinear, roomsInBox, strokesNotLettering, traceRing, type Box } from "./roomAreas";
import type { StrokeSegment } from "./wallVectors";

/**
 * The polygon half is tested on shapes whose area is known by arithmetic; the
 * detection half on a drawn plan whose rooms are known by construction.
 *
 * NO REAL PLAN SET IS USED. Customer drawings are confidential and are never
 * fixtures here — the measurements that justified this feature were taken by
 * hand against the sets on Diego's machine and are recorded in the changelog.
 */

/** A rectangle of wall, drawn as single lines. */
function box(x0: number, y0: number, x1: number, y1: number): StrokeSegment[] {
  return [
    { x1: x0, y1: y0, x2: x1, y2: y0 },
    { x1, y1: y0, x2: x1, y2: y1 },
    { x1, y1, x2: x0, y2: y1 },
    { x1: x0, y1, x2: x0, y2: y0 },
  ];
}

const cellsOf = (set: Set<string>) => (x: number, y: number) => set.has(`${x},${y}`);

describe("traceRing", () => {
  it("walks a rectangle and gives back its own area", () => {
    const cells = new Set<string>();
    for (let y = 2; y < 7; y += 1) for (let x = 3; x < 9; x += 1) cells.add(`${x},${y}`);
    const ring = dropCollinear(traceRing(cellsOf(cells), 3, 2, 8, 6));
    expect(ring).toHaveLength(4);
    // 6 wide by 5 tall in cells.
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(6);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(5);
  });

  it("follows an L rather than squaring it off", () => {
    // An L: a 4x4 block with its bottom-right 2x2 removed.
    const cells = new Set<string>();
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        if (x >= 2 && y >= 2) continue;
        cells.add(`${x},${y}`);
      }
    }
    const ring = dropCollinear(traceRing(cellsOf(cells), 0, 0, 3, 3));
    // An L has six corners. A bounding box would have four and would be a
    // third too big, which is the whole reason the ring is traced.
    expect(ring).toHaveLength(6);
  });

  it("DOES NOT CROSS ITSELF WHERE A REGION PINCHES AT A CORNER", () => {
    // Two cells touching at one corner give that corner FOUR boundary edges.
    // The first version of this took whichever had been registered first,
    // which jumps between the two halves — and drawn over a real sheet that
    // showed as long diagonal chords straight across rooms. No test could see
    // it: a chord still has an area and still has corners.
    //
    // It is not cosmetic. `saveTakeoffMeasurement` REFUSES a self-intersecting
    // AREA ring, so rooms traced that way cannot be accepted at all.
    const cells = new Set(["0,0", "1,1"]);
    const ring = dropCollinear(traceRing(cellsOf(cells), 0, 0, 1, 1));
    expect(ring.length).toBeGreaterThanOrEqual(4);
    expect(ringSelfIntersects(ring.map((p) => p.x), ring.map((p) => p.y))).toBe(false);
    // One cell's worth, not a figure of eight spanning both.
    expect(ring).toHaveLength(4);
  });

  it("stays simple on a mask that is nothing but pinches", () => {
    // A checkerboard: every cell touches four others at a corner and nowhere
    // else. One contrived pair is not enough — in a two-cell fixture the
    // correct edge happens to be registered first, so taking `outs[0]` passes
    // it. Here it cannot: whichever edge is taken at one junction, some
    // junction orders the other way.
    const cells = new Set<string>();
    for (let y = 0; y < 7; y += 1) for (let x = 0; x < 7; x += 1) if ((x + y) % 2 === 0) cells.add(`${x},${y}`);
    const ring = dropCollinear(traceRing(cellsOf(cells), 0, 0, 6, 6));
    expect(ringSelfIntersects(ring.map((p) => p.x), ring.map((p) => p.y))).toBe(false);
    // A single cell is the largest simple boundary in a checkerboard. Any
    // longer ring has walked from one cell into another through a corner,
    // which is the crossing this guards.
    expect(ring).toHaveLength(4);
  });

  it("returns nothing for an empty region rather than throwing", () => {
    expect(traceRing(() => false, 0, 0, 4, 4)).toEqual([]);
  });
});

describe("dropCollinear", () => {
  it("keeps corners and drops the points between them", () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    // (1,0) is the only point on a straight line between its neighbours; the
    // other four are corners of the rectangle and all survive.
    expect(dropCollinear(straight)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]);
  });
});

describe("roomsInBox", () => {
  // A plan at 1/8in = 1ft: 1pt = 8/72 ft. Two rooms side by side inside an
  // outer shell, each 20ft x 20ft of clear space.
  const feetPerPoint = 8 / 72;
  const ft = (feet: number) => feet / feetPerPoint;
  const widthPt = ft(100);
  const heightPt = ft(70);

  const plan: StrokeSegment[] = [
    // Outer shell, 42ft x 22ft of outside dimension, sitting at 10,10.
    ...box(ft(10), ft(10), ft(52), ft(32)),
    ...box(ft(10.5), ft(10.5), ft(51.5), ft(31.5)),
    // The partition between the two rooms, drawn as two faces.
    { x1: ft(31), y1: ft(10.5), x2: ft(31), y2: ft(31.5) },
    { x1: ft(31.4), y1: ft(10.5), x2: ft(31.4), y2: ft(31.5) },
  ];

  const whole: Box = { x0: 0, y0: 0, x1: 1, y1: heightPt / widthPt };

  it("finds the rooms a plan draws, at about the right size", () => {
    const rooms = roomsInBox(plan, widthPt, heightPt, feetPerPoint, whole);
    expect(rooms.length).toBeGreaterThanOrEqual(2);
    // Each clear space is about 20.5 x 21 = ~430 sf. Raster resolution moves
    // this a little, so the assertion is a band rather than a figure — but a
    // band narrow enough that a bounding box or a doubled scale breaks it.
    const [a, b] = rooms;
    expect(a.squareFeet).toBeGreaterThan(330);
    expect(a.squareFeet).toBeLessThan(530);
    expect(b.squareFeet).toBeGreaterThan(330);
    expect(b.squareFeet).toBeLessThan(530);
  });

  it("returns polygons in stored-measurement units", () => {
    const rooms = roomsInBox(plan, widthPt, heightPt, feetPerPoint, whole);
    for (const room of rooms) {
      expect(room.xs).toHaveLength(room.ys.length);
      for (const x of room.xs) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
      for (const y of room.ys) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(4);
      }
      // At least a triangle, or `verticesProblem` refuses it on save.
      expect(room.xs.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("EXCLUDES WHAT IS OUTSIDE THE BOX, which is the whole point of the box", () => {
    // A SECOND BUILDING off to the right. On a real sheet the thing outside
    // the box is a notes panel or the margin, but those are only detectable
    // BECAUSE they look like rooms — so a second plan is the same test with
    // nothing contrived about whether the decoy detects.
    const decoy = [...box(ft(60), ft(10), ft(92), ft(32)), ...box(ft(60.5), ft(10.5), ft(91.5), ft(31.5))];
    const everything = [...plan, ...decoy];

    const wide = roomsInBox(everything, widthPt, heightPt, feetPerPoint, whole);
    const justThePlan = roomsInBox(everything, widthPt, heightPt, feetPerPoint, {
      x0: ft(5) / widthPt,
      y0: ft(5) / widthPt,
      x1: ft(57) / widthPt,
      y1: ft(37) / widthPt,
    });

    // Both buildings are found when the box takes them both in.
    expect(wide.length).toBeGreaterThan(justThePlan.length);
    // The box around the first finds its rooms and none of the decoy's: every
    // room lies inside the box. This is the assertion the feature rests on.
    expect(justThePlan.length).toBeGreaterThanOrEqual(2);
    for (const room of justThePlan) {
      expect(Math.max(...room.xs) * widthPt).toBeLessThan(ft(57));
    }
  });

  it("MEASURES AN L-SHAPED ROOM AS AN L, not as its bounding box", () => {
    // Found by mutation: replacing the traced ring with the region's bounding
    // box passed every other test in this file. `traceRing` has its own L
    // case, but nothing exercised an L through `roomsInBox`, so the detector
    // could have shipped squaring off every room it found. An L measured as
    // its box over-measures by the notch — here a sixth of the room, and on a
    // real plan an estimator would be bidding ceiling grid for a corridor
    // that is not there.
    //
    // Drawn as a DOUBLE-LINE shell like every other wall here: a wall has two
    // faces, and `wallsFromRooms` needs the cavity between them. A single-line
    // L encloses a region and bounds it with nothing the wall finder calls a
    // wall, so no room is reported at all — which is how this case first
    // failed, and is itself worth knowing.
    //
    // Outer 30 x 20 with a 10 x 10 notch; the inner face encloses ~451 sf,
    // against the 551 its bounding box would claim.
    const ring = (pts: number[][]): StrokeSegment[] =>
      pts.map(([cx, cy], i) => {
        const [nx, ny] = pts[(i + 1) % pts.length];
        return { x1: ft(cx), y1: ft(cy), x2: ft(nx), y2: ft(ny) };
      });
    const lShaped: StrokeSegment[] = [
      ...ring([
        [10, 10],
        [40, 10],
        [40, 20],
        [30, 20],
        [30, 30],
        [10, 30],
      ]),
      ...ring([
        [10.5, 10.5],
        [39.5, 10.5],
        [39.5, 19.5],
        [29.5, 19.5],
        [29.5, 29.5],
        [10.5, 29.5],
      ]),
    ];

    const [room] = roomsInBox(lShaped, widthPt, heightPt, feetPerPoint, whole);
    expect(room).toBeDefined();
    // Comfortably below the 600 the bounding box would give, and close to the
    // 500 the shape actually encloses.
    expect(room.squareFeet).toBeGreaterThan(395);
    expect(room.squareFeet).toBeLessThan(505);
    // Six corners survive the collinear drop, which a rectangle cannot have.
    expect(room.xs.length).toBe(6);
  });

  it("STRAIGHTENS THE RASTER STAIRCASE off a slanted wall", () => {
    // Found by mutation: setting the straightening tolerance to zero passed
    // every other test here, because every other fixture is exactly
    // axis-aligned and leaves no staircase behind. A real wall almost never
    // is — on Augusta p11 the first ten rooms came back with 406, 376 and 869
    // corners before this was wired in.
    //
    // A room with one slanted wall: four corners, and a diagonal that the
    // rasteriser can only draw as a flight of steps.
    const slanted: StrokeSegment[] = [
      { x1: ft(10), y1: ft(10), x2: ft(40), y2: ft(10) },
      { x1: ft(40), y1: ft(10), x2: ft(34), y2: ft(30) },
      { x1: ft(34), y1: ft(30), x2: ft(10), y2: ft(30) },
      { x1: ft(10), y1: ft(30), x2: ft(10), y2: ft(10) },
      { x1: ft(10.5), y1: ft(10.5), x2: ft(39.3), y2: ft(10.5) },
      { x1: ft(39.3), y1: ft(10.5), x2: ft(33.7), y2: ft(29.5) },
      { x1: ft(33.7), y1: ft(29.5), x2: ft(10.5), y2: ft(29.5) },
      { x1: ft(10.5), y1: ft(29.5), x2: ft(10.5), y2: ft(10.5) },
    ];
    const [room] = roomsInBox(slanted, widthPt, heightPt, feetPerPoint, whole);
    expect(room).toBeDefined();
    // Four-ish corners. Generous, because a slant does not land on exact
    // corners — but nothing like the hundreds a raw staircase gives.
    expect(room.xs.length).toBeLessThanOrEqual(12);
  });

  it("returns rings the save would accept, on every shape here", () => {
    for (const rooms of [roomsInBox(plan, widthPt, heightPt, feetPerPoint, whole)]) {
      expect(rooms.length).toBeGreaterThan(0);
      for (const room of rooms) {
        expect(ringSelfIntersects(room.xs, room.ys), `room ${room.id} crosses itself`).toBe(false);
      }
    }
  });

  it("refuses a box with no area, and a sheet with no strokes", () => {
    expect(roomsInBox(plan, widthPt, heightPt, feetPerPoint, { x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.9 })).toEqual([]);
    expect(roomsInBox([], widthPt, heightPt, feetPerPoint, whole)).toEqual([]);
    expect(roomsInBox(plan, widthPt, heightPt, 0, whole)).toEqual([]);
  });
});

describe("strokesNotLettering", () => {
  // A page-width unit is the sheet; at 300 ft across, a foot is 1/300.
  const feetPerUnit = 300;
  const ft = (feet: number) => feet / feetPerUnit;
  const seg = (x1: number, y1: number, x2: number, y2: number) => ({
    x1: ft(x1),
    y1: ft(y1),
    x2: ft(x2),
    y2: ft(y2),
  });
  const textBox = (x: number, y: number, w: number, h: number) => ({
    x: ft(x),
    y: ft(y),
    width: ft(w),
    height: ft(h),
  });

  it("drops the short strokes inside a text box", () => {
    // A glyph outline: a few inches long, sitting in the tag's own box.
    const glyph = seg(10.1, 10.1, 10.2, 10.3);
    expect(strokesNotLettering([glyph], [textBox(10, 10, 3, 1)], feetPerUnit)).toEqual([]);
  });

  it("KEEPS A WALL RUNNING BEHIND A ROOM TAG", () => {
    // The filter would take the room with the label otherwise — a wall does
    // not stop being a wall because somebody wrote CONFERENCE on top of it.
    //
    // THE MIDPOINT HAS TO BE INSIDE THE BOX or this proves nothing: the first
    // version ran the wall from x=0 to x=40, whose midpoint at x=20 is
    // nowhere near a box spanning 10 to 13. It passed with the length check
    // deleted, which is how mutation found it.
    const wall = seg(5, 10.5, 18, 10.5); // midpoint x=11.5, inside the box
    expect(strokesNotLettering([wall], [textBox(10, 10, 3, 1)], feetPerUnit)).toHaveLength(1);
  });

  it("keeps a short stroke that is nowhere near any text", () => {
    expect(strokesNotLettering([seg(50, 50, 50.2, 50.2)], [textBox(10, 10, 3, 1)], feetPerUnit)).toHaveLength(1);
  });

  it("does nothing at all when the sheet has no text layer", () => {
    // A scanned sheet. Returning an empty set here would delete the drawing.
    const strokes = [seg(10.1, 10.1, 10.2, 10.3), seg(0, 10.5, 40, 10.5)];
    expect(strokesNotLettering(strokes, [], feetPerUnit)).toHaveLength(2);
  });

  it("REFUSES TO WORK IN THE WRONG UNITS rather than deleting the sheet", () => {
    // `wallsNotLettering` records the scar: a bare pad is two points to the
    // server reader and TWO PAGE WIDTHS to the viewer, which would put every
    // stroke inside a text box. A zero or missing scale must not do that.
    const strokes = [seg(10.1, 10.1, 10.2, 10.3), seg(0, 10.5, 40, 10.5)];
    expect(strokesNotLettering(strokes, [textBox(10, 10, 3, 1)], 0)).toHaveLength(2);
  });

  it("USES THE MIDPOINT, not an endpoint", () => {
    // The box spans 10..13 with half a foot of pad, so 9.5..13.5. This stroke
    // STARTS at 9.0 — outside — and its midpoint is 9.7, inside. Testing an
    // endpoint keeps it; testing the midpoint drops it.
    //
    // The first version of this used 12.9 to 13.3, which is inside the padded
    // box at both the endpoint and the midpoint, so it could not tell the two
    // rules apart. Mutation found that.
    const half = seg(9.0, 10.5, 10.4, 10.5);
    expect(strokesNotLettering([half], [textBox(10, 10, 3, 1)], feetPerUnit)).toEqual([]);
  });
});
