import { tagByRun, type WallTypeTag } from "./wallTags";
import type { TagSymbol, SymbolShape } from "./tagSymbols";
import type { WallCandidate } from "./wallVectors";

/**
 * ── A SYMBOL BECOMES A TAG WHEN THE LEGEND KNOWS ITS CODE ──
 *
 * `tagSymbols` finds every small closed symbol with a short code in it, and on
 * a real floor plan that is a crowd: Camp Bow Wow A101 yields 133 of them.
 * Most are door marks — `101A`, `103`, `116` — and some are wall tags, and
 * they are drawn in the SAME shape, so the shape cannot separate them. What
 * can is the vocabulary: the partition legend names `A B C D E`, the door
 * schedule names `100 101A 102 …`, and a code belongs to whichever list
 * claims it.
 *
 * This is `wallNotes.ts`'s rule arriving from a different direction. There it
 * is "the library is the filter, and it costs nothing to apply": a note naming
 * `A-501` proposes nothing because no wall type is called that. Here the
 * legend is the filter, and a symbol holding `REF.` or `17' - 8"` proposes
 * nothing for the same reason.
 *
 * ── THE CODE IS WHICHEVER HALF THE LEGEND KNOWS ──
 *
 * ELEVEN03 tags a wall as `MC` over `1 HR` in one split box. The legend
 * defines `MC`; it does not define `1 HR`. So each of a symbol's parts is
 * tried against the vocabulary and the one that matches is the tag's name,
 * which is the only way a rating or a note can share a symbol with the code
 * without hiding it.
 *
 * ── THE SHAPE IS A CONFIRMATION, NEVER A REQUIREMENT ──
 *
 * `shapeFromLegend` learns which shape a set draws its tags in, and a symbol
 * of another shape holding a legend code is still reported — as AMBIGUOUS
 * rather than dropped. A set that legends its types in squares and tags one
 * wall in a hexagon has done something a reader should see, and a filter that
 * hid it would be choosing silence over a question.
 *
 * ── THE MATCHING IS `tagByRun`'s, ANCHORED WHERE THE LEADER LANDS ──
 *
 * That function already pairs a tag with the run it labels, with the reach and
 * the clear-margin rules measured on real sheets. The only thing that changed
 * is WHERE the tag is taken to be. A symbol with a leader is placed at the
 * leader's far end — the drafter drew that line to say which wall — and one
 * without a leader is placed at its centre, as before. Measured on Camp Bow
 * Wow A101 before this: 16 of 56 legend-coded symbols failed the clear margin
 * because they sat between two walls; the leader resolves that without
 * loosening the margin for the tags that have none.
 */

/** The share of legend-coded symbols the legend's own shape must hold to be believed. */
export const LEGEND_SHAPE_FAIR_SHARE = 0.25;

export type SymbolTagReport = {
  /** Symbols whose code the legend knows and whose shape matches the set's. */
  tags: WallTypeTag[];
  /**
   * Symbols holding a legend code in the WRONG shape — reported, never
   * dropped, because an odd one out is a question for a person.
   */
  oddShape: { code: string; shape: SymbolShape }[];
  /** Codes found on the sheet that no legend claims, commonest first. */
  unknownCodes: { code: string; count: number }[];
  /** Run-to-code, for the runs a tag could be matched to. */
  byRun: Map<WallCandidate, string>;
  /** The shape tags were required to have, and where that came from. */
  shape: SymbolShape | null;
  shapeFrom: "legend" | "plan" | "none";
  counts: {
    symbols: number;
    couldBeTags: number;
    knownToLegend: number;
    matchedToRun: number;
    /** Of the matched, how many were placed by their leader rather than by proximity. */
    matchedByLeader: number;
    ambiguous: number;
  };
};

/**
 * Turn the symbols on a sheet into wall-type tags and match them to runs.
 *
 * `legendCodes` is the vocabulary — whatever the legend defines. `shape` is
 * what that legend draws its tags in, or null where no shape dominated, in
 * which case shape is not used at all rather than guessed.
 */
