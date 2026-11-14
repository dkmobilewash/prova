import { describe, expect, it } from "vitest";
import { doorsAndWindowsForSheet } from "./doorsWindows";
import { doorSymbols } from "./doorWindowSymbols";
import { asideExistingWalls, dashedBoxAround, dashedLines, existingDoors, existingPrefixes, swingSide } from "./existingDoors";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/** One foot = 0.01 page-width units, so feetPerUnit is 100; the page is 1000 pt wide. */
const FPU = 100;
const W = 1000;
const ft = (n: number) => n / FPU;

function swing(hx: number, hy: number, r: number, from: number, to: number, pieces = 12): StrokeSegment[] {
  const out: StrokeSegment[] = [];
  for (let i = 0; i < pieces; i++) {
    const a0 = from + ((to - from) * i) / pieces, a1 = from + ((to - from) * (i + 1)) / pieces;
    out.push({ x1: hx + r * Math.cos(a0), y1: hy + r * Math.sin(a0), x2: hx + r * Math.cos(a1), y2: hy + r * Math.sin(a1) });
  }
  return out;
}
const wall = (x1: number, y1: number, x2: number, y2: number): WallCandidate => ({ x1, y1, x2, y2, thicknessFeet: 0.5, lengthFeet: Math.hypot(x2 - x1, y2 - y1) * FPU }) as WallCandidate;
/** A word centred at (cx, cy) page-width units, as the PDF gives it: page points, y at the baseline. */
const word = (str: string, cx: number, cy: number) => ({ str, x: cx * W - 5, y: cy * W + 2, width: 10, height: 4 });

// A 3 ft door hinged at (0.50, 0.50) in a wall along y = 0.50; its leaf stands north and its swing is north of the wall.
const door = [{ x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 - ft(3) }, ...swing(0.5, 0.5, ft(3), -Math.PI / 2, 0)];
const walls = [wall(0.4, 0.5, 0.5, 0.5), wall(0.53, 0.5, 0.7, 0.5)];
const doors = doorSymbols(door, walls, FPU);
const run = (segments: StrokeSegment[], text: ReturnType<typeof word>[], evidence?: Parameters<typeof existingDoors>[0]["evidence"]) =>
  existingDoors({ doors, segments: [...door, ...segments], textPt: text, widthPt: W, feetPerUnit: FPU, ...(evidence === undefined ? {} : { evidence }) });

/** A dashed line from (x1, y1) to (x2, y2), axis-aligned: 1 ft dashes, 0.5 ft gaps. */
function dashed(x1: number, y1: number, x2: number, y2: number): StrokeSegment[] {
  const out: StrokeSegment[] = [];
  const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  for (let t = 0; t + ft(1) <= len; t += ft(1.5)) out.push({ x1: x1 + ux * t, y1: y1 + uy * t, x2: x1 + ux * (t + ft(1)), y2: y1 + uy * (t + ft(1)) });
  return out;
}

