import {
  COLUMN_SIZE_FT,
  GRID,
  L1,
  L2,
  PARTITION_TYPES,
  add,
  demoWalls,
  drawWall,
  hiddenLayerWalls,
  len,
  level1Rev1,
  mul,
  normal,
  openingsIn,
  sub,
  thicknessFt,
  unit,
  type Level,
  type Pt,
  type Wall,
} from "./model";

/**
 * EVERY SHEET OF THE BID SET AS A DISPLAY LIST, in paper POINTS, PDF user space
 * (y up, origin bottom-left). The PDF writers, the SVG writer for Chromium, the
 * DXF writer and the raster "scan" all draw from this — so every export of a
 * sheet is the same drawing, and only the file structure differs.
 *
 * A `View` is a piece of the sheet drawn at one scale. The answer key is built
 * from views and the model, never from these primitives.
 */

export type Role =
  | "wall"
  | "cap"
  | "hatch"
  | "door"
  | "glass"
  | "dim"
  | "dimtext"
  | "text"
  | "grid"
  | "bubble"
  | "column"
  | "furn"
  | "case"
  | "fixture"
  | "stair"
  | "tag"
  | "border"
  | "titleblock"
  | "duct"
  | "soffit"
  | "ceilinggrid"
  | "light"
  | "beam"
  | "joist"
  | "elev"
  | "table"
  | "cloud"
  | "detail"
  | "map"
  | "scalebar"
  | "arrow"
  | "stray";

export type Prim =
  | {
      k: "path";
      pts: Pt[];
      closed?: boolean;
      w: number;
      dash?: number[];
      fill?: number;
      stroke?: boolean;
      role: Role;
      layer: string;
      wallId?: string;
      /** Block instance this belongs to, for the AutoCAD-style writer. */
      inst?: string;
      gray?: number;
    }
  | { k: "bez"; start: Pt; segs: [Pt, Pt, Pt][]; w: number; role: Role; layer: string; wallId?: string; inst?: string; dash?: number[]; gray?: number }
  | {
      k: "text";
      at: Pt;
      s: string;
      size: number;
      /** Degrees, CCW. */
      rot?: number;
      anchor?: "start" | "middle";
      role: Role;
      layer: string;
      inst?: string;
    };

export type View = {
  name: string;
  /** Paper point of building (0,0). */
  origin: Pt;
  ptPerFt: number;
  /** The scale this view is drawn at, or null for NTS. */
  scaleName: string | null;
  /** The building region shown, in feet: [x0, y0, x1, y1]. */
  box: [number, number, number, number];
  level?: Level;
  /** Extra walls drawn in this view (demo, hidden layer). */
  extraWalls?: Wall[];
  /** Whether walls in this view are takeoff scope on this sheet. A floor plan's
   *  are; an RCP's or a mechanical background's are DUPLICATES of the plan. */
  wallsAreScope: boolean;
};

export type Sheet = {
  id: string;
  title: string;
  widthPt: number;
  heightPt: number;
  prims: Prim[];
  views: View[];
  /** The scale(s) captioned on the sheet, as a person reads them. */
  printedScale: string;
  /** Traps on this sheet, for the answer key and the report. */
  traps: string[];
  /** Whether a correct takeoff finds walls here at all. */
  expectWalls: boolean;
};

export const ARCH_D = { w: 36 * 72, h: 24 * 72 };

const SCALE_18 = '1/8" = 1\'-0"';
const SCALE_14 = '1/4" = 1\'-0"';
const SCALE_12 = '1/2" = 1\'-0"';
const SCALE_3 = '3" = 1\'-0"';

/** Format feet as an architect's dimension: 27'-4", 15'-3 1/2". */
export function ftIn(feet: number): string {
  const totalSixteenths = Math.round(feet * 12 * 16);
  const ft = Math.floor(totalSixteenths / (12 * 16));
  const remSixteenths = totalSixteenths - ft * 12 * 16;
  const inches = Math.floor(remSixteenths / 16);
  const frac = remSixteenths - inches * 16;
  let fracText = "";
  if (frac > 0) {
    let n = frac;
    let d = 16;
    while (n % 2 === 0) {
      n /= 2;
      d /= 2;
    }
    fracText = ` ${n}/${d}`;
  }
  return `${ft}'-${inches}${fracText}"`;
}

class Builder {
  prims: Prim[] = [];
  private instCounter = 0;
  constructor(readonly view?: View) {}

  /** Building feet → paper points, through the current view. */
  P(pt: Pt): Pt {
    const v = this.view!;
    return { x: v.origin.x + pt.x * v.ptPerFt, y: v.origin.y + pt.y * v.ptPerFt };
  }

  inst(name: string) {
    this.instCounter += 1;
    return `${name}#${this.instCounter}`;
  }

  line(a: Pt, b: Pt, o: Omit<Extract<Prim, { k: "path" }>, "k" | "pts">) {
    this.prims.push({ k: "path", pts: [a, b], ...o });
  }
  poly(pts: Pt[], o: Omit<Extract<Prim, { k: "path" }>, "k" | "pts">) {
    this.prims.push({ k: "path", pts, ...o });
  }
  rect(x: number, y: number, w: number, h: number, o: Omit<Extract<Prim, { k: "path" }>, "k" | "pts" | "closed">) {
    this.prims.push({ k: "path", pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], closed: true, ...o });
  }
  text(at: Pt, s: string, size: number, o: Partial<Extract<Prim, { k: "text" }>> & { role: Role; layer: string }) {
    this.prims.push({ k: "text", at, s, size, ...o });
  }
  /** A circle as four cubic Béziers, in paper points. */
  circle(c: Pt, r: number, o: { w: number; role: Role; layer: string; inst?: string }) {
    this.arc(c, r, 0, 360, o);
  }
  arc(c: Pt, r: number, a0: number, a1: number, o: { w: number; role: Role; layer: string; inst?: string; wallId?: string; dash?: number[] }) {
    const segs: [Pt, Pt, Pt][] = [];
    const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90));
    const da = (a1 - a0) / steps;
    const pt = (deg: number) => ({ x: c.x + r * Math.cos((deg * Math.PI) / 180), y: c.y + r * Math.sin((deg * Math.PI) / 180) });
    const k = (4 / 3) * Math.tan((da * Math.PI) / 180 / 4);
    for (let i = 0; i < steps; i += 1) {
      const s = a0 + da * i;
      const e = s + da;
      const p0 = pt(s);
      const p3 = pt(e);
      const t0 = { x: -Math.sin((s * Math.PI) / 180), y: Math.cos((s * Math.PI) / 180) };
      const t3 = { x: -Math.sin((e * Math.PI) / 180), y: Math.cos((e * Math.PI) / 180) };
      segs.push([add(p0, mul(t0, k * r)), sub(p3, mul(t3, k * r)), p3]);
    }
    this.prims.push({ k: "bez", start: pt(a0), segs, ...o });
  }
}

// ── TITLE BLOCK AND BORDER ─────────────────────────────────────────────────────

function titleBlock(b: Builder, sheetNo: string, title: string, scale: string, revisions: { n: string; date: string; text: string }[] = []) {
  const W = ARCH_D.w;
  const H = ARCH_D.h;
  const o = { w: 1.5, role: "border" as Role, layer: "G-ANNO-TTLB" };
  b.rect(36, 36, W - 72, H - 72, o);
  const x0 = W - 36 - 180;
  b.rect(x0, 36, 180, H - 72, { ...o, w: 1 });
  const rows = [H - 36 - 160, H - 36 - 320, 36 + 420, 36 + 300, 36 + 200, 36 + 120];
  for (const y of rows) b.line({ x: x0, y }, { x: W - 36, y }, { ...o, w: 0.5, role: "titleblock" });
  const t = (y: number, s: string, size: number) => b.text({ x: x0 + 10, y }, s, size, { role: "titleblock", layer: "G-ANNO-TTLB" });
  t(H - 60, "ARCADIA DESIGN COLLECTIVE", 9);
  t(H - 74, "SYNTHETIC TEST SET - NOT A REAL PROJECT", 6);
  t(H - 88, "1200 E CAMELBACK RD, PHOENIX AZ", 6);
  t(H - 190, "MESA RIDGE MEDICAL", 11);
  t(H - 204, "OFFICE BUILDING", 11);
  t(H - 218, "4410 S RIDGE PKWY, PHOENIX AZ", 6);
  t(H - 232, "PROJECT NO. 25-118", 6);
  // Revision block.
  t(36 + 405, "REVISIONS", 7);
  revisions.forEach((r, i) => {
    b.text({ x: x0 + 10, y: 36 + 388 - i * 12 }, r.n, 7, { role: "titleblock", layer: "G-ANNO-TTLB" });
    b.text({ x: x0 + 30, y: 36 + 388 - i * 12 }, `${r.date}  ${r.text}`, 6, { role: "titleblock", layer: "G-ANNO-TTLB" });
    if (r.n.startsWith("2")) {
      // A delta around the revision number.
      const c = { x: x0 + 13, y: 36 + 390 - i * 12 };
      b.poly([{ x: c.x - 7, y: c.y - 4 }, { x: c.x + 7, y: c.y - 4 }, { x: c.x, y: c.y + 8 }], { closed: true, w: 0.6, role: "cloud", layer: "A-REVS" });
    }
  });
  t(36 + 280, "DATE: 08/04/2026", 7);
  t(36 + 265, "ISSUE: BID SET", 7);
  t(36 + 180, `SCALE: ${scale}`, 7);
  t(36 + 100, title, 9);
  b.text({ x: x0 + 10, y: 36 + 50 }, sheetNo, 30, { role: "titleblock", layer: "G-ANNO-TTLB" });
}

