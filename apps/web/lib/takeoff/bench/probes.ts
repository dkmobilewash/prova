import { Buffer } from "node:buffer";
import { recipeInputsFromMeasurements, type StoredMeasurement } from "../../takeoff-plan";
import { scheduleLines } from "../../wall-assemblies";
import { scaleFromDimensions } from "../scaleFromDimensions";
import { scaleFromPrinted } from "../scaleFromPrinted";
import { sheetStrokes } from "../sheetStrokes";
import { clusterByThickness, type StrokeSegment } from "../wallVectors";
import { wallsFromBothEngines } from "../wallRuns";
import { wallTypeInputs } from "./harness";
import type { Prim, Sheet } from "./sheets";
import { writePdf, type PdfOptions } from "./writers";

/**
 * MECHANISM PROBES: each one isolates ONE heuristic with the smallest input that
 * can show it, and calls the product function directly. The full bench says
 * WHAT went wrong on a drawing; these say WHY, with nothing else on the page.
 *
 * `holds` is the honest outcome a correct takeoff needs. A probe that does not
 * hold is a confirmed defect, and its `observed` is the product's own output.
 */

export type Probe = { id: string; heuristic: string; input: string; expected: string; observed: string; holds: boolean };

const FPP = 1 / 9; // 1/8" = 1'-0": 9 points to the foot
const ft = (x: number) => x * 9;

/** Two faces of a horizontal wall at y, thickness in inches, from x0 to x1 feet. */
function wall(x0: number, x1: number, y: number, tIn: number): StrokeSegment[] {
  const half = ft(tIn / 24);
  return [
    { x1: ft(x0), y1: ft(y) - half, x2: ft(x1), y2: ft(y) - half },
    { x1: ft(x0), y1: ft(y) + half, x2: ft(x1), y2: ft(y) + half },
  ];
}

/** The product's own entry point, as the viewer calls it, on a 36x24 page in points. */
const find = (segs: StrokeSegment[]) => wallsFromBothEngines(segs, 2592, 1728, { feetPerPoint: FPP });
const sumFt = (segs: StrokeSegment[]) => find(segs).reduce((s, w) => s + w.lengthFeet, 0);

function tinyPdf(prims: Prim[], o: PdfOptions): Buffer {
  const sheet: Sheet = { id: "P", title: "P", widthPt: 1224, heightPt: 792, prims, views: [], printedScale: "", traps: [], expectWalls: true };
  return writePdf(sheet, prims, o);
}

const face = (x1: number, y1: number, x2: number, y2: number, extra: Partial<Extract<Prim, { k: "path" }>> = {}): Prim => ({
  k: "path",
  pts: [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ],
  w: 0.7,
  role: "wall",
  layer: "A-WALL",
  ...extra,
});

