import { describe, expect, it } from "vitest";
import { offeredCandidates } from "./offeredCandidates";
import { clipToWorkArea, describeStyle, runAt, sameStyle, wallsLikeThese, wallStyles, insideWorkArea, openingsInWorkArea } from "./userExclusions";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

// 100 ft per page-width unit: 1 ft = 0.01 units.
const FPU = 100;
const ft = (n: number) => n / FPU;
const wall = (x1: number, y1: number, x2: number, y2: number, thicknessFeet = 0.5): WallCandidate =>
  ({ x1: ft(x1), y1: ft(y1), x2: ft(x2), y2: ft(y2), lengthFeet: Math.hypot(x2 - x1, y2 - y1), thicknessFeet }) as WallCandidate;
const faces = (w: WallCandidate, pen: { gray?: number; width: number; fill?: number }): StrokeSegment[] => {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, l = Math.hypot(dx, dy);
  const nx = (-dy / l) * (w.thicknessFeet / 2 / FPU), ny = (dx / l) * (w.thicknessFeet / 2 / FPU);
  return [1, -1].map((s) => ({ x1: w.x1 + s * nx, y1: w.y1 + s * ny, x2: w.x2 + s * nx, y2: w.y2 + s * ny, ...pen }));
};
const black = { gray: 0, width: 0.5 };
const grey = { gray: 0.7, width: 0.5 };

describe("exclude walls like this", () => {
  // Six walls: three black outline 6 in, two light-grey outline 6 in, one black 12 in.
  const ws = [wall(10, 10, 40, 10), wall(10, 20, 40, 20), wall(10, 30, 40, 30), wall(10, 40, 40, 40), wall(10, 50, 40, 50), wall(10, 60, 40, 60, 1)];
  const pens = [black, black, black, grey, grey, black];
  const segments = ws.flatMap((w, i) => faces(w, pens[i]));

  it("reads each wall's style in bands, and the two grey walls share one", () => {
    const styles = wallStyles(ws, segments, FPU);
    expect(describeStyle(styles.get(ws[0])!)).toBe("black, usual pen, outline, 6 in");
    expect(describeStyle(styles.get(ws[3])!)).toBe("light grey, usual pen, outline, 6 in");
    expect(sameStyle(styles.get(ws[3])!, styles.get(ws[4])!)).toBe(true);
    expect(sameStyle(styles.get(ws[0])!, styles.get(ws[3])!)).toBe(false);
    // the 12 in black wall is outside the 6 in walls' thickness band
    expect(sameStyle(styles.get(ws[0])!, styles.get(ws[5])!)).toBe(false);
  });
  it("a click on the first grey wall names it, and excludes both grey walls and nothing else", () => {
    const click = { x1: ft(20), y1: ft(40), x2: ft(30), y2: ft(40) };
    expect(runAt(click, ws, FPU)).toBe(ws[3]);
    const { excluded, patterns } = wallsLikeThese([click], ws, segments, FPU);
    expect([...excluded]).toEqual([ws[3], ws[4]]);
    expect(patterns).toHaveLength(1);
  });
  it("a click that lands on no wall excludes nothing; two clicks exclude two styles", () => {
    expect(wallsLikeThese([{ x1: ft(20), y1: ft(80), x2: ft(30), y2: ft(80) }], ws, segments, FPU).excluded.size).toBe(0);
    const two = wallsLikeThese([{ x1: ft(20), y1: ft(40), x2: ft(30), y2: ft(40) }, { x1: ft(20), y1: ft(60), x2: ft(30), y2: ft(60) }], ws, segments, FPU);
    expect([...two.excluded]).toEqual([ws[3], ws[4], ws[5]]);
  });
});

describe("the work area", () => {
  const box = { xs: [ft(0), ft(50), ft(50), ft(0)], ys: [ft(0), ft(0), ft(50), ft(50)] };
  it("keeps a wall inside, sets aside one outside, and splits one across the boundary at it", () => {
    const inside = wall(10, 10, 40, 10);
    const outside = wall(60, 10, 90, 10);
    const across = wall(30, 20, 70, 20); // 40 ft, 20 inside and 20 outside
    const r = clipToWorkArea([inside, outside, across], [box], FPU);
    expect(r.inside).toEqual([inside]);
    expect(r.outside).toEqual([outside]);
    expect(r.split).toHaveLength(1);
    expect(r.split[0].from).toBe(across);
    expect(r.split[0].piece.lengthFeet).toBeCloseTo(20, 5);
    expect(r.split[0].piece.x2).toBeCloseTo(ft(50), 9);
    expect(r.outsideFeet).toBeCloseTo(50, 5);
  });
  it("a wall crossing a notch is cut into two inside pieces; two boxes act as one area; no polygons keep everything", () => {
    const left = { xs: [ft(0), ft(20), ft(20), ft(0)], ys: [ft(0), ft(0), ft(50), ft(50)] };
    const right = { xs: [ft(30), ft(50), ft(50), ft(30)], ys: [ft(0), ft(0), ft(50), ft(50)] };
    const long = wall(0, 25, 50, 25);
    const r = clipToWorkArea([long], [left, right], FPU);
    expect(r.split.map((s) => Math.round(s.piece.lengthFeet))).toEqual([20, 20]);
    expect(r.outsideFeet).toBeCloseTo(10, 5);
    expect(clipToWorkArea([long], [], FPU).inside).toEqual([long]);
  });
  it("a curved run is kept or set aside whole, by its midpoint", () => {
    const arc = { ...wall(30, 20, 70, 20), curved: true } as WallCandidate;
    expect(clipToWorkArea([arc], [box], FPU).outside).toEqual([arc]);
    const arcIn = { ...wall(10, 20, 45, 20), curved: true } as WallCandidate;
    expect(clipToWorkArea([arcIn], [box], FPU).inside).toEqual([arcIn]);
  });
});