// ── PLANS ────────────────────────────────────────────────────────────────────

const WALL_PEN = 0.7;

/** The plan drawing of a level's walls, doors and windows, through `b`'s view. */
function drawWalls(b: Builder, level: Level, opts: { pen?: number; gray?: number; extra?: Wall[]; hatchCmu?: boolean } = {}) {
  const pen = opts.pen ?? WALL_PEN;
  const walls = [...level.walls, ...(opts.extra ?? [])];
  for (const w of walls) {
    const layer = w.demo ? "A-WALL-DEMO" : w.hiddenLayer ? "A-WALL-HIDN" : w.type === "CMU" ? "A-WALL-CMU" : "A-WALL";
    const dash = w.demo ? [6, 4] : undefined;
    if (w.arc) {
      const t = thicknessFt(w);
      for (const s of [1, -1]) {
        const r = w.arc.r + (s * t) / 2;
        b.arc(b.P(w.arc.c), r * b.view!.ptPerFt, w.arc.a0, w.arc.a1, { w: pen, role: "wall", layer, wallId: w.id });
      }
      // Free-end caps.
      for (const deg of [w.arc.a0, w.arc.a1]) {
        const dir = { x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) };
        const p1 = add(w.arc.c, mul(dir, w.arc.r - t / 2));
        const p2 = add(w.arc.c, mul(dir, w.arc.r + t / 2));
        b.line(b.P(p1), b.P(p2), { w: pen, role: "cap", layer, wallId: w.id });
      }
      continue;
    }
    const d = drawWall(w, level, opts.extra ?? []);
    const u = unit(sub(w.b, w.a));
    const n = normal(u);
    for (const run of d.lines) {
      for (const [s, e] of run.spans) {
        const p1 = add(add(w.a, mul(u, s)), mul(n, run.offsetFt));
        const p2 = add(add(w.a, mul(u, e)), mul(n, run.offsetFt));
        b.line(b.P(p1), b.P(p2), { w: pen, role: "wall", layer, wallId: w.id, dash, gray: opts.gray });
      }
    }
    const t = thicknessFt(w);
    for (const at of d.caps) {
      const c = add(w.a, mul(u, at));
      b.line(b.P(add(c, mul(n, t / 2))), b.P(add(c, mul(n, -t / 2))), { w: pen, role: "cap", layer, wallId: w.id, dash, gray: opts.gray });
    }
    if (w.type === "CMU" && opts.hatchCmu !== false) {
      // 45 degree hatch inside the CMU body, 3pt apart on paper.
      const L = len(sub(w.b, w.a));
      const stepFt = 3 / b.view!.ptPerFt;
      for (let s = 0; s < L - t; s += stepFt) {
        const p1 = add(add(w.a, mul(u, s)), mul(n, -t / 2));
        const p2 = add(add(w.a, mul(u, s + t)), mul(n, t / 2));
        b.line(b.P(p1), b.P(p2), { w: 0.25, role: "hatch", layer: "A-WALL-PATT" });
      }
    }
    if (!w.demo && !w.hiddenLayer) drawOpenings(b, w, level);
  }
}

function drawOpenings(b: Builder, w: Wall, level: Level) {
  const u = unit(sub(w.b, w.a));
  const n = normal(u);
  const t = thicknessFt(w);
  for (const op of openingsIn(w, level)) {
    const inst = b.inst(`${op.kind.toUpperCase()}-${op.widthFt}`);
    const left = add(op.at, mul(u, -op.widthFt / 2));
    const right = add(op.at, mul(u, op.widthFt / 2));
    const o = { w: 0.35, role: "door" as Role, layer: "A-DOOR", inst };
    if (op.kind === "window" || op.kind === "relite") {
      for (const off of [-t / 2, 0, t / 2]) {
        b.line(b.P(add(left, mul(n, off))), b.P(add(right, mul(n, off))), { ...o, role: "glass", layer: "A-GLAZ" });
      }
      continue;
    }
    if (op.kind === "storefront" || op.kind === "cased") continue;
    // Doors swing into the + normal side.
    const leaves = op.kind === "pair" ? [[left, 1], [right, -1]] : [[left, 1]];
    const leafW = op.kind === "pair" ? op.widthFt / 2 : op.kind === "sidelite" ? 3 : op.widthFt;
    for (const [hinge, dirSign] of leaves as [Pt, number][]) {
      const face = add(hinge, mul(n, t / 2));
      const tip = add(face, mul(n, leafW));
      // The leaf as a thin rectangle (1-3/4" door).
      const th = 1.75 / 12;
      const along = mul(u, dirSign * th);
      b.poly([b.P(face), b.P(tip), b.P(add(tip, along)), b.P(add(face, along))], { ...o, closed: true });
      // The swing: a quarter arc from the leaf tip back to the wall.
      const c = b.P(face);
      const r = leafW * b.view!.ptPerFt;
      const nAngle = (Math.atan2(n.y, n.x) * 180) / Math.PI;
      const uAngle = (Math.atan2(u.y * dirSign, u.x * dirSign) * 180) / Math.PI;
      const a0 = nAngle;
      let a1 = uAngle;
      if (a1 - a0 > 180) a1 -= 360;
      if (a0 - a1 > 180) a1 += 360;
      b.arc(c, r, Math.min(a0, a1), Math.max(a0, a1), { w: 0.25, role: "door", layer: "A-DOOR", inst });
    }
    if (op.kind === "sidelite") {
      const s0 = add(left, mul(u, 3.1));
      for (const off of [-1 / 12, 1 / 12]) b.line(b.P(add(s0, mul(n, off))), b.P(add(right, mul(n, off))), { ...o, role: "glass", layer: "A-GLAZ" });
    }
    // Door tag.
    const tagAt = b.P(add(op.at, mul(n, -(t / 2 + 2.2))));
    b.circle(tagAt, 5, { w: 0.3, role: "tag", layer: "A-ANNO-SYMB", inst });
    b.text({ x: tagAt.x, y: tagAt.y - 2 }, op.mark, 5, { anchor: "middle", role: "tag", layer: "A-ANNO-SYMB", inst });
  }
}

/** A dimension string between two building points, offset perpendicular. */
function dim(b: Builder, a: Pt, c: Pt, offsetFt: number, label?: string) {
  const u = unit(sub(c, a));
  const n = normal(u);
  const A = add(a, mul(n, offsetFt));
  const C = add(c, mul(n, offsetFt));
  const pa = b.P(A);
  const pc = b.P(C);
  const o = { w: 0.25, role: "dim" as Role, layer: "A-ANNO-DIMS" };
  b.line(pa, pc, o);
  // Extension lines from 2pt off the feature to 3pt past the dimension line.
  const nP = normal(unit(sub(pc, pa)));
  const sgn = Math.sign(offsetFt) || 1;
  for (const [feat, onLine] of [
    [b.P(a), pa],
    [b.P(c), pc],
  ] as [Pt, Pt][]) {
    b.line(add(feat, mul(nP, sgn * 2)), add(onLine, mul(nP, sgn * 3)), o);
    // 45 degree tick.
    const tick = unit(add(unit(sub(pc, pa)), nP));
    b.line(sub(onLine, mul(tick, 2.5)), add(onLine, mul(tick, 2.5)), { ...o, w: 0.5 });
  }
  const text = label ?? ftIn(len(sub(c, a)));
  const mid = mul(add(pa, pc), 0.5);
  const angle = (Math.atan2(pc.y - pa.y, pc.x - pa.x) * 180) / Math.PI;
  const rot = Math.abs(angle) > 89 && Math.abs(angle) < 91 ? 90 : 0;
  const at = rot === 90 ? { x: mid.x - 2, y: mid.y } : { x: mid.x, y: mid.y + 2 };
  b.text(at, text, 6.75, { rot, anchor: "middle", role: "dimtext", layer: "A-ANNO-DIMS" });
  }

function grid(b: Builder, extentFt = 14) {
  const o = { w: 0.25, role: "grid" as Role, layer: "S-GRID", dash: [24, 4, 4, 4] };
  const v = b.view!;
  const [x0, y0, x1, y1] = v.box;
  for (const g of GRID.x) {
    if (g.at < x0 - 1 || g.at > x1 + 1) continue;
    const top = b.P({ x: g.at, y: y1 + extentFt });
    b.line(b.P({ x: g.at, y: y0 - 4 }), top, o);
    b.circle({ x: top.x, y: top.y + 12 }, 12, { w: 0.5, role: "bubble", layer: "S-GRID" });
    b.text({ x: top.x, y: top.y + 8 }, g.name, 12, { anchor: "middle", role: "bubble", layer: "S-GRID" });
  }
  for (const g of GRID.y) {
    if (g.at < y0 - 1 || g.at > y1 + 1) continue;
    const left = b.P({ x: x0 - extentFt, y: g.at });
    b.line(left, b.P({ x: x1 + 4, y: g.at }), o);
    b.circle({ x: left.x - 12, y: left.y }, 12, { w: 0.5, role: "bubble", layer: "S-GRID" });
    b.text({ x: left.x - 12, y: left.y - 4 }, g.name, 12, { anchor: "middle", role: "bubble", layer: "S-GRID" });
  }
}

