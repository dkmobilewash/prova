import { describe, expect, it } from "vitest";
import { doorsAndWindowsForSheet } from "./doorsWindows";
import { doorSymbols } from "./doorWindowSymbols";
import { asideExistingWalls, dashedBoxAround, dashedLines, doorPen, existingDoors, existingPrefixes, existingScheduleMarks, insideLegendBox, swingSide, type ExistingDoorEvidence } from "./existingDoors";
import { doorsInScope } from "./doorsWindows";
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

  it("a bare EXIST. / EXIST / EXISTING inside the swing sets the door aside (Garden Square A100's 102B, 102C)", () => {
    for (const w of ["EXIST.", "EXIST .", "EXIST", "EXISTING"]) expect(run([], [word(w, 0.51, 0.485)]).map((e) => e.route)).toEqual(["tag"]);
    expect(run([], [word("EXIST.", 0.515, 0.515)])).toEqual([]);
    expect(run([], [word("EXISTING WALL", 0.51, 0.485)])).toEqual([]);
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

  it("a framed legend's lines ride along, marked legend, and never set a door aside as existing", () => {
    const line = { x1: 0.4, y1: 0.5, x2: 0.7, y2: 0.5, lengthFeet: 30, why: "" };
    expect(asideExistingWalls([{ ...line, kind: "legend-box" }])).toEqual([{ x1: 0.4, y1: 0.5, x2: 0.7, y2: 0.5, legend: true }]);
    expect(run([], [], { asideWalls: asideExistingWalls([{ ...line, kind: "legend-box" }]) })).toEqual([]);
  });

  it("a door inside a framed legend is a sample and is dropped; one outside the frame, or with no frame, stays (Joplin A-101)", () => {
    // The frame round the door at (0.5, 0.5): four sides, each a legend-box line.
    const frame = [{ x1: 0.4, y1: 0.4, x2: 0.65, y2: 0.4 }, { x1: 0.4, y1: 0.6, x2: 0.65, y2: 0.6 }, { x1: 0.4, y1: 0.4, x2: 0.4, y2: 0.6 }, { x1: 0.65, y1: 0.4, x2: 0.65, y2: 0.6 }];
    expect(insideLegendBox({ x: 0.5, y: 0.5 }, frame)).toBe(true);
    expect(insideLegendBox({ x: 0.7, y: 0.5 }, frame)).toBe(false);
    // Three sides is the frame (Joplin's top rule went to its title's underline); two, an L, is not.
    expect(insideLegendBox({ x: 0.5, y: 0.5 }, frame.slice(1))).toBe(true);
    expect(insideLegendBox({ x: 0.5, y: 0.5 }, [frame[1]!, frame[2]!])).toBe(false);
    const scope = (asideWalls: NonNullable<ExistingDoorEvidence["asideWalls"]>) => doorsInScope({ segments: door, walls, feetPerUnit: FPU, textPt: [], widthPt: W, marks: [], existing: { asideWalls } }).all.length;
    expect(scope(frame.map((l) => ({ ...l, legend: true as const })))).toBe(0);
    expect(scope([])).toBe(1);
    // The same four lines as existing walls, not a legend: the door is still found.
    expect(scope(frame)).toBe(1);
  });

  it("a leaf wider than 4.5 ft is not a door the product counts: 4 ft is, 5 ft is not (Mack A-101's enlarged plans read at the 1/8in scale)", () => {
    const at = (r: number) => doorsInScope({ segments: [{ x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 - ft(r) }, ...swing(0.5, 0.5, ft(r), -Math.PI / 2, 0)], walls: [wall(0.4, 0.5, 0.5, 0.5), wall(0.5 + ft(r), 0.5, 0.7, 0.5)], feetPerUnit: FPU, textPt: [], widthPt: W, marks: [] }).all;
    expect(at(4)).toHaveLength(1);
    expect(at(5)).toHaveLength(0);
    // The arc itself is still read: the scale suggester counts it.
    expect(doorSymbols([{ x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.45 }, ...swing(0.5, 0.5, ft(5), -Math.PI / 2, 0)], [wall(0.4, 0.5, 0.5, 0.5), wall(0.55, 0.5, 0.7, 0.5)], FPU)).toHaveLength(1);
  });

  it("an angle dimension's word inside a door's swing makes the arc the dimension's; outside the swing, across the wall, or a radius word, it does not (Substation A-101, Mack A-101)", () => {
    const found = (text: ReturnType<typeof word>[]) => doorsInScope({ segments: door, walls, feetPerUnit: FPU, textPt: text, widthPt: W, marks: [] }).all.length;
    expect(found([])).toBe(1);
    expect(found([word("110.00°", 0.515, 0.49)])).toBe(0);
    expect(found([word("86°", 0.515, 0.49)])).toBe(0);
    expect(found([word("110.00°", 0.485, 0.49)])).toBe(1);
    expect(found([word("110.00°", 0.515, 0.51)])).toBe(1);
    expect(found([word("110.00°", 0.56, 0.45)])).toBe(1);
    // Substation's "R 3'-0"" sits in the swing of the real door 1118 beside the curved wall it dimensions.
    expect(found([word("R 3'-0\"", 0.515, 0.49)])).toBe(1);
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

  it("NOT IN CONSTRUCTION labels a hatched area too, on one line or stacked over two (F13: Sedgwick A22.1)", () => {
    const hatch: StrokeSegment[] = [];
    for (let k = -20; k <= 20; k += 1) hatch.push({ x1: 0.4 + ft(k), y1: 0.4, x2: 0.4 + ft(k) + ft(20), y2: 0.6 });
    expect(run(hatch, [word("NOT IN CONSTRUCTION", 0.52, 0.47)]).map((e) => e.route)).toEqual(["area"]);
    expect(run(hatch, [word("NOT IN", 0.52, 0.47), word("CONSTRUCTION", 0.52, 0.476)]).map((e) => e.route)).toEqual(["area"]);
    // "NOT IN" alone, or with CONSTRUCTION far off, labels nothing.
    expect(run(hatch, [word("NOT IN", 0.52, 0.47)])).toEqual([]);
    expect(run(hatch, [word("NOT IN", 0.52, 0.47), word("CONSTRUCTION", 0.52, 0.56)])).toEqual([]);
  });

  it("a door in the hatched area's boundary wall that swings OUT of the hatch is new work (F13': Sedgwick's 201)", () => {
    // The hatch only south of the wall (y > 0.5); the door's swing is north of it.
    const south: StrokeSegment[] = [];
    for (let k = -20; k <= 20; k += 1) south.push({ x1: 0.4 + ft(k), y1: 0.5, x2: 0.4 + ft(k) + ft(10), y2: 0.6 });
    expect(run(south, [word("NOT IN CONSTRUCTION", 0.52, 0.55)])).toEqual([]);
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

describe("a door drawn in the existing (grey) pen", () => {
  // Four 3 ft doors along a wall at y = 0.5; the first is drawn grey, the rest black.
  const at = [0.2, 0.4, 0.6, 0.8];
  const doorAt = (x: number, gray: number): StrokeSegment[] => [{ x1: x, y1: 0.5, x2: x, y2: 0.5 - ft(3), gray }, ...swing(x, 0.5, ft(3), -Math.PI / 2, 0).map((s) => ({ ...s, gray }))];
  const sheet = (grays: number[]) => at.flatMap((x, i) => doorAt(x, grays[i]!));
  const run = (grays: number[], words: string[]) => {
    const segs = sheet(grays);
    const ds = doorSymbols(segs, [wall(0.1, 0.5, 0.9, 0.5)], FPU);
    return { ds, got: existingDoors({ doors: ds, segments: segs, textPt: words.map((w, i) => word(w, 0.1 + i * 0.01, 0.1)), widthPt: W, feetPerUnit: FPU }) };
  };
  const reno = ["(E)", "EXISTING", "EXISTING", "EXISTING"];

  it("reads a door's pen off its own arc and leaf", () => {
    const { ds } = run([0.6, 0, 0, 0], []);
    expect(ds).toHaveLength(4);
    expect(doorPen(ds[0]!, sheet([0.6, 0, 0, 0]), FPU)).toEqual({ grey: 1, dark: 0 });
    expect(doorPen(ds[1]!, sheet([0.6, 0, 0, 0]), FPU)).toEqual({ grey: 0, dark: 1 });
  });

  it("reads the pen off the arc: a dark line along the leaf does not make a grey door dark (UCCS A2.1.2)", () => {
    const segs = sheet([0.6, 0, 0, 0]);
    const d = run([0.6, 0, 0, 0], []).ds[0]!;
    // A dark boundary dash along the grey door's leaf, the length of the leaf: the door still reads grey.
    expect(doorPen(d, [...segs, { x1: 0.2, y1: 0.5 + ft(0.2), x2: 0.2, y2: 0.5 - ft(3.2) }], FPU)).toEqual({ grey: 1, dark: 0 });
    // A dark line 8 ft long with only its MIDDLE on the arc's circle (a jamb line, UCCS's grey pair) is not arc.
    const crossing = { x1: 0.2 - ft(4), y1: 0.5 - ft(3), x2: 0.2 + ft(4), y2: 0.5 - ft(3) };
    expect(doorPen(d, [...segs, crossing], FPU)).toEqual({ grey: 1, dark: 0 });
    // Nor one with its middle and ONE end on the circle, running on past it (a chord carried beyond).
    const at = (deg: number) => ({ x: 0.2 + ft(3) * Math.cos((deg * Math.PI) / 180), y: 0.5 + ft(3) * Math.sin((deg * Math.PI) / 180) });
    const p1 = at(-60), p2 = at(-30);
    expect(doorPen(d, [...segs, { x1: p1.x, y1: p1.y, x2: 2 * p2.x - p1.x, y2: 2 * p2.y - p1.y }], FPU)).toEqual({ grey: 1, dark: 0 });
    // With no arc stroke to read (only the leaf), the leaf's pen is the door's.
    const leafOnly = segs.filter((s) => s.x1 === s.x2 && Math.abs(s.x1 - 0.2) < 1e-9);
    expect(doorPen(d, leafOnly, FPU)).toEqual({ grey: 1, dark: 0 });
    expect(doorPen(d, leafOnly.map((s) => ({ ...s, gray: 0 })), FPU)).toEqual({ grey: 0, dark: 1 });
  });

  it("on a sheet that shows existing work, the grey door among black ones is set aside", () => {
    const { got } = run([0.6, 0, 0, 0], reno);
    expect(got.map((e) => e.route)).toEqual(["grey"]);
    expect(got[0]!.why).toBe("drawn grey where the sheet draws its doors dark, on a sheet that shows existing work");
  });

  it("grey alone is not enough: where most doors are grey, or with no renovation words and not nearly all dark, nothing goes", () => {
    expect(run([0.6, 0.6, 0.6, 0], reno).got).toEqual([]);
    expect(run([0.6, 0.6, 0, 0], []).got).toEqual([]);
  });

  it("with no renovation words, a door all grey where three of four doors are dark is set aside", () => {
    expect(run([0.6, 0, 0, 0], []).got.map((e) => e.why)).toEqual(["drawn grey where the sheet draws nearly all its doors dark"]);
  });

  // The first door's arc grey and its leaf part dark: `darkFt` of the 3 ft leaf (the arc is ~4.7 ft).
  // The pen is read off the arc: `darkPieces` of its twelve pieces dark, the leaf grey.
  const mixed = (darkPieces: number) => {
    const x = at[0]!;
    const first: StrokeSegment[] = [
      { x1: x, y1: 0.5, x2: x, y2: 0.5 - ft(3), gray: 0.6 },
      ...swing(x, 0.5, ft(3), -Math.PI / 2, 0).map((g, k) => ({ ...g, gray: k < darkPieces ? 0 : 0.6 })),
    ];
    return [...first, ...at.slice(1).flatMap((xx) => doorAt(xx, 0))];
  };
  const runSegs = (segs: StrokeSegment[], words: string[]) => {
    const ds = doorSymbols(segs, [wall(0.1, 0.5, 0.9, 0.5)], FPU);
    return existingDoors({ doors: ds, segments: segs, textPt: words.map((w, i) => word(w, 0.1 + i * 0.01, 0.1)), widthPt: W, feetPerUnit: FPU });
  };

  it("a door about 83% grey (2 of 12 arc pieces dark) goes on a renovation sheet, and not on a sheet with no renovation words (that bar is 90%)", () => {
    expect(doorSymbols(mixed(2), [wall(0.1, 0.5, 0.9, 0.5)], FPU)).toHaveLength(4);
    expect(runSegs(mixed(2), reno).map((e) => e.route)).toEqual(["grey"]);
    expect(runSegs(mixed(2), [])).toEqual([]);
  });

  it("a door a quarter dark stays, even on a renovation sheet", () => {
    // The leaf grey, five of the arc's twelve pieces dark: about 25% dark by length.
    const x = at[0]!;
    const quarter: StrokeSegment[] = [
      { x1: x, y1: 0.5, x2: x, y2: 0.5 - ft(3), gray: 0.6 },
      ...swing(x, 0.5, ft(3), -Math.PI / 2, 0).map((g, k) => ({ ...g, gray: k < 5 ? 0 : 0.6 })),
      ...at.slice(1).flatMap((xx) => doorAt(xx, 0)),
    ];
    expect(doorSymbols(quarter, [wall(0.1, 0.5, 0.9, 0.5)], FPU)).toHaveLength(4);
    expect(runSegs(quarter, reno)).toEqual([]);
  });

  it("a stroke with no colour is black: a sheet drawn without pen colours sets nothing aside", () => {
    const plain = at.flatMap((x) => [{ x1: x, y1: 0.5, x2: x, y2: 0.5 - ft(3) }, ...swing(x, 0.5, ft(3), -Math.PI / 2, 0)]);
    expect(runSegs(plain, reno)).toEqual([]);
    // A grey door among doors drawn with no colour: they are black, so it goes.
    expect(runSegs([...doorAt(at[0]!, 0.6), ...plain.slice(13)], reno).map((e) => e.route)).toEqual(["grey"]);
  });
});

describe("a door on the grey the sheet calls not in contract, read in paint order (route 7)", () => {
  // The door above: hinged at (0.50, 0.50), its swing north, so its swing's interior is near (0.51, 0.49).
  const fillRect = (x1: number, y1: number, x2: number, y2: number, gray: number, path: number): StrokeSegment[] =>
    [[x1, y1, x2, y1], [x2, y1, x2, y2], [x2, y2, x1, y2], [x1, y2, x1, y1]].map(([a, b, c, d]) => ({ x1: a!, y1: b!, x2: c!, y2: d!, fill: gray, path }));
  // NW C35NW's shape: ONE grey rectangle under the whole building (0.757), and the legend's swatch a lighter 0.80.
  const under = fillRect(0.3, 0.3, 0.8, 0.8, 0.757, 0);
  const swatch = fillRect(0.9, 0.9, 0.92, 0.91, 0.8, 1);
  // Its label to its right on the same line; the legend's title just above it is NEARER, and is not its label.
  const legend = word("AREA NOT IN SCOPE", 0.935, 0.905);
  const title = word("FLOOR PLAN LEGEND", 0.91, 0.895);

  it("a door whose swing stands on that grey is set aside, read off the label beside the swatch, not the title above it", () => {
    expect(run([...under, ...swatch], [legend, title]).map((e) => e.route)).toEqual(["nic"]);
    expect(run([...under, ...swatch], [title])).toEqual([]);
  });

  it("a door in the BOUNDARY wall of the area, grey only on its swing's side, is new work and stays (HPL I-110)", () => {
    expect(run([...fillRect(0.3, 0.3, 0.8, 0.5, 0.757, 0), ...swatch], [legend])).toEqual([]);
  });

  it("a door whose grey reaches only about one leaf past its wall is still on the boundary and stays (Appendix 5B 421)", () => {
    expect(run([...fillRect(0.3, 0.3, 0.8, 0.5 + ft(3), 0.757, 0), ...swatch], [legend])).toEqual([]);
  });

  it("new work painted white OVER the grey keeps its doors; the same white painted UNDER it does not (paint order decides)", () => {
    expect(run([...under, ...swatch, ...fillRect(0.45, 0.45, 0.6, 0.495, 1, 2)], [legend])).toEqual([]);
    const greyOnTop = fillRect(0.3, 0.3, 0.8, 0.8, 0.757, 3);
    expect(run([...fillRect(0.45, 0.45, 0.6, 0.6, 1, 2), ...greyOnTop, ...swatch], [legend]).map((e) => e.route)).toEqual(["nic"]);
  });

  it("a fill too small to stand on (a door leaf, a symbol) is not the ground", () => {
    expect(run([...under, ...swatch, ...fillRect(0.505, 0.485, 0.515, 0.495, 1, 2)], [legend]).map((e) => e.route)).toEqual(["nic"]);
  });

  it("a swatch labelled NO WORK names the grey too (F16: Aldrich A111's EXISTING SCHOOL, NO WORK); NOWORKSHOP does not", () => {
    expect(run([...under, ...swatch], [word("EXISTING SCHOOL, NO WORK", 0.935, 0.905)]).map((e) => e.route)).toEqual(["nic"]);
    expect(run([...under, ...swatch], [word("NOWORKSHOP", 0.935, 0.905)])).toEqual([]);
  });

  it("an N.I.C. phrase printed inside the grey names it with no swatch at all (HPL I-110's NIC - REFER TO ARCH PLANS)", () => {
    expect(run(under, [word("NIC - REFER TO ARCH PLANS", 0.6, 0.7)]).map((e) => e.route)).toEqual(["nic"]);
  });

  it("nothing goes with no N.I.C. phrase, with a word that only contains the letters, or with a swatch of another grey", () => {
    expect(run([...under, ...swatch], [word("AREA OF WORK", 0.93, 0.905)])).toEqual([]);
    expect(run([...under, ...swatch], [word("CLINIC", 0.93, 0.905)])).toEqual([]);
    expect(run([...under, ...fillRect(0.9, 0.9, 0.92, 0.91, 0.5, 1)], [legend])).toEqual([]);
  });
});

describe("a door found again in another view of the same plan (F5: HPL I-110, Kirkland df9e0224 A100)", () => {
  // One view: three 3 ft doors along a wall at y = 0.2, hinges 5 ft apart, swings north. Views repeat 30 ft to the right.
  const view = (ox: number) => {
    const segs: StrokeSegment[] = [], ws: WallCandidate[] = [wall(0.05 + ox, 0.2, 0.3 + ox, 0.2)];
    for (const hx of [0.1, 0.15, 0.2]) segs.push({ x1: hx + ox, y1: 0.2, x2: hx + ox, y2: 0.2 - ft(3) }, ...swing(hx + ox, 0.2, ft(3), -Math.PI / 2, 0));
    return { segs, ws };
  };
  const views = [view(0), view(0.3), view(0.6)];
  const scope = (titles: ReturnType<typeof word>[]) =>
    doorsInScope({ segments: views.flatMap((v) => v.segs), walls: views.flatMap((v) => v.ws), feetPerUnit: FPU, textPt: titles, widthPt: W, marks: [] });
  const under = (str: string, ox: number) => word(str, 0.15 + ox, 0.3);

  it("the finish and lighting copies go; the partition plan's doors stay", () => {
    const got = scope([under("FINISH PLAN - TIER 1 WHITE", 0), under("DECORATIVE LIGHTING PLAN", 0.3), under("PARTITION PLAN - TIER 1 WHITE", 0.6)]);
    expect(got.all.map((d) => Math.round(d.hinge.x * 100) / 100)).toEqual([0.7, 0.75, 0.8]);
  });

  it("a copy whose open and closed leaves the finder read the other way round is still a copy (F10: HPL's lighting plan)", () => {
    // The finish-plan copy drawn with each leaf standing EAST instead of north: same hinges, the leaves swapped.
    const flipped = (ox: number) => [0.1, 0.15, 0.2].flatMap((hx): StrokeSegment[] => [{ x1: hx + ox, y1: 0.2, x2: hx + ox + ft(3), y2: 0.2 }, ...swing(hx + ox, 0.2, ft(3), -Math.PI / 2, 0)]);
    const segs = [...flipped(0), ...views[2]!.segs], ws = [wall(0.05, 0.2 - ft(3), 0.05, 0.2), ...views[2]!.ws];
    const got = doorsInScope({ segments: segs, walls: ws, feetPerUnit: FPU, textPt: [under("FINISH PLAN", 0), under("PARTITION PLAN", 0.6)], widthPt: W, marks: [] });
    expect(got.all.every((d) => d.hinge.x > 0.5)).toBe(true);
    // Control: with no titles the flipped copies ARE found (3 of them), so the line above is not vacuous.
    expect(doorsInScope({ segments: segs, walls: ws, feetPerUnit: FPU, textPt: [], widthPt: W, marks: [] }).all.filter((d) => d.hinge.x < 0.5)).toHaveLength(3);
  });

  it("with no titles, or every view a finish plan, or a notes block nearest, every door stays", () => {
    expect(scope([]).all).toHaveLength(9);
    expect(scope([under("FINISH PLAN", 0), under("FINISH PLAN", 0.3), under("FINISH PLAN", 0.6)]).all).toHaveLength(9);
    expect(scope([under("FLOOR PLAN NOTES", 0), under("FLOOR PLAN", 0.3)]).all).toHaveLength(9);
  });
});

describe("a grey door in a grey wall, where the sheet draws its new doors dark (F6: Kirkland df9e0224 A100)", () => {
  // Kirkland's shape: MOST doors are the existing ones, grey, standing in grey walls; the one new door is black.
  const at = [0.2, 0.4, 0.6, 0.8];
  const doorAt = (x: number, gray: number): StrokeSegment[] => [{ x1: x, y1: 0.5, x2: x, y2: 0.5 - ft(3), gray }, ...swing(x, 0.5, ft(3), -Math.PI / 2, 0).map((s) => ({ ...s, gray }))];
  // The wall's face either side of the opening, 2 ft each way, in the given pen.
  const jambs = (x: number, gray: number): StrokeSegment[] => [{ x1: x - ft(2), y1: 0.5, x2: x - ft(0.05), y2: 0.5, gray }, { x1: x + ft(3.05), y1: 0.5, x2: x + ft(5), y2: 0.5, gray }];
  const run = (grays: number[], jambGray: number, words: string[]) => {
    const segs = at.flatMap((x, i) => [...doorAt(x, grays[i]!), ...jambs(x, grays[i]! > 0 ? jambGray : 0)]);
    const ds = doorSymbols(segs, [wall(0.1, 0.5, 0.9, 0.5)], FPU);
    return existingDoors({ doors: ds, segments: segs, textPt: words.map((w, i) => word(w, 0.1 + i * 0.01, 0.1)), widthPt: W, feetPerUnit: FPU });
  };
  const reno = ["(E)", "EXISTING", "EXISTING", "EXISTING"];

  it("the three grey doors in grey walls go, though most of the sheet's doors are grey", () => {
    expect(run([0.6, 0.6, 0.6, 0], 0.6, reno).map((e) => e.why)).toEqual(Array(3).fill("drawn grey in a grey wall, where the sheet draws its new doors dark"));
  });

  it("not in a dark wall, not with no renovation words, and not where no door is drawn dark", () => {
    expect(run([0.6, 0.6, 0.6, 0], 0, reno)).toEqual([]);
    expect(run([0.6, 0.6, 0.6, 0], 0.6, [])).toEqual([]);
    expect(run([0.6, 0.6, 0.6, 0.6], 0.6, reno)).toEqual([]);
  });
});

describe("a symbol legend's door sample is not a door (F11: Bluetooth AI101)", () => {
  const counted = (text: ReturnType<typeof word>[]) => doorsInScope({ segments: door, walls, feetPerUnit: FPU, textPt: text, widthPt: W, marks: [] }).all.length;
  it("NEW DOOR or EXISTING DOOR AND FRAME TO REMAIN beside it drops it", () => {
    expect(counted([word("NEW DOOR", 0.56, 0.49)])).toBe(0);
    expect(counted([word("EXISTING DOOR AND FRAME TO REMAIN", 0.6, 0.49)])).toBe(0);
  });
  it("a bare DOOR (a split tag), a schedule pointer, a tag with a number, a label above, or one too far right does not", () => {
    expect(counted([word("DOOR", 0.56, 0.49)])).toBe(1);
    expect(counted([word("DOOR TYPE; SEE DOOR SCHEDULE", 0.6, 0.49)])).toBe(1);
    expect(counted([word("NEW DOOR 101", 0.56, 0.49)])).toBe(1);
    expect(counted([word("NEW DOOR", 0.56, 0.40)])).toBe(1);
    expect(counted([word("NEW DOOR", 0.70, 0.49)])).toBe(1);
  });
});

describe("a hinge on a centre mark is a radius dimension, not a door (F12: Substation A-101's curved corners)", () => {
  const counted = (extra: StrokeSegment[]) => doorsInScope({ segments: [...door, ...extra], walls, feetPerUnit: FPU, textPt: [], widthPt: W, marks: [] }).all.length;
  const cross = [{ x1: 0.5 - ft(0.7), y1: 0.5, x2: 0.5 + ft(0.7), y2: 0.5 }, { x1: 0.5, y1: 0.5 - ft(0.7), x2: 0.5, y2: 0.5 + ft(0.7) }];
  const ring = Array.from({ length: 10 }, (_, k) => {
    const a0 = (2 * Math.PI * k) / 10, a1 = (2 * Math.PI * (k + 1)) / 10, r = ft(0.13);
    return { x1: 0.5 + r * Math.cos(a0), y1: 0.5 + r * Math.sin(a0), x2: 0.5 + r * Math.cos(a1), y2: 0.5 + r * Math.sin(a1) };
  });
  // Substation 1108's jamb near a real hinge: short pieces beside it, none centred on it, no ring.
  const jamb = [{ x1: 0.5 + ft(0.01), y1: 0.5 + ft(0.005), x2: 0.5 + ft(0.01), y2: 0.5 + ft(0.155) }, { x1: 0.5 - ft(0.53), y1: 0.5 + ft(0.06), x2: 0.5 - ft(0.13), y2: 0.5 + ft(0.06) }, { x1: 0.5 - ft(0.13), y1: 0.5 + ft(0.005), x2: 0.5 - ft(0.13), y2: 0.5 + ft(0.055) }];
  it("a cross or a small ring centred on the hinge drops it; a jamb beside a real hinge does not", () => {
    expect(counted([])).toBe(1);
    expect(counted(cross)).toBe(0);
    expect(counted(ring)).toBe(0);
    expect(counted(jamb)).toBe(1);
  });

  it("an x on the hinge, 45 degrees to the leaf, is not a centre mark (F12': Joplin A-101's real door)", () => {
    const x = [{ x1: 0.5 - ft(0.23), y1: 0.5 - ft(0.23), x2: 0.5 + ft(0.23), y2: 0.5 + ft(0.23) }, { x1: 0.5 - ft(0.23), y1: 0.5 + ft(0.23), x2: 0.5 + ft(0.23), y2: 0.5 - ft(0.23) }];
    expect(counted(x)).toBe(1);
  });
});

describe("marks a door schedule lists under an EXISTING section (F15: Sedgwick County Courthouse Annex p63)", () => {
  // Page points, y at the baseline. The EXISTING table at the left, the new-door schedule beside it.
  const item = (str: string, x: number, y: number) => ({ str, x, y, width: str.length * 4, height: 6 });
  const page = [
    item("DOOR & FRAME SCHEDULE - EXISTING", 100, 100), item("MARK", 105, 130), item("REMARKS", 200, 130),
    item("E001", 105, 142), item("PAINT, NEW HARDWARE", 150, 142),
    item("E-125", 105, 154), item("PAINT", 150, 154),
    item("S104", 105, 166), item("SALVAGE DOOR AND HARDWARE", 150, 166),
    // A long gap ends the section: a later stray mark in the column is not the schedule's.
    item("E999", 105, 300),
    item("DOOR & FRAME SCHEDULE", 400, 100), item("MARK", 405, 130), item("101", 405, 142), item("WD", 450, 142),
  ];
  it("reads the section's marks, normalised, less the salvaged one, the stray below a gap and the other table's", () => {
    expect(existingScheduleMarks([page])).toEqual(["E001", "E125"]);
  });
  it("a schedule page with no EXISTING section gives nothing, so nothing changes", () => {
    expect(existingScheduleMarks([page.filter((i) => !i.str.includes("EXISTING"))])).toEqual([]);
  });
  it("a plan door tagged with a listed mark is set aside; an unlisted mark, or no list, sets nothing aside", () => {
    const tag = word("E125", 0.51, 0.515);
    expect(run([], [tag], { existingMarks: ["E001", "E125"] }).map((e) => e.why)).toEqual(['marked "E125": the door schedule lists it as existing']);
    expect(run([], [word("E126", 0.51, 0.515)], { existingMarks: ["E001", "E125"] })).toEqual([]);
    expect(run([], [tag], { existingMarks: [] })).toEqual([]);
    expect(run([], [tag])).toEqual([]);
  });
});

describe("a pair tagged EXIST. where its leaves meet is existing (F17: Garden Square A100)", () => {
  // Two 3 ft leaves hinged at x = 0.50 and x = 0.56 on a wall at y = 0.5, both swinging north, meeting at x = 0.53.
  const pair: StrokeSegment[] = [
    { x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 - ft(3) }, ...swing(0.5, 0.5, ft(3), -Math.PI / 2, 0),
    { x1: 0.56, y1: 0.5, x2: 0.56, y2: 0.5 - ft(3) }, ...swing(0.56, 0.5, ft(3), -Math.PI, -Math.PI / 2),
  ];
  const pw = [wall(0.4, 0.5, 0.5, 0.5), wall(0.56, 0.5, 0.7, 0.5)];
  const ds = doorSymbols(pair, pw, FPU);
  const go = (text: ReturnType<typeof word>[]) => existingDoors({ doors: ds, segments: pair, textPt: text, widthPt: W, feetPerUnit: FPU });
  it("finds the pair as one door", () => {
    expect(ds).toHaveLength(1);
    expect(ds[0]!.leaves).toBe(2);
  });
  it("EXIST. in the swing where the leaves meet sets the pair aside; the same word across the wall does not", () => {
    expect(go([word("EXIST.", 0.53, 0.485)]).map((e) => e.why)).toEqual(['"EXIST." printed inside its swing']);
    expect(go([word("EXIST.", 0.53, 0.515)])).toEqual([]);
  });
});
