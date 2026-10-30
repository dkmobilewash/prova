import type { WallCandidate } from "./wallVectors";

/**
 * ── A TAG NAMES A WALL, AND A WALL IS LONGER THAN THE RUN IT LANDS ON ──
 *
 * The finder hands back runs — segments between the places where something
 * interrupts a line — and a drafter tags a WALL once, usually near its
 * middle. Measured on the training sheets 2026-10-20: 1–28% of a sheet's
 * runs carry a tag directly, while the walls those runs belong to are most
 * of the drawing. So the type has to travel from the tagged run along the
 * wall it is part of, and stop where the wall stops being that wall.
 *
 * ── WHERE IT STOPS ──
 *
 *   - at a THICKNESS change: a 6in wall meeting a 3-5/8in wall is a different
 *     assembly whatever the tags say;
 *   - at a DIFFERENT TAG: a run already named something else is a boundary,
 *     and the two tags disagreeing about the run between them is reported;
 *   - where the line TURNS: propagation is along a straight wall only. A
 *     corner is a new wall, and the tag for it is the drafter's to place;
 *   - where TWO continuations exist in the same direction (a run splits), it
 *     stops rather than guess.
 *
 * A T-junction does not stop it: the wall runs straight past the partition
 * that meets it, and so does its type.
 *
 * ── THE DEFAULT IS A DIFFERENT KIND OF ANSWER ──
 *
 * `wallNotes` reads "ALL PARTITIONS TYPE A1 U.N.O." Every run still untyped
 * after propagation takes that type, marked `default`, never `tagged`: an
 * estimator reading the quantity needs to know which feet the drawing named
 * and which feet a general note covers, because the note is what a GC will
 * argue about.
 *
 * Pure: takes runs and the run-to-code map, edits nothing it is handed.
 */

/** Two endpoints closer than this, in feet, touch. */
export const TOUCH_FEET = 0.75;
/**
 * How far along the same line a wall may be interrupted and still be the
 * same wall. A door is a gap in the line work, and the wall — and its type —
 * continues on the far side. A run across a gap must still lie on the line
 * (offset within the wall's own thickness) and not merely point the same way.
 *
 * Seven feet is a pair of 3-ft leaves and a frame, not `openings.ts`'s 12-ft
 * widest door: at 12 ft, E Street A2.1 carried type 2 across an 8-ft open
 * passage between the IT room's wall and a storage partition that happens
 * to lie on the same line — a corridor is a gap too, and a wider allowance
 * bridges more of them than it bridges double doors.
 */
export const GAP_FEET = 7;
/** Runs within this many degrees of each other are collinear. */
export const COLLINEAR_DEGREES = 6;
/** Thicknesses within this share of each other are the same wall. */
export const SAME_THICKNESS_SHARE = 0.2;

export type TypeSource = "tagged" | "propagated" | "default";

export type RunType = {
  code: string;
  source: TypeSource;
  /** For a propagated run, the tagged run the type travelled from. */
  via?: WallCandidate;
};

export type PropagationReport = {
  byRun: Map<WallCandidate, RunType>;
  /** Runs two different tags both reached, left untyped and listed. */
  conflicts: { run: WallCandidate; codes: string[] }[];
  feet: Record<TypeSource | "untyped", number>;
};

export function propagateTypes(input: {
  walls: readonly WallCandidate[];
  tagged: ReadonlyMap<WallCandidate, string>;
  feetPerUnit: number;
  /** The U.N.O. type from the sheet's notes, or null. */
  defaultCode: string | null;
  /** Override for the gap a type may cross; `TOUCH_FEET` means touching only. */
  gapFeet?: number;
}): PropagationReport {
  const { walls, tagged, feetPerUnit, defaultCode } = input;
  const gapFeet = input.gapFeet ?? GAP_FEET;
  const byRun = new Map<WallCandidate, RunType>();
  const reached = new Map<WallCandidate, Set<string>>();
  for (const [run, code] of tagged) byRun.set(run, { code, source: "tagged" });

  const touch = feetPerUnit > 0 ? TOUCH_FEET / feetPerUnit : 0;
  const gap = feetPerUnit > 0 ? gapFeet / feetPerUnit : 0;
  const straight = walls.filter((w) => !w.curved);

  // ── FROM EACH TAGGED RUN, OUT OF BOTH ENDS ──
  for (const [start, code] of tagged) {
    for (const end of [0, 1] as const) {
      let current = start;
      let at = end === 0 ? { x: current.x1, y: current.y1 } : { x: current.x2, y: current.y2 };
      const seen = new Set<WallCandidate>([start]);
      for (;;) {
        const next = continuation(current, at, straight, touch, gap, feetPerUnit, seen);
        if (next === null) break;
        const already = byRun.get(next);
        if (already !== undefined) {
          // A different tag's own run, or a run another tag reached first:
          // the wall between two tags that disagree is a question, not a
          // quantity.
          if (already.code !== code) {
            reached.set(next, new Set([...(reached.get(next) ?? [already.code]), code]));
          }
          break;
        }
        byRun.set(next, { code, source: "propagated", via: start });
        reached.set(next, new Set([code]));
        seen.add(next);
        at = farEnd(next, at);
        current = next;
      }
    }
  }

  const conflicts: PropagationReport["conflicts"] = [];
  for (const [run, codes] of reached) {
    if (codes.size < 2) continue;
    if (byRun.get(run)?.source === "tagged") continue;
    byRun.delete(run);
    conflicts.push({ run, codes: [...codes].sort() });
  }

  if (defaultCode !== null) {
    for (const run of walls) {
      if (!byRun.has(run) && !conflicts.some((c) => c.run === run)) byRun.set(run, { code: defaultCode, source: "default" });
    }
  }

  const feet: PropagationReport["feet"] = { tagged: 0, propagated: 0, default: 0, untyped: 0 };
  for (const run of walls) feet[byRun.get(run)?.source ?? "untyped"] += run.lengthFeet;
  return { byRun, conflicts, feet };
}