function columns(b: Builder, level: Level) {
  const h = COLUMN_SIZE_FT / 2;
  for (const c of level.columns) {
    const inst = b.inst("COL-W10");
    const p0 = b.P({ x: c.x - h, y: c.y - h });
    const s = COLUMN_SIZE_FT * b.view!.ptPerFt;
    // Fireproofed box (stroked) with a solid W-shape inside (filled, no stroke).
    b.rect(p0.x, p0.y, s, s, { w: 0.35, role: "column", layer: "A-COLS", inst });
    const m = s * 0.2;
    b.poly(
      [
        { x: p0.x + m, y: p0.y + m },
        { x: p0.x + s - m, y: p0.y + m },
        { x: p0.x + s - m, y: p0.y + m + 1.2 },
        { x: p0.x + s / 2 + 0.5, y: p0.y + m + 1.2 },
        { x: p0.x + s / 2 + 0.5, y: p0.y + s - m - 1.2 },
        { x: p0.x + s - m, y: p0.y + s - m - 1.2 },
        { x: p0.x + s - m, y: p0.y + s - m },
        { x: p0.x + m, y: p0.y + s - m },
        { x: p0.x + m, y: p0.y + s - m - 1.2 },
        { x: p0.x + s / 2 - 0.5, y: p0.y + s - m - 1.2 },
        { x: p0.x + s / 2 - 0.5, y: p0.y + m + 1.2 },
        { x: p0.x + m, y: p0.y + m + 1.2 },
      ],
      { closed: true, w: 0, fill: 0, stroke: false, role: "column", layer: "A-COLS", inst },
    );
  }
}

function rooms(b: Builder, level: Level) {
  for (const r of level.rooms) {
    const at = b.P(r.at);
    b.text({ x: at.x, y: at.y + 2 }, r.name, 8, { anchor: "middle", role: "text", layer: "A-ANNO-TEXT" });
    b.rect(at.x - 11, at.y - 11, 22, 10, { w: 0.3, role: "tag", layer: "A-ANNO-SYMB" });
    b.text({ x: at.x, y: at.y - 9 }, r.number, 7, { anchor: "middle", role: "tag", layer: "A-ANNO-SYMB" });
  }
}

/** Wall type tags: a hexagon with the type code, beside walls longer than 12'. */
function typeTags(b: Builder, level: Level) {
  for (const w of level.walls) {
    if (w.arc || len(sub(w.b, w.a)) < 12) continue;
    const u = unit(sub(w.b, w.a));
    const n = normal(u);
    const mid = mul(add(w.a, w.b), 0.5);
    const at = b.P(add(add(mid, mul(u, 3)), mul(n, thicknessFt(w) / 2 + 1.4)));
    const r = 6;
    const pts = Array.from({ length: 6 }, (_, i) => ({ x: at.x + r * Math.cos((i * Math.PI) / 3), y: at.y + r * Math.sin((i * Math.PI) / 3) }));
    const inst = b.inst("WALLTAG");
    b.poly(pts, { closed: true, w: 0.3, role: "tag", layer: "A-ANNO-SYMB", inst });
    b.text({ x: at.x, y: at.y - 2 }, w.type, 4.5, { anchor: "middle", role: "tag", layer: "A-ANNO-SYMB", inst });
  }
}

function furniture(b: Builder) {
  const o = (inst: string) => ({ w: 0.25, role: "furn" as Role, layer: "A-FURN", inst });
  const desk = (x: number, y: number) => {
    const inst = b.inst("DESK-60x30");
    const p0 = b.P({ x, y });
    b.rect(p0.x, p0.y, 5 * b.view!.ptPerFt, 2.5 * b.view!.ptPerFt, o(inst));
    const ch = b.P({ x: x + 2, y: y - 2 });
    b.rect(ch.x, ch.y, 1.6 * b.view!.ptPerFt, 1.6 * b.view!.ptPerFt, o(inst));
  };
  // Offices.
  desk(55, 80);
  desk(75, 82);
  desk(35, 80);
  desk(3, 70);
  desk(92, 10);
  desk(125, 8);
  // Exam tables.
  for (const x of [32, 42, 52, 62, 72]) {
    const inst = b.inst("EXAM-TABLE");
    const p0 = b.P({ x: x + 1, y: 56 });
    b.rect(p0.x, p0.y, 2.2 * b.view!.ptPerFt, 6 * b.view!.ptPerFt, o(inst));
    const q0 = b.P({ x: x + 1, y: 31 });
    b.rect(q0.x, q0.y, 2.2 * b.view!.ptPerFt, 6 * b.view!.ptPerFt, o(b.inst("EXAM-TABLE")));
  }
  // Conference table and waiting chairs.
  const ct = b.P({ x: 124, y: 80 });
  b.rect(ct.x, ct.y, 16 * b.view!.ptPerFt, 4 * b.view!.ptPerFt, o(b.inst("CONF-TABLE")));
  for (let i = 0; i < 8; i += 1) {
    const c = b.P({ x: 3 + i * 2.2, y: 47 });
    b.rect(c.x, c.y, 1.8 * b.view!.ptPerFt, 1.8 * b.view!.ptPerFt, o(b.inst("CHAIR")));
  }
}

/** Base cabinets along the exam rooms' back wall, with the upper cabinet dashed
 *  1'-0" off the wall face — a line that sits a wall-thickness from a wall face. */
function casework(b: Builder) {
  for (const x of [30, 40, 50, 60, 70]) {
    const face = 66 - 0.203;
    const inst = b.inst("BASE-CAB-6");
    const o = { w: 0.3, role: "case" as Role, layer: "A-FLOR-CASE", inst };
    b.line(b.P({ x: x + 2, y: face - 2 }), b.P({ x: x + 8, y: face - 2 }), o);
    b.line(b.P({ x: x + 2, y: face }), b.P({ x: x + 2, y: face - 2 }), o);
    b.line(b.P({ x: x + 8, y: face }), b.P({ x: x + 8, y: face - 2 }), o);
    b.line(b.P({ x: x + 2, y: face - 1 }), b.P({ x: x + 8, y: face - 1 }), { ...o, dash: [3, 2] });
  }
}

function plumbing(b: Builder) {
  const o = (inst: string) => ({ w: 0.3, role: "fixture" as Role, layer: "P-FIXT", inst });
  const wc = (x: number, y: number, facing: 1 | -1) => {
    const inst = b.inst("WC");
    const tank = b.P({ x: x - 0.9, y: facing > 0 ? y : y - 0.75 });
    b.rect(tank.x, tank.y, 1.8 * b.view!.ptPerFt, 0.75 * b.view!.ptPerFt, o(inst));
    const c = b.P({ x, y: y + facing * 1.6 });
    b.arc(c, 0.75 * b.view!.ptPerFt, 0, 360, { w: 0.3, role: "fixture", layer: "P-FIXT", inst });
  };
  const lav = (x: number, y: number) => {
    const inst = b.inst("LAV");
    const p0 = b.P({ x: x - 0.9, y: y - 1.5 });
    b.rect(p0.x, p0.y, 1.8 * b.view!.ptPerFt, 1.5 * b.view!.ptPerFt, o(inst));
    b.arc(b.P({ x, y: y - 0.75 }), 0.5 * b.view!.ptPerFt, 0, 360, { w: 0.3, role: "fixture", layer: "P-FIXT", inst });
  };
  // Men's (west of chase) and women's (east), toilets against the chase.
  for (const y of [15, 21, 27]) {
    wc(186 - 0.6 - 0.9, y, -1 as const);
    wc(186 + 0.6 + 0.9, y, 1 as const);
  }
  for (const y of [34, 38]) {
    lav(184, y);
    lav(188.5, y);
  }
  // Toilet partitions: 1" panels, drawn double.
  for (const y of [18, 24]) {
    for (const off of [-1 / 24, 1 / 24]) {
      b.line(b.P({ x: 178.5, y: y + off }), b.P({ x: 186 - 0.6, y: y + off }), o(b.inst("TP")));
      b.line(b.P({ x: 186 + 0.6, y: y + off }), b.P({ x: 193.5, y: y + off }), o(b.inst("TP")));
    }
  }
  // Grab bars: 1-1/2" apart, 1-1/2" off the wall face.
  for (const off of [0.125, 0.25]) b.line(b.P({ x: 166, y: 10.2 + off }), b.P({ x: 169.5, y: 10.2 + off }), o(b.inst("GB")));
}

