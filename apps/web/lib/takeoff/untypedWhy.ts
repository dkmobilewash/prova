import type { TagSymbol } from "./tagSymbols";
import { TAG_CLEAR_MARGIN, TAG_REACH_FEET } from "./wallTags";
import type { WallCandidate } from "./wallVectors";

/**
 * ── WHY A WALL STAYED UNTYPED, IN WORDS A PERSON CAN ACT ON ──
 *
 * "568 ft untyped" is a number with four different causes behind it, and an
 * estimator looking at the sheet needs to know which: there is no tag near
 * this wall at all (the drafter did not tag it — the U.N.O. note or a
 * question for the architect), there is a tag but it is too far or between
 * two walls (the pairing rule stopped it — a crop will settle it), the
 * nearest tag holds a code the legend does not define (a keynote, a window
 * mark, or a legend the reader missed), or there IS a tag but no run was
 * found under it (the finder's miss, not the reader's).
 *
 * Pure: the finder's runs, the sheet's symbols, the legend's vocabulary and
 * the run-to-code map in; one reason per untyped run, with feet, out.
 */

export type UntypedReason =
  | "no tag nearby"
  | "tag too far"
  | "no clear margin"
  | "code not in legend"
  | "tag with no run under it";

export type UntypedRun = { run: WallCandidate; reason: UntypedReason; nearestFeet: number; code: string | null };

export type UntypedReport = {
  runs: UntypedRun[];
  /** Feet by reason, over the untyped runs. */
  feet: Record<Exclude<UntypedReason, "tag with no run under it">, number>;
  /** Coded symbols with no run within reach: the finder's gaps, not the reader's. */
  orphanTags: { code: string; x: number; y: number; nearestFeet: number }[];
};

/** Beyond this a tag is not "nearby" at all. */
export const NEARBY_FEET = 20;

/** Short alphanumeric text, the shape of any code — a tag's, a door's, a keynote's. */
const CODE_LIKE = /^[A-Z0-9][A-Z0-9.\-/ ]{0,6}$/;

export function untypedWhy(input: {
  walls: readonly WallCandidate[];
  symbols: readonly TagSymbol[];
  /** Upper-cased words the legend knows (`legendVocabulary(...).keys()`). */
  vocabulary: ReadonlySet<string>;
  byRun: ReadonlyMap<WallCandidate, string>;
  feetPerUnit: number;
  widthPt: number;
  /** The shape the sheet's wall tags are drawn in, when one dominated; other shapes are not wall tags. */
  shape?: TagSymbol["shape"] | null;
}): UntypedReport {
  const { walls, symbols, vocabulary, byRun, feetPerUnit, widthPt } = input;
  const codeOf = (s: TagSymbol): string | null => {
    for (const p of [s.text, ...s.parts]) {
      const w = p.trim().toUpperCase();
      if (vocabulary.has(w)) return w;
    }
    return null;
  };
  const all = symbols
    .filter((s) => s.rejected === null || s.rejected === "sheet-reference")
    .map((s) => {
      const at = s.leader ?? { x: s.x, y: s.y };
      return { x: at.x / widthPt, y: at.y / widthPt, code: codeOf(s), text: s.text.trim().toUpperCase(), shape: s.shape };
    });
  // Wall tags: legend-coded, and in the sheet's tag shape where one is known.
  const tags = all.filter((t) => t.code !== null && (input.shape === undefined || input.shape === null || t.shape === input.shape));
  // Other codes: short text the legend does not define — a door mark, a keynote, a window.
  const others = all.filter((t) => t.code === null && CODE_LIKE.test(t.text));
  const distFt = (p: { x: number; y: number }, w: WallCandidate) => distance(p, w) * feetPerUnit;
  const nearestOf = (list: typeof all, run: WallCandidate) => {
    let best: { d: number; code: string | null; text: string } | null = null;
    for (const t of list) {
      const d = distFt(t, run);
      if (best === null || d < best.d) best = { d, code: t.code, text: t.text };
    }
    return best;
  };

  const runs: UntypedRun[] = [];
  const feet = { "no tag nearby": 0, "tag too far": 0, "no clear margin": 0, "code not in legend": 0 };
  for (const run of walls) {
    if (byRun.has(run)) continue;
    const tag = nearestOf(tags, run);
    const other = nearestOf(others, run);
    // ── THE ORDER IS THE ARGUMENT ──
    // A legend tag within reach that did not pair lost on margin; one within
    // sight but past reach is too far; with no legend tag in sight, a short
    // code sitting on the run is a code the legend does not know; and with
    // none of those, nobody tagged this wall.
    let reason: Exclude<UntypedReason, "tag with no run under it">;
    let nearest: { d: number; code: string | null } | null;
    if (tag !== null && tag.d <= TAG_REACH_FEET) [reason, nearest] = ["no clear margin", tag];
    else if (tag !== null && tag.d <= NEARBY_FEET) [reason, nearest] = ["tag too far", tag];
    else if (other !== null && other.d <= TAG_REACH_FEET) [reason, nearest] = ["code not in legend", { d: other.d, code: other.text }];
    else [reason, nearest] = ["no tag nearby", tag];
    runs.push({ run, reason, nearestFeet: nearest?.d ?? Infinity, code: nearest?.code ?? null });
    feet[reason] += run.lengthFeet;
  }

  // Tags the legend knows that no run is within reach of: the finder has
  // nothing there for the tag to name. Second-nearest is reported too, so a
  // reader can tell "no wall" from "two walls".
  const orphanTags: UntypedReport["orphanTags"] = [];
  for (const t of tags) {
    if (t.code === null) continue;
    let best = Infinity;
    let second = Infinity;
    for (const run of walls) {
      const d = distFt(t, run);
      if (d < best) {
        second = best;
        best = d;
      } else if (d < second) second = d;
    }
    const claimed = best <= TAG_REACH_FEET && second >= best * TAG_CLEAR_MARGIN;
    if (!claimed && best > TAG_REACH_FEET) orphanTags.push({ code: t.code, x: t.x, y: t.y, nearestFeet: best });
  }
  return { runs, feet, orphanTags };
}

/** One sentence per reason, feet first, for a report or the screen. */
export function untypedSentence(report: UntypedReport): string {
  const parts = (Object.entries(report.feet) as [string, number][])
    .filter(([, ft]) => ft > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([why, ft]) => `${Math.round(ft)} ft ${why}`);
  const orphans = report.orphanTags.length === 0 ? "" : `; ${report.orphanTags.length} tag${report.orphanTags.length === 1 ? "" : "s"} with no run under ${report.orphanTags.length === 1 ? "it" : "them"}`;
  return (parts.join(", ") || "nothing untyped") + orphans;
}

function distance(p: { x: number; y: number }, w: WallCandidate): number {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / len2));
  return Math.hypot(p.x - (w.x1 + t * dx), p.y - (w.y1 + t * dy));
}
