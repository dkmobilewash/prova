import { ARCHITECTURAL_SCALES } from "../scaleFromDimensions";
import {
  PARTITION_TYPES,
  add,
  centrelineLength,
  dot,
  drawWall,
  len,
  mul,
  normal,
  openingsIn,
  spanOverlap,
  sub,
  thicknessFt,
  unit,
  type Level,
  type Pt,
  type TypeCode,
  type Wall,
} from "./model";
import { ARCH_D, bidSet, doorSchedule, windowSchedule, DOOR_COLUMNS, WINDOW_COLUMNS, type Prim, type Sheet, type View } from "./sheets";
import { flattenBez, outlineText, type PdfOptions } from "./writers";

/**
 * EXPORT VARIANTS AND THE ANSWER KEY.
 *
 * A variant is the same drawing written a different way. Each one names the
 * heuristic or code path it is aimed at, so a failure reads as a cause.
 *
 * THE ANSWER KEY IS COMPUTED HERE FROM THE MODEL AND THE VARIANT'S OWN SPEC —
 * where a view puts building feet on paper, and where the variant puts paper on
 * the displayed page — and never from reading a PDF back. The display mapping is
 * written out by hand (see `displayMap`) rather than borrowed from pdfjs, so a
 * reader bug cannot cancel against the grading and read as a pass.
 */

export type Producer = "raw" | "skia";

export type Variant = {
  id: string;
  label: string;
  producer: Producer;
  /** The heuristic or code path this variant is aimed at. */
  targets: string;
  transform?: (prims: Prim[], sheet: Sheet) => Prim[];
  pdf?: (sheet: Sheet) => PdfOptions;
  /** How the expected scale changes: a print factor, or "the reader cannot know". */
  scaleEffect?: { printFactor?: number; undetermined?: "scan" | "outlines" };
  /** The viewport clip, in paper points, if any. */
  clip?: (sheet: Sheet) => [number, number, number, number];
};

const isTitle = (p: Prim) => p.role === "border" || p.role === "titleblock";

/** Faces broken into short collinear pieces, staggered between the two faces. */
function splitFaces(prims: Prim[]): Prim[] {
  let seed = 11;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const out: Prim[] = [];
  for (const p of prims) {
    if (p.k !== "path" || p.role !== "wall" || p.pts.length !== 2) {
      out.push(p);
      continue;
    }
    const [a, b] = p.pts;
    const L = len(sub(b, a));
    const u = unit(sub(b, a));
    let s = 0;
    while (s < L) {
      const piece = Math.min(L - s, 13 + rnd() * 40);
      out.push({ ...p, pts: [add(a, mul(u, s)), add(a, mul(u, s + piece))] });
      s += piece;
    }
  }
  return out;
}

/** Revit "cut pattern": each wall drawn as a filled closed polygon per piece,
 *  plus the same faces again as separate strokes (overlapping duplicates). */
function revitStyle(prims: Prim[]): Prim[] {
  const out: Prim[] = [];
  const byWall = new Map<string, Prim[]>();
  for (const p of prims) {
    if (p.k === "path" && p.role === "wall" && p.wallId && p.pts.length === 2) {
      const list = byWall.get(p.wallId) ?? [];
      list.push(p);
      byWall.set(p.wallId, list);
    }
  }
  for (const p of prims) {
    if (p.k === "path" && p.layer === "A-WALL-PATT") continue; // poché replaces hatch
    out.push(p);
  }
  // The fill: one closed polygon per wall from its two outermost face runs.
  for (const [, faces] of byWall) {
    const longest = [...faces].sort((a, b) => lenOf(b) - lenOf(a));
    const a = longest[0];
    const partner = longest.find((q) => q !== a && Math.abs(angleOf(q) - angleOf(a)) < 0.01 && perp(a, q) > 0.5);
    if (!partner || a.k !== "path" || partner.k !== "path") continue;
    const [p1, p2] = a.pts;
    const q = partner.pts;
    const [q1, q2] = dot(sub(q[1], q[0]), sub(p2, p1)) > 0 ? [q[0], q[1]] : [q[1], q[0]];
    out.push({ k: "path", pts: [p1, p2, q2, q1], closed: true, w: 0, fill: 0.55, stroke: false, role: "hatch", layer: "A-WALL-PATT" });
  }
  return splitFaces(out);
}