function stair(b: Builder) {
  const o = { w: 0.25, role: "stair" as Role, layer: "A-FLOR-STRS" };
  const x0 = 190.32;
  const x1 = 207.63;
  const mid = (x0 + x1) / 2;
  // Two flights, 11" treads.
  for (let i = 0; i < 16; i += 1) {
    const y = 66 + (i * 11) / 12;
    b.line(b.P({ x: x0, y }), b.P({ x: mid - 0.25, y }), o);
    b.line(b.P({ x: mid + 0.25, y }), b.P({ x: x1, y }), o);
  }
  // Handrails 1-1/2" round, 2-1/4" off the wall face: two lines each.
  for (const off of [0.1875, 0.3125]) {
    b.line(b.P({ x: x0 + off, y: 64 }), b.P({ x: x0 + off, y: 82 }), o);
    b.line(b.P({ x: x1 - off, y: 64 }), b.P({ x: x1 - off, y: 82 }), o);
  }
  b.line(b.P({ x: mid - 0.25, y: 64 }), b.P({ x: mid - 0.25, y: 82 }), o);
  b.line(b.P({ x: mid + 0.25, y: 64 }), b.P({ x: mid + 0.25, y: 82 }), o);
  b.text(b.P({ x: x0 + 2, y: 84 }), "UP", 6, { role: "text", layer: "A-ANNO-TEXT" });
  // Elevator car.
  const car = b.P({ x: 179, y: 80 });
  b.rect(car.x, car.y, 9 * b.view!.ptPerFt, 11 * b.view!.ptPerFt, o);
  b.line(car, b.P({ x: 188, y: 91 }), o);
}

function northArrowAndScaleBar(b: Builder, at: Pt, ptPerFt: number) {
  const o = { w: 0.5, role: "arrow" as Role, layer: "A-ANNO-SYMB" };
  b.circle(at, 18, o);
  b.poly([{ x: at.x, y: at.y + 18 }, { x: at.x - 6, y: at.y - 10 }, { x: at.x + 6, y: at.y - 10 }], { ...o, closed: true, fill: 0 });
  b.text({ x: at.x, y: at.y + 24 }, "N", 10, { anchor: "middle", role: "arrow", layer: "A-ANNO-SYMB" });
  // Graphic scale: 0-4-8-16-32 ft, a bar 4pt tall.
  const x0 = at.x + 60;
  const y0 = at.y - 4;
  const marks = [0, 4, 8, 16, 32];
  for (let i = 0; i < marks.length - 1; i += 1) {
    const xa = x0 + marks[i] * ptPerFt;
    const xb = x0 + marks[i + 1] * ptPerFt;
    b.rect(xa, y0, xb - xa, 4, { w: 0.4, role: "scalebar", layer: "A-ANNO-SYMB", fill: i % 2 === 0 ? 0 : undefined });
    b.text({ x: xa, y: y0 - 9 }, String(marks[i]), 5, { anchor: "middle", role: "scalebar", layer: "A-ANNO-SYMB" });
  }
  b.text({ x: x0 + 32 * ptPerFt, y: y0 - 9 }, "32", 5, { anchor: "middle", role: "scalebar", layer: "A-ANNO-SYMB" });
}

function keynotes(b: Builder, x: number, y: number) {
  const notes = [
    "GENERAL NOTES",
    "1. ALL PARTITIONS TYPE A1 U.N.O.",
    "2. SEE A-501 FOR PARTITION TYPES",
    "3. SEE A-601 FOR DOOR SCHEDULE",
    "4. DIMENSIONS ARE TO FACE OF STUD",
    "   OR GRID U.N.O.",
    "5. DO NOT SCALE DRAWINGS",
    "6. PROVIDE BLOCKING AT ALL",
    "   WALL-MOUNTED EQUIPMENT",
    "KEYNOTES",
    "08 41 13  ALUMINUM STOREFRONT",
    "09 21 16  GYPSUM BOARD ASSEMBLY",
    "09 22 16  NON-STRUCT. METAL FRAMING",
    "04 22 00  CMU - BY OTHERS",
  ];
  notes.forEach((s, i) => b.text({ x, y: y - i * 11 }, s, 6.5, { role: "text", layer: "A-ANNO-TEXT" }));
}

function viewTitle(b: Builder, at: Pt, title: string, scale: string) {
  b.circle({ x: at.x - 20, y: at.y + 4 }, 14, { w: 0.6, role: "tag", layer: "A-ANNO-SYMB" });
  b.text({ x: at.x - 20, y: at.y }, "1", 10, { anchor: "middle", role: "tag", layer: "A-ANNO-SYMB" });
  b.text(at, title, 14, { role: "text", layer: "A-ANNO-TEXT" });
  b.line({ x: at.x, y: at.y - 4 }, { x: at.x + 300, y: at.y - 4 }, { w: 1.2, role: "text", layer: "A-ANNO-TEXT" });
  b.text({ x: at.x, y: at.y - 16 }, `SCALE: ${scale}`, 7, { role: "text", layer: "A-ANNO-TEXT" });
}

const PLAN_ORIGIN = { x: 230, y: 560 };

function planView(level: Level, name: string, extra?: Wall[]): View {
  return {
    name,
    origin: PLAN_ORIGIN,
    ptPerFt: 9,
    scaleName: SCALE_18,
    box: [-2, -2, 210, 95],
    level,
    extraWalls: extra,
    wallsAreScope: true,
  };
}

function planDims(b: Builder, level: Level) {
  if (level.dims) {
    for (const [a, c] of level.dims) dim(b, a, c, a.y === c.y && a.y < 0 ? -10 : 0);
    return;
  }
  const xs = GRID.x.map((g) => g.at);
  const ys = GRID.y.map((g) => g.at);
  // South: grid bays and overall.
  for (let i = 0; i < xs.length - 1; i += 1) dim(b, { x: xs[i], y: -0.67 }, { x: xs[i + 1], y: -0.67 }, -10);
  dim(b, { x: xs[0], y: -0.67 }, { x: xs[xs.length - 1], y: -0.67 }, -16);
  // West: grid bays and overall (vertical).
  for (let i = 0; i < ys.length - 1; i += 1) dim(b, { x: -0.67, y: ys[i] }, { x: -0.67, y: ys[i + 1] }, 10);
  dim(b, { x: -0.67, y: ys[0] }, { x: -0.67, y: ys[ys.length - 1] }, 16);
  // North: window centres along the north wall.
  if (level.name === "L1") {
    const north = [0, 20, 40, 80, 100, 130, 158];
    for (let i = 0; i < north.length - 1; i += 1) dim(b, { x: north[i], y: 92.67 }, { x: north[i + 1], y: 92.67 }, 8);
    // Interior.
    for (const x of [30, 40, 50, 60, 70]) dim(b, { x, y: 54 }, { x: x + 10, y: 54 }, 0);
    dim(b, { x: 120, y: 43 }, { x: 120, y: 49 }, 0);
    dim(b, { x: 33, y: 49 }, { x: 33, y: 66 }, 0);
    dim(b, { x: 33, y: 28 }, { x: 33, y: 43 }, 0);
    dim(b, { x: 98, y: 58 }, { x: 110, y: 58 }, 0);
    dim(b, { x: 165, y: 30 }, { x: 186, y: 30 }, 0);
    dim(b, { x: 186, y: 5 }, { x: 208, y: 5 }, 0);
    dim(b, { x: 147.33, y: 75 }, { x: 165, y: 75 }, 0);
    dim(b, { x: 50, y: 88 }, { x: 70, y: 88 }, 0);
    dim(b, { x: 58.5, y: 14 }, { x: 87.33, y: 14 }, 0);
  } else {
    for (const x of [12, 24, 36, 48]) dim(b, { x, y: 30 }, { x: x + 12, y: 30 }, 0);
    dim(b, { x: 10, y: 40 }, { x: 10, y: 46 }, 0);
    dim(b, { x: 100, y: 64 }, { x: 144, y: 64 }, 0);
    dim(b, { x: 150, y: 50 }, { x: 165, y: 50 }, 0);
    dim(b, { x: 170, y: 0 }, { x: 170, y: 10 }, 0);
  }
}

export type PlanOptions = {
  rev?: boolean;
  demo?: boolean;
  hidden?: boolean;
  /** Dimension texts to override: index into the dims in drawing order → label. */
  overrideDims?: Record<number, string>;
};

