import { describe, expect, it } from "vitest";

import {
  SNAP_RADIUS,
  closesRing,
  cutoutInside,
  extendByLength,
  lockToAxis,
  moveVertex,
  nearestOnSegment,
  pointInRing,
  rectanglePoints,
  snapToGeometry,
  vertexAt,
} from "./drawTools";

/** A 0.2 × 0.2 square, in the page-width box. */
const SQUARE = { xs: [0.1, 0.3, 0.3, 0.1], ys: [0.1, 0.1, 0.3, 0.3] };

describe("nearestOnSegment", () => {
  it("drops a perpendicular onto the segment", () => {
    expect(nearestOnSegment({ x: 0.5, y: 0.2 }, 0, 0, 1, 0)).toEqual({ x: 0.5, y: 0 });
  });

  it("CLAMPS to the ends rather than running off down the line", () => {
    // A click past the end of a wall belongs to its CORNER, not to a point on
    // the infinite line the wall would reach if it carried on.
    expect(nearestOnSegment({ x: 5, y: 0 }, 0, 0, 1, 0)).toEqual({ x: 1, y: 0 });
    expect(nearestOnSegment({ x: -5, y: 0 }, 0, 0, 1, 0)).toEqual({ x: 0, y: 0 });
  });

  it("survives a zero-length segment", () => {
    expect(nearestOnSegment({ x: 1, y: 1 }, 0.5, 0.5, 0.5, 0.5)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("snapToGeometry", () => {
  const targets = [
    { kind: "vertex" as const, x: 0.5, y: 0.5 },
    { kind: "segment" as const, x1: 0, y1: 0.5, x2: 1, y2: 0.5 },
  ];

  it("leaves a click alone when nothing is near", () => {
    expect(snapToGeometry({ x: 0.1, y: 0.1 }, targets)).toEqual({ x: 0.1, y: 0.1, to: null });
  });

  it("A VERTEX WINS EVEN WHEN THE SEGMENT IS NEARER", () => {
    // THE RULE THIS FUNCTION EXISTS FOR. Corners are what people aim at. This
    // click is 0.001 from the wall and 0.002 from its corner; taking the
    // closer one would snap an eighth of an inch along the wall instead of to
    // the corner, which is the one place the estimator meant.
    const click = { x: 0.5 + 0.002, y: 0.5 + 0.001 };
    const snapped = snapToGeometry(click, targets);
    expect(snapped.to).toBe("vertex");
    expect(snapped).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it("falls back to the segment when no vertex is in range", () => {
    const snapped = snapToGeometry({ x: 0.2, y: 0.502 }, targets);
    expect(snapped.to).toBe("segment");
    expect(snapped.y).toBeCloseTo(0.5, 6);
    expect(snapped.x).toBeCloseTo(0.2, 6);
  });

  it("respects a radius the caller shrinks for zoom", () => {
    // The viewer divides by the zoom, so a snap does not grow as somebody
    // zooms in to be careful.
    //
    // OFF THE SEGMENT'S LINE, which the first version of this case was not:
    // it sat exactly on y=0.5, so at the smaller radius it correctly snapped
    // to the SEGMENT at zero distance and the test read that as a failure.
    // The radius has to be the only thing deciding, so the click is diagonal
    // from the vertex and clear of the wall.
    const click = { x: 0.5 + SNAP_RADIUS / 2, y: 0.5 + SNAP_RADIUS / 2 };
    expect(snapToGeometry(click, targets).to).toBe("vertex");
    expect(snapToGeometry(click, targets, SNAP_RADIUS / 4).to).toBe(null);
  });
});

describe("lockToAxis", () => {
  const from = { x: 0.5, y: 0.5 };

  it("locks a near-horizontal drag to horizontal", () => {
    const locked = lockToAxis(from, { x: 0.7, y: 0.507 });
    expect(locked.y).toBeCloseTo(0.5, 6);
    expect(locked.x).toBeGreaterThan(0.5);
  });

  it("KEEPS THE LENGTH rather than projecting onto the axis", () => {
    // Projecting shortens the run as the pointer drifts off axis, so the
    // NUMBER changes while the line looks identical. Somebody dragging 10 ft
    // at 2° off horizontal means 10 ft.
    const to = { x: 0.7, y: 0.507 };
    const dragged = Math.hypot(to.x - from.x, to.y - from.y);
    const locked = lockToAxis(from, to);
    expect(Math.hypot(locked.x - from.x, locked.y - from.y)).toBeCloseTo(dragged, 9);
  });

  it("locks to 45° as well as the four square directions", () => {
    // A building is mostly square and sometimes has a diagonal corridor. A
    // lock that cannot follow one is a lock people switch off.
    const locked = lockToAxis(from, { x: 0.6, y: 0.605 });
    expect(locked.x - from.x).toBeCloseTo(locked.y - from.y, 6);
  });

  it("is a no-op when there is nowhere to go", () => {
    expect(lockToAxis(from, from)).toEqual(from);
  });
});

describe("rectanglePoints", () => {
  it("makes four corners from two opposite ones", () => {
    expect(rectanglePoints({ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.6 })).toEqual({
      xs: [0.1, 0.4, 0.4, 0.1],
      ys: [0.2, 0.2, 0.6, 0.6],
    });
  });

  it("winds consistently however the corners were dragged", () => {
    // Dragging up-left must not produce a bowtie, which `ringArea` refuses
    // outright — so the outline would have no area at all.
    for (const [a, b] of [
      [{ x: 0.4, y: 0.6 }, { x: 0.1, y: 0.2 }],
      [{ x: 0.1, y: 0.6 }, { x: 0.4, y: 0.2 }],
    ]) {
      const { xs, ys } = rectanglePoints(a, b);
      // Opposite corners differ in both axes; adjacent ones in exactly one.
      expect(xs[0] === xs[1] && ys[0] === ys[1]).toBe(false);
      expect(ys[0]).toBe(ys[1]);
      expect(xs[1]).toBe(xs[2]);
    }
  });
});

describe("extendByLength", () => {
  const from = { x: 0.5, y: 0.5 };
  // A sheet 144 ft across: 1 ft is 1/144 of the page width.
  const SCALE = 144;

  it("goes the typed distance in the aimed direction", () => {
    const point = extendByLength(from, { x: 0.9, y: 0.5 }, 72, SCALE);
    expect(point).not.toBeNull();
    expect(point?.x).toBeCloseTo(0.5 + 72 / 144, 9);
    expect(point?.y).toBeCloseTo(0.5, 9);
  });

  it("uses the direction only, not how far the pointer is", () => {
    const near = extendByLength(from, { x: 0.51, y: 0.5 }, 72, SCALE);
    const far = extendByLength(from, { x: 0.99, y: 0.5 }, 72, SCALE);
    expect(near).toEqual(far);
  });

  it("REFUSES rather than defaulting to east when there is no direction", () => {
    // A run that appears pointing right because somebody typed a length
    // before aiming is a wall in the wrong place.
    expect(extendByLength(from, from, 10, SCALE)).toBeNull();
  });

  it("refuses without a scale, and refuses a nonsense length", () => {
    expect(extendByLength(from, { x: 0.9, y: 0.5 }, 10, null)).toBeNull();
    expect(extendByLength(from, { x: 0.9, y: 0.5 }, 10, 0)).toBeNull();
    expect(extendByLength(from, { x: 0.9, y: 0.5 }, 0, SCALE)).toBeNull();
    expect(extendByLength(from, { x: 0.9, y: 0.5 }, -5, SCALE)).toBeNull();
    expect(extendByLength(from, { x: 0.9, y: 0.5 }, Number.NaN, SCALE)).toBeNull();
  });
});

describe("closesRing", () => {
  it("closes on a click at the first vertex once there are enough points", () => {
    expect(closesRing({ x: 0.1, y: 0.1 }, SQUARE.xs.slice(0, 3), SQUARE.ys.slice(0, 3))).toBe(true);
  });

  it("does not close a shape that is not one yet", () => {
    expect(closesRing({ x: 0.1, y: 0.1 }, [0.1, 0.3], [0.1, 0.1])).toBe(false);
  });

  it("does not close on a click anywhere else", () => {
    expect(closesRing({ x: 0.3, y: 0.3 }, SQUARE.xs.slice(0, 3), SQUARE.ys.slice(0, 3))).toBe(false);
  });
});

describe("pointInRing and cutoutInside", () => {
  it("knows inside from outside", () => {
    expect(pointInRing(0.2, 0.2, SQUARE.xs, SQUARE.ys)).toBe(true);
    expect(pointInRing(0.5, 0.5, SQUARE.xs, SQUARE.ys)).toBe(false);
  });

  it("accepts a hole wholly inside its outline", () => {
    const hole = { xs: [0.15, 0.25, 0.25, 0.15], ys: [0.15, 0.15, 0.25, 0.25] };
    expect(cutoutInside(hole, SQUARE)).toBe(true);
  });

  it("REFUSES a hole that pokes outside, which would measure as nothing", () => {
    // `netArea` clamps at zero rather than going negative, so a hole bigger
    // than its outline makes the ROOM measure nothing — which reads as a
    // broken tool. Refusing at the moment of drawing is when the person still
    // knows what they meant.
    const poking = { xs: [0.25, 0.5, 0.5, 0.25], ys: [0.15, 0.15, 0.25, 0.25] };
    expect(cutoutInside(poking, SQUARE)).toBe(false);
  });

  it("refuses a shape that is not a shape", () => {
    expect(cutoutInside({ xs: [0, 1], ys: [0, 1] }, SQUARE)).toBe(false);
    expect(cutoutInside({ xs: [0.2, 0.25, 0.22], ys: [0.2, 0.2, 0.25] }, { xs: [0, 1], ys: [0, 1] })).toBe(
      false,
    );
  });
});

describe("vertexAt and moveVertex", () => {
  it("finds the vertex under a click, nearest first", () => {
    expect(vertexAt({ x: 0.1001, y: 0.1001 }, SQUARE.xs, SQUARE.ys)).toBe(0);
    expect(vertexAt({ x: 0.3001, y: 0.1 }, SQUARE.xs, SQUARE.ys)).toBe(1);
    expect(vertexAt({ x: 0.5, y: 0.5 }, SQUARE.xs, SQUARE.ys)).toBeNull();
  });

  it("moves one vertex and leaves the rest alone", () => {
    const moved = moveVertex(SQUARE.xs, SQUARE.ys, 1, { x: 0.9, y: 0.05 });
    expect(moved.xs).toEqual([0.1, 0.9, 0.3, 0.1]);
    expect(moved.ys).toEqual([0.1, 0.05, 0.3, 0.3]);
    // The original is untouched — the caller holds it as state.
    expect(SQUARE.xs).toEqual([0.1, 0.3, 0.3, 0.1]);
  });

  it("ignores an index that is not there rather than growing the shape", () => {
    expect(moveVertex(SQUARE.xs, SQUARE.ys, 9, { x: 0, y: 0 }).xs).toEqual(SQUARE.xs);
    expect(moveVertex(SQUARE.xs, SQUARE.ys, -1, { x: 0, y: 0 }).xs).toEqual(SQUARE.xs);
  });
});
