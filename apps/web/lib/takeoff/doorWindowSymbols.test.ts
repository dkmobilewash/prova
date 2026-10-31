import { describe, expect, it } from "vitest";
import type { StrokeSegment, WallCandidate } from "./wallVectors";
import { doorArcCandidates, doorSymbols, exteriorWalls, tagsNameEveryWindow, windowSymbols, WIDEST_WINDOW_FEET, onlyMarkedDoors } from "./doorWindowSymbols";

/** One foot = 0.01 page-width units here, so feetPerUnit is 100. */
const FPU = 100;
const ft = (n: number) => n / FPU;

/** A quarter-circle swing as CAD exports it: short straight pieces, in order. */
function swing(hx: number, hy: number, r: number, from: number, to: number, pieces = 12): StrokeSegment[] {
  const out: StrokeSegment[] = [];
  for (let i = 0; i < pieces; i++) {
    const a0 = from + ((to - from) * i) / pieces, a1 = from + ((to - from) * (i + 1)) / pieces;
    out.push({ x1: hx + r * Math.cos(a0), y1: hy + r * Math.sin(a0), x2: hx + r * Math.cos(a1), y2: hy + r * Math.sin(a1) });
  }
  return out;
}
const wall = (x1: number, y1: number, x2: number, y2: number, thicknessFeet = 0.5): WallCandidate => ({
  x1, y1, x2, y2, thicknessFeet, lengthFeet: Math.hypot(x2 - x1, y2 - y1) * FPU,
});

describe("door symbols", () => {
  // A 3 ft door hinged at (0.50, 0.50) in a horizontal wall along y = 0.50, leaf standing up (north), strike at (0.53, 0.50).
  const hinge = { x: 0.5, y: 0.5 };
  const leaf: StrokeSegment = { x1: hinge.x, y1: hinge.y, x2: hinge.x, y2: hinge.y - ft(3) };
  const arc = swing(hinge.x, hinge.y, ft(3), -Math.PI / 2, 0);
  const walls = [wall(0.4, 0.5, 0.5, 0.5), wall(0.53, 0.5, 0.7, 0.5)];

  it("finds a door from its swing and leaf, with the leaf's radius as the width, on its wall", () => {
    const doors = doorSymbols([leaf, ...arc], walls, FPU);
    expect(doors).toHaveLength(1);
    const d = doors[0]!;
    expect(d.widthFeet).toBeCloseTo(3, 1);
    expect(d.hinge.x).toBeCloseTo(0.5, 3);
    expect(d.strike.x).toBeCloseTo(0.53, 3);
    expect(d.wall).not.toBeNull();
    expect(d.leaves).toBe(1);
  });

  it("needs the leaf: a bare quarter arc is a countertop return, not a door", () => {
    expect(doorSymbols(arc, walls, FPU)).toHaveLength(0);
    const why = doorArcCandidates(arc, walls, FPU);
    expect(why).toHaveLength(1);
    expect(why[0]!.reject).toBe("no-leaf");
  });

  it("rejects arcs that are not door-sized or not a swing", () => {
    const tiny = swing(0.2, 0.2, ft(0.5), 0, Math.PI / 2);
    const tinyLeaf: StrokeSegment = { x1: 0.2, y1: 0.2, x2: 0.2 + ft(0.5), y2: 0.2 };
    expect(doorArcCandidates([tinyLeaf, ...tiny], [], FPU)[0]!.reject).toBe("radius");
    const half = swing(0.3, 0.3, ft(3), 0, Math.PI, 24);
    expect(doorArcCandidates(half, [], FPU)[0]!.reject).toBe("sweep");
  });

  it("reports a pair of leaves meeting at one strike as one door at the full width", () => {
    // Second leaf hinged at (0.56, 0.50), swinging the other way to the same strike.
    const leaf2: StrokeSegment = { x1: 0.56, y1: 0.5, x2: 0.56, y2: 0.5 - ft(3) };
    const arc2 = swing(0.56, 0.5, ft(3), -Math.PI / 2, -Math.PI, 12);
    const doors = doorSymbols([leaf, ...arc, leaf2, ...arc2], [wall(0.3, 0.5, 0.5, 0.5), wall(0.56, 0.5, 0.8, 0.5)], FPU);
    expect(doors).toHaveLength(1);
    expect(doors[0]!.leaves).toBe(2);
    expect(doors[0]!.widthFeet).toBeCloseTo(6, 1);
  });

  it("counts a door drawn twice over once", () => {
    const doors = doorSymbols([leaf, ...arc, leaf, ...arc], walls, FPU);
    expect(doors).toHaveLength(1);
  });
});

