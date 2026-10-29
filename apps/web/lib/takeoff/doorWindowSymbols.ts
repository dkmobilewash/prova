import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── DOORS AND WINDOWS FROM THE PLAN'S OWN SYMBOLS ──
 *
 * `openings.ts` finds a doorway as a GAP in a wall face and says so in its
 * header: no arc fitting, because an arc "reaches us as dozens of flattened
 * bezier segments". This file is that other problem, taken on. A door on a
 * floor plan is drawn the same way by every CAD program since drafting
 * boards: a leaf line standing off the wall at the hinge, and a quarter-circle
 * swing from the leaf's tip back to the strike point in the wall. Its RADIUS
 * is the door's width. That is a measurement the gap detector cannot make
 * (the gap is narrower than the door, as `openingMarks.ts` measured), and a
 * door the gap detector never saw at all is still a door here.
 *
 * Measured first, before any of this was written: on the four training floor
 * plans not ONE door-sized quarter arc arrives flagged `curved` — the swings
 * are exported as runs of short straight pieces. So the chain below does not
 * read the flag; it reads the geometry — consecutive short pieces turning the
 * same way by a little each — and fits a circle to the run.
 *
 * A window is the other symbol: the wall faces stop, and across the gap run
 * two or three lines parallel to the wall — the frame at each face and the
 * glass between them. The glass line is the tell, because a plain wall never
 * has a line INSIDE its own thickness.
 *
 * Units: whatever the segments and walls are in, with `feetPerUnit` to turn
 * them into feet, the same contract as `openingsInWalls`.
 */

export type DoorSymbol = {
  kind: "door";
  /** Hinge, in the input units. */
  hinge: { x: number; y: number };
  /** Where the leaf lands in the wall when closed. */
  strike: { x: number; y: number };
  /** Hinge to strike, feet — the leaf, which is the door's width. */
  widthFeet: number;
  /** The wall run it sits in, as an index into the walls given, or null. */
  wall: number | null;
  /** Two leaves meeting at one strike: a pair, reported once at full width. */
  leaves: 1 | 2;
  /** The swing's sweep, degrees, for a reviewer. */
  sweepDegrees: number;
};

export type WindowSymbol = {
  kind: "window";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  widthFeet: number;
  /** The parallel wall run within reach, as an index into the walls given, or -1. */
  wall: number;
  /** How many distinct lines run across it (3 = frame, glass, frame). */
  lines: number;
};

/** A leaf narrower than this is a cabinet door or a hatch, not a doorway. */
export const NARROWEST_LEAF_FEET = 1.5;
/** Wider than this is a gate or a garage door — a different symbol. */
export const WIDEST_LEAF_FEET = 7;
/** A swing this far from a quarter circle is a different thing (a 180° swing is a double-acting door, a 30° one a cabinet). */
/** Baker A101 draws door 101 at 65°; nothing else on four plans fits a circle at 1.5-7 ft with a sweep this low. */
export const SWEEP_MIN_DEGREES = 55;
export const SWEEP_MAX_DEGREES = 110;
/** How far a vertex may sit off the fitted circle, as a fraction of its radius. */
export const CIRCLE_FIT_TOLERANCE = 0.04;
/** A piece of a flattened arc is short; one longer than this, in feet, is a wall. */
export const LONGEST_ARC_PIECE_FEET = 1.5;
/** The leaf's ends must land this close, feet, to the hinge and to the arc's end. */
export const LEAF_END_TOLERANCE_FEET = 0.5;
/** Hinge and strike must both lie this close, feet, to the wall run's centreline band. */
export const ON_WALL_TOLERANCE_FEET = 0.75;
/** A window's lines are this long at least, and no longer than a storefront. */
export const NARROWEST_WINDOW_FEET = 1;
export const WIDEST_WINDOW_FEET = 16;

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Algebraic (Kåsa) circle fit: cheap, and plenty for a drawn arc. */
function fitCircle(points: readonly Pt[]): { cx: number; cy: number; r: number; worst: number } | null {
  const n = points.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const p of points) {
    const z = p.x * p.x + p.y * p.y;
    sx += p.x; sy += p.y; sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y; sxz += p.x * z; syz += p.y * z; sz += z;
  }
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] · [a b c] = [sxz syz sz], circle x²+y² = a x + b y + c.
  const m = [[sxx, sxy, sx, sxz], [sxy, syy, sy, syz], [sx, sy, n, sz]];
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(m[k]![i]!) > Math.abs(m[p]![i]!)) p = k;
    [m[i], m[p]] = [m[p]!, m[i]!];
    if (Math.abs(m[i]![i]!) < 1e-12) return null;
    for (let k = i + 1; k < 3; k++) {
      const f = m[k]![i]! / m[i]![i]!;
      for (let j = i; j < 4; j++) m[k]![j]! -= f * m[i]![j]!;
    }
  }
  const sol = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = m[i]![3]!;
    for (let j = i + 1; j < 3; j++) s -= m[i]![j]! * sol[j]!;
    sol[i] = s / m[i]![i]!;
  }
  const cx = sol[0]! / 2, cy = sol[1]! / 2;
  const r = Math.sqrt(Math.max(0, sol[2]! + cx * cx + cy * cy));
  if (!(r > 0)) return null;
  let worst = 0;
  for (const p of points) worst = Math.max(worst, Math.abs(dist(p, { x: cx, y: cy }) - r));
  return { cx, cy, r, worst: worst / r };
}

