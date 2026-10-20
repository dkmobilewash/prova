import type { WallCandidate } from "./wallVectors";

/**
 * ── HOW MUCH OF THIS SHEET'S WALL HAS A TYPE, AND WHERE THAT TYPE CAME FROM ──
 *
 * Diego's rule, and it is a rule about EVIDENCE rather than about coverage: a
 * wall's type comes from its own tag or from a `U.N.O.` general note, and never
 * from its thickness. Two types routinely share a thickness and differ only in
 * fire rating — School-01's A1 and A2 are both 4⅞in — so a thickness can
 * narrow a guess and can never identify a type, even in principle.
 *
 * That leaves a third answer, and it has to be visible rather than absorbed:
 * **unknown**. An architect tags representative walls, not every wall — 41 tags
 * against 202 runs on one measured page — so without a `U.N.O.` note most of a
 * sheet is legitimately untyped. A screen that reported only "A1: 340 ft"
 * would be describing a quarter of the building and sounding complete.
 *
 * So this returns three figures that sum to the sheet's total, each with the
 * evidence behind it, and the caller shows all three. The number an estimator
 * needs most is the third one.
 */

export type TypeSource = "tag" | "note" | "unknown";

export type TypedFeet = {
  /** The wall type's code, or null for the unknown bucket. */
  code: string | null;
  source: TypeSource;
  feet: number;
  runs: number;
  /** Why this run has this type — the tag's text, or the note, verbatim. */
  evidence: string | null;
};

export type SheetTypeCoverage = {
  byType: TypedFeet[];
  totalFeet: number;
  taggedFeet: number;
  notedFeet: number;
  unknownFeet: number;
  /** Share of the sheet's footage with no type at all, 0..1. */
  unknownShare: number;
};

/**
 * Attribute every run's footage to a tag, a note, or neither.
 *
 * `tagged` maps a run to the code its own tag gives it — `tagByRun`'s output.
 * `note` is the `U.N.O.` default, which applies to every run the tags did not
 * claim and to nothing else: that is what "unless noted otherwise" means, and
 * letting it override a tag would silently retype the walls the architect
 * bothered to label.
 */
export function sheetTypeCoverage(input: {
  walls: readonly WallCandidate[];
  tagged: ReadonlyMap<WallCandidate, string>;
  note: { code: string; note: string } | null;
}): SheetTypeCoverage {
  const { walls, tagged, note } = input;
  const buckets = new Map<string, TypedFeet>();
  let totalFeet = 0;

  for (const wall of walls) {
    const feet = wall.lengthFeet;
    if (!(feet > 0)) continue;
    totalFeet += feet;
    const tag = tagged.get(wall) ?? null;

    // ── A TAG BEATS THE NOTE, WHICH IS WHAT `U.N.O.` MEANS ──
    const code = tag ?? note?.code ?? null;
    const source: TypeSource = tag !== null ? "tag" : note !== null ? "note" : "unknown";
    const evidence = tag !== null ? `tagged ${tag}` : note !== null ? note.note : null;

    const key = `${source}:${code ?? ""}`;
    const at = buckets.get(key);
    if (at === undefined) {
      buckets.set(key, { code, source, feet, runs: 1, evidence });
    } else {
      at.feet += feet;
      at.runs += 1;
    }
  }

  const byType = [...buckets.values()].sort((a, b) => b.feet - a.feet);
  const sum = (source: TypeSource) =>
    byType.filter((one) => one.source === source).reduce((n, one) => n + one.feet, 0);
  const unknownFeet = sum("unknown");
  return {
    byType,
    totalFeet,
    taggedFeet: sum("tag"),
    notedFeet: sum("note"),
    unknownFeet,
    unknownShare: totalFeet > 0 ? unknownFeet / totalFeet : 0,
  };
}

/** One line a person can read, for the takeoff screen and for a report. */
export function coverageSentence(coverage: SheetTypeCoverage): string {
  const ft = (n: number) => `${Math.round(n)} ft`;
  if (coverage.totalFeet <= 0) return "No wall measured on this sheet.";
  const parts = [`${ft(coverage.taggedFeet)} from tags on the drawing`];
  if (coverage.notedFeet > 0) parts.push(`${ft(coverage.notedFeet)} from a U.N.O. note`);
  // Said last and never omitted, even at zero: a reader who sees two figures
  // and no third one cannot tell whether the rest is typed or missing.
  parts.push(`${ft(coverage.unknownFeet)} with no type`);
  return `${ft(coverage.totalFeet)} of wall — ${parts.join(", ")}.`;
}
