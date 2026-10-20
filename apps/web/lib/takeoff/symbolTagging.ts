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
  const { symbols, legendCodes, shape, walls, feetPerUnit, widthPt } = input;
  const known = new Set(legendCodes.map((c) => c.trim().toUpperCase()).filter((c) => c !== ""));

  const couldBeTags = symbols.filter((s) => s.rejected === null);
  const tags: WallTypeTag[] = [];
  const anchoredByLeader = new Set<WallTypeTag>();
  const oddShape: { code: string; shape: SymbolShape }[] = [];
  const unknown = new Map<string, number>();

  for (const symbol of couldBeTags) {
    // The whole text first, then each half — so a one-part symbol and a split
    // one are both read, and a code that is itself two words still matches.
    const candidates = [symbol.text, ...symbol.parts].map((p) => p.trim().toUpperCase());
    const code = candidates.find((c) => known.has(c));
    if (code === undefined) {
      const whole = candidates[0];
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