const turn = (a: StrokeSegment, b: StrokeSegment) => {
  const t1 = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), t2 = Math.atan2(b.y2 - b.y1, b.x2 - b.x1);
  let d = t2 - t1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

/**
 * Runs of short pieces, each starting where the last ended and turning the
 * same way by a little, in the order the drawing emitted them — a flattened
 * arc is emitted in order, and nothing else is.
 */
export function arcChains(segments: readonly StrokeSegment[], feetPerUnit: number): Pt[][] {
  const longest = LONGEST_ARC_PIECE_FEET / feetPerUnit;
  const joinTol = 0.02 / feetPerUnit;
  const chains: Pt[][] = [];
  let chain: Pt[] = [];
  let prev: StrokeSegment | null = null;
  let sign = 0;
  const flush = () => { if (chain.length >= 4) chains.push(chain); chain = []; prev = null; sign = 0; };
  for (const s of segments) {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (len > longest || len === 0) { flush(); continue; }
    if (prev !== null) {
      const joined = Math.hypot(prev.x2 - s.x1, prev.y2 - s.y1) <= joinTol;
      const t = turn(prev, s);
      const small = Math.abs(t) > 0.01 && Math.abs(t) < 0.6;
      const same = sign === 0 || Math.sign(t) === sign;
      if (!joined || !small || !same) flush();
      else sign = Math.sign(t);
    }
    if (prev === null) chain.push({ x: s.x1, y: s.y1 });
    chain.push({ x: s.x2, y: s.y2 });
    prev = s;
  }
  flush();
  return chains;
}

