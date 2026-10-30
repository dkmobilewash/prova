import { describe, expect, it } from "vitest";
import { AREA_LABEL, existingWalls, isExistingRoomName, isWallTag, LEGEND_EXISTING, legendPens, textRows } from "./existingWalls";
import { offeredCandidates } from "./offeredCandidates";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

// 100 ft per page-width unit, 1000 pt wide: 1 ft = 0.01 units = 10 pt.
const FPU = 100;
const W = 1000;
const T = 0.5;
const ft = (n: number) => n / FPU;
const wall = (x1: number, y1: number, x2: number, y2: number): WallCandidate =>
  ({ x1: ft(x1), y1: ft(y1), x2: ft(x2), y2: ft(y2), lengthFeet: Math.hypot(x2 - x1, y2 - y1), thicknessFeet: T }) as WallCandidate;
/** A word whose BASELINE is at `yFt`, 8 pt tall, 40 pt wide, starting 20 pt left of `xFt`. */
const word = (str: string, xFt: number, yFt: number) => ({ str, x: xFt * 10 - 20, y: yFt * 10, width: 40, height: 8 });
/** The two face strokes of a wall, drawn with a pen, in page-width units. */
const faces = (w: WallCandidate, pen: { gray?: number; width: number }): StrokeSegment[] => {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, l = Math.hypot(dx, dy);
  const nx = (-dy / l) * (ft(T) / 2), ny = (dx / l) * (ft(T) / 2);
  return [1, -1].map((s) => ({ x1: w.x1 + s * nx, y1: w.y1 + s * ny, x2: w.x2 + s * nx, y2: w.y2 + s * ny, ...pen }));
};
const run = wall(10, 50, 40, 50); // 30 ft along y = 50 ft

describe("textRows joins a line's items and keeps columns apart", () => {
  it("reads EXISTING / WALL / TO / REMAIN as one row and a second column as another", () => {
    const items = [
      { str: "EXISTING", x: 100, y: 500, width: 40, height: 8 },
      { str: "WALL", x: 144, y: 500, width: 20, height: 8 },
      { str: "TO", x: 168, y: 501, width: 10, height: 8 },
      { str: "REMAIN", x: 182, y: 500, width: 30, height: 8 },
      { str: "NEW WALL", x: 400, y: 500, width: 40, height: 8 },
    ];
    expect(textRows(items).map((r) => r.str)).toEqual(["EXISTING WALL TO REMAIN", "NEW WALL"]);
  });
});

describe("the words: what is a wall tag and what marks an area", () => {
  it("a wall tag: (E), (E) WALL, (E) DEMISING, EXIST. 8\" CMU WALL, EXISTING WALL TO REMAIN, WALL TO REMAIN — not a room name, a note, a slab or a fixture", () => {
    for (const yes of ["(E)", "(E) WALL", "(E) DEMISING", "EXIST. 8\" CMU WALL", "EXISTING WALL TO REMAIN", "WALL TO REMAIN", "EXIST'G PARTITION", "PARTITION TO REMAIN."]) expect(isWallTag(yes), yes).toBe(true);
    for (const no of ["(E) OFFICE", "EXISTING WALLS TO REMAIN SHALL BE PATCHED AND PAINTED", "E", "NEW WALL", "WALL", "EXISTING CONCRETE", "EXISTING MIRROR TOILET PARTITION", "(E) COLUMN TO REMAIN"]) expect(isWallTag(no), no).toBe(false);
  });
  it("an area label: NIC, N.I.C., NIC - REFER TO ARCH PLANS, NIC, TYP ALL, AREA \"NOT IN CONTRACT\", NO WORK THIS AREA, EXISTING BUILDING (NIC), LIMITED SCOPE — not a wall tag, a niche or a note", () => {
    for (const yes of ["NIC", "N.I.C.", "NIC - REFER TO ARCH PLANS", "NIC, TYP ALL", 'AREA "NOT IN CONTRACT"', "NOT IN CONTRACT", "NO WORK THIS AREA", "EXISTING BUILDING (NIC)", "EXISTING BUILDING - NO WORK", "LIMITED SCOPE", "EXISTING TO REMAIN"]) expect(AREA_LABEL.test(yes), yes).toBe(true);
    for (const no of ["(E) WALL", "NICHE", "EXISTING WALL", "OFFICE", "ALL EXISTING CONSTRUCTION TO REMAIN SHALL BE PATCHED, REPAIRED, AND PREP AS", "NICKEL FINISH"]) expect(AREA_LABEL.test(no), no).toBe(false);
  });
  it("an existing room's name: (E) OFFICE, (E) DISPATCH, (E) STORAGE 104 — not a wall tag, a column, an overhead door, or the first line of a split note", () => {
    for (const yes of ["(E) OFFICE", "(E) DISPATCH", "(E) STORAGE 104", "(E) DELIVERY /"]) expect(isExistingRoomName(yes), yes).toBe(true);
    // EXISTING CORRIDOR is left out on purpose: `EXISTING <word>` on the training sheets is a split note far more often than a room.
    for (const no of ["(E) WALL", "(E) COLUMN", "(E) OVERHEAD", "EXISTING FIXED", "EXISTING SIDEWALK", "EXISTING CORRIDOR", "EXISTING CEILING TO REMAIN", "OFFICE"]) expect(isExistingRoomName(no), no).toBe(false);
  });
  it("a legend row is the WHOLE short row naming the sample — never a note sentence, a heading or a furring detail", () => {
    for (const yes of ["EXISTING WALL", "EXISTING WALL TO REMAIN", "EXISTING CONSTRUCTION", "EXIST. 8\" CMU WALL", "WALL TO REMAIN"]) expect(LEGEND_EXISTING.test(yes), yes).toBe(true);
    for (const no of ["ALL EXISTING MASONRY DOOR JAMBS SCHEDULED TO RECIEVE NEW DOOR/FRAME SHALL BE PAINTED", "LINE WITH EXISTING WALLS.", "EXISTING WALL FURROUT.", "NEW & EXISTING PARTITIONS .", "EXISTING WALL OPENING DIMENSIONS MAY VARY FOR ALL"]) expect(LEGEND_EXISTING.test(no), no).toBe(false);
  });
});