describe("offeredCandidates: what the user excluded", () => {
  const ws = [wall(10, 10, 40, 10), wall(10, 20, 40, 20), wall(10, 40, 40, 40), wall(10, 50, 40, 50), wall(60, 10, 90, 10)];
  const pens = [black, black, grey, grey, black];
  // segments in POINTS, as `DetectedSheet` takes them (1000 pt wide)
  const segments = ws.flatMap((w, i) => faces(w, pens[i])).map((s) => ({ ...s, x1: s.x1 * 1000, y1: s.y1 * 1000, x2: s.x2 * 1000, y2: s.y2 * 1000 }));
  const sheet = (user?: { excludeLike?: { x1: number; y1: number; x2: number; y2: number }[]; workArea?: { xs: number[]; ys: number[] }[] }) =>
    ({ walls: ws, segments, widthPt: 1000, feetPerUnit: FPU, planBoxes: null, textItems: [], user });

  it("one click on a grey wall sets both grey walls aside under `excluded-like`, with the count and the pattern in words", () => {
    const got = offeredCandidates(sheet({ excludeLike: [{ x1: ft(20), y1: ft(40), x2: ft(30), y2: ft(40) }] }));
    expect(got.candidates).toHaveLength(3);
    expect(got.setAside).toEqual([{ kind: "excluded-like", why: "drawn like the wall you clicked (light grey, usual pen, outline, 6 in) — excluded by you, on this sheet only", n: 2 }]);
    expect(got.setAsideLines.filter((l) => l.kind === "excluded-like")).toHaveLength(2);
  });
  it("a work area round the left four sets the right-hand wall aside under `outside-work-area`; no user input offers all five", () => {
    const got = offeredCandidates(sheet({ workArea: [{ xs: [ft(0), ft(50), ft(50), ft(0)], ys: [ft(0), ft(0), ft(60), ft(60)] }] }));
    expect(got.candidates).toHaveLength(4);
    expect(got.setAside).toEqual([{ kind: "outside-work-area", why: "outside the work area you drew — 30 ft set aside", n: 1 }]);
    expect(offeredCandidates(sheet()).candidates).toHaveLength(5);
  });
  it("a wall the work-area edge crosses is offered as its inside piece", () => {
    const got = offeredCandidates(sheet({ workArea: [{ xs: [ft(0), ft(25), ft(25), ft(0)], ys: [ft(0), ft(0), ft(60), ft(60)] }] }));
    // four walls cut at x = 25 ft to 15 ft pieces; the right-hand wall outside
    expect(got.candidates.map((c) => Math.round(c.lengthFeet)).sort()).toEqual([15, 15, 15, 15]);
    expect(got.setAside[0]).toEqual({ kind: "outside-work-area", why: "outside the work area you drew — 90 ft set aside, 4 walls cut at its edge", n: 5 });
  });
});

describe("doors and windows outside the work area", () => {
  const square = { xs: [0, 0.5, 0.5, 0], ys: [0, 0, 0.5, 0.5] };
  const door = (x: number) => ({ hinge: { x, y: 0.1 }, strike: { x: x + 0.01, y: 0.1 }, wall: null });
  const result = {
    doors: [door(0.1), door(0.8)],
    windows: [{ x1: 0.1, y1: 0.2, x2: 0.2, y2: 0.2 }, { x1: 0.8, y1: 0.2, x2: 0.9, y2: 0.2 }],
    join: { openings: ["inside", "outside"] },
  };
  it("leaves the ones outside out, and keeps the schedule join lined up with the doors", () => {
    const got = openingsInWorkArea(result, [square]);
    expect(got.doors).toEqual([door(0.1)]);
    expect(got.windows).toHaveLength(1);
    expect(got.join?.openings).toEqual(["inside"]);
  });
  it("with no work area, the whole sheet is the job", () => {
    expect(openingsInWorkArea(result, [])).toBe(result);
    expect(insideWorkArea(0.9, 0.9, [])).toBe(true);
    expect(insideWorkArea(0.9, 0.9, [square])).toBe(false);
  });
});
