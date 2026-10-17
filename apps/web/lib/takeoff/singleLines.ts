import type { StrokeSegment, WallCandidate } from "@/lib/takeoff/wallVectors";

/**
 * ── WHAT THE UNPAIRED LONG LINES ACTUALLY ARE ──
 *
 * Measured on two real sheets: of the long faces no reported wall covers, most
 * have NO parallel partner anywhere within the thickness band — 167 of 216 on
 * Camp Bow Wow A102 (7,694 ft) and 134 of 197 on ELEVEN03 A4.B.1 (8,485 ft).
 * A pairing engine cannot reach those by definition, so tuning the pair
 * filters will never find them.
 *
 * Before deciding whether any of them are walls, it is worth knowing what they
 * look like. This classifies them on evidence the geometry already carries,
 * so an answer-key reviewer is shown a handful of named classes rather than
 * eight thousand feet of line.
 *
 * ── IT CLASSIFIES, IT DOES NOT DECIDE ──
 *
 * Nothing here changes detection or proposes a wall. Every class is a
 * DESCRIPTION, and the answer key is what will say which of them matter. Two
 * of the six are inferred rather than read, and say so: the PDF extraction
 * keeps a pen width and a curve flag and nothing else, so dashes and fills are
 * not available and are deduced from the shape instead.
 */

/** One class, in the order a reviewer should meet them. */
export type SingleLineClass =
  | "heavier-than-walls"
  | "lighter-than-walls"
  | "in-a-hatch"
  | "dashed"
  | "past-the-building"
  | "small-closed-shape"
  | "unclassified";

export type ClassifiedLine = {
  line: StrokeSegment;
  lengthFeet: number;
  kind: SingleLineClass;
  /** Why, in the words a reviewer would use. */
  why: string;
};

export type ClassifyInput = {
  /** The long faces nobody claimed, in page-width units. */
  unclaimed: readonly StrokeSegment[];
  /** Every face on the sheet, for neighbourhood questions. */
  faces: readonly StrokeSegment[];
  /** The raw segments, for composition questions a joined face has lost. */
  segments: readonly StrokeSegment[];
  /** The walls that WERE reported, which define the building and its pens. */
  walls: readonly WallCandidate[];
  feetPerUnit: number;
};

function lengthOf(s: StrokeSegment): number {
  return Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
}

function angleOf(s: StrokeSegment): number {
  const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
  // Folded to a half turn: a line drawn right to left is the same line.
  return a < 0 ? a + Math.PI : a;
}