describe("route 1 — a tag beside the wall", () => {
  const ask = (items: ReturnType<typeof word>[]) => existingWalls({ walls: [run], segments: [], textItems: items, widthPt: W, feetPerUnit: FPU });

  it("sets aside a wall with (E) WALL written 1 ft from it, and says so", () => {
    const got = ask([word("(E) WALL", 25, 51.5)]);
    expect(got.map((e) => [e.route, e.why])).toEqual([["tag", 'tagged "(E) WALL" 1 ft away']]);
  });
  it("a bare (E) and a split EXISTING / WALL / TO / REMAIN count; a room named (E) OFFICE and a tag 4 ft away do not", () => {
    expect(ask([word("(E)", 25, 51.5)])).toHaveLength(1);
    expect(ask([word("EXISTING", 20, 51.5), { str: "WALL TO REMAIN", x: 224, y: 515, width: 60, height: 8 }])).toHaveLength(1);
    expect(ask([word("(E) OFFICE", 25, 51.5)])).toHaveLength(0);
    expect(ask([word("(E) WALL", 25, 54.5)])).toHaveLength(0);
  });
});

describe("route 2 — an area the sheet marks NIC or existing", () => {
  // Two 10x10 ft rooms side by side with their OWN top and bottom walls, so a
  // wall can bound one room without bounding the other. Centrelines sit half
  // a thickness outside each interior.
  const c = T / 2;
  const room1 = { top: wall(-c, -c, 10 + c, -c), bottom: wall(-c, 10 + c, 10 + c, 10 + c), left: wall(-c, -c, -c, 10 + c) };
  const shared = wall(10 + c, -c, 10 + c, 10 + c);
  const room2 = { top: wall(10 + c, -c, 20 + 3 * c, -c), bottom: wall(10 + c, 10 + c, 20 + 3 * c, 10 + c), right: wall(20 + 3 * c, -c, 20 + 3 * c, 10 + c) };
  const walls = [room1.top, room1.bottom, room1.left, shared, room2.top, room2.bottom, room2.right];
  const ask = (items: ReturnType<typeof word>[]) => existingWalls({ walls, segments: [], textItems: items, widthPt: W, feetPerUnit: FPU });

  it("NIC in room 1: its three own walls are existing; the shared wall and room 2's walls are offered", () => {
    const got = ask([word("NIC", 5, 5), word("OFFICE", 15, 5)]);
    expect(got.map((e) => e.route)).toEqual(["area", "area", "area"]);
    expect(new Set(got.map((e) => e.wall))).toEqual(new Set([room1.top, room1.bottom, room1.left]));
    expect(got[0].why).toBe('bounds only "NIC" — an area the sheet marks existing or not in contract');
  });
  it("a room named (E) STORAGE marks the same way; OFFICE marks nothing; a label outside every room marks nothing", () => {
    expect(ask([word("(E) STORAGE", 5, 5)])).toHaveLength(3);
    expect(ask([word("EXISTING FIXED", 5, 5)])).toHaveLength(0);
    expect(ask([word("OFFICE", 5, 5)])).toHaveLength(0);
    expect(ask([word("NIC", 40, 40)])).toHaveLength(0);
  });
  it("NIC in BOTH rooms: every wall, the shared one included, is existing", () => {
    expect(ask([word("NIC", 5, 5), word("N.I.C.", 15, 5)])).toHaveLength(7);
  });
});