const lenOf = (p: Prim) => (p.k === "path" ? len(sub(p.pts[1], p.pts[0])) : 0);
const angleOf = (p: Prim) => (p.k === "path" ? ((Math.atan2(p.pts[1].y - p.pts[0].y, p.pts[1].x - p.pts[0].x) % Math.PI) + Math.PI) % Math.PI : 0);
const perp = (a: Prim, b: Prim) => {
  if (a.k !== "path" || b.k !== "path") return 0;
  const u = unit(sub(a.pts[1], a.pts[0]));
  return Math.abs(dot(sub(b.pts[0], a.pts[0]), normal(u)));
};

/** AutoCAD: arcs exported as chords, linetypes exploded into dash segments. */
function autocadStyle(prims: Prim[]): Prim[] {
  const out: Prim[] = [];
  for (const p of prims) {
    if (p.k === "bez" && p.role === "wall") {
      const pts = flattenBez(p.start, p.segs, 6);
      for (let i = 0; i < pts.length - 1; i += 1) out.push({ k: "path", pts: [pts[i], pts[i + 1]], w: p.w, role: p.role, layer: p.layer, wallId: p.wallId });
      continue;
    }
    if (p.k === "path" && p.dash && p.pts.length === 2) {
      const [a, b] = p.pts;
      const L = len(sub(b, a));
      const u = unit(sub(b, a));
      let s = 0;
      let i = 0;
      while (s < L) {
        const d = p.dash[i % p.dash.length];
        if (i % 2 === 0) out.push({ ...p, dash: undefined, pts: [add(a, mul(u, s)), add(a, mul(u, Math.min(L, s + d)))] });
        s += d;
        i += 1;
      }
      continue;
    }
    out.push(p);
  }
  return out;
}

const textToOutlines = (prims: Prim[]) => prims.flatMap((p) => (p.k === "text" ? outlineText(p) : [p]));
const plotToBlack = (prims: Prim[]) =>
  prims.map((p) => (p.k === "text" ? p : { ...p, w: p.k === "path" && p.stroke === false ? 0 : 0.5, gray: undefined, ...(p.k === "path" && p.fill !== undefined ? { fill: 0 } : {}) }));

/** Primitives OUTSIDE the CropBox of the rotated variant: a plot stamp and a
 *  pair of stray wall-like lines that a viewer never shows. */
function outsideCrop(sheet: Sheet): Prim[] {
  const x = sheet.widthPt + 20;
  return [
    { k: "path", pts: [{ x, y: 200 }, { x, y: 900 }], w: 0.7, role: "stray", layer: "STRAY" },
    { k: "path", pts: [{ x: x + 4, y: 200 }, { x: x + 4, y: 900 }], w: 0.7, role: "stray", layer: "STRAY" },
    { k: "text", at: { x, y: 100 }, s: "PLOTTED 08/04/2026 3:14 PM", size: 6, role: "stray", layer: "STRAY" },
  ];
}