export function tagsFromSymbols(input: {
  symbols: readonly TagSymbol[];
  legendCodes: readonly string[];
  shape: SymbolShape | null;
  walls: readonly WallCandidate[];
  feetPerUnit: number;
  /** Page width in points, to put symbol centres in page-width units. */
  widthPt: number;
}): SymbolTagReport {
  const { symbols, legendCodes, walls, feetPerUnit, widthPt } = input;
  const known = legendVocabulary(legendCodes);

  // ── A CODE THE LEGEND DEFINES IS NOT A SHEET REFERENCE ──
  //
  // `tagSymbols` rejects `G4.1` as a detail callout, because a letter, a digit
  // and a dotted number is what a callout looks like. Central Bank names a
  // wall type that way. The legend is the better witness: a symbol whose words
  // the legend knows is read as a tag whatever its spelling suggests.
  const codeOf = (symbol: TagSymbol): string | undefined => {
    // The whole text first, then each half — so a one-part symbol and a split
    // one are both read, and a code that is itself two words still matches.
    const candidates = [symbol.text, ...symbol.parts].map((p) => p.trim().toUpperCase());
    for (const c of candidates) {
      const code = known.get(c);
      if (code !== undefined) return code;
    }
    return undefined;
  };
  const couldBeTags = symbols.filter(
    (s) => s.rejected === null || (s.rejected === "sheet-reference" && codeOf(s) !== undefined),
  );
  const tags: WallTypeTag[] = [];
  const anchoredByLeader = new Set<WallTypeTag>();
  const oddShape: { code: string; shape: SymbolShape }[] = [];
  const unknown = new Map<string, number>();

  // ── THE LEGEND'S SHAPE, UNLESS THE PLAN HARDLY DRAWS IT ──
  //
  // SW Grand Junction legends its types in circles and tags every wall in a
  // square: 30 squares and 3 circles hold its codes on A110. Required to be
  // circles, 30 of 33 tags were "odd". But the count alone cannot decide:
  // Camp Bow Wow's window marks are 39 pentagons lettered B and C beside the
  // 36 diamonds that are its wall tags, and the legend is right about the
  // diamond. So the legend's shape is kept while it carries a fair share of
  // the coded symbols, and a legend shape the plan all but ignores gives way
  // to the plan's own commonest. A quarter is the measured line: 36 of 93 on
  // Camp Bow Wow and 76 of 124 on STEM keep theirs; 3 of 33 on SW does not.
  const byShape = new Map<SymbolShape, number>();
  let coded = 0;
  for (const symbol of couldBeTags) {
    if (codeOf(symbol) === undefined) continue;
    coded += 1;
    byShape.set(symbol.shape, (byShape.get(symbol.shape) ?? 0) + 1);
  }
  let shape = input.shape;
  let shapeFrom: SymbolTagReport["shapeFrom"] = shape === null ? "none" : "legend";
  if (shape !== null && coded > 0 && (byShape.get(shape) ?? 0) < coded * LEGEND_SHAPE_FAIR_SHARE) {
    shape = [...byShape].sort((a, b) => b[1] - a[1])[0][0];
    shapeFrom = "plan";
  }

  for (const symbol of couldBeTags) {
    const code = codeOf(symbol);
    if (code === undefined) {
      const whole = symbol.text.trim().toUpperCase();
      unknown.set(whole, (unknown.get(whole) ?? 0) + 1);
      continue;
    }
    if (shape !== null && symbol.shape !== shape) {
      oddShape.push({ code, shape: symbol.shape });
      continue;
    }
    const at = symbol.leader ?? { x: symbol.x, y: symbol.y };
    const tag: WallTypeTag = {
      name: code,
      // `tagByRun` works in page-width units, which is what the runs are in.
      x: widthPt > 0 ? at.x / widthPt : at.x,
      y: widthPt > 0 ? at.y / widthPt : at.y,
    };
    if (symbol.leader !== null) anchoredByLeader.add(tag);
    tags.push(tag);
  }

  const byRun = tagByRun(walls, tags, feetPerUnit);
  // Which tags landed: a run claimed by the name a leader-anchored tag carries,
  // at the leader-anchored tag's own position, is that tag's. `tagByRun` keeps
  // the run-to-name map only, so the attribution is re-derived here the same
  // way it decides — nearest fitting run within reach.
  let matchedByLeader = 0;
  if (anchoredByLeader.size > 0 && byRun.size > 0) {
    const claimed = new Set(byRun.keys());
    for (const tag of anchoredByLeader) {
      let best: { wall: WallCandidate; d: number } | null = null;
      for (const wall of claimed) {
        if (byRun.get(wall) !== tag.name) continue;
        const d = distance(tag, wall);
        if (best === null || d < best.d) best = { wall, d };
      }
      if (best !== null) {
        matchedByLeader += 1;
        claimed.delete(best.wall);
      }
    }
  }

  return {
    tags,
    oddShape,
    unknownCodes: [...unknown]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
    byRun,
    shape,
    shapeFrom,
    counts: {
      symbols: symbols.length,
      couldBeTags: couldBeTags.length,
      knownToLegend: tags.length,
      matchedToRun: byRun.size,
      matchedByLeader,
      // A tag the legend knows that no run claimed: it is on the sheet and
      // nothing was labelled by it, which is the number worth watching.
      ambiguous: Math.max(0, tags.length - byRun.size) + oddShape.length,
    },
  };
}