describe("route 3 — the legend's own existing-wall pen", () => {
  // The legend, far from the plan: a row's words at x = 60 ft with its drawn
  // sample 4 ft long just to the left. Baselines at 90 and 92 ft.
  const legend = [word("EXISTING WALL", 62, 90), word("NEW WALL", 62, 92)];
  const swatch = (yFt: number, pen: { gray?: number; width: number }, lines = 1): StrokeSegment[] =>
    Array.from({ length: lines }, (_, i) => ({ x1: ft(55), y1: ft(yFt - 0.4) + i * 0.002, x2: ft(59), y2: ft(yFt - 0.4) + i * 0.002, ...pen }));
  const grey = { gray: 0.6, width: 0.5 };
  const black = { gray: 0, width: 1.5 };
  const a = wall(10, 50, 40, 50);
  const b = wall(10, 60, 40, 60);
  const c = wall(10, 70, 40, 70);
  const strokes = [...swatch(90, grey), ...swatch(92, black, 2), ...faces(a, grey), ...faces(b, black), ...faces(c, { gray: 0.6, width: 1.5 })];
  const ask = (items: ReturnType<typeof word>[], segments: StrokeSegment[]) => existingWalls({ walls: [a, b, c], segments, textItems: items, widthPt: W, feetPerUnit: FPU });

  it("reads the two pens off the swatches beside the rows", () => {
    const pens = legendPens(textRows(legend), strokes, W);
    expect(pens.existing?.pen).toEqual({ gray: 0.6, width: 0.5, dashed: false });
    expect(pens.fresh?.pen).toEqual({ gray: 0, width: 1.5, dashed: false });
  });
  it("the grey 0.5 pt wall is existing; the black one is not; the GREY BUT HEAVY one is not — grey alone is never enough", () => {
    const got = ask(legend, strokes);
    expect(got.map((e) => e.wall)).toEqual([a]);
    expect(got[0].route).toBe("legend");
    expect(got[0].why).toBe('drawn with the legend\'s "EXISTING WALL" pen (grey 0.60, 0.50 pt)');
  });
  it("with no legend row nothing is read off the pens, and a legend whose two samples share a pen says nothing", () => {
    expect(ask([], strokes)).toHaveLength(0);
    const samePen = [...swatch(90, black), ...swatch(92, black), ...faces(a, black), ...faces(b, black), ...faces(c, black)];
    expect(ask(legend, samePen)).toHaveLength(0);
  });
  it("a keynote's hexagon beside a numbered note is not a swatch: six short oblique edges read no pen", () => {
    const hex = Array.from({ length: 6 }, (_, i) => {
      const a = (i * Math.PI) / 3, b = ((i + 1) * Math.PI) / 3, r = 0.004, cx = ft(58), cy = ft(89.6);
      return { x1: cx + r * Math.cos(a), y1: cy + r * Math.sin(a), x2: cx + r * Math.cos(b), y2: cy + r * Math.sin(b), gray: 0.6, width: 0.5 };
    });
    expect(legendPens(textRows([word("EXISTING WALL", 62, 90)]), hex, W).existing).toBeNull();
  });
  it("a hatched sample and a filled sample name no pen — a wall drawn as a region has no face pen to match", () => {
    const hatch = Array.from({ length: 8 }, (_, i) => ({ x1: ft(55) + i * 0.004, y1: ft(89.6) + 0.003, x2: ft(55) + i * 0.004 + 0.003, y2: ft(89.6) - 0.003, gray: 0, width: 0.24 }));
    const rows = textRows([word("EXISTING CONSTRUCTION", 62, 90)]);
    expect(legendPens(rows, [...hatch, ...swatch(90, { gray: 0, width: 0.24 })], W).existing).toBeNull();
    expect(legendPens(rows, swatch(90, { gray: 0, width: 20 }), W).existing).toBeNull();
  });
  it("reads the swatch off the PAGE's strokes when given them: the finder's list is clipped to the drawing and has no legend in it", () => {
    const got = existingWalls({ walls: [a, b, c], segments: [...faces(a, grey), ...faces(b, black), ...faces(c, black)], pageSegments: [...swatch(90, grey), ...swatch(92, black, 2)], textItems: legend, widthPt: W, feetPerUnit: FPU });
    expect(got.map((e) => e.wall)).toEqual([a]);
  });
  it("a FILLED sample — grey poché between black outlines, Murray A101's and Bunkie A100's — is matched on the fill, and a wall filled white is not", () => {
    const poche = (w: WallCandidate, fill: number) => faces(w, { gray: 0, width: 1 }).map((s) => ({ ...s, fill }));
    const page = [...swatch(90, { gray: 0, width: 1 }, 2).map((s) => ({ ...s, fill: 0.75 })), ...swatch(92, black, 2)];
    const got = existingWalls({ walls: [a, b, c], segments: [...faces(a, black), ...poche(a, 0.75), ...faces(b, black), ...faces(c, black), ...poche(c, 1)], pageSegments: page, textItems: legend, widthPt: W, feetPerUnit: FPU });
    expect(got.map((e) => [e.wall, e.why])).toEqual([[a, 'drawn with the legend\'s "EXISTING WALL" pen (filled grey 0.75)']]);
  });
  it("with no NEW WALL row the sheet's usual wall pen stands in for it: a legend pen that most walls share sets nothing aside", () => {
    const mostlyGrey = [...swatch(90, grey), ...faces(a, grey), ...faces(b, grey), ...faces(c, grey)];
    expect(ask([legend[0]], mostlyGrey)).toHaveLength(0);
    const oneGrey = [...swatch(90, grey), ...faces(a, grey), ...faces(b, black), ...faces(c, black)];
    expect(ask([legend[0]], oneGrey).map((e) => e.wall)).toEqual([a]);
  });
});