/**
 * The one run that continues `run` past the endpoint `at`: touching, nearly
 * collinear, the same thickness, not yet walked. Null where there is none or
 * more than one.
 */
function continuation(
  run: WallCandidate,
  at: { x: number; y: number },
  walls: readonly WallCandidate[],
  touch: number,
  gap: number,
  feetPerUnit: number,
  seen: ReadonlySet<WallCandidate>,
): WallCandidate | null {
  const candidates: WallCandidate[] = [];
  const gapped: { wall: WallCandidate; along: number }[] = [];
  // Unit direction of the run, pointing out of `at`.
  const len = Math.hypot(run.x2 - run.x1, run.y2 - run.y1);
  const out = len === 0 ? { x: 1, y: 0 } : atIsEnd(run, at) ? { x: (run.x2 - run.x1) / len, y: (run.y2 - run.y1) / len } : { x: (run.x1 - run.x2) / len, y: (run.y1 - run.y2) / len };
  const lateral = Math.max(run.thicknessFeet, 0.5) / feetPerUnit;
  for (const other of walls) {
    if (seen.has(other)) continue;
    if (angleBetween(run, other) > COLLINEAR_DEGREES) continue;
    const near = Math.hypot(other.x1 - at.x, other.y1 - at.y) <= Math.hypot(other.x2 - at.x, other.y2 - at.y) ? { x: other.x1, y: other.y1 } : { x: other.x2, y: other.y2 };
    const dx = near.x - at.x;
    const dy = near.y - at.y;
    const along = dx * out.x + dy * out.y;
    const across = Math.abs(dx * out.y - dy * out.x);
    const touches = Math.hypot(dx, dy) <= touch;
    // Across a gap: ahead of the endpoint, on the same line, within a door's width.
    const acrossGap = along > 0 && along <= gap && across <= lateral;
    if (!touches && !acrossGap) continue;
    const thick = Math.max(run.thicknessFeet, other.thicknessFeet);
    if (thick > 0 && Math.abs(run.thicknessFeet - other.thicknessFeet) > thick * SAME_THICKNESS_SHARE) continue;
    if (touches) candidates.push(other);
    else gapped.push({ wall: other, along });
  }
  // A touching run is the wall continuing; only with none does the walk
  // look across a gap, and then to the NEAREST run on the line — the one
  // past the door, not the one past the next door too.
  if (candidates.length > 0) return candidates.length === 1 ? candidates[0] : null;
  if (gapped.length > 0) {
    gapped.sort((a, b) => a.along - b.along);
    if (gapped.length > 1 && gapped[1].along - gapped[0].along <= touch) return null;
    return gapped[0].wall;
  }
  // ── ROUND A CORNER, WHEN THE CORNER IS THE ONLY WAY ON ──
  // Measured on nine training floor plans (2026-10-29): collinear carrying
  // typed under 4% of the footage on every sheet, because a tag's wall ends
  // at the room's corner and the next wall of the same room — same studs,
  // same board — starts there. A run of the same thickness whose END meets
  // this endpoint, and nothing else meeting it, is that wall. Two runs
  // leaving the point (a T seen from its stem, a crossing) is a question and
  // the walk stops; a run this endpoint lands in the MIDDLE of is a wall
  // passing by, not one continuing, and is not a candidate.
  const corners = walls.filter((other) => {
    if (seen.has(other)) return false;
    const thick = Math.max(run.thicknessFeet, other.thicknessFeet);
    if (thick > 0 && Math.abs(run.thicknessFeet - other.thicknessFeet) > thick * SAME_THICKNESS_SHARE) return false;
    return Math.hypot(other.x1 - at.x, other.y1 - at.y) <= touch || Math.hypot(other.x2 - at.x, other.y2 - at.y) <= touch;
  });
  return corners.length === 1 ? corners[0]! : null;
}

function atIsEnd(run: WallCandidate, at: { x: number; y: number }): boolean {
  return Math.hypot(run.x2 - at.x, run.y2 - at.y) <= Math.hypot(run.x1 - at.x, run.y1 - at.y);
}

function farEnd(run: WallCandidate, from: { x: number; y: number }): { x: number; y: number } {
  const d1 = Math.hypot(run.x1 - from.x, run.y1 - from.y);
  const d2 = Math.hypot(run.x2 - from.x, run.y2 - from.y);
  return d1 < d2 ? { x: run.x2, y: run.y2 } : { x: run.x1, y: run.y1 };
}

/** Degrees between two runs' directions, 0..90, sign of travel ignored. */
function angleBetween(a: WallCandidate, b: WallCandidate): number {
  const ta = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
  const tb = Math.atan2(b.y2 - b.y1, b.x2 - b.x1);
  let d = Math.abs(ta - tb) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return (d * 180) / Math.PI;
}