export const VARIANTS: Variant[] = [
  { id: "clean", label: "Clean vector export", producer: "raw", targets: "baseline: every heuristic on well-formed input" },
  {
    id: "revit",
    label: "Revit-style: filled wall polygons, poché, duplicate strokes, faces in short collinear pieces",
    producer: "raw",
    targets: "wallsFromStrokes: each face used once (duplicates pair with each other's partners), overlap >= 50% of the shorter face, 2ft input floor on pieces",
    transform: (p) => revitStyle(p),
  },
  {
    id: "autocad",
    label: "AutoCAD-style: blocks as nested Form XObjects with /Matrix, plan as an xref at 0.5 inside a 2x viewport, arcs as chords, linetypes exploded",
    producer: "raw",
    targets: "sheetStrokes CTM stack: Form XObject /Matrix arrives as paintFormXObjectBegin, not as a `cm`",
    transform: (p) => autocadStyle(p),
    pdf: () => ({ forms: true, xref: { k: 4 }, compress: true }),
  },
  {
    id: "autocad-flat",
    label: "AutoCAD-style content WITHOUT Form XObjects: arcs as chords, linetypes exploded into dash segments",
    producer: "raw",
    targets: "the curved wall as chords (does pairing recover it?); exploded linetypes (dash segments vs the 2 ft input floor); isolates these from the Form /Matrix defect",
    transform: (p) => autocadStyle(p),
    pdf: () => ({ compress: true }),
  },
  {
    id: "shx",
    label: "Text as vector outlines (SHX), no text layer at all",
    producer: "raw",
    targets: "dimensionLabels has nothing to read; hasTextLayer; wallsNotLettering has no text boxes",
    transform: textToOutlines,
    scaleEffect: { undetermined: "outlines" },
  },
  {
    id: "rotate",
    label: "/Rotate 90, portrait MediaBox, CropBox off the origin, strays outside the crop",
    producer: "raw",
    targets: "viewport transform with rotation and a CropBox origin; content outside the CropBox",
    pdf: (s) => ({ rotate90: { margin: 72 }, outsideCrop: outsideCrop(s) }),
  },
  {
    id: "half-11x17",
    label: "ARCH D fitted onto 11x17 (0.472x): title block still says 1/8\" = 1'-0\"",
    producer: "raw",
    targets: "scale vote snap (2%), printed-scale fallback sheet-size guard (ANSI B is a 'standard' size)",
    pdf: () => ({ printAt: { scale: 17 / 36, widthPt: 17 * 72, heightPt: 11 * 72 } }),
    scaleEffect: { printFactor: 17 / 36 },
  },
  {
    id: "half-archB",
    label: "ARCH D at exactly half size onto ARCH B 18x12: title block still says 1/8\" = 1'-0\"",
    producer: "raw",
    targets: "printed-scale half-size guard: half of ARCH D IS a standard sheet (ARCH B)",
    pdf: () => ({ printAt: { scale: 0.5, widthPt: 18 * 72, heightPt: 12 * 72 } }),
    scaleEffect: { printFactor: 0.5 },
  },
  {
    id: "half-archB-outlines",
    label: "Half-size ARCH B AND drawing-area lettering saved as outlines (title block still real text)",
    producer: "raw",
    targets: "printed-scale fallback when no dimension can be read on a half-size print",
    transform: (p) => p.flatMap((q) => (q.k === "text" && !isTitle(q) ? outlineText(q) : [q])),
    pdf: () => ({ printAt: { scale: 0.5, widthPt: 18 * 72, heightPt: 12 * 72 } }),
    scaleEffect: { printFactor: 0.5 },
  },
  {
    id: "overridden-dims",
    label: "Overridden dimension text: wrong values, EQ, VERIFY, +/-",
    producer: "raw",
    targets: "scale vote: distinct labels, 3 to agree, 2x margin over the runner-up",
  },
  {
    id: "ocg",
    label: "Optional content: walls on a layer that is OFF, furniture on a layer that is ON",
    producer: "raw",
    targets: "getOperatorList returns hidden optional content; sheetStrokes does not read OC state",
    pdf: () => ({ ocg: { off: ["A-WALL-HIDN"], on: ["A-FURN"] } }),
  },
  {
    id: "clip",
    label: "Viewport clip path hides the east third of the plan",
    producer: "raw",
    targets: "sheetStrokes ignores clipping (W n) and reads the clip rectangle itself as four segments",
    pdf: (s) => ({ clip: clipRect(s) }),
    clip: (s) => clipRect(s),
  },
  {
    id: "dashed",
    label: "Existing walls to be demolished drawn dashed; gridlines dash-dot",
    producer: "raw",
    targets: "sheetStrokes ignores the dash pattern: a dashed wall reads as a solid one",
  },
  {
    id: "plot-black",
    label: "Plot to black: one line weight, no grey",
    producer: "raw",
    targets: "control — nothing in the shipped pipeline reads the pen since #671",
    transform: plotToBlack,
  },
  {
    id: "scan",
    label: "Scanned raster: image only, 0.6 degree skew, noise",
    producer: "raw",
    targets: "no vector strokes, no text layer: the honest refusal",
    pdf: () => ({ raster: { dpi: 100, skewDeg: 0.6, noise: 0.004, seed: 3 }, compress: true }),
    scaleEffect: { undetermined: "scan" },
  },
  { id: "skia", label: "Chromium/Skia PDF producer (from SVG)", producer: "skia", targets: "a second, unrelated PDF writer's structure" },
];

function clipRect(sheet: Sheet): [number, number, number, number] {
  const v = sheet.views[0];
  const x1 = v ? v.origin.x + 140 * v.ptPerFt : sheet.widthPt;
  return [40, 40, x1, sheet.heightPt - 40];
}

/** Which variants run on which sheets. Everything runs clean and through Skia;
 *  the plans carry the full matrix. */
export function variantsFor(sheetId: string): string[] {
  const core = ["clean", "revit", "autocad", "skia"];
  switch (sheetId) {
    case "A-101":
      return VARIANTS.map((v) => v.id);
    case "A-102":
      return [...core, "autocad-flat", "rotate", "clip", "half-archB"];
    case "A-401":
      return [...core, "overridden-dims", "half-11x17"];
    case "M-101":
      return [...core, "plot-black"];
    case "A-101-REV1":
      return ["clean"];
    default:
      return core;
  }
}

