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

/** The thinnest and thickest thing worth calling one wall, in feet. */
const THINNEST_WALL_FEET = 0.2;
const THICKEST_WALL_FEET = 1.5;

/**
 * ── HATCHING BETWEEN A WALL'S TWO FACES IS A WALL, NOT A HATCHED AREA ──
 *
 * `in-a-hatch` is the only set-aside reason that hides real walls, and it
 * hides a LOT of them: measured against the keys on the eighteen training
 * sheets, 16,973 ft of confirmed wall — every foot of real wall any reason
 * withheld. The other five withheld 27,934 ft without a single foot of wall.
 *
 * The cause is in the rule's own comment, which says "a wall face has ONE
 * parallel neighbour, which is its other face". True of a wall drawn as two
 * empty lines, and false of a wall drawn POCHÉ — masonry, a rated assembly,
 * anything whose thickness is filled in. That wall has its two faces AND the
 * fill lines between them, so each face counts the fill as its neighbours and
 * is withheld as hatching. The wall is hidden BECAUSE it was drawn as solid.
 *
 * ── THE DISCRIMINATOR IS WHICH SIDE THE NEIGHBOURS ARE ON ──
 *
 * A line inside a field of hatching has neighbours on BOTH sides. A face
 * bounding a fill has them on ONE side — the fill is inside the wall, and
 * outside the face is room. So:
 *
 *   hatch line    ·  ─ ─ ─ ─ ─ ─ ─   neighbours above AND below
 *   wall face     ─  ═════════════   neighbours on one side only, and a
 *                 ·  ─────────────   partner at a wall thickness beyond them
 *
 * Requiring the PARTNER is what separates a poché wall from the edge of a
 * hatched floor area, which also has neighbours on one side: a wall's far
 * face sits 0.2 to 1.5 ft away, a floor area's far edge does not. Those are
 * the same bounds `wallVectors` uses to decide two lines are one wall, and
 * its own comment explains them — 2-1/2in is furring, 18in is a shaft wall.
 *
 * Returns the thickness it found, or null when this is hatching after all.
 */
function fillBetweenFaces(sides: readonly number[]): number | null {
  if (sides.length < 3) return null;
  const above = sides.filter((v) => v > 0);
  const below = sides.filter((v) => v < 0);
  // Neighbours on both sides: a line INSIDE the field. Hatching.
  if (above.length > 0 && below.length > 0) return null;
  const run = above.length > 0 ? above : below.map((v) => -v);
  const partner = Math.max(...run);
  if (partner < THINNEST_WALL_FEET || partner > THICKEST_WALL_FEET) return null;
  // ── NO INSIDE-COUNT HERE, AND THE REASON IS A SURVIVING MUTATION ──
  //
  // This required at least two neighbours strictly inside the pair, on the
  // grounds that a "fill between faces" needs something filling it. Deleting
  // that requirement changed no test and no sheet, so by this repo's own rule
  // it was a case that proves nothing — and the reason is structural rather
  // than a gap in the fixtures: this function's answer is only consulted when
  // `evenPitch` has already found a regular pitch on one side, which needs
  // three distinct gaps, which forces three neighbours inside the pair. The
  // check could never fire. It is gone rather than kept as reassurance.
  return partner;
}

/**
 * ── A HATCH HAS AN EVEN PITCH; A CROWDED PLAN DOES NOT ──
 *
 * The first attempt at this asked which SIDE the parallel neighbours were on,
 * reasoning that a face bounding its own fill has them on one side only. That
 * is true of a poché wall in isolation and it is a measured no-op here: it
 * released three lines and 448 ft of junk and not one foot of wall. The
 * instrument then said why, which is the only reason this second attempt is
 * aimed anywhere. Of the 16,530 ft of confirmed wall the hatch class withheld,
 * ALL of it — 438 lines of 438 — has parallel neighbours on BOTH sides.
 *
 * Three feet is a wide window in a dense plan. A real wall face has its own
 * far face on one side and, on the other, whatever the room contains: the
 * next wall across a furring space, a jamb, a dimension string, a fixture.
 * So "neighbours on both sides" describes a busy floor plan at least as well
 * as it describes hatching, which is why the side test could not separate
 * them.
 *
 * What hatching has and a floor plan does not is a CONSTANT PITCH. A fill is
 * generated: its lines sit at one spacing, repeated. The parallel company of
 * a wall face is placed by a person at whatever distances the building needs.
 * So the question is not where the neighbours are but whether they are evenly
 * spaced.
 *
 * Measured as the spread of the gaps between successive neighbours, relative
 * to their mean. A generated fill holds that ratio very low; anything a
 * person placed does not.
 *
 * Returns the pitch when the company really is a fill, else null — so a line
 * is withheld as hatching only when something regular is drawn around it.
 */