function floorPlanSheet(id: string, level: Level, title: string, opts: PlanOptions = {}): Sheet {
  const extra = [...(opts.demo ? demoWalls() : []), ...(opts.hidden ? hiddenLayerWalls() : [])];
  const view = planView(level, title, extra.length > 0 ? extra : undefined);
  const b = new Builder(view);
  grid(b);
  drawWalls(b, level, { extra });
  columns(b, level);
  // Mesa Ridge's stair, furniture and fixtures sit at Mesa Ridge coordinates; a
  // generated holdout plan (which carries its own `dims`) has none of them.
  if (!level.dims) stair(b);
  if (level.name === "L1" && !level.dims) {
    furniture(b);
    casework(b);
    plumbing(b);
  }
  rooms(b, level);
  typeTags(b, level);
  const dimStart = b.prims.length;
  planDims(b, level);
  if (opts.overrideDims) {
    const texts = b.prims.slice(dimStart).filter((p): p is Extract<Prim, { k: "text" }> => p.k === "text" && p.role === "dimtext");
    for (const [i, label] of Object.entries(opts.overrideDims)) {
      const t = texts[Number(i)];
      if (t) t.s = label;
    }
  }
  northArrowAndScaleBar(b, { x: 300, y: 380 }, view.ptPerFt);
  viewTitle(b, { x: 600, y: 330 }, `${level.name === "L1" ? "LEVEL 1" : "LEVEL 2"} FLOOR PLAN`, SCALE_18);
  keynotes(b, 2160, 1600);
  // Match line text and a section marker.
  b.line(b.P({ x: 186, y: -6 }), b.P({ x: 186, y: -2 }), { w: 1.5, role: "text", layer: "A-ANNO-SYMB", dash: [18, 6, 3, 6] });
  b.text(b.P({ x: 187, y: -5 }), "MATCH LINE", 6, { role: "text", layer: "A-ANNO-TEXT" });
  const revisions = [{ n: "1", date: "08/04/2026", text: "BID SET" }];
  if (opts.rev) {
    revisions.push({ n: "2", date: "09/14/2026", text: "ADDENDUM 2" });
    // A cloud around the moved corridor: scalloped arcs along a rectangle.
    const r0 = b.P({ x: 28, y: 40 });
    const r1 = b.P({ x: 210, y: 56 });
    cloud(b, r0, r1);
  }
  titleBlock(b, id, title, SCALE_18, revisions);
  return {
    id: opts.rev ? `${id}-REV1` : id,
    title,
    widthPt: ARCH_D.w,
    heightPt: ARCH_D.h,
    prims: b.prims,
    views: [view],
    printedScale: SCALE_18,
    traps: [
      "casework upper-cabinet line 1'-0\" off a wall face",
      "stair handrail lines beside the CMU face",
      "graphic scale bar: two parallel edges 4pt apart",
      "gridlines on wall centrelines",
      "door leaves as thin rectangles",
      "window glazing: three parallel lines across each opening",
      "chase wall D1 drawn as four lines",
      "EXT-1 drawn as five lines, EXT-2 as four",
      "F1 furring 1-1/2\" thick, under the 2-1/2\" thickness floor",
      "curved reception wall (Béziers)",
      "A1 and C1 thicknesses 1/8\" apart",
    ],
    expectWalls: true,
  };
}

function cloud(b: Builder, p0: Pt, p1: Pt) {
  const r = 10;
  const edge = (a: Pt, c: Pt) => {
    const L = len(sub(c, a));
    const n = Math.max(1, Math.round(L / (2 * r)));
    const u = unit(sub(c, a));
    for (let i = 0; i < n; i += 1) {
      const m = add(a, mul(u, (i + 0.5) * (L / n)));
      const ang = (Math.atan2(u.y, u.x) * 180) / Math.PI;
      b.arc(m, L / n / 2, ang, ang + 180, { w: 0.6, role: "cloud", layer: "A-REVS" });
    }
  };
  edge({ x: p0.x, y: p0.y }, { x: p1.x, y: p0.y });
  edge({ x: p1.x, y: p0.y }, { x: p1.x, y: p1.y });
  edge({ x: p1.x, y: p1.y }, { x: p0.x, y: p1.y });
  edge({ x: p0.x, y: p1.y }, { x: p0.x, y: p0.y });
}

// ── THE OTHER SHEETS ─────────────────────────────────────────────────────────

function coverSheet(): Sheet {
  const b = new Builder();
  b.text({ x: 200, y: 1450 }, "MESA RIDGE MEDICAL OFFICE BUILDING", 40, { role: "text", layer: "G-ANNO-TEXT" });
  b.text({ x: 200, y: 1400 }, "4410 S RIDGE PARKWAY, PHOENIX, ARIZONA", 18, { role: "text", layer: "G-ANNO-TEXT" });
  b.text({ x: 200, y: 1360 }, "BID SET - 08/04/2026", 18, { role: "text", layer: "G-ANNO-TEXT" });
  const data = [
    ["PROJECT DATA", ""],
    ["OCCUPANCY", "B (BUSINESS / OUTPATIENT CLINIC)"],
    ["CONSTRUCTION TYPE", "II-B, SPRINKLERED"],
    ["STORIES", "2"],
    ["GROSS AREA", "38,800 SF"],
    ["CODE", "2018 IBC W/ PHOENIX AMENDMENTS"],
  ];
  data.forEach(([k, v], i) => {
    b.text({ x: 200, y: 1250 - i * 16 }, k, 9, { role: "table", layer: "G-ANNO-TEXT" });
    b.text({ x: 400, y: 1250 - i * 16 }, v, 9, { role: "table", layer: "G-ANNO-TEXT" });
  });
  const index = [
    ["G-001", "COVER SHEET"],
    ["A-101", "LEVEL 1 FLOOR PLAN"],
    ["A-102", "LEVEL 2 FLOOR PLAN"],
    ["A-111", "LEVEL 1 REFLECTED CEILING PLAN"],
    ["A-201", "EXTERIOR ELEVATIONS"],
    ["A-401", "ENLARGED PLANS AND DETAILS"],
    ["A-501", "PARTITION TYPES"],
    ["A-601", "DOOR AND WINDOW SCHEDULES"],
    ["S-101", "LEVEL 2 FRAMING PLAN"],
    ["M-101", "LEVEL 1 MECHANICAL PLAN"],
  ];
  b.text({ x: 200, y: 1060 }, "SHEET INDEX", 12, { role: "table", layer: "G-ANNO-TEXT" });
  index.forEach(([k, v], i) => {
    b.text({ x: 200, y: 1040 - i * 16 }, k, 9, { role: "table", layer: "G-ANNO-TEXT" });
    b.text({ x: 280, y: 1040 - i * 16 }, v, 9, { role: "table", layer: "G-ANNO-TEXT" });
    b.line({ x: 195, y: 1036 - i * 16 }, { x: 600, y: 1036 - i * 16 }, { w: 0.25, role: "table", layer: "G-ANNO-TEXT" });
  });
  // Vicinity map: streets as DOUBLE LINES 12pt apart — the cover-sheet phantom.
  const mapO = { x: 1100, y: 500 };
  const st = { w: 0.6, role: "map" as Role, layer: "G-MAP" };
  for (const yy of [0, 200, 400, 600]) {
    b.line({ x: mapO.x, y: mapO.y + yy }, { x: mapO.x + 900, y: mapO.y + yy }, st);
    b.line({ x: mapO.x, y: mapO.y + yy + 12 }, { x: mapO.x + 900, y: mapO.y + yy + 12 }, st);
  }
  for (const xx of [0, 300, 600, 900]) {
    b.line({ x: mapO.x + xx, y: mapO.y }, { x: mapO.x + xx, y: mapO.y + 612 }, st);
    b.line({ x: mapO.x + xx + 12, y: mapO.y }, { x: mapO.x + xx + 12, y: mapO.y + 612 }, st);
  }
  b.text({ x: mapO.x + 320, y: mapO.y + 300 }, "SITE", 14, { role: "map", layer: "G-MAP" });
  b.text({ x: mapO.x, y: mapO.y - 30 }, "VICINITY MAP   N.T.S.", 10, { role: "map", layer: "G-MAP" });
  // Key plan: the building outline, double line, tiny.
  const kp = { x: 200, y: 500 };
  for (const off of [0, 2]) b.rect(kp.x + off, kp.y + off, 208 - 2 * off, 93 - 2 * off, { w: 0.5, role: "map", layer: "G-MAP" });
  b.text({ x: kp.x, y: kp.y - 20 }, "KEY PLAN", 10, { role: "map", layer: "G-MAP" });
  titleBlock(b, "G-001", "COVER SHEET", "NONE");
  return {
    id: "G-001",
    title: "COVER SHEET",
    widthPt: ARCH_D.w,
    heightPt: ARCH_D.h,
    prims: b.prims,
    views: [],
    printedScale: "NONE",
    traps: ["vicinity-map streets drawn as double lines", "key plan outline drawn double"],
    expectWalls: false,
  };
}