// ── DISPLAY MAPPING ────────────────────────────────────────────────────────────

/**
 * Paper point → the page AS DISPLAYED (pdfjs viewport space: y down, rotation
 * applied), and the displayed width. Written from the PDF model directly:
 * rotation 0 maps (x, y) to (x - crop.x0, crop.y1 - y); this file's /Rotate 90
 * variant draws landscape content under `0 1 -1 0 H+m m cm` in a portrait box,
 * which displays as (x, H - y).
 */
export function displayMap(sheet: Sheet, v: Variant): { map: (pt: Pt) => Pt; inv: (pt: Pt) => Pt; widthPt: number; heightPt: number } {
  const W = sheet.widthPt;
  const H = sheet.heightPt;
  const opts = v.pdf?.(sheet) ?? {};
  if (opts.printAt) {
    const { scale, widthPt, heightPt } = opts.printAt;
    const ox = (widthPt - W * scale) / 2;
    const oy = (heightPt - H * scale) / 2;
    return {
      map: (pt) => ({ x: ox + scale * pt.x, y: heightPt - (oy + scale * pt.y) }),
      inv: (d) => ({ x: (d.x - ox) / scale, y: (heightPt - d.y - oy) / scale }),
      widthPt,
      heightPt,
    };
  }
  return { map: (pt) => ({ x: pt.x, y: H - pt.y }), inv: (d) => ({ x: d.x, y: H - d.y }), widthPt: W, heightPt: H };
}

// ── THE ANSWER KEY ─────────────────────────────────────────────────────────────

export type KeyWall = {
  id: string;
  type: TypeCode;
  inScope: boolean;
  thicknessIn: number;
  heightFt: number;
  view: string;
  viewScale: string | null;
  /** Feet of building per page-width unit in this wall's view, after the variant. */
  trueFeetPerUnit: number;
  /** Centreline in page-width units on the displayed page. */
  display: { x1: number; y1: number; x2: number; y2: number } | null;
  arc: { cx: number; cy: number; r: number; a0: number; a1: number } | null;
  /** CENTRELINE length, feet — the estimator's convention. */
  clFt: number;
  /** What a perfect two-face pair-finder can claim: the overlap of the two
   *  outer faces' drawn spans, feet. The other convention. */
  faceOverlapFt: number;
  /** Centreline minus every opening width. */
  netFt: number;
  openings: { mark: string; kind: string; widthFt: number; heightFt: number }[];
  /** Board area per side, openings >= 32 SF deducted (the app's rule). */
  areaPerSideSf: number;
  /** Should a takeoff of THIS sheet count it? */
  count: boolean;
  /** Is it part of the bid totals (enlarged plans repeat the floor plan)? */
  bid: boolean;
  whyNot: string | null;
  note: string | null;
};

export type ScaleExpectation = {
  view: string;
  /** The standard scale a correct reader names, or null when no standard scale fits. */
  scaleName: string | null;
  feetPerInch: number | null;
};

export type CaseKey = {
  caseId: string;
  sheetId: string;
  variant: string;
  producer: Producer;
  title: string;
  targets: string;
  displayWidthPt: number;
  displayHeightPt: number;
  expectWalls: boolean;
  traps: string[];
  scales: ScaleExpectation[];
  /** What a correct pipeline does about scale on this case. */
  scaleBehaviour: "name-it" | "decline-or-flag" | "decline";
  expectedRefusal: string | null;
  walls: KeyWall[];
  schedules?: { door: { columns: string[]; rows: Record<string, string>[] }; window: { columns: string[]; rows: Record<string, string>[] } };
};

const nearestStandard = (feetPerInch: number) =>
  ARCHITECTURAL_SCALES.find((s) => Math.abs(feetPerInch - s.feetPerInch) / s.feetPerInch <= 0.02) ?? null;

const scaleFeetPerInch = (name: string | null) => (name === null ? null : ARCHITECTURAL_SCALES.find((s) => s.name === name)?.feetPerInch ?? null);

/** Clip a segment (feet) to a box; returns params [t0, t1] along it or null. */
function clipParams(a: Pt, b: Pt, box: [number, number, number, number]): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const d = sub(b, a);
  const checks: [number, number][] = [
    [-d.x, a.x - box[0]],
    [d.x, box[2] - a.x],
    [-d.y, a.y - box[1]],
    [d.y, box[3] - a.y],
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
  }
  return t1 - t0 > 1e-6 ? [t0, t1] : null;
}