function sweepDegrees(c: { cx: number; cy: number }, a: Pt, b: Pt, mid: Pt): number {
  const ang = (p: Pt) => Math.atan2(p.y - c.cy, p.x - c.cx);
  let s = ang(b) - ang(a);
  while (s > Math.PI) s -= 2 * Math.PI;
  while (s < -Math.PI) s += 2 * Math.PI;
  // The midpoint decides which way round: a quarter arc's midpoint is between the ends.
  let m = ang(mid) - ang(a);
  while (m > Math.PI) m -= 2 * Math.PI;
  while (m < -Math.PI) m += 2 * Math.PI;
  if (Math.sign(m) !== Math.sign(s)) s = s - Math.sign(s) * 2 * Math.PI;
  return Math.abs((s * 180) / Math.PI);
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function wallFor(walls: readonly WallCandidate[], a: Pt, b: Pt, feetPerUnit: number): number | null {
  const tol = ON_WALL_TOLERANCE_FEET / feetPerUnit;
  const doorWidth = dist(a, b);
  let best: { i: number; d: number } | null = null;
  walls.forEach((w, i) => {
    if (w.curved) return;
    const wx = w.x2 - w.x1, wy = w.y2 - w.y1, wl = Math.hypot(wx, wy);
    if (wl === 0) return;
    // On the run's LINE, with the hinge and strike both allowed to sit up to
    // a door's width past its ends: the finder's run often stops at the
    // jamb, and the door is in the gap beside it rather than on the run.
    const reach = tol + (w.thicknessFeet / feetPerUnit) / 2;
    const perp = (p: Pt) => Math.abs((p.x - w.x1) * -wy + (p.y - w.y1) * wx) / wl;
    const along = (p: Pt) => ((p.x - w.x1) * wx + (p.y - w.y1) * wy) / wl;
    const onLine = (p: Pt) => perp(p) <= reach && along(p) >= -doorWidth - tol && along(p) <= wl + doorWidth + tol;
    if (!onLine(a) || !onLine(b)) return;
    const d = Math.max(perp(a), perp(b));
    if (best === null || d < best.d) best = { i, d };
  });
  return best === null ? null : (best as { i: number }).i;
}

export type DoorArcCandidate = {
  chain: Pt[];
  fit: { cx: number; cy: number; r: number; worst: number } | null;
  radiusFeet: number | null;
  sweepDegrees: number | null;
  /** Why it is not a door, or null when it is one. */
  reject: "no-fit" | "off-circle" | "radius" | "sweep" | "no-leaf" | null;
  door: DoorSymbol | null;
};

/** Every arc-shaped chain on the sheet, judged — the eval reads the rejects. */
export function doorArcCandidates(
  segments: readonly StrokeSegment[],
  walls: readonly WallCandidate[],
  feetPerUnit: number,
): DoorArcCandidate[] {
  if (!(feetPerUnit > 0)) return [];
  const leafTol = LEAF_END_TOLERANCE_FEET / feetPerUnit;
  const straight = segments.filter((s) => !s.curved);
  const out: DoorArcCandidate[] = [];
  for (const chain of arcChains(segments, feetPerUnit)) {
    const fit = fitCircle(chain);
    const base = { chain, fit, radiusFeet: fit ? fit.r * feetPerUnit : null, sweepDegrees: null as number | null, door: null };
    if (fit === null) { out.push({ ...base, reject: "no-fit" }); continue; }
    if (fit.worst > CIRCLE_FIT_TOLERANCE) { out.push({ ...base, reject: "off-circle" }); continue; }
    const rFeet = fit.r * feetPerUnit;
    if (rFeet < NARROWEST_LEAF_FEET || rFeet > WIDEST_LEAF_FEET) { out.push({ ...base, reject: "radius" }); continue; }
    const a = chain[0]!, b = chain[chain.length - 1]!, mid = chain[Math.floor(chain.length / 2)]!;
    const sweep = sweepDegrees(fit, a, b, mid);
    if (sweep < SWEEP_MIN_DEGREES || sweep > SWEEP_MAX_DEGREES) { out.push({ ...base, sweepDegrees: sweep, reject: "sweep" }); continue; }
    const hinge = { x: fit.cx, y: fit.cy };
    // The leaf: a straight piece from the hinge to one end of the arc. Its
    // other end is the strike, in the wall.
    let strike: Pt | null = null;
    for (const s of straight) {
      const p1 = { x: s.x1, y: s.y1 }, p2 = { x: s.x2, y: s.y2 };
      const len = dist(p1, p2);
      if (Math.abs(len - fit.r) > leafTol) continue;
      const fromHinge = dist(p1, hinge) <= leafTol ? p2 : dist(p2, hinge) <= leafTol ? p1 : null;
      if (fromHinge === null) continue;
      if (dist(fromHinge, a) <= leafTol) { strike = b; break; }
      if (dist(fromHinge, b) <= leafTol) { strike = a; break; }
    }
    if (strike === null) { out.push({ ...base, sweepDegrees: sweep, reject: "no-leaf" }); continue; }
    out.push({
      ...base,
      sweepDegrees: sweep,
      reject: null,
      door: {
        kind: "door",
        hinge,
        strike,
        widthFeet: dist(hinge, strike) * feetPerUnit,
        wall: wallFor(walls, hinge, strike, feetPerUnit),
        leaves: 1,
        sweepDegrees: sweep,
      },
    });
  }
  return out;
}

export function doorSymbols(
  segments: readonly StrokeSegment[],
  walls: readonly WallCandidate[],
  feetPerUnit: number,
): DoorSymbol[] {
  const all = doorArcCandidates(segments, walls, feetPerUnit).map((c) => c.door).filter((d): d is DoorSymbol => d !== null);
  // MHK draws each office door three times over (three layers, one swing);
  // the same hinge and strike is one door.
  const same = 0.3 / feetPerUnit;
  const doors: DoorSymbol[] = [];
  for (const d of all) {
    if (doors.some((o) => dist(o.hinge, d.hinge) <= same && dist(o.strike, d.strike) <= same)) continue;
    doors.push(d);
  }
  return pairLeaves(doors, feetPerUnit);
}

/** Two leaves whose strikes meet and whose hinges face each other are one pair. */
function pairLeaves(doors: DoorSymbol[], feetPerUnit: number): DoorSymbol[] {
  const meet = 0.4 / feetPerUnit;
  const used = new Set<number>();
  const out: DoorSymbol[] = [];
  for (let i = 0; i < doors.length; i++) {
    if (used.has(i)) continue;
    const d = doors[i]!;
    let paired = false;
    for (let j = i + 1; j < doors.length && !paired; j++) {
      if (used.has(j)) continue;
      const e = doors[j]!;
      if (dist(d.strike, e.strike) > meet) continue;
      const width = dist(d.hinge, e.hinge) * feetPerUnit;
      if (Math.abs(width - d.widthFeet - e.widthFeet) > 0.6) continue;
      used.add(j);
      out.push({ ...d, strike: e.hinge, widthFeet: width, leaves: 2 });
      paired = true;
    }
    if (!paired) out.push(d);
  }
  return out;
}

/** The widest wall a window symbol sits in, feet, frame line to frame line. */
export const WINDOW_BAND_FEET = 1.25;

/**
 * The window symbol on its own: two frame lines with glass between them,
 * parallel, stacked across a wall's thickness and all stopping at the same
 * two ends. It is found without the walls — Bunkie's east windows sit in
 * the CMU between piers while the finder's wall there is the furring line a
 * foot inboard, so a search inside the found wall's band saw none of them.
 * The wall is attached afterwards, when one runs parallel within reach.
 */
/** A window tag (W1, W2, A, 1…) drawn within this many feet of the window says it is one. */
export const WINDOW_TAG_REACH_FEET = 6;

export function windowSymbols(
  segments: readonly StrokeSegment[],
  walls: readonly WallCandidate[],
  feetPerUnit: number,
  /** Window tags on the sheet (text inside a symbol), page-width units, when known. */
  tags: readonly { x: number; y: number }[] = [],
): WindowSymbol[] {
  if (!(feetPerUnit > 0)) return [];
  const minLen = NARROWEST_WINDOW_FEET / feetPerUnit, maxLen = WIDEST_WINDOW_FEET / feetPerUnit;
  const band = WINDOW_BAND_FEET / feetPerUnit;
  const endTol = 0.5 / feetPerUnit;
  const inside = 0.5 / 12 / feetPerUnit;
  type Line = { x1: number; y1: number; x2: number; y2: number; ang: number; len: number; mx: number; my: number };
  const lines: Line[] = [];
  for (const s of segments) {
    if (s.curved) continue;
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (len < minLen || len > maxLen) continue;
    let ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    if (ang < 0) ang += Math.PI;
    if (ang >= Math.PI - 1e-9) ang = 0;
    lines.push({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, ang, len, mx: (s.x1 + s.x2) / 2, my: (s.y1 + s.y2) / 2 });
  }
  // Candidates near each other: a coarse grid of window-sized cells.
  const cell = maxLen;
  const grid = new Map<string, number[]>();
  const keyOf = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  lines.forEach((l, i) => { const k = keyOf(l.mx, l.my); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  const exterior = exteriorWalls(walls, feetPerUnit);
  const used = new Set<number>();
  const out: WindowSymbol[] = [];
  const parallel = (a: Line, b: Line) => { const d = Math.abs(a.ang - b.ang); return Math.min(d, Math.PI - d) <= (3 * Math.PI) / 180; };
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const a = lines[i]!;
    const ex = Math.cos(a.ang), ey = Math.sin(a.ang);
    const proj = (x: number, y: number) => (x - a.x1) * ex + (y - a.y1) * ey;
    const off = (x: number, y: number) => (x - a.x1) * -ey + (y - a.y1) * ex;
    const aLo = Math.min(proj(a.x1, a.y1), proj(a.x2, a.y2)), aHi = Math.max(proj(a.x1, a.y1), proj(a.x2, a.y2));
    const group: { i: number; off: number }[] = [{ i, off: 0 }];
    const cx = Math.floor(a.mx / cell), cy = Math.floor(a.my / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (const j of grid.get(`${gx},${gy}`) ?? []) {
        if (j === i || used.has(j)) continue;
        const b = lines[j]!;
        if (!parallel(a, b)) continue;
        const o = (off(b.x1, b.y1) + off(b.x2, b.y2)) / 2;
        if (Math.abs(o) > band) continue;
        const bLo = Math.min(proj(b.x1, b.y1), proj(b.x2, b.y2)), bHi = Math.max(proj(b.x1, b.y1), proj(b.x2, b.y2));
        if (Math.abs(bLo - aLo) > endTol || Math.abs(bHi - aHi) > endTol) continue;
        group.push({ i: j, off: o });
      }
    }
    const offs = [...new Set(group.map((g) => Math.round(g.off / inside)))].sort((p, q) => p - q);
    if (offs.length < 3) continue;
    const spread = (offs[offs.length - 1]! - offs[0]!) * inside;
    // Frame to frame is a wall's thickness, not a hairline and not a room.
    if (spread < 2 / 12 / feetPerUnit || spread > band) continue;
    for (const g of group) used.add(g.i);
    const midOff = ((offs[0]! + offs[offs.length - 1]!) / 2) * inside;
    const x1 = a.x1 + ex * aLo + -ey * midOff, y1 = a.y1 + ey * aLo + ex * midOff;
    const x2 = a.x1 + ex * aHi + -ey * midOff, y2 = a.y1 + ey * aHi + ex * midOff;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    // ...and it has to be in an EXTERIOR wall: on a found run's line (a foot
    // of slack for Bunkie's furring-line walls), within a window's width of
    // its ends, running parallel. Measured before this rule: the pattern on
    // its own is also a desk, a cubicle panel, a counter, a closet shelf, a
    // rated wall's hatch and an underlined room name — 183 of them on MHK's
    // office floor, 55 on Baker, where the plan has no window at all.
    let wall = -1, best = Infinity;
    walls.forEach((w, wi) => {
      if (w.curved || !exterior[wi]) return;
      const wx = w.x2 - w.x1, wy = w.y2 - w.y1, wl = Math.hypot(wx, wy);
      if (wl === 0) return;
      const wa = Math.atan2(wy, wx);
      const d = Math.abs(((wa % Math.PI) + Math.PI) % Math.PI - a.ang);
      if (Math.min(d, Math.PI - d) > (5 * Math.PI) / 180) return;
      const t = ((mx - w.x1) * wx + (my - w.y1) * wy) / wl;
      if (t < -maxLen || t > wl + maxLen) return;
      const perp = Math.abs((mx - w.x1) * -wy + (my - w.y1) * wx) / wl;
      const reach = (w.thicknessFeet / 2 + 1) / feetPerUnit;
      if (perp > reach) return;
      if (perp < best) { best = perp; wall = wi; }
    });
    if (wall === -1) continue;
    // ── IN A GAP OF THE WALL, NOT ON A WALL ──
    // A window's frame lines ARE the wall's faces where the wall stops; a
    // rated wall's hatch and a desk against the wall sit under faces that run
    // straight past them. So if a straight stroke at either frame's offset
    // runs on beyond both ends of the window, this is not a window — unless
    // the sheet puts a window tag beside it, which is the drawing saying so.
    const tagged = tags.some((t) => Math.hypot(t.x - mx, t.y - my) <= WINDOW_TAG_REACH_FEET / feetPerUnit);
    if (!tagged) {
      const beyond = 1 / feetPerUnit;
      const frameOffs = [offs[0]! * inside, offs[offs.length - 1]! * inside];
      let covered = false;
      for (const s of segments) {
        if (covered) break;
        if (s.curved) continue;
        const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        if (len <= (aHi - aLo) + beyond) continue;
        let ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
        if (ang < 0) ang += Math.PI;
        const d = Math.abs(ang - a.ang);
        if (Math.min(d, Math.PI - d) > (2 * Math.PI) / 180) continue;
        const o = (off(s.x1, s.y1) + off(s.x2, s.y2)) / 2;
        if (!frameOffs.some((fo) => Math.abs(o - fo) <= inside)) continue;
        const lo = Math.min(proj(s.x1, s.y1), proj(s.x2, s.y2)), hi = Math.max(proj(s.x1, s.y1), proj(s.x2, s.y2));
        if (lo <= aLo - beyond && hi >= aHi + beyond) covered = true;
      }
      if (covered) continue;
    }
    out.push({ kind: "window", x1, y1, x2, y2, widthFeet: (aHi - aLo) * feetPerUnit, wall, lines: offs.length });
  }
  return mergeLites(out, feetPerUnit);
}

/** A storefront's lites sit this close, mullion to mullion; farther apart they are two windows. */
export const MULLION_FEET = 0.6;

/**
 * ── ONE STOREFRONT IS ONE WINDOW, NOT A WINDOW PER LITE ──
 *
 * Seen by eye on Joplin A-101 (2026-10-29): the vestibule's glazing read as
 * three windows of 2.1–2.3 ft — one per lite between mullions — and
 * Sherwin-Williams' storefront as six of 1.6 ft. A contractor counts the
 * opening. So symbols on the same wall, collinear, with no more than a
 * mullion between their ends, are joined into one window of the whole
 * width. Joining only ever lowers the count; it cannot invent a window.
 */
export function mergeLites(windows: readonly WindowSymbol[], feetPerUnit: number): WindowSymbol[] {
  const gapMax = MULLION_FEET / feetPerUnit;
  const inside = 2 / 12 / feetPerUnit;
  const merged: WindowSymbol[] = windows.map((w) => ({ ...w }));
  let joined = true;
  while (joined) {
    joined = false;
    for (let i = 0; i < merged.length && !joined; i += 1) {
      const a = merged[i]!;
      const ax = a.x2 - a.x1, ay = a.y2 - a.y1, al = Math.hypot(ax, ay);
      if (al === 0) continue;
      const ux = ax / al, uy = ay / al;
      for (let j = i + 1; j < merged.length; j += 1) {
        const b = merged[j]!;
        if (a.wall !== b.wall) continue;
        const bx = b.x2 - b.x1, by = b.y2 - b.y1, bl = Math.hypot(bx, by);
        if (bl === 0) continue;
        if (Math.abs(ux * bx + uy * by) / bl < Math.cos((3 * Math.PI) / 180)) continue;
        const off = (p: number, q: number) => Math.abs((p - a.x1) * -uy + (q - a.y1) * ux);
        if (off(b.x1, b.y1) > inside || off(b.x2, b.y2) > inside) continue;
        const t = (p: number, q: number) => (p - a.x1) * ux + (q - a.y1) * uy;
        const aLo = Math.min(t(a.x1, a.y1), t(a.x2, a.y2)), aHi = Math.max(t(a.x1, a.y1), t(a.x2, a.y2));
        const bLo = Math.min(t(b.x1, b.y1), t(b.x2, b.y2)), bHi = Math.max(t(b.x1, b.y1), t(b.x2, b.y2));
        const gap = Math.max(bLo - aHi, aLo - bHi);
        if (gap > gapMax) continue;
        const lo = Math.min(aLo, bLo), hi = Math.max(aHi, bHi);
        merged[i] = { ...a, x1: a.x1 + ux * lo, y1: a.y1 + uy * lo, x2: a.x1 + ux * hi, y2: a.y1 + uy * hi, widthFeet: (hi - lo) * feetPerUnit, lines: Math.max(a.lines, b.lines) };
        merged.splice(j, 1);
        joined = true;
        break;
      }
    }
  }
  return merged;
}

/** How far to look for another wall before calling a side of a wall "outside". */
export const OUTSIDE_LOOK_FEET = 60;

/**
 * A wall is exterior when nothing stands on one side of it: a ray from its
 * midpoint, perpendicular, meets no other wall within `OUTSIDE_LOOK_FEET`.
 * Interior partitions meet a wall on both sides well inside that; a hull
 * would have done the same but loses every re-entrant wall of an L-shaped
 * building and every inner face of a sheet carrying three plans.
 */
export function exteriorWalls(walls: readonly WallCandidate[], feetPerUnit: number): boolean[] {
  const look = OUTSIDE_LOOK_FEET / feetPerUnit;
  const hits = (ox: number, oy: number, dx: number, dy: number, skip: number): boolean => {
    for (let i = 0; i < walls.length; i++) {
      if (i === skip) continue;
      const w = walls[i]!;
      // Ray (o + t·d, t in (0, look]) against segment w.
      const sx = w.x2 - w.x1, sy = w.y2 - w.y1;
      const den = dx * sy - dy * sx;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((w.x1 - ox) * sy - (w.y1 - oy) * sx) / den;
      const u = ((w.x1 - ox) * dy - (w.y1 - oy) * dx) / den;
      if (t > 1e-9 && t <= look && u >= 0 && u <= 1) return true;
    }
    return false;
  };
  return walls.map((w, i) => {
    if (w.curved) return false;
    const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    if (len === 0) return false;
    const nx = -(w.y2 - w.y1) / len, ny = (w.x2 - w.x1) / len;
    return !hits(mx, my, nx, ny, i) || !hits(mx, my, -nx, -ny, i);
  });
}
