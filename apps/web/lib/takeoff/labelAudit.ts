import { UNKNOWN_FINDER } from "./finderVersion";

/**
 * ── WHAT CAN BE WRONG WITH A SAVED SHEET, ASKED OF THE FILE ALONE ──
 *
 * No PDF, no database, no finder. Everything here is answerable from the
 * label file, which is what makes it runnable while somebody is labelling the
 * next sheet — the checks that need the drawing belong in an eval.
 *
 * The flags are the ones that cost money or cost a model:
 *
 *   OVERLAPPING ACCEPTS   two accepted runs along one wall. The estimate bills
 *                         the same feet twice, and the reviewer cannot see it
 *                         because both look right on their own.
 *   TRACE OVER ACCEPT     the same thing across the two kinds. Tracing is for
 *                         walls the finder MISSED; a trace over a run that was
 *                         already accepted is double-counted key footage, and
 *                         it inflates the held-out score in the flattering
 *                         direction.
 *   UNDECIDED             candidates nobody judged. They become confident
 *                         NEGATIVES in training if the sheet is marked
 *                         complete, which is how 483 unsure runs once became
 *                         negatives.
 *   SCALE                 accepted feet against the sheet's own width in feet.
 *                         A scale wrong by 10x does not look wrong on screen —
 *                         every wall is still a wall — and shows up here as a
 *                         sheet claiming ten times the footage a building of
 *                         that size can hold.
 *   FINDER                a version that is `-dirty` or `unknown` cannot be
 *                         got back, and one that differs from the build now
 *                         running means the rows were built by another finder.
 *
 * Pure. No DOM, no filesystem.
 */

export type AuditRun = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthFeet: number;
  thicknessFeet?: number;
  verdict: string;
};

export type AuditInput = {
  set: string;
  sheet: string;
  feetPerUnit: number;
  reviewComplete?: boolean;
  finderVersion?: string;
  counts?: { unreviewed?: number };
  verdicts: readonly AuditRun[];
};

export type OverlapFlag = {
  kind: "accept-accept" | "trace-accept";
  feet: number;
  a: string;
  b: string;
};

export type SheetAudit = {
  set: string;
  sheet: string;
  accepted: number;
  acceptedFeet: number;
  rejected: number;
  rejectedFeet: number;
  unsure: number;
  unsureFeet: number;
  traced: number;
  tracedFeet: number;
  undecided: number;
  overlaps: OverlapFlag[];
  doubleCountedFeet: number;
  /** Accepted feet divided by the sheet's own width in feet. */
  footageRatio: number;
  flags: string[];
};

/**
 * How far apart two runs may be and still be the same wall, in feet.
 *
 * `duplicateCandidates`'s band, for the same reason: wider than drafting
 * jitter and the nine-inch offset twins, narrower than a corridor.
 */
export const SAME_WALL_FEET = 1.5;

/**
 * The plausible range for accepted feet as a multiple of the sheet's width in
 * feet.
 *
 * ── WHY A RANGE AND NOT A NUMBER ──
 *
 * A floor plan's walls are many times the sheet's width: a 288 ft-wide sheet
 * holding a building 200 ft across easily carries 600-900 ft of partition, so
 * 2-3x is ordinary. The bound catches the ORDER-OF-MAGNITUDE mistake — a
 * scale out by ten, which puts the ratio at 0.2x or 30x — rather than
 * second-guessing a reviewer. Measured against the nine sheets labelled
 * before 2026-10-20, whose ratios run from 0.1 to 2.4.
 */
export const RATIO_FLOOR = 0.02;
export const RATIO_CEILING = 12;

const len = (r: AuditRun) => Math.hypot(r.x2 - r.x1, r.y2 - r.y1);

function unit(r: AuditRun): [number, number] {
  const l = len(r);
  return l === 0 ? [0, 0] : [(r.x2 - r.x1) / l, (r.y2 - r.y1) / l];
}

/** Perpendicular distance from a point to a's infinite line, in page units. */
function offLine(a: AuditRun, px: number, py: number): number {
  const l = len(a);
  if (l === 0) return Math.hypot(px - a.x1, py - a.y1);
  return Math.abs((a.x2 - a.x1) * (a.y1 - py) - (a.x1 - px) * (a.y2 - a.y1)) / l;
}

/**
 * How much of `b` lies along `a`, in feet — zero unless they are the same
 * wall.
 *
 * BOTH of b's ends must be within the band, not just its midpoint: a wall
 * crossing at a shallow angle passes through the band in the middle and
 * leaves at both ends, and counting that as overlap would flag every
 * T-junction on the sheet.
 */
export function overlapFeet(a: AuditRun, b: AuditRun, feetPerUnit: number): number {
  const la = len(a);
  if (la === 0 || len(b) === 0) return 0;
  const [ux, uy] = unit(a);
  const [bx, by] = unit(b);
  // Parallel, either direction.
  if (Math.abs(ux * bx + uy * by) < 0.985) return 0;
  const band = SAME_WALL_FEET / feetPerUnit;
  if (Math.max(offLine(a, b.x1, b.y1), offLine(a, b.x2, b.y2)) > band) return 0;
  const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy;
  const t1 = at(b.x1, b.y1);
  const t2 = at(b.x2, b.y2);
  const lo = Math.max(0, Math.min(t1, t2));
  const hi = Math.min(la, Math.max(t1, t2));
  return Math.max(0, hi - lo) * feetPerUnit;
}