export function keyWallsForView(sheet: Sheet, view: View, variant: Variant, bid: boolean): KeyWall[] {
  const level = view.level;
  if (!level) return [];
  const dm = displayMap(sheet, variant);
  const toUnits = (pt: Pt) => {
    const d = dm.map({ x: view.origin.x + pt.x * view.ptPerFt, y: view.origin.y + pt.y * view.ptPerFt });
    return { x: d.x / dm.widthPt, y: d.y / dm.widthPt };
  };
  const scale = variant.pdf?.(sheet).printAt?.scale ?? 1;
  // Page-width units per foot = ptPerFt * scale / displayWidth.
  const trueFeetPerUnit = dm.widthPt / (view.ptPerFt * scale);
  const clip = variant.clip?.(sheet);
  const clipFeet: [number, number, number, number] | null = clip
    ? [(clip[0] - view.origin.x) / view.ptPerFt, (clip[1] - view.origin.y) / view.ptPerFt, (clip[2] - view.origin.x) / view.ptPerFt, (clip[3] - view.origin.y) / view.ptPerFt]
    : null;

  const extra = (view.extraWalls ?? []).filter((w) => (w.demo ? variant.id === "dashed" : w.hiddenLayer ? variant.id === "ocg" : true));
  const out: KeyWall[] = [];
  for (const w of [...level.walls, ...extra]) {
    const type = PARTITION_TYPES[w.type];
    const base = {
      id: w.id,
      type: w.type,
      inScope: type.inScope,
      thicknessIn: type.thicknessIn,
      heightFt: w.heightFt,
      view: view.name,
      viewScale: view.scaleName,
      trueFeetPerUnit,
      note: w.note ?? null,
    };
    if (w.arc) {
      if (!(w.arc.c.x >= view.box[0] && w.arc.c.x <= view.box[2] && w.arc.c.y >= view.box[1] && w.arc.c.y <= view.box[3])) continue;
      const c = toUnits(w.arc.c);
      const cl = centrelineLength(w);
      out.push({
        ...base,
        display: null,
        // Display is y-down, so a CCW arc in building space runs CW on screen.
        arc: { cx: c.x, cy: c.y, r: w.arc.r / trueFeetPerUnit, a0: -w.arc.a1, a1: -w.arc.a0 },
        clFt: cl,
        faceOverlapFt: cl,
        netFt: cl,
        openings: [],
        areaPerSideSf: cl * w.heightFt,
        count: view.wallsAreScope,
        bid,
        whyNot: view.wallsAreScope ? null : "repeated from the floor plan",
      });
      continue;
    }
    const range = clipParams(w.a, w.b, view.box);
    if (range === null) continue;
    let [t0, t1] = range;
    let outsideClip = false;
    if (clipFeet) {
      const r2 = clipParams(w.a, w.b, clipFeet);
      if (r2 === null) outsideClip = true;
      else [t0, t1] = [Math.max(t0, r2[0]), Math.min(t1, r2[1])];
      if (t1 <= t0) outsideClip = true;
    }
    const L = len(sub(w.b, w.a));
    const u = unit(sub(w.b, w.a));
    const a = add(w.a, mul(u, t0 * L));
    const b = add(w.a, mul(u, t1 * L));
    const cl = (t1 - t0) * L;
    const d = drawWall(w, level, extra);
    const clipSpans = (spans: [number, number][]) => spans.map(([s, e]) => [Math.max(s, t0 * L), Math.min(e, t1 * L)] as [number, number]).filter(([s, e]) => e > s);
    const faceOverlapFt = spanOverlap(clipSpans(d.faceSpans[0]), clipSpans(d.faceSpans[1]));
    const ops = openingsIn(w, level).filter((o) => {
      const along = dot(sub(o.at, w.a), u);
      return along >= t0 * L && along <= t1 * L;
    });
    const openArea = ops.map((o) => o.widthFt * o.heightFt).filter((x) => x >= 32).reduce((s2, x) => s2 + x, 0);
    const A = toUnits(a);
    const B = toUnits(b);
    const whyNot = w.demo
      ? "existing to be demolished (dashed)"
      : w.hiddenLayer
        ? "on an optional-content layer that is OFF"
        : outsideClip
          ? "outside the viewport clip"
          : !view.wallsAreScope
            ? "repeated from the floor plan"
            : null;
    out.push({
      ...base,
      display: { x1: A.x, y1: A.y, x2: B.x, y2: B.y },
      arc: null,
      clFt: cl,
      faceOverlapFt,
      netFt: cl - ops.reduce((s2, o) => s2 + o.widthFt, 0),
      openings: ops.map((o) => ({ mark: o.mark, kind: o.kind, widthFt: o.widthFt, heightFt: o.heightFt })),
      areaPerSideSf: Math.max(0, cl * w.heightFt - openArea),
      count: whyNot === null,
      bid: bid && whyNot === null,
      whyNot,
    });
    void thicknessFt;
  }
  return out;
}