function rcpSheet(): Sheet {
  const view: View = { ...planView(L1, "LEVEL 1 RCP"), wallsAreScope: false };
  const b = new Builder(view);
  grid(b);
  drawWalls(b, L1, { pen: 0.35, hatchCmu: false });
  columns(b, L1);
  // Ceiling grid 2x4 in the ACT zones, light fixtures, soffits.
  const act: [number, number, number, number][] = [
    [30.4, 49.4, 87, 65.6],
    [30.4, 28.4, 87, 42.6],
    [117.6, 49.4, 147, 92.2],
    [87.6, 0, 147, 19.6],
  ];
  const cg = { w: 0.2, role: "ceilinggrid" as Role, layer: "A-CLNG-GRID" };
  for (const [x0, y0, x1, y1] of act) {
    for (let x = x0 + 1; x < x1; x += 4) b.line(b.P({ x, y: y0 }), b.P({ x, y: y1 }), cg);
    for (let y = y0 + 1; y < y1; y += 2) b.line(b.P({ x: x0, y }), b.P({ x: x1, y }), cg);
    // 1x4 strip lights: two long edges 1'-0" apart.
    for (let x = x0 + 3; x < x1 - 4; x += 8) {
      const p0 = b.P({ x, y: (y0 + y1) / 2 - 0.5 });
      b.rect(p0.x, p0.y, 4 * view.ptPerFt, 1 * view.ptPerFt, { w: 0.4, role: "light", layer: "E-LITE", inst: b.inst("LT-1x4") });
    }
  }
  // Soffits and bulkheads: the edge and the bulkhead face, 8" apart.
  for (const s of L1.soffits) {
    for (const off of [0, 8 / 12]) {
      const p0 = b.P({ x: s.x0 + off, y: s.y0 + off });
      const p1 = b.P({ x: s.x1 - off, y: s.y1 - off });
      b.rect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y, { w: 0.5, role: "soffit", layer: "A-CLNG-SOFF" });
    }
    b.text(b.P({ x: (s.x0 + s.x1) / 2, y: s.y1 + 1 }), "GYP SOFFIT @ 9'-0\" A.F.F.", 6, { anchor: "middle", role: "text", layer: "A-ANNO-TEXT" });
  }
  for (const r of L1.rooms) {
    if (r.ceilingFt === 0) continue;
    const at = b.P(r.at);
    b.text(at, `${r.ceiling} ${ftIn(r.ceilingFt)}`, 6, { anchor: "middle", role: "text", layer: "A-ANNO-TEXT" });
  }
  planDims(b, L1);
  viewTitle(b, { x: 600, y: 330 }, "LEVEL 1 REFLECTED CEILING PLAN", SCALE_18);
  titleBlock(b, "A-111", "LEVEL 1 RCP", SCALE_18);
  return {
    id: "A-111",
    title: "LEVEL 1 REFLECTED CEILING PLAN",
    widthPt: ARCH_D.w,
    heightPt: ARCH_D.h,
    prims: b.prims,
    views: [view],
    printedScale: SCALE_18,
    traps: ["soffit edge + bulkhead face 8\" apart", "1x4 light fixtures: two edges 1'-0\" apart", "walls repeated from A-101 (duplicates, not scope)"],
    expectWalls: false,
  };
}

/** A-401: enlarged restrooms at 1/4", enlarged stair at 1/2", and an NTS detail. */
function enlargedSheet(opts: { overrideDims?: boolean } = {}): Sheet {
  const rr: View = { name: "ENLARGED RESTROOMS", origin: { x: 160 - 163 * 18, y: 560 + 2 * 18 }, ptPerFt: 18, scaleName: SCALE_14, box: [163, -2, 210, 45], level: L1, wallsAreScope: true };
  const st: View = { name: "ENLARGED STAIR", origin: { x: 1100 - 188 * 36, y: 220 - 60 * 36 }, ptPerFt: 36, scaleName: SCALE_12, box: [188, 60, 209, 93.5], level: L1, wallsAreScope: true };
  const out: Prim[] = [];

  const b1 = new Builder(rr);
  drawWalls(b1, L1);
  // Restroom plumbing at this scale.
  plumbing(b1);
  b1.prims = clipToView(b1.prims, rr);
  const rrDims: [Pt, Pt, number][] = [
    [{ x: 165, y: 45 }, { x: 186, y: 45 }, 0],
    [{ x: 186, y: 45 }, { x: 208, y: 45 }, 0],
    [{ x: 163, y: 0 }, { x: 163, y: 10 }, 0],
    [{ x: 163, y: 10 }, { x: 163, y: 43 }, 0],
    [{ x: 178.5, y: 13 }, { x: 186, y: 13 }, 0],
    [{ x: 186, y: 31 }, { x: 193.5, y: 31 }, 0],
    [{ x: 165, y: 7 }, { x: 175.5, y: 7 }, 0],
    [{ x: 196, y: 3 }, { x: 208, y: 3 }, 0],
    [{ x: 204, y: 10 }, { x: 204, y: 27 }, 0],
  ];
  const labels = opts.overrideDims ? { 2: "VERIFY", 4: "EQ", 5: "EQ", 8: "16'-0\"" } : {};
  rrDims.forEach(([a, c, off], i) => dim(b1, a, c, off, (labels as Record<number, string>)[i]));
  rooms(b1, { ...L1, rooms: L1.rooms.filter((r) => r.at.x >= rr.box[0] && r.at.x <= rr.box[2] && r.at.y >= rr.box[1] && r.at.y <= rr.box[3]) });
  viewTitle(b1, { x: 200, y: 400 }, "ENLARGED RESTROOM PLAN", SCALE_14);
  out.push(...b1.prims);

  const b2 = new Builder(st);
  drawWalls(b2, L1);
  stair(b2);
  b2.prims = clipToView(b2.prims, st);
  const stDims: [Pt, Pt, number][] = [
    [{ x: 190.32, y: 64 }, { x: 207.63, y: 64 }, 0],
    [{ x: 199, y: 61.68 }, { x: 199, y: 92.3 }, 0],
    [{ x: 190.32, y: 86 }, { x: 198.73, y: 86 }, 0],
  ];
  stDims.forEach(([a, c, off]) => dim(b2, a, c, off));
  viewTitle(b2, { x: 1150, y: 150 }, "ENLARGED STAIR PLAN", SCALE_12);
  out.push(...b2.prims);

  // NTS head-of-wall detail: deck, deflection track, studs, board — parallel lines,
  // with dimensions whose geometry matches no scale.
  const b3 = new Builder();
  const dx = 1950;
  const dy = 900;
  const o = { w: 0.5, role: "detail" as Role, layer: "A-DETL" };
  b3.line({ x: dx, y: dy + 400 }, { x: dx + 360, y: dy + 400 }, { ...o, w: 1.2 });
  b3.line({ x: dx, y: dy + 410 }, { x: dx + 360, y: dy + 410 }, o);
  for (const x of [140, 152, 208, 220]) b3.line({ x: dx + x, y: dy }, { x: dx + x, y: dy + 395 }, o);
  for (const x of [131, 140, 220, 229]) b3.line({ x: dx + x, y: dy }, { x: dx + x, y: dy + 380 }, o);
  b3.text({ x: dx + 180, y: dy + 430 }, "1'-0\"", 6.75, { anchor: "middle", role: "dimtext", layer: "A-ANNO-DIMS" });
  b3.line({ x: dx + 131, y: dy + 425 }, { x: dx + 229, y: dy + 425 }, { w: 0.25, role: "dim", layer: "A-ANNO-DIMS" });
  b3.text({ x: dx + 280, y: dy + 200 }, "2'-6\"", 6.75, { anchor: "middle", role: "dimtext", layer: "A-ANNO-DIMS" });
  b3.line({ x: dx + 270, y: dy + 20 }, { x: dx + 270, y: dy + 380 }, { w: 0.25, role: "dim", layer: "A-ANNO-DIMS" });
  b3.text({ x: dx + 60, y: dy + 300 }, "3'-0\"", 6.75, { anchor: "middle", role: "dimtext", layer: "A-ANNO-DIMS" });
  b3.line({ x: dx + 20, y: dy + 290 }, { x: dx + 100, y: dy + 290 }, { w: 0.25, role: "dim", layer: "A-ANNO-DIMS" });
  viewTitle(b3, { x: dx, y: dy - 40 }, "HEAD OF WALL DETAIL", "NTS");
  out.push(...b3.prims);

  const tb = new Builder();
  titleBlock(tb, "A-401", "ENLARGED PLANS", "AS NOTED");
  out.push(...tb.prims);
  return {
    id: "A-401",
    title: "ENLARGED PLANS AND DETAILS",
    widthPt: ARCH_D.w,
    heightPt: ARCH_D.h,
    prims: out,
    views: [rr, st],
    printedScale: `${SCALE_14} + ${SCALE_12} + NTS (title block: AS NOTED)`,
    traps: ["three scales on one sheet", "an NTS detail with dimensions", "the restroom view carries 3x the stair view's dimensions"],
    expectWalls: true,
  };
}

/** Keep what lies inside a view's box: segments clipped, anything else dropped
 *  unless it sits wholly inside. An enlarged plan is cut out of the floor plan. */