/**
 * What a symbol may say to name each legend type: the code as the legend
 * spells it, and the code with its label stripped.
 *
 * Murray Towers' legend names its types `WALL TYPE 1` and `WALL TYPE 2`, and
 * its plan tags each wall with a `1` or a `2` in a diamond — nobody draws
 * `WALL TYPE 1` inside a quarter-inch symbol. STEM's does the same. The tag
 * keeps the legend's full name, so coverage reports read as the legend does.
 *
 * Exported for its own test; a mapping that nobody can see is a mapping
 * nobody has checked.
 */
export function legendVocabulary(legendCodes: readonly string[]): Map<string, string> {
  const known = new Map<string, string>();
  for (const raw of legendCodes) {
    const code = raw.trim().toUpperCase();
    if (code === "") continue;
    known.set(code, code);
    const short = code.replace(/^(?:WALL|PARTITION|PART\.?)\s+TYPE\s+|^TYPE\s+/, "").trim();
    if (short !== "" && short !== code && !known.has(short)) known.set(short, code);
  }
  return known;
}

/**
 * ── THE PREFIX THE PLAN DROPS ──
 *
 * A legend names its types `P1`, `P2` and the plan tags walls `1` and `2`.
 * Where EVERY legend code shares one letter prefix, the codes without it are
 * a second spelling of the same vocabulary — but a bare `1` is also a grid
 * line, a keynote and a door, so this map is offered only as a FALLBACK: the
 * caller uses it when no symbol on the plan holds a full code, and reports
 * that it did. It was written for a held-out set and has not been shown to
 * help on any training set, where every plan spells the legend's codes in
 * full; the measurement is the report's `shortForm` flag.
 */
export function prefixlessVocabulary(legendCodes: readonly string[]): Map<string, string> | null {
  const codes = legendCodes.map((c) => c.trim().toUpperCase()).filter((c) => c !== "");
  if (codes.length < 2) return null;
  const prefixes = new Set(codes.map((c) => c.match(/^([A-Z]+)[-\s]?\d/)?.[1] ?? ""));
  if (prefixes.size !== 1 || prefixes.has("")) return null;
  const prefix = [...prefixes][0];
  const out = new Map<string, string>();
  for (const code of codes) {
    const tail = code.slice(prefix.length).replace(/^[-\s]/, "");
    if (tail !== "" && !out.has(tail)) out.set(tail, code);
  }
  return out;
}

/** Page-width units from a point to the nearest point of a run. */
function distance(p: { x: number; y: number }, wall: WallCandidate): number {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - wall.x1) * dx + (p.y - wall.y1) * dy) / len2));
  return Math.hypot(p.x - (wall.x1 + t * dx), p.y - (wall.y1 + t * dy));
}

/** One line a person can read, for a report or the takeoff screen. */
export function symbolTagSentence(report: SymbolTagReport): string {
  const { counts } = report;
  if (counts.symbols === 0) return "No tag symbols were found on this sheet.";
  return (
    `${counts.symbols} symbols, ${counts.couldBeTags} could be tags, ` +
    `${counts.knownToLegend} name a type the legend defines, ` +
    `${counts.matchedToRun} were matched to a run` +
    (counts.matchedByLeader === 0 ? "" : ` (${counts.matchedByLeader} by their leader)`) +
    (counts.ambiguous === 0 ? "." : `, ${counts.ambiguous} left over.`)
  );
}