export function buildKey(sheet: Sheet, variant: Variant): CaseKey {
  const dm = displayMap(sheet, variant);
  const factor = variant.scaleEffect?.printFactor ?? 1;
  const scales: ScaleExpectation[] = sheet.views
    .filter((v) => v.level || v.scaleName)
    .map((v) => {
      const fpi = scaleFeetPerInch(v.scaleName);
      if (fpi === null) return { view: v.name, scaleName: null, feetPerInch: null };
      const onPaper = fpi / factor;
      const std = nearestStandard(onPaper);
      return { view: v.name, scaleName: std?.name ?? null, feetPerInch: onPaper };
    });
  if (sheet.id === "A-501") scales.push({ view: "PARTITION TYPES", scaleName: '3" = 1\'-0"', feetPerInch: 1 / 3 });
  const distinct = new Set(scales.map((s) => s.scaleName));
  let scaleBehaviour: CaseKey["scaleBehaviour"];
  let expectedRefusal: string | null = null;
  if (variant.scaleEffect?.undetermined) {
    scaleBehaviour = "decline";
    expectedRefusal = variant.scaleEffect.undetermined === "scan" ? "a scan: no vector strokes, no text layer" : "lettering saved as line work: no readable dimensions";
  } else if (scales.length === 0 || scales.every((s) => s.scaleName === null)) {
    scaleBehaviour = "decline";
  } else if (distinct.size > 1) {
    scaleBehaviour = "decline-or-flag";
  } else {
    scaleBehaviour = "name-it";
  }
  const bidSheet = sheet.id === "A-101" || sheet.id === "A-102" || sheet.id === "A-101-REV1";
  const walls = sheet.views.flatMap((v) => keyWallsForView(sheet, v, variant, bidSheet));
  return {
    caseId: `${sheet.id}__${variant.id}`,
    sheetId: sheet.id,
    variant: variant.id,
    producer: variant.producer,
    title: sheet.title,
    targets: variant.targets,
    displayWidthPt: dm.widthPt,
    displayHeightPt: dm.heightPt,
    expectWalls: sheet.expectWalls,
    traps: sheet.traps,
    scales,
    scaleBehaviour,
    expectedRefusal,
    walls,
    schedules:
      sheet.id === "A-601"
        ? { door: { columns: DOOR_COLUMNS, rows: doorSchedule() }, window: { columns: WINDOW_COLUMNS, rows: windowSchedule() } }
        : undefined,
  };
}

/** The sheet a variant draws: some variants need different CONTENT (demo walls,
 *  hidden layer walls, overridden dimension text), not just a different file. */
export function sheetForVariant(sheetId: string, variantId: string, sheets: Sheet[]): Sheet {
  const base = sheets.find((s) => s.id === sheetId)!;
  if (sheetId === "A-101" && variantId === "dashed") return sheetBuildersRef.planSheetL1({ demo: true });
  if (sheetId === "A-101" && variantId === "ocg") return sheetBuildersRef.planSheetL1({ hidden: true });
  if (sheetId === "A-101" && variantId === "overridden-dims")
    return sheetBuildersRef.planSheetL1({ overrideDims: { 0: "24'-0\"", 3: "EQ", 4: "EQ", 9: "VERIFY", 12: "12'-0\" +/-", 15: "20'-0\"", 16: "20'-0\"" } });
  if (sheetId === "A-401" && variantId === "overridden-dims") return sheetBuildersRef.enlargedSheet({ overrideDims: true });
  return base;
}

import { sheetBuilders as sheetBuildersRef } from "./sheets";

export function allSheets(): Sheet[] {
  return bidSet();
}

export function primsForCase(sheet: Sheet, variant: Variant): Prim[] {
  return variant.transform ? variant.transform(sheet.prims, sheet) : sheet.prims;
}

export { ARCH_D };
export type { Level, Wall };