describe("offeredCandidates: the `existing` kind", () => {
  const sheet = (textItems?: ReturnType<typeof word>[]) => ({ walls: [run], segments: [], widthPt: W, feetPerUnit: FPU, planBoxes: null, textItems });

  it("a framed legend keeps its frame: the EXISTING WALL row beside the left upright does not take it from `legend-box`, and the samples inside stay set aside", () => {
    // A 10 x 8 ft frame at x 60..70, y 80..88 with "LEGEND" in large type in
    // its top band, the row "EXISTING WALL" 1 ft inside the left upright, and
    // a 4 ft wall sample inside it.
    const left = wall(60, 80, 60, 88), right = wall(70, 80, 70, 88), top = wall(60, 80, 70, 80), bottom = wall(60, 88, 70, 88);
    const sample = wall(63, 84, 67, 84);
    const items = [{ str: "LEGEND", x: 630, y: 815, width: 40, height: 14 }, { ...word("EXISTING WALL", 63, 840), x: 605, y: 840, width: 50 }, word("OFFICE", 30, 30)];
    const got = offeredCandidates({ walls: [left, right, top, bottom, sample, run], segments: [], widthPt: W, feetPerUnit: FPU, planBoxes: null, textItems: items });
    expect(got.setAside.map((a) => [a.kind, a.n])).toEqual([["legend-box", 5]]);
    expect(got.candidates).toHaveLength(1);
  });
  it("sets the tagged wall aside under `existing` with the tag's words, and offers it without the words", () => {
    const got = offeredCandidates(sheet([word("(E) WALL", 25, 51.5)]));
    expect(got.candidates).toEqual([]);
    expect(got.setAside).toEqual([{ kind: "existing", why: "1 tagged (E) or EXISTING beside the wall — existing work, not a wall to take off", n: 1 }]);
    expect(got.setAsideLines.map((l) => [l.kind, l.why, l.lengthFeet])).toEqual([["existing", 'tagged "(E) WALL" 1 ft away', 30]]);
    expect(got.offPlanPaired).toBe(0);
    expect(offeredCandidates(sheet()).candidates).toHaveLength(1);
  });
});