describe("window symbols", () => {
  // A building 40 x 30 ft; the north wall runs along y = 0.40 from x 0.40 to 0.80.
  const north = wall(0.4, 0.4, 0.8, 0.4, 0.67);
  const box = [north, wall(0.8, 0.4, 0.8, 0.7, 0.67), wall(0.8, 0.7, 0.4, 0.7, 0.67), wall(0.4, 0.7, 0.4, 0.4, 0.67)];
  const partition = wall(0.6, 0.4, 0.6, 0.7, 0.4);
  /** Frame, glass, frame: three coterminous lines across the wall at x 0.50..0.54. */
  const triple = (y: number, x1 = 0.5, x2 = 0.54): StrokeSegment[] => [
    { x1, y1: y - ft(0.33), x2, y2: y - ft(0.33) },
    { x1, y1: y, x2, y2: y },
    { x1, y1: y + ft(0.33), x2, y2: y + ft(0.33) },
  ];

  it("tells the exterior walls from the partition", () => {
    const ext = exteriorWalls([...box, partition], FPU);
    expect(ext).toEqual([true, true, true, true, false]);
  });

  it("where the sheet tags its windows, an untagged candidate is not one", () => {
    const tag = { x: 0.52, y: 0.4 + ft(1) };
    expect(windowSymbols(triple(0.4), [...box, partition], FPU, [], true)).toHaveLength(0);
    expect(windowSymbols(triple(0.4), [...box, partition], FPU, [tag], true)).toHaveLength(1);
  });

  it("an interior window counts only on a tagged sheet, with its tag right beside it", () => {
    const interior: StrokeSegment[] = [-0.15, 0, 0.15].map((o) => ({ x1: 0.6 + ft(o), y1: 0.5, x2: 0.6 + ft(o), y2: 0.54 }));
    const beside = { x: 0.6 + ft(1.5), y: 0.52 };
    const far = { x: 0.6 + ft(5), y: 0.52 };
    expect(windowSymbols(interior, [...box, partition], FPU, [beside], false)).toHaveLength(0);
    expect(windowSymbols(interior, [...box, partition], FPU, [beside], true)).toHaveLength(1);
    expect(windowSymbols(interior, [...box, partition], FPU, [far], true)).toHaveLength(0);
  });

  it("finds a window in an exterior wall and measures it", () => {
    const windows = windowSymbols(triple(0.4), [...box, partition], FPU);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.widthFeet).toBeCloseTo(4, 1);
    expect(windows[0]!.wall).toBe(0);
    expect(windows[0]!.lines).toBe(3);
  });

  it("ignores the same pattern on an interior partition, and two lines alone", () => {
    const onPartition: StrokeSegment[] = [
      { x1: 0.6 - ft(0.2), y1: 0.5, x2: 0.6 - ft(0.2), y2: 0.54 },
      { x1: 0.6, y1: 0.5, x2: 0.6, y2: 0.54 },
      { x1: 0.6 + ft(0.2), y1: 0.5, x2: 0.6 + ft(0.2), y2: 0.54 },
    ];
    expect(windowSymbols(onPartition, [...box, partition], FPU)).toHaveLength(0);
    expect(windowSymbols(triple(0.4).slice(0, 2), [...box, partition], FPU)).toHaveLength(0);
  });

  it("JOINS THE LITES OF A STOREFRONT INTO ONE WINDOW, and leaves two windows apart alone", () => {
    // Three 4-ft lites with a 4-inch mullion between them, in the north wall: one 12.7-ft window.
    const lites = [...triple(0.4, 0.5, 0.54), ...triple(0.4, 0.5433, 0.5833), ...triple(0.4, 0.5867, 0.6267)];
    const one = windowSymbols(lites, [...box, partition], FPU);
    expect(one).toHaveLength(1);
    expect(one[0]!.widthFeet).toBeCloseTo(12.67, 1);
    // Joined lites stop at the widest window: eleven 4-ft lites with 4-inch mullions are not one 47-ft window.
    const many = Array.from({ length: 11 }, (_, i) => triple(0.4, 0.5 + i * 0.0433, 0.54 + i * 0.0433)).flat();
    const widest = Math.max(...windowSymbols(many, [...box, partition], FPU).map((w) => w.widthFeet));
    expect(widest).toBeLessThanOrEqual(WIDEST_WINDOW_FEET);
    // The same two lites 3 ft apart are two windows.
    const two = windowSymbols([...triple(0.4, 0.5, 0.54), ...triple(0.4, 0.57, 0.61)], [...box, partition], FPU);
    expect(two).toHaveLength(2);
  });

  it("NEEDS GLASS INSIDE THE WALL: the wall's two faces plus a parallel line beside it are not a window", () => {
    // Joplin's 13–15 ft "windows": the north wall's faces (±4 in of an 8 in
    // wall) and a roof line 10 in outside, all stopping at the same piers.
    const facesAndRoof: StrokeSegment[] = [
      { x1: 0.5, y1: 0.4 - ft(0.33), x2: 0.64, y2: 0.4 - ft(0.33) },
      { x1: 0.5, y1: 0.4 + ft(0.33), x2: 0.64, y2: 0.4 + ft(0.33) },
      { x1: 0.5, y1: 0.4 - ft(0.83), x2: 0.64, y2: 0.4 - ft(0.83) },
    ];
    expect(windowSymbols(facesAndRoof, box, FPU)).toHaveLength(0);
    // The same three lines sitting entirely outside the wall are not one either.
    const beside = facesAndRoof.map((l) => ({ ...l, y1: l.y1 - ft(1), y2: l.y2 - ft(1) }));
    expect(windowSymbols(beside, box, FPU)).toHaveLength(0);
    // Frame, glass, frame inside the wall is (the test above), and a tag beside
    // the faces-and-roof pattern overrides the rule: the drawing says window.
    expect(windowSymbols(facesAndRoof, box, FPU, [{ x: 0.57, y: 0.4 - ft(3) }])).toHaveLength(1);
  });

  it("gives a tag to the NEAREST candidate only, and to the lites drawn like it", () => {
    // A 4 ft window at x 0.50–0.54 and, abutting it, a 6 ft piece of cavity
    // wall drawn with its own inner lines (x 0.54–0.60), both in the north
    // wall. One G tag over the window. The wall piece has lines outside the
    // wall, so it lives or dies by the tag — and the tag is the window's.
    const window = triple(0.4);
    const cavity: StrokeSegment[] = [-0.33, -0.1, 0.1, 0.33, 0.75].map((o) => ({ x1: 0.5405, y1: 0.4 + ft(o), x2: 0.6, y2: 0.4 + ft(o) }));
    const tag = [{ x: 0.52, y: 0.4 - ft(2) }];
    const got = windowSymbols([...window, ...cavity], box, FPU, tag);
    expect(got).toHaveLength(1);
    expect(got[0]!.widthFeet).toBeCloseTo(4, 1);
    // Three lites of a glass partition, each drawn with the same three lines
    // but all of them outside the found wall, one tag over the middle lite:
    // the tag names the storefront, so all three are kept and joined.
    const lite = (x1: number, x2: number) => triple(0.4 - ft(1), x1, x2);
    const storefront = [...lite(0.5, 0.54), ...lite(0.5433, 0.5833), ...lite(0.5867, 0.6267)];
    expect(windowSymbols(storefront, box, FPU)).toHaveLength(0);
    const tagged = windowSymbols(storefront, box, FPU, [{ x: 0.563, y: 0.4 - ft(3.5) }]);
    expect(tagged).toHaveLength(1);
    expect(tagged[0]!.widthFeet).toBeCloseTo(12.67, 1);
  });

  it("ignores staggered lines — a hatch along the wall — that do not stop together", () => {
    const staggered: StrokeSegment[] = [
      { x1: 0.5, y1: 0.4 - ft(0.33), x2: 0.54, y2: 0.4 - ft(0.33) },
      { x1: 0.52, y1: 0.4, x2: 0.56, y2: 0.4 },
      { x1: 0.54, y1: 0.4 + ft(0.33), x2: 0.58, y2: 0.4 + ft(0.33) },
    ];
    expect(windowSymbols(staggered, box, FPU)).toHaveLength(0);
  });
});

describe("a sheet that tags its windows", () => {
  it("counts W tags, and not bare marks or a stray pair", () => {
    expect(tagsNameEveryWindow(["W1", "W2", "W-3", "S8B"])).toBe(true);
    expect(tagsNameEveryWindow(["W1", "W2", "A", "7"])).toBe(false);
  });
});

describe("onlyMarkedDoors", () => {
  const door = (x: number) => ({ kind: "door", hinge: { x, y: 0.5 }, strike: { x: x + 0.01, y: 0.5 }, widthFeet: 3, wall: null, leaves: 1, sweepDegrees: 90 }) as never;
  const doors = [0.1, 0.2, 0.3, 0.4, 0.8].map(door);
  it("drops the unmarked door on a sheet that marks its doors", () => {
    const marks = [0.1, 0.2, 0.3, 0.4].map((x) => ({ x: x + 0.005, y: 0.505 }));
    expect(onlyMarkedDoors(doors, marks, 100)).toHaveLength(4);
  });
  it("keeps every door where the marks could not be read", () => {
    expect(onlyMarkedDoors(doors, [{ x: 0.105, y: 0.505 }], 100)).toHaveLength(5);
  });
});