export async function runProbes(): Promise<Probe[]> {
  const out: Probe[] = [];
  const add = (p: Probe) => out.push(p);

  const base = sumFt(wall(0, 20, 10, 4.875));
  add({ id: "P1", heuristic: "control", input: "one 20' A1 wall, two faces", expected: "20.0 ft", observed: `${base.toFixed(1)} ft`, holds: Math.abs(base - 20) < 0.05 });

  const grid = sumFt([...wall(0, 20, 10, 4.875), { x1: ft(-10), y1: ft(10 + 8 / 12), x2: ft(60), y2: ft(10 + 8 / 12) }]);
  add({
    id: "P2",
    heuristic: "inAHatchSeries (SERIES_REACH 2.5)",
    input: "the same wall + a gridline 8\" off its centreline (parallel, 70' long)",
    expected: "20.0 ft — a gridline is not a third wall face",
    observed: `${grid.toFixed(1)} ft`,
    holds: Math.abs(grid - 20) < 0.05,
  });

  const tick = sumFt([...wall(0, 20, 10, 4.875), { x1: ft(9.7), y1: ft(10 + 0.6), x2: ft(10.3), y2: ft(10 + 0.6) }]);
  add({
    id: "P3",
    heuristic: "inAHatchSeries — no length floor on the third line",
    input: "the same wall + one 6\"-long tick parallel to it, 7\" off centre (a tag edge, a door-leaf end, a letter)",
    expected: "20.0 ft",
    observed: `${tick.toFixed(1)} ft`,
    holds: Math.abs(tick - 20) < 0.05,
  });

  const dup = sumFt([...wall(0, 20, 10, 4.875), ...wall(0, 20, 10, 4.875)]);
  add({
    id: "P4",
    heuristic: "duplicate strokes (wallsFromBothEngines + mergeWalls)",
    input: "the same wall with every face stroked twice (fill boundary + stroke, a Revit habit)",
    expected: "20.0 ft",
    observed: `${dup.toFixed(1)} ft`,
    holds: Math.abs(dup - 20) < 0.05,
  });

  const half = ft(4.875 / 24);
  const tSegs: StrokeSegment[] = [
    { x1: 0, y1: ft(10) - half, x2: ft(30), y2: ft(10) - half },
    { x1: 0, y1: ft(10) + half, x2: ft(9.8), y2: ft(10) + half },
    { x1: ft(10.2), y1: ft(10) + half, x2: ft(30), y2: ft(10) + half },
  ];
  const tee = sumFt(tSegs);
  add({
    id: "P5",
    heuristic: "one-face-one-use + 3x face ratio at a T junction",
    input: "30' wall whose top face is broken at 10' by a branch (5\" gap), bottom face continuous",
    expected: "~29.6-30 ft",
    observed: `${tee.toFixed(1)} ft`,
    holds: tee > 29,
  });

  const furr = sumFt(wall(0, 20, 10, 1.5));
  add({ id: "P6", heuristic: "minThicknessFeet 0.2", input: "20' of F1 furring, 1-1/2\" (hat channel + 5/8\" board)", expected: "20.0 ft", observed: `${furr.toFixed(1)} ft`, holds: Math.abs(furr - 20) < 0.05 });

  // Readers: a 40' wall at 1/8" (360pt) through each PDF structure.
  const w40 = [face(100, 400, 460, 400, { inst: "BLK" }), face(100, 403.656, 460, 403.656, { inst: "BLK" })];
  const lenOf = async (prims: Prim[], o: PdfOptions) => {
    const s = await sheetStrokes(tinyPdf(prims, o), 1);
    return { segs: s.segments.length, longest: Math.max(0, ...s.segments.map((g) => Math.hypot(g.x2 - g.x1, g.y2 - g.y1))) };
  };
  const plain = await lenOf(w40, {});
  const form = await lenOf(w40, { forms: true });
  add({
    id: "P7",
    heuristic: "sheetStrokes CTM: Form XObject /Matrix",
    input: "a 360pt wall face drawn inside a Form XObject whose /Matrix is [1/8 0 0 1/8 …] (AutoCAD block)",
    expected: "360 pt",
    observed: `${form.longest.toFixed(1)} pt (plain: ${plain.longest.toFixed(1)} pt)`,
    holds: Math.abs(form.longest - 360) < 1,
  });

  const hidden = await lenOf([face(100, 400, 460, 400, { layer: "OFF" }), face(100, 403.656, 460, 403.656, { layer: "OFF" })], { ocg: { off: ["OFF"], on: [] } });
  add({ id: "P8", heuristic: "sheetStrokes ignores optional content", input: "a wall on an optional-content layer that is OFF", expected: "0 segments", observed: `${hidden.segs} segments`, holds: hidden.segs === 0 });

  const clipped = await lenOf(w40, { clip: [0, 0, 200, 792] });
  add({
    id: "P9",
    heuristic: "sheetStrokes ignores the clip path",
    input: "the 360pt wall under a clip that shows only x < 200",
    expected: "faces of at most 100pt; the clip rectangle is not geometry",
    observed: `${clipped.segs} segments, longest ${clipped.longest.toFixed(1)} pt`,
    holds: clipped.longest <= 101 && clipped.segs <= 2,
  });

  const dashed = await lenOf([face(100, 400, 460, 400, { dash: [6, 4] }), face(100, 403.656, 460, 403.656, { dash: [6, 4] })], {});
  add({ id: "P10", heuristic: "sheetStrokes ignores the dash pattern", input: "a wall drawn dashed (existing to be demolished)", expected: "recognisably not a solid wall", observed: `${dashed.segs} solid segments of ${dashed.longest.toFixed(0)} pt`, holds: dashed.segs !== 2 });

  // Scale.
  const printedHalf = scaleFromPrinted(['1/8" = 1\'-0"'], 18 * 72, 12 * 72);
  add({
    id: "P11",
    heuristic: "scaleFromPrinted half-size guard (standardSheetSize)",
    input: "title block says 1/8\" on an 18x12 page (an ARCH D printed at exactly half size)",
    expected: "decline — half of ARCH D is ARCH B, so the page size cannot prove full size",
    observed: printedHalf ? `returns ${printedHalf.scaleName} (2x wrong on every quantity)` : "declines",
    holds: printedHalf === null,
  });
  const printed1117 = scaleFromPrinted(['1/8" = 1\'-0"'], 17 * 72, 11 * 72);
  add({
    id: "P12",
    heuristic: "scaleFromPrinted half-size guard",
    input: "title block says 1/8\" on an 11x17 page (ARCH D fitted to tabloid)",
    expected: "decline",
    observed: printed1117 ? `returns ${printed1117.scaleName} (2.12x wrong)` : "declines",
    holds: printed1117 === null,
  });
  const bays = Array.from({ length: 8 }, (_, i) => ({ text: "30'-0\"", feet: 30, x: 100 + i * 270 + 135, y: 500 - 3 }));
  const baySegs = Array.from({ length: 8 }, (_, i) => ({ x1: 100 + i * 270, y1: 500, x2: 100 + (i + 1) * 270, y2: 500 }));
  const v = scaleFromDimensions(bays, baySegs, { pageWidthPt: 2592 });
  add({
    id: "P13",
    heuristic: "scale vote counts DISTINCT label text",
    input: "eight 30'-0\" bay dimensions, each exactly 270pt (1/8\")",
    expected: "1/8\" = 1'-0\" (eight independent agreeing dimensions)",
    observed: v.ok ? v.scaleName : `declines: ${v.reason}`,
    holds: v.ok,
  });

  // Clustering and posting.
  const a1 = find(wall(0, 20, 10, 4.875));
  const c1 = find(wall(0, 20, 30, 4.75));
  const clusters = clusterByThickness([...a1, ...c1]);
  add({
    id: "P14",
    heuristic: "clusterByThickness (CLUSTER_INCHES 0.5)",
    input: "an A1 partition (4-7/8\") and a C1 shaft wall (4-3/4\")",
    expected: "two groups — different assemblies, different prices",
    observed: `${clusters.length} group(s)`,
    holds: clusters.length === 2,
  });

  const stored: StoredMeasurement[] = Array.from({ length: 10 }, (_, i) => ({
    kind: "LINEAR",
    xs: [0, 10 / 288],
    ys: [i * 0.01, i * 0.01],
    label: null,
    calibration: { x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: 288 },
  }));
  const posted = recipeInputsFromMeasurements("wall", stored, { heightFt: 10, sides: 2, openings: [] });
  const types = wallTypeInputs();
  const merged = posted.ok && posted.inputs[0].kind === "wall" ? scheduleLines([{ id: "m", label: "m", wallTypeId: "A1", lengthFt: posted.inputs[0].wall.lengthFt, heightFt: 10, openings: [] }], types) : null;
  const separate = scheduleLines(Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, label: "r", wallTypeId: "A1", lengthFt: 10, heightFt: 10, openings: [] })), types);
  const studs = (s: ReturnType<typeof scheduleLines> | null) => s?.lines.find((l) => l.componentId === "A1:studs")?.quantity ?? 0;
  add({
    id: "P15",
    heuristic: "postMeasuredWallRun sums an accepted group into ONE run",
    input: "ten separate 10' walls accepted as one found-walls group",
    expected: `${studs(separate)} studs (each run has its own end stud)`,
    observed: `${studs(merged)} studs`,
    holds: studs(merged) === studs(separate),
  });

  return out;
}