describe("existing doors set aside", () => {
  it("finds the door the tests are about, its swing north of the wall", () => {
    expect(doors).toHaveLength(1);
    expect(swingSide(doors[0]!)).toBe(-1);
  });

  it("a bare (E) printed inside the swing sets the door aside (UCCS's corridor doors)", () => {
    expect(run([], [word("(E)", 0.51, 0.485)]).map((e) => e.route)).toEqual(["tag"]);
  });

  it("a bare (E) across the wall from the swing is a dimension's, not the door's (E Street A2.1, doors E-9 to E-11)", () => {
    expect(run([], [word("(E)", 0.515, 0.515)])).toEqual([]);
  });

  it("a mark ending (E) beside the door sets it aside, either side of the wall (N141 (E))", () => {
    expect(run([], [word("N141 (E)", 0.49, 0.515)]).map((e) => e.why)).toEqual(['tagged "N141 (E)"']);
  });

  it("a door on a wall already set aside as existing is set aside; one on a new wall is not", () => {
    expect(run([], [], { asideWalls: [{ x1: 0.4, y1: 0.5, x2: 0.7, y2: 0.5 }] }).map((e) => e.route)).toEqual(["wall"]);
    expect(run([], [], { asideWalls: [{ x1: 0.4, y1: 0.6, x2: 0.7, y2: 0.6 }] })).toEqual([]);
  });

  it("route 1 reads the walls the sheet's own marks set aside, never the ones plan comparison did (E Street A2.1 doors 1 and 6, new openings in kept walls)", () => {
    const line = { x1: 0.4, y1: 0.5, x2: 0.7, y2: 0.5, lengthFeet: 30, why: "" };
    expect(asideExistingWalls([{ ...line, kind: "existing" }])).toHaveLength(1);
    expect(asideExistingWalls([{ ...line, kind: "on-prior-plan" }, { ...line, kind: "dashed-faces" }])).toEqual([]);
    // On a paired sheet the demolition plan decides: a door it does not draw stays, on a kept wall or not.
    expect(run([], [], { asideWalls: asideExistingWalls([{ ...line, kind: "on-prior-plan" }]), priorDoors: [{ hinge: { x: 0.6, y: 0.5 }, strike: { x: 0.63, y: 0.5 } }] })).toEqual([]);
  });

  it("a door the demolition plan draws in the same place, and keeps, is existing to remain", () => {
    const got = run([], [], { priorDoors: [{ hinge: { x: 0.5, y: 0.5 }, strike: { x: 0.53, y: 0.5 } }], priorSheet: "AD101" });
    expect(got.map((e) => e.why)).toEqual(["drawn on AD101 and not removed — existing to remain"]);
    expect(run([], [], { priorDoors: [{ hinge: { x: 0.6, y: 0.5 }, strike: { x: 0.63, y: 0.5 } }] })).toEqual([]);
  });

  it("a door inside a hatched area labelled not in contract is set aside; the label outside the hatch sets nothing aside", () => {
    const hatch: StrokeSegment[] = [];
    for (let k = -20; k <= 20; k += 1) hatch.push({ x1: 0.4 + ft(k), y1: 0.4, x2: 0.4 + ft(k) + ft(20), y2: 0.6 });
    expect(run(hatch, [word("N.I.C.", 0.52, 0.47)]).map((e) => e.route)).toEqual(["area"]);
    expect(run(hatch, [word("N.I.C.", 0.9, 0.9)])).toEqual([]);
  });

  it("a door inside a closed dashed box with an EXISTING label in it is set aside; an open dashed outline is not a box", () => {
    const box = [...dashed(0.45, 0.42, 0.6, 0.42), ...dashed(0.45, 0.56, 0.6, 0.56), ...dashed(0.45, 0.42, 0.45, 0.56), ...dashed(0.6, 0.42, 0.6, 0.56)];
    const label = word("EXISTING", 0.57, 0.45);
    expect(run(box, [label]).map((e) => e.why)).toEqual(['inside the dashed boundary round "EXISTING"']);
    // Three sides only: a long dashed grid line does not close a box either.
    expect(run(box.filter((s) => !(Math.abs(s.x1 - 0.6) < 1e-9 && Math.abs(s.x2 - 0.6) < 1e-9)), [label])).toEqual([]);
    expect(run(box, [word("OFFICE", 0.57, 0.45)])).toEqual([]);
  });

  it("dashed grid lines crossing round a label are not a box: their ends do not meet at corners", () => {
    const grid = [...dashed(0.1, 0.42, 0.9, 0.42), ...dashed(0.1, 0.56, 0.9, 0.56), ...dashed(0.45, 0.1, 0.45, 0.9), ...dashed(0.6, 0.1, 0.6, 0.9)];
    expect(run(grid, [word("EXISTING", 0.57, 0.45)])).toEqual([]);
  });

  it("reads dashed lines and the box round a point", () => {
    const lines = dashedLines([...dashed(0.1, 0.1, 0.3, 0.1), ...dashed(0.1, 0.3, 0.3, 0.3), ...dashed(0.1, 0.1, 0.1, 0.3), ...dashed(0.3, 0.1, 0.3, 0.3)], FPU);
    expect(lines.across).toHaveLength(2);
    expect(lines.down).toHaveLength(2);
    const box = dashedBoxAround({ x: 0.2, y: 0.2 }, lines, FPU)!;
    expect(box.x1).toBeCloseTo(0.1, 2);
    expect(box.y2).toBeCloseTo(0.3, 2);
    // A solid line cut into touching pieces is not dashed.
    const solid: StrokeSegment[] = [];
    for (let t = 0; t < 10; t += 1) solid.push({ x1: 0.1 + ft(t), y1: 0.5, x2: 0.1 + ft(t + 1), y2: 0.5 });
    expect(dashedLines(solid, FPU).across).toHaveLength(0);
  });

  it("a person who chose to count the sheet's existing doors gets nothing set aside", () => {
    expect(run([], [word("(E)", 0.51, 0.485)], { counted: true })).toEqual([]);
  });

  it("the product's door path leaves an existing door out of its doors and says why", () => {
    const got = doorsAndWindowsForSheet({ segments: door, segmentsPt: door.map((s) => ({ ...s, x1: s.x1 * W, y1: s.y1 * W, x2: s.x2 * W, y2: s.y2 * W })), textPt: [word("(E)", 0.51, 0.485)], widthPt: W, walls, feetPerUnit: FPU, scheduleRows: [] });
    expect(got.doors).toHaveLength(0);
    expect(got.existingDoors.map((e) => e.route)).toEqual(["tag"]);
    const counted = doorsAndWindowsForSheet({ segments: door, segmentsPt: [], textPt: [word("(E)", 0.51, 0.485)], widthPt: W, walls, feetPerUnit: FPU, scheduleRows: [], existing: { counted: true } });
    expect(counted.doors).toHaveLength(1);
    expect(counted.existingDoors).toEqual([]);
  });
});

