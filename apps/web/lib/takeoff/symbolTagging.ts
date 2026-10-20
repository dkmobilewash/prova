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
 * ── THE SHAPE IS A CONFIRMATION, NEVER A REQUIREMENT ──
 *
 * `shapeFromLegend` learns which shape a set draws its tags in, and a symbol
 * of another shape holding a legend code is still reported — as AMBIGUOUS
 * rather than dropped. A set that legends its types in squares and tags one
 * wall in a hexagon has done something a reader should see, and a filter that
 * hid it would be choosing silence over a question.
 *
 * ── THE MATCHING IS `tagByRun`'s ──
 *
 * That function already pairs a tag with the run it labels, with the reach and
 * the clear-margin rules measured on real sheets, and `wallTags.ts` records
 * that its pairing is clean — tags sit 0.5 to 2.2 ft from their run with the
 * runner-up past 4, and zero are orphaned. The only thing that changed is
 * where the tags come from. A second matcher would be a second set of those
 * numbers to keep in step.
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
  const oddShape: { code: string; shape: SymbolShape }[] = [];
  const unknown = new Map<string, number>();

  for (const symbol of couldBeTags) {
    const code = symbol.text.trim().toUpperCase();
    if (!known.has(code)) {
      unknown.set(code, (unknown.get(code) ?? 0) + 1);
      continue;
    }
    if (shape !== null && symbol.shape !== shape) {
      oddShape.push({ code, shape: symbol.shape });
      continue;
    }
    tags.push({
      name: code,
      // `tagByRun` works in page-width units, which is what the runs are in.
      x: widthPt > 0 ? symbol.x / widthPt : symbol.x,
      y: widthPt > 0 ? symbol.y / widthPt : symbol.y,
    });
  }

  const byRun = tagByRun(walls, tags, feetPerUnit);
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
      // A tag the legend knows that no run claimed: it is on the sheet and
      // nothing was labelled by it, which is the number worth watching.
      ambiguous: Math.max(0, tags.length - byRun.size) + oddShape.length,
    },
  };
}

/** One line a person can read, for a report or the takeoff screen. */
export function symbolTagSentence(report: SymbolTagReport): string {
  const { counts } = report;
  if (counts.symbols === 0) return "No tag symbols were found on this sheet.";
  return (
    `${counts.symbols} symbols, ${counts.couldBeTags} could be tags, ` +
    `${counts.knownToLegend} name a type the legend defines, ` +
    `${counts.matchedToRun} were matched to a run` +
    (counts.ambiguous === 0 ? "." : `, ${counts.ambiguous} left over.`)
  );
}