function evenPitch(sides: readonly number[]): number | null {
  // ── MEASURED PER SIDE, WHICH THE FIRST VERSION GOT WRONG ──
  //
  // Pooling both sides' distances into one sorted list makes a SYMMETRIC
  // field look ragged: a fill at an even 2in pitch on both sides reads as
  // 2, 2.1, 4, 4.1, 6, 6.1, whose successive gaps alternate 2 and 0.1 and
  // whose spread then exceeds any sane bound. The hatch fixture failed
  // exactly that way, which is the only reason this is per side now.
  const one = (run: number[]): number | null => {
    if (run.length < 3) return null;
    run.sort((a, b) => a - b);
    const gaps = [run[0]!];
    for (let i = 1; i < run.length; i += 1) gaps.push(run[i]! - run[i - 1]!);
    const real = gaps.filter((g) => g > 1e-9);
    if (real.length < 3) return null;
    const mean = real.reduce((n, g) => n + g, 0) / real.length;
    if (mean <= 0) return null;
    const spread = Math.sqrt(real.reduce((n, g) => n + (g - mean) * (g - mean), 0) / real.length);
    // A quarter of the mean. A generated fill sits far below it; anything a
    // person placed does not.
    return spread / mean <= 0.25 ? mean : null;
  };
  // Either side being a regular fill is enough — a wall face against a
  // hatched floor has the fill on one side and the room on the other.
  return one(sides.filter((v) => v > 0)) ?? one(sides.filter((v) => v < 0).map((v) => -v));
}

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
    /** Signed perpendicular offsets, in feet — the sign is which side. */
    const sides: number[] = [];
    for (const other of faces) {
      if (other === line) continue;
      if (Math.abs(angleOf(other) - mine) > 0.05) continue;
      const signed =
        ((other.x1 - line.x1) * -Math.sin(mine) + (other.y1 - line.y1) * Math.cos(mine)) *
        feetPerUnit;
      const gap = Math.abs(signed);
      if (gap > 0 && gap <= 3) {
        parallelNeighbours += 1;
        sides.push(signed);
      }
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
    const sayFilled = (feet: number) =>
      `a face with its partner ${(feet * 12).toFixed(0)}in away and the fill drawn between them — ` +
      `a hatched wall, not a hatched area`;
    // Ordered most-telling first: a line can be several of these at once, and
    // the first match is the one a reviewer most needs to know.
    const filled = fillBetweenFaces(sides);
    const pitch = evenPitch(sides);
    if (parallelNeighbours >= 3 && filled === null && pitch !== null) {
      kind = "in-a-hatch";
      // WHICH condition ruled out a filled wall, because "a hatch or a fill"
      // alone cannot be argued with — by a reviewer or by the next person
      // measuring this rule.
      const both = sides.some((v) => v > 0) && sides.some((v) => v < 0);
      const run = sides.map(Math.abs);
      const nearest = run.length === 0 ? 0 : Math.min(...run);
      why = both
        ? `${parallelNeighbours} parallel lines within 3 ft at an even ${((pitch ?? 0) * 12).toFixed(1)}in pitch` +
          ` — inside a hatch, not a face`
        : `${parallelNeighbours} parallel lines within 3 ft, all on ONE side, nearest ${(nearest * 12).toFixed(0)}in` +
          ` — a hatch edge rather than a face with its fill`;
    } else if (parallelNeighbours >= 3 && pitch === null) {
      // Crowded, but not by anything regular — so the company is a floor
      // plan's own geometry and this line is offered like any other.
      why =
        `${parallelNeighbours} parallel lines within 3 ft, but unevenly spaced — ` +
        `crowded by the plan rather than filled by a hatch`;
    } else if (parallelNeighbours >= 3 && filled !== null) {
      // Left `unclassified`, which is what gets OFFERED, and says why rather
      // than falling through to the catch-all.
      why = sayFilled(filled);
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