function clipToView(prims: Prim[], view: View): Prim[] {
  const x0 = view.origin.x + view.box[0] * view.ptPerFt;
  const y0 = view.origin.y + view.box[1] * view.ptPerFt;
  const x1 = view.origin.x + view.box[2] * view.ptPerFt;
  const y1 = view.origin.y + view.box[3] * view.ptPerFt;
  const inside = (q: Pt) => q.x >= x0 - 0.01 && q.x <= x1 + 0.01 && q.y >= y0 - 0.01 && q.y <= y1 + 0.01;
  const out: Prim[] = [];
  for (const p of prims) {
    if (p.k === "path" && p.pts.length === 2 && !p.closed) {
      const [a, b] = p.pts;
      let t0 = 0;
      let t1 = 1;
      const d = sub(b, a);
      let ok = true;
      for (const [pp, q] of [[-d.x, a.x - x0], [d.x, x1 - a.x], [-d.y, a.y - y0], [d.y, y1 - a.y]] as [number, number][]) {
        if (Math.abs(pp) < 1e-12) {
          if (q < 0) ok = false;
          continue;
        }
        const r = q / pp;
        if (pp < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
      }
      if (ok && t1 - t0 > 1e-6) out.push({ ...p, pts: [add(a, mul(d, t0)), add(a, mul(d, t1))] });
      continue;
    }
    const pts = p.k === "path" ? p.pts : p.k === "bez" ? [p.start, ...p.segs.map((s) => s[2])] : [p.at];
    if (pts.every(inside)) out.push(p);
  }
  return out;
}

function partitionLegend(): Sheet {
  const b = new Builder();
  const ptPerFt = 216; // 3" = 1'-0"
  const codes = Object.values(PARTITION_TYPES);
  codes.forEach((t, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x0 = 150 + col * 1050;
    const y0 = 1500 - row * 260;
    const o = { w: 0.5, role: "detail" as Role, layer: "A-DETL" };
    const lines = new Set<number>(t.planLines);
    // Board layers and stud flanges, as a legend draws them.
    if (t.studRows > 0) {
      lines.add(t.planLines[0] - 0.625);
      lines.add(t.planLines[t.planLines.length - 1] + 0.625);
    }
    for (const inches of lines) {
      const y = y0 + (inches / 12) * ptPerFt;
      b.line({ x: x0, y }, { x: x0 + 2 * ptPerFt, y }, o);
    }
    // Studs as C-shapes every 16" — short vertical ticks.
    for (let s = 0; s < 2; s += t.studSpacingIn > 0 ? t.studSpacingIn / 12 : 3) {
      const x = x0 + s * ptPerFt + 20;
      b.line({ x, y: y0 - 30 }, { x, y: y0 + 30 }, { ...o, w: 0.3 });
    }
    b.text({ x: x0 + 2 * ptPerFt + 30, y: y0 + 10 }, t.code, 14, { role: "text", layer: "A-ANNO-TEXT" });
    b.text({ x: x0 + 2 * ptPerFt + 30, y: y0 - 8 }, t.description.slice(0, 58), 6.5, { role: "text", layer: "A-ANNO-TEXT" });
    b.text({ x: x0 + 2 * ptPerFt + 30, y: y0 - 20 }, t.description.slice(58), 6.5, { role: "text", layer: "A-ANNO-TEXT" });
  });
  b.text({ x: 150, y: 1680 }, "PARTITION TYPES   SCALE: 3\" = 1'-0\"", 14, { role: "text", layer: "A-ANNO-TEXT" });
  titleBlock(b, "A-501", "PARTITION TYPES", SCALE_3);
  return {
    id: "A-501",
    title: "PARTITION TYPES",
    widthPt: ARCH_D.w,
    heightPt: ARCH_D.h,
    prims: b.prims,
    views: [],
    printedScale: SCALE_3,
    traps: ["each partition type drawn as 2-6 parallel layer lines", "legend is drawn at 3\" = 1'-0\""],
    expectWalls: false,
  };
}

export type ScheduleRow = Record<string, string>;

export const DOOR_COLUMNS = ["MARK", "WIDTH", "HEIGHT", "TYPE", "MATERIAL", "FRAME", "RATING", "HDW SET", "REMARKS"];
export const WINDOW_COLUMNS = ["MARK", "TYPE", "WIDTH", "HEIGHT", "SILL", "GLAZING"];

/** The schedules as data — the answer key for schedule parsing. */
export function doorSchedule(): ScheduleRow[] {
  return L1.openings
    .filter((o) => o.kind === "door" || o.kind === "pair" || o.kind === "sidelite" || o.kind === "cased")
    .map((o, i) => ({
      MARK: o.mark,
      WIDTH: ftIn(o.widthFt),
      HEIGHT: ftIn(o.heightFt),
      TYPE: o.kind === "pair" ? "PR" : o.kind === "sidelite" ? "SL" : o.kind === "cased" ? "CO" : "A",
      MATERIAL: o.kind === "cased" ? "" : o.mark.startsWith("1") && Number(o.mark) >= 143 ? "HM" : "WD",
      FRAME: "HM",
      // Blank on most rows — a real schedule leaves a non-rated door's cell empty.
      RATING: ["120", "122", "145", "150A"].includes(o.mark) ? "90 MIN" : i % 7 === 0 ? "20 MIN" : "",
      "HDW SET": o.kind === "cased" ? "" : String((i % 6) + 1),
      REMARKS: o.kind === "pair" ? "PROVIDE CLOSERS AND FLUSH BOLTS" : o.kind === "sidelite" ? "TEMPERED SIDELITE" : "",
    }));
}

export function windowSchedule(): ScheduleRow[] {
  return L1.openings
    .filter((o) => o.kind === "window" || o.kind === "storefront" || o.kind === "relite")
    .map((o) => ({
      MARK: o.mark,
      TYPE: o.kind === "storefront" ? "SF" : o.kind === "relite" ? "RL" : o.mark.slice(0, 2),
      WIDTH: ftIn(o.widthFt),
      HEIGHT: ftIn(o.heightFt),
      SILL: o.kind === "storefront" ? "0'-0\"" : o.kind === "relite" ? "3'-0\"" : "3'-0\"",
      GLAZING: o.kind === "relite" ? "1/4\" TEMP" : "1\" IGU LOW-E",
    }));
}

function scheduleSheet(): Sheet {
  const b = new Builder();
  const table = (x0: number, y0: number, title: string, cols: string[], widths: number[], rows: ScheduleRow[]) => {
    b.text({ x: x0, y: y0 + 20 }, title, 12, { role: "text", layer: "A-ANNO-TEXT" });
    const pitch = 14;
    const total = widths.reduce((s, w) => s + w, 0);
    const xs = widths.reduce<number[]>((acc, w) => [...acc, (acc[acc.length - 1] ?? x0) + w], [x0]);
    cols.forEach((c, i) => b.text({ x: xs[i] + 3, y: y0 }, c, 7, { role: "table", layer: "A-ANNO-TEXT" }));
    rows.forEach((r, ri) => {
      const y = y0 - (ri + 1) * pitch;
      cols.forEach((c, i) => {
        const v = r[c] ?? "";
        if (v === "") return;
        if (c === "REMARKS" && v.length > 18) {
          // Wrapped onto two lines inside the cell, the way CAD tables do.
          const cut = v.lastIndexOf(" ", 18);
          b.text({ x: xs[i] + 3, y: y + 3 }, v.slice(0, cut), 5.5, { role: "table", layer: "A-ANNO-TEXT" });
          b.text({ x: xs[i] + 3, y: y - 3.5 }, v.slice(cut + 1), 5.5, { role: "table", layer: "A-ANNO-TEXT" });
          return;
        }
        b.text({ x: xs[i] + 3, y }, v, 7, { role: "table", layer: "A-ANNO-TEXT" });
      });
    });
    const tb = { w: 0.35, role: "table" as Role, layer: "A-ANNO-TEXT" };
    for (let ri = 0; ri <= rows.length + 1; ri += 1) {
      const y = y0 + 10 - ri * pitch;
      b.line({ x: x0, y }, { x: x0 + total, y }, tb);
    }
    for (const x of xs) b.line({ x, y: y0 + 10 }, { x, y: y0 + 10 - (rows.length + 1) * pitch }, tb);
  };
  // Side by side, rows on the SAME baselines: a real sheet does this.
  table(80, 1560, "DOOR SCHEDULE", DOOR_COLUMNS, [50, 55, 55, 40, 70, 45, 55, 55, 130], doorSchedule());
  table(1000, 1560, "WINDOW SCHEDULE", WINDOW_COLUMNS, [60, 40, 55, 55, 50, 90], windowSchedule());
  titleBlock(b, "A-601", "SCHEDULES", "NONE");
  return {
    id: "A-601",
    title: "DOOR AND WINDOW SCHEDULES",
    widthPt: ARCH_D.w,
    heightPt: ARCH_D.h,
    prims: b.prims,
    views: [],
    printedScale: "NONE",
    traps: ["two schedules side by side on the same baselines", "blank cells (unrated doors)", "remarks wrapped onto two lines", "table rules 14pt apart"],
    expectWalls: false,
  };
}

function elevationSheet(): Sheet {
  const view: View = { name: "ELEVATIONS", origin: { x: 230, y: 950 }, ptPerFt: 9, scaleName: SCALE_18, box: [0, 0, 0, 0], wallsAreScope: false };
  const b = new Builder(view);
  for (const [oy, label] of [
    [950, "SOUTH ELEVATION"],
    [450, "NORTH ELEVATION"],
  ] as [number, string][]) {
    const P = (x: number, y: number) => ({ x: 230 + x * 9, y: oy + y * 9 });
    const o = { w: 0.5, role: "elev" as Role, layer: "A-ELEV" };
    b.line(P(-5, 0), P(214, 0), { ...o, w: 1.5 });
    // Floor lines and parapet, cap flashing as two lines 8" apart.
    b.line(P(-0.7, 15), P(208.7, 15), { ...o, dash: [12, 4] });
    b.line(P(-0.7, 28), P(208.7, 28), { ...o, dash: [12, 4] });
    b.line(P(-0.7, 31), P(208.7, 31), o);
    b.line(P(-0.7, 31.67), P(208.7, 31.67), o);
    b.line(P(-0.7, 0), P(-0.7, 31.67), o);
    b.line(P(208.7, 0), P(208.7, 31.67), o);
    // EIFS reveals: pairs 3/4" apart.
    for (const y of [3, 15.5, 28.5]) for (const off of [0, 0.0625]) b.line(P(-0.7, y + off), P(208.7, y + off), { ...o, w: 0.25 });
    // Windows with 2" mullions.
    for (const x of [20, 60, 100, 140, 180]) {
      for (const yb of [4, 18]) {
        const p0 = P(x - 2, yb);
        b.rect(p0.x, p0.y, 4 * 9, 5 * 9, { ...o, w: 0.35 });
        for (const off of [-1 / 12, 1 / 12]) b.line(P(x + off, yb), P(x + off, yb + 5), { ...o, w: 0.25 });
      }
    }
    if (label === "SOUTH ELEVATION") {
      // Storefront: 4-1/2" mullions every 5' — two lines 0.375' apart, 10' tall.
      for (let x = 5; x <= 25; x += 5) for (const off of [-0.1875, 0.1875]) b.line(P(x + off, 0), P(x + off, 10), { ...o, w: 0.35 });
      b.line(P(5, 10), P(25, 10), o);
      b.line(P(5, 10.375), P(25, 10.375), o);
    }
    // Level markers and vertical dims.
    for (const [y, t] of [
      [0, "LEVEL 1  0'-0\""],
      [15, "LEVEL 2  15'-0\""],
      [28, "ROOF  28'-0\""],
    ] as [number, string][]) {
      const m = P(212, y);
      b.circle(m, 5, { w: 0.4, role: "tag", layer: "A-ANNO-SYMB" });
      b.text({ x: m.x + 10, y: m.y - 2 }, t, 6.5, { role: "text", layer: "A-ANNO-TEXT" });
    }
    const vb = new Builder({ ...view, origin: { x: 230, y: oy } });
    dim(vb, { x: 210, y: 0 }, { x: 210, y: 15 }, 0);
    dim(vb, { x: 210, y: 15 }, { x: 210, y: 28 }, 0);
    dim(vb, { x: 210, y: 28 }, { x: 210, y: 31.67 }, 0);
    dim(vb, { x: -0.7, y: -4 }, { x: 208.7, y: -4 }, 0);
    b.prims.push(...vb.prims);
    viewTitle(b, { x: 300, y: oy - 80 }, label, SCALE_18);
  }
  titleBlock(b, "A-201", "EXTERIOR ELEVATIONS", SCALE_18);
  return {
    id: "A-201",
    title: "EXTERIOR ELEVATIONS",
    widthPt: ARCH_D.w,
    heightPt: ARCH_D.h,
    prims: b.prims,
    views: [view],
    printedScale: SCALE_18,
    traps: ["long horizontal floor and parapet lines", "parapet cap flashing: two lines 8\" apart", "storefront mullions: two lines 4-1/2\" apart, 10' tall"],
    expectWalls: false,
  };
}

function framingSheet(): Sheet {
  const view: View = { ...planView(L2, "LEVEL 2 FRAMING PLAN"), wallsAreScope: false };
  const b = new Builder(view);
  grid(b);
  const xs = GRID.x.map((g) => g.at);
  const ys = GRID.y.map((g) => g.at);
  // Girders along the column lines, drawn double at their 9" flange width.
  const gird = { w: 0.6, role: "beam" as Role, layer: "S-BEAM" };
  for (const y of ys) for (const off of [-0.375, 0.375]) b.line(b.P({ x: xs[0], y: y + off }), b.P({ x: xs[xs.length - 1], y: y + off }), gird);
  // Beams single-line along the x grids, joists dashed at 5' o.c.
  for (const x of xs) b.line(b.P({ x, y: ys[0] }), b.P({ x, y: ys[ys.length - 1] }), { ...gird, w: 0.8 });
  for (let i = 0; i < xs.length - 1; i += 1) {
    for (let x = xs[i] + 5; x < xs[i + 1] - 1; x += 5) {
      b.line(b.P({ x, y: ys[0] }), b.P({ x, y: ys[ys.length - 1] }), { w: 0.3, role: "joist", layer: "S-JOIS", dash: [8, 4] });
    }
    b.text(b.P({ x: (xs[i] + xs[i + 1]) / 2, y: 45 }), "24K7 @ 5'-0\" O.C.", 6, { anchor: "middle", role: "text", layer: "S-ANNO" });
  }
  for (const y of ys) b.text(b.P({ x: 15, y: y + 1 }), "W24x55", 6, { role: "text", layer: "S-ANNO" });
  columns(b, L2);
  // Edge of slab, 1'-0" outside the grid, and the deck edge angle 3" inside it.
  for (const off of [1, 0.75]) {
    const p0 = b.P({ x: -off, y: -off });
    b.rect(p0.x, p0.y, (207.33 + 2 * off) * 9, (92 + 2 * off) * 9, { w: 0.5, role: "beam", layer: "S-SLAB" });
  }
  dim(b, { x: 0, y: -1 }, { x: 207.33, y: -1 }, -8);
  dim(b, { x: 0, y: -1 }, { x: 30, y: -1 }, -4);
  dim(b, { x: 30, y: -1 }, { x: 60, y: -1 }, -4);
  dim(b, { x: 60, y: -1 }, { x: 87.33, y: -1 }, -4);
  viewTitle(b, { x: 600, y: 330 }, "LEVEL 2 FRAMING PLAN", SCALE_18);
  titleBlock(b, "S-101", "LEVEL 2 FRAMING PLAN", SCALE_18);
  return {
    id: "S-101",
    title: "LEVEL 2 FRAMING PLAN",
    widthPt: ARCH_D.w,
    heightPt: ARCH_D.h,
    prims: b.prims,
    views: [view],
    printedScale: SCALE_18,
    traps: ["girders drawn double at 9\" flange width", "edge of slab + deck angle 3\" apart", "joists dashed at 5' o.c."],
    expectWalls: false,
  };
}

function mechanicalSheet(): Sheet {
  const view: View = { ...planView(L1, "LEVEL 1 MECHANICAL PLAN"), wallsAreScope: false };
  const b = new Builder(view);
  grid(b);
  // Architectural background, screened.
  drawWalls(b, L1, { pen: 0.2, gray: 0.6, hatchCmu: false });
  const duct = { w: 0.6, role: "duct" as Role, layer: "M-DUCT" };
  const run = (a: Pt, c: Pt, widthIn: number, label: string) => {
    const u = unit(sub(c, a));
    const n = normal(u);
    for (const s of [1, -1]) b.line(b.P(add(a, mul(n, (s * widthIn) / 24))), b.P(add(c, mul(n, (s * widthIn) / 24))), duct);
    b.text(b.P(add(mul(add(a, c), 0.5), mul(n, widthIn / 24 + 1))), label, 6, { anchor: "middle", role: "text", layer: "M-ANNO" });
  };
  // Supply trunk down the corridor (24" — wider than any wall).
  run({ x: 35, y: 46 }, { x: 180, y: 46 }, 24, "24x14 SA");
  // Branches into every exam room: 12", 10", 14".
  [35, 45, 55, 65, 75].forEach((x, i) => {
    run({ x, y: 47 }, { x, y: 60 }, [12, 10, 14, 12, 10][i], `${[12, 10, 14, 12, 10][i]}x10`);
    run({ x, y: 45 }, { x, y: 34 }, [12, 10, 14, 12, 10][i], `${[12, 10, 14, 12, 10][i]}x10`);
  });
  // Return main at exactly 18" — the top of the thickness window.
  run({ x: 92, y: 30 }, { x: 160, y: 30 }, 18, "18x12 RA");
  run({ x: 130, y: 52 }, { x: 130, y: 85 }, 16, "16x12 SA");
  for (const x of [35, 45, 55, 65, 75]) {
    const p0 = b.P({ x: x - 1, y: 58 });
    b.rect(p0.x, p0.y, 18, 18, { w: 0.4, role: "duct", layer: "M-DIFF", inst: b.inst("DIFF-24") });
  }
  viewTitle(b, { x: 600, y: 330 }, "LEVEL 1 MECHANICAL PLAN", SCALE_18);
  titleBlock(b, "M-101", "LEVEL 1 MECHANICAL", SCALE_18);
  return {
    id: "M-101",
    title: "LEVEL 1 MECHANICAL PLAN",
    widthPt: ARCH_D.w,
    heightPt: ARCH_D.h,
    prims: b.prims,
    views: [view],
    printedScale: SCALE_18,
    traps: ["ductwork drawn double, 10\"-18\" apart", "an 18\" duct sits exactly on the 1.5' thickness ceiling", "screened architectural background (duplicates)"],
    expectWalls: false,
  };
}

export function planSheetL1(opts: PlanOptions = {}): Sheet {
  return floorPlanSheet("A-101", opts.rev ? level1Rev1() : L1, "LEVEL 1 FLOOR PLAN", opts);
}

export function bidSet(): Sheet[] {
  return [
    coverSheet(),
    planSheetL1(),
    floorPlanSheet("A-102", L2, "LEVEL 2 FLOOR PLAN"),
    rcpSheet(),
    elevationSheet(),
    enlargedSheet(),
    partitionLegend(),
    scheduleSheet(),
    framingSheet(),
    mechanicalSheet(),
    planSheetL1({ rev: true }),
  ];
}

export const sheetBuilders = { coverSheet, planSheetL1, floorPlanSheet, rcpSheet, elevationSheet, enlargedSheet, partitionLegend, scheduleSheet, framingSheet, mechanicalSheet };
export { Builder, drawWalls, dim, grid, columns, rooms, titleBlock, planDims, typeTags, viewTitle, planView };
export const SCALES = { SCALE_18, SCALE_14, SCALE_12, SCALE_3 };