/** The median of a list, or null when it is empty. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function classifySingleLines(input: ClassifyInput): ClassifiedLine[] {
  const { unclaimed, faces, segments, walls, feetPerUnit } = input;

  // ── THE SHEET'S OWN WALL PEN ──
  //
  // Not a constant: every office plots at its own weights, and the question is
  // whether THIS line is heavier or lighter than the walls on THIS sheet. The
  // pen of a face that a reported wall covers is a wall pen by construction.
  const wallPens: number[] = [];
  for (const face of faces) {
    if (face.width === undefined) continue;
    const mx = (face.x1 + face.x2) / 2;
    const my = (face.y1 + face.y2) / 2;
    const onAWall = walls.some((w) => {
      const dx = w.x2 - w.x1;
      const dy = w.y2 - w.y1;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((mx - w.x1) * dx + (my - w.y1) * dy) / len2));
      return Math.hypot(mx - (w.x1 + t * dx), my - (w.y1 + t * dy)) * feetPerUnit <= 1.5;
    });
    if (onAWall) wallPens.push(face.width);
  }
  const wallPen = median(wallPens);

  // ── WHERE THE BUILDING IS ──
  //
  // The reported walls' own box. A line reaching well outside it is a property
  // line, a match line, a leader to a note, or the sheet's own furniture — the
  // one class here that is about POSITION rather than about the line itself.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const wall of walls) {
    minX = Math.min(minX, wall.x1, wall.x2);
    maxX = Math.max(maxX, wall.x1, wall.x2);
    minY = Math.min(minY, wall.y1, wall.y2);
    maxY = Math.max(maxY, wall.y1, wall.y2);
  }
  const margin = 10 / feetPerUnit;

  const out: ClassifiedLine[] = [];
  for (const line of unclaimed) {
    const lengthFeet = lengthOf(line) * feetPerUnit;
    const mine = angleOf(line);

    // ── DASHED, DEDUCED FROM COMPOSITION ──
    //
    // The extraction keeps no dash array, and `oneFacePerLine` has already
    // joined a dashed line's pieces into one face — so the evidence left is
    // how MANY raw segments lie along it. A solid line is one or two; a dashed
    // one is many short collinear pieces.
    let pieces = 0;
    for (const seg of segments) {
      if (Math.abs(angleOf(seg) - mine) > 0.05) continue;
      const mx = (seg.x1 + seg.x2) / 2;
      const my = (seg.y1 + seg.y2) / 2;
      const dx = line.x2 - line.x1;
      const dy = line.y2 - line.y1;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : ((mx - line.x1) * dx + (my - line.y1) * dy) / len2;
      if (t < 0 || t > 1) continue;
      if (Math.hypot(mx - (line.x1 + t * dx), my - (line.y1 + t * dy)) * feetPerUnit > 0.3) continue;
      pieces += 1;
    }

    // ── IN A HATCH, DEDUCED FROM COMPANY ──
    //
    // Hatching is many parallel lines at an even spacing. A line with several
    // parallel neighbours of a similar length nearby is in a field of them;
    // a wall face has ONE parallel neighbour, which is its other face, and
    // that one is already excluded because these are the unpaired lines.
    let parallelNeighbours = 0;
    for (const other of faces) {
      if (other === line) continue;
      if (Math.abs(angleOf(other) - mine) > 0.05) continue;
      const gap =
        Math.abs(
          (other.x1 - line.x1) * -Math.sin(mine) + (other.y1 - line.y1) * Math.cos(mine),
        ) * feetPerUnit;
      if (gap > 0 && gap <= 3) parallelNeighbours += 1;
    }

    const endsOutside =
      line.x1 < minX - margin ||
      line.x2 < minX - margin ||
      line.x1 > maxX + margin ||
      line.x2 > maxX + margin ||
      line.y1 < minY - margin ||
      line.y2 < minY - margin ||
      line.y1 > maxY + margin ||
      line.y2 > maxY + margin;

    // ── A SMALL CLOSED SHAPE ──
    //
    // A symbol, a column bubble's frame, a fixture outline. Both ends meet
    // other unclaimed lines, and the whole thing is short — which separates it
    // from a wall, whose ends meet WALLS.
    const meets = (px: number, py: number) =>
      unclaimed.some((other) => {
        if (other === line) return false;
        const at = (qx: number, qy: number) => Math.hypot(px - qx, py - qy) * feetPerUnit <= 1;
        return at(other.x1, other.y1) || at(other.x2, other.y2);
      });
    const closed = lengthFeet < 30 && meets(line.x1, line.y1) && meets(line.x2, line.y2);

    let kind: SingleLineClass = "unclassified";
    let why = "a single line with no partner, and nothing else to say about it";
    // Ordered most-telling first: a line can be several of these at once, and
    // the first match is the one a reviewer most needs to know.
    if (parallelNeighbours >= 3) {
      kind = "in-a-hatch";
      why = `${parallelNeighbours} parallel lines within 3 ft — a hatch or a fill, not a face`;
    } else if (pieces >= 4) {
      kind = "dashed";
      why = `${pieces} separate strokes along one line — drawn dashed, so it is shown rather than built`;
    } else if (closed) {
      kind = "small-closed-shape";
      why = "both ends meet other unpaired lines and it is under 30 ft — a symbol or a fixture";
    } else if (endsOutside) {
      kind = "past-the-building";
      why = "reaches outside the walls' own box — a match line, a property line or a leader";
    } else if (wallPen !== null && line.width !== undefined && line.width > wallPen * 1.5) {
      kind = "heavier-than-walls";
      why = `drawn at ${line.width.toFixed(2)}pt against the sheet's ${wallPen.toFixed(2)}pt wall pen — heavier`;
    } else if (wallPen !== null && line.width !== undefined && line.width < wallPen * 0.6) {
      kind = "lighter-than-walls";
      why = `drawn at ${line.width.toFixed(2)}pt against the sheet's ${wallPen.toFixed(2)}pt wall pen — lighter`;
    }
    out.push({ line, lengthFeet, kind, why });
  }
  return out;
}

/**
 * ── WHICH OF THESE A REVIEWER SHOULD BE ASKED ABOUT ──
 *
 * Every class above is a thing this file has already decided is not a wall
 * face, with a reason — and nothing acted on it, so an answer-key reviewer was
 * offered all of them. On Camp Bow Wow A102 that is 168 lines, of which 162
 * are `in-a-hatch` and 2 are `past-the-building`: an hour of pressing reject on
 * lines the app had already named.
 *
 * So only `unclassified` is offered. It is the honest set: the ones this file
 * looked at and could say nothing about, which is exactly the question a
 * reviewer is for.
 *
 * ── NOTHING IS HIDDEN SILENTLY, WHICH IS THE OTHER HALF ──
 *
 * The panel reports what was set aside and by which class, and can bring them
 * back. A key is a judgement about a drawing, and a reviewer who cannot see
 * what the app decided for them is reviewing the app's opinion rather than the
 * drawing. `AnswerKeyPanel` carries the control.
 */
export const OFFERED_CLASSES: readonly SingleLineClass[] = ["unclassified"];

/** Is this one a reviewer should be asked about by default? */
export function worthOffering(kind: SingleLineClass): boolean {
  return OFFERED_CLASSES.includes(kind);
}