describe("a door series the set calls existing", () => {
  // Three 3 ft doors along a wall at y = 0.5, hinged at x = 0.2, 0.4, 0.6; each mark sits 2 ft above its door's middle.
  const at = [0.2, 0.4, 0.6];
  const segs: StrokeSegment[] = at.flatMap((x) => [{ x1: x, y1: 0.5, x2: x, y2: 0.5 - ft(3) }, ...swing(x, 0.5, ft(3), -Math.PI / 2, 0)]);
  const threeDoors = doorSymbols(segs, [wall(0.1, 0.5, 0.9, 0.5)], FPU);
  const markAt = (str: string, i: number) => word(str, at[i]! + ft(1.5), 0.5 - ft(2));
  const series = (text: ReturnType<typeof word>[], evidence?: Parameters<typeof existingDoors>[0]["evidence"]) =>
    existingDoors({ doors: threeDoors, segments: segs, textPt: text, widthPt: W, feetPerUnit: FPU, ...(evidence === undefined ? {} : { evidence }) });
  const tags = [markAt("E-1", 0), markAt("E-2", 1), markAt("E-3", 2)];

  it("reads the definitions a set prints, and not a letter that means something else", () => {
    expect(existingPrefixes(['13. DOORS WITH PREFIX "E" ARE EXISTING DOORS TO REMAIN.'])).toEqual(["E"]);
    expect(existingPrefixes(["DOORS WITH PREFIX \u201cEX\u201d ARE EXISTING", "EX = EXISTING TO REMAIN"])).toEqual(["EX"]);
    expect(existingPrefixes(["E = EAST WING", "PREFIX E INDICATES EAST", "SEE DOOR SCHEDULE FOR EXISTING DOOR HARDWARE"])).toEqual([]);
  });

  it("an E- series the door schedule calls existing is set aside (E Street p31)", () => {
    expect(threeDoors).toHaveLength(3);
    const got = series(tags, { existingPrefixes: ["E"] });
    expect(got.map((e) => e.route)).toEqual(["series", "series", "series"]);
    expect(got[0]!.why).toBe('tagged "E-1": the set calls prefix "E" existing');
  });

  it("an E- series with no legend, keynote or demolition plan behind it is left alone (an east wing's doors)", () => {
    expect(series(tags)).toEqual([]);
    expect(series(tags, { existingPrefixes: ["X"] })).toEqual([]);
  });

  it("the sheet's own legend or keynote is support enough", () => {
    expect(series([...tags, word("DOORS WITH PREFIX E ARE EXISTING TO REMAIN", 0.8, 0.2)]).map((e) => e.route)).toEqual(["series", "series", "series"]);
  });

  it("a paired demolition plan that keeps most of the series supports the rest; one keeping a third does not", () => {
    const kept = (i: number) => ({ hinge: threeDoors[i]!.hinge, strike: threeDoors[i]!.strike });
    expect(series(tags, { priorDoors: [kept(0), kept(1)], priorSheet: "AD1" }).map((e) => e.route)).toEqual(["demo", "demo", "series"]);
    expect(series(tags, { priorDoors: [kept(0)], priorSheet: "AD1" }).map((e) => e.route)).toEqual(["demo"]);
  });

  it("a door's own mark is the nearest one: a new door 1 beside existing E-1 stays (E Street's entry)", () => {
    const mixed = [word("1", at[0]! + ft(1.5), 0.5 - ft(1)), markAt("E-1", 0), markAt("E-2", 1), markAt("E-3", 2)];
    expect(series(mixed, { existingPrefixes: ["E"] }).map((e) => e.why)).toEqual(['tagged "E-2": the set calls prefix "E" existing', 'tagged "E-3": the set calls prefix "E" existing']);
  });

  it("a keynote or reference shaped like a prefix (E23.04, E5B beside E Street's E-5) is not a door mark: the series takes its hyphen", () => {
    expect(series([markAt("E23.04", 0)], { existingPrefixes: ["E"] })).toEqual([]);
    expect(series([markAt("E5B", 0)], { existingPrefixes: ["E"] })).toEqual([]);
  });
});