/** A run's label in a report: where it is and how long, never an index. */
export function describe(r: AuditRun): string {
  return `${r.lengthFeet.toFixed(1)}ft at (${r.x1.toFixed(4)},${r.y1.toFixed(4)})`;
}

/**
 * Audit one saved sheet.
 *
 * `currentFinder` is the build running now; pass `null` to skip that
 * comparison rather than have it compare against a guess.
 */
export function auditSheet(file: AuditInput, currentFinder: string | null): SheetAudit {
  const by = (v: string) => file.verdicts.filter((r) => r.verdict === v);
  const accepted = by("wall");
  const rejected = by("not-wall");
  const unsure = by("unsure");
  const traced = by("traced");
  const feet = (rs: readonly AuditRun[]) => rs.reduce((n, r) => n + r.lengthFeet, 0);

  const overlaps: OverlapFlag[] = [];
  // ── ACCEPTED AGAINST ACCEPTED ──
  for (let i = 0; i < accepted.length; i += 1) {
    for (let j = i + 1; j < accepted.length; j += 1) {
      const ft = overlapFeet(accepted[i], accepted[j], file.feetPerUnit);
      // A foot of overlap is two walls meeting at a corner, not a duplicate.
      if (ft > 1) {
        overlaps.push({
          kind: "accept-accept",
          feet: ft,
          a: describe(accepted[i]),
          b: describe(accepted[j]),
        });
      }
    }
  }
  // ── TRACED AGAINST ACCEPTED ──
  for (const t of traced) {
    for (const a of accepted) {
      const ft = overlapFeet(a, t, file.feetPerUnit);
      if (ft > 1) {
        overlaps.push({ kind: "trace-accept", feet: ft, a: describe(a), b: describe(t) });
      }
    }
  }

  const acceptedFeet = feet(accepted);
  const footageRatio = file.feetPerUnit > 0 ? acceptedFeet / file.feetPerUnit : 0;
  const undecided = file.counts?.unreviewed ?? 0;
  const doubleCountedFeet = overlaps.reduce((n, o) => n + o.feet, 0);

  const flags: string[] = [];
  const acceptAccept = overlaps.filter((o) => o.kind === "accept-accept");
  const traceAccept = overlaps.filter((o) => o.kind === "trace-accept");
  if (acceptAccept.length > 0) {
    flags.push(
      `${acceptAccept.length} overlapping accepted pair(s), ` +
        `${acceptAccept.reduce((n, o) => n + o.feet, 0).toFixed(1)} ft counted twice`,
    );
  }
  if (traceAccept.length > 0) {
    flags.push(
      `${traceAccept.length} trace(s) over an accepted run, ` +
        `${traceAccept.reduce((n, o) => n + o.feet, 0).toFixed(1)} ft counted twice`,
    );
  }
  if (undecided > 0) {
    flags.push(`${undecided} candidate(s) left undecided`);
  }
  if (unsure.length > 0) {
    flags.push(`${unsure.length} not sure (${feet(unsure).toFixed(1)} ft) — excluded from training`);
  }
  if (acceptedFeet > 0 && (footageRatio < RATIO_FLOOR || footageRatio > RATIO_CEILING)) {
    flags.push(
      `accepted ${acceptedFeet.toFixed(0)} ft on a ${file.feetPerUnit.toFixed(0)} ft-wide sheet ` +
        `(${footageRatio.toFixed(2)}x) — CHECK THE SCALE`,
    );
  }
  const finder = file.finderVersion ?? UNKNOWN_FINDER;
  if (finder === UNKNOWN_FINDER) {
    flags.push("no finderVersion — the finder that drew these candidates is unrecorded");
  } else if (finder.endsWith("-dirty")) {
    flags.push(`finderVersion ${finder} is dirty — that build cannot be got back`);
  } else if (currentFinder !== null && finder !== currentFinder) {
    flags.push(`finderVersion ${finder} differs from the build now running (${currentFinder})`);
  }

  return {
    set: file.set,
    sheet: file.sheet,
    accepted: accepted.length,
    acceptedFeet,
    rejected: rejected.length,
    rejectedFeet: feet(rejected),
    unsure: unsure.length,
    unsureFeet: feet(unsure),
    traced: traced.length,
    tracedFeet: feet(traced),
    undecided,
    overlaps,
    doubleCountedFeet,
    footageRatio,
    flags,
  };
}

/** One line per sheet, for the report. */
export function auditLine(a: SheetAudit): string {
  return (
    `${a.set.slice(0, 30).padEnd(30)} ${a.sheet.padEnd(7)}` +
    ` ${String(a.accepted).padStart(3)} acc ${a.acceptedFeet.toFixed(0).padStart(5)} ft` +
    ` · ${String(a.rejected).padStart(3)} rej ${a.rejectedFeet.toFixed(0).padStart(5)} ft` +
    (a.traced > 0 ? ` · ${a.traced} traced ${a.tracedFeet.toFixed(0)} ft` : "") +
    ` · ${a.footageRatio.toFixed(2)}x sheet` +
    (a.flags.length === 0 ? "  ok" : `  ⚑ ${a.flags.length}`)
  );
}
