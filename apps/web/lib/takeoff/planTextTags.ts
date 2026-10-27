import { bareTextTags } from "./bareTextTags";
import { legendVocabulary, prefixlessVocabulary, tagsFromSymbols } from "./symbolTagging";
import { tagSymbols, type SymbolShape, type TextForSymbol } from "./tagSymbols";
import { propagateTypes } from "./typePropagation";
import { tagByRun, type WallTypeTag } from "./wallTags";
import type { MatchableWallType } from "./wallTypeMatch";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── THE RUN-TO-TYPE MAP, READ FROM THE DRAWING'S OWN SYMBOLS ──
 *
 * `findWallsOnSheet`'s regroup block builds its map from `wallTypeTags`: text
 * items that spell a type the COMPANY already has. This builds it from what
 * the SET defines — the codes its partition legend names — found three ways
 * and then carried along the wall:
 *
 *   1. symbols: a closed shape holding a legend code (`tagSymbols` →
 *      `tagsFromSymbols`), anchored where its leader lands;
 *   2. bare text: a legend code printed beside a run with no shape around it
 *      (`bareTextTags`), which is how Bunkie and MHK draw theirs;
 *   3. the company's own text tags, as before, so a sheet that names a type
 *      the company has and the legend does not still gets it;
 *
 * and then `propagateTypes` carries each tag along collinear runs of the same
 * thickness, across a door-sized gap, stopping at a turn, a fork or another
 * tag.
 *
 * ── A PROPAGATED RUN IS MARKED IN THE TAG ITSELF ──
 *
 * `GroupSource` has `TAG`, `REMAINDER` and `GENERAL_NOTE`, and the stored
 * proposal's `source` is a Postgres enum of the same three. A fourth kind is
 * the right design and is a migration plus edits to `wallGroups.ts` and
 * `wallProposal.ts`, which belong to the finder's lane. Until then a
 * propagated run's tag is the code with `PROPAGATED_MARK` appended:
 * `sameDesignation` strips every non-alphanumeric before comparing, so
 * `IW-2 ≈` still matches the company's `IW-2`, the group still prices, and
 * the screen can tell the two apart and say so.
 *
 * ponytail: a marker in a string; replace with a `PROPAGATED` source kind and
 * enum value once the migration is allowed.
 */
export const PROPAGATED_MARK = " ≈";

export function propagatedTag(code: string): string {
  return `${code}${PROPAGATED_MARK}`;
}

export function isPropagatedTag(tag: string): boolean {
  return tag.endsWith(PROPAGATED_MARK);
}

/** The code without the propagation marker. */
export function plainTag(tag: string): string {
  return isPropagatedTag(tag) ? tag.slice(0, -PROPAGATED_MARK.length) : tag;
}

/** What the finder is handed when the switch is on. */
export type PlanTextInput = {
  /**
   * The vocabulary a symbol has to hold to count as a wall tag: the company's
   * OWN wall-type codes, plus the set's partition legend where one has been
   * read. The field keeps its old name because `findWallsOnSheet` reads it —
   * see `tagVocabulary` for what goes in it now and why.
   */
  legendCodes: readonly string[];
};

/**
 * ── THE TAGS DO NOT NEED THE AI SWITCH; ONLY THE LEGEND READ DOES ──
 *
 * A wall tag printed in a hexagon is free geometry. What the symbol reader
 * needs is a VOCABULARY to tell a wall tag from a door mark, and until now the
 * only vocabulary was the legend — read by a model, behind PLAN_TEXT_READ, so
 * every company with the switch off saw no symbol tags at all, and typed its
 * walls by thickness alone.
 *
 * The company's own library is a vocabulary too: an estimator who has S6A and
 * C8B in it is saying those are the codes this set uses. So the vocabulary is
 * the library's codes always, and the legend's as well when one has been read.
 * A library code that is not on the drawing matches nothing; a legend code the
 * library lacks still tags a group, which `verdictFor` reports as
 * NO_SUCH_TYPE with the schedule to read — unchanged.
 */
export function tagVocabulary(libraryCodes: readonly string[], legendCodes: readonly string[] | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...(legendCodes ?? []), ...libraryCodes]) {
    const code = raw.trim();
    if (code === "" || seen.has(code.toUpperCase())) continue;
    seen.add(code.toUpperCase());
    out.push(code);
  }
  return out;
}

export type PlanTextTagReport = {
  symbols: number;
  /** Symbols holding a legend code. */
  coded: number;
  bareText: number;
  /** Runs typed by a tag that sits on or points at them. */
  direct: number;
  /** Runs typed because the wall they are part of carries a tag. */
  propagated: number;
  /** Runs two different tags both reached, left untyped. */
  conflicts: number;
  /** The symbol shape the tags were required to have, where one dominated. */
  shape: SymbolShape | null;
  /**
   * True when no symbol held a legend code as spelled and the codes without
   * their shared letter prefix were used instead (`P1` tagged as `1`).
   */
  shortForm: boolean;
};

export function planTextTagByRun(input: {
  /** The sheet's strokes, in points. */
  segments: readonly StrokeSegment[];
  /** The sheet's text as the PDF gives it — `y` the baseline, in points. */
  text: readonly TextForSymbol[];
  widthPt: number;
  /** The runs, in page-width units. */
  walls: readonly WallCandidate[];
  feetPerUnit: number;
  legendCodes: readonly string[];
  /** Today's text-matched tags against the company's own types, kept. */
  textTags: readonly WallTypeTag[];
  wallTypes: readonly MatchableWallType[];
}): { byRun: Map<WallCandidate, string>; report: PlanTextTagReport } {
  const { segments, text, widthPt, walls, feetPerUnit, legendCodes, textTags, wallTypes } = input;
  const symbols = tagSymbols({ segments, text, unitsPerPaperInch: 72 });
  const spelled = legendVocabulary(legendCodes);
  const holds = (vocab: ReadonlyMap<string, string>) => (s: (typeof symbols)[number]) =>
    [s.text, ...s.parts].some((p) => vocab.has(p.trim().toUpperCase()));
  // ── THE PLAN'S SPELLING, WHEN IT IS NOT THE LEGEND'S ──
  // Only when NO symbol holds a code as the legend spells it; see
  // `prefixlessVocabulary` for why that is the condition and not a default.
  const short = prefixlessVocabulary(legendCodes);
  const shortForm = short !== null && !symbols.some(holds(spelled)) && symbols.some(holds(short));
  const vocabulary = shortForm && short !== null ? short : spelled;
  const codes = shortForm && short !== null ? [...short.keys()] : legendCodes;
  const holdsCode = holds(vocabulary);

  // ── THE SHAPE IS THE PLAN'S OWN COMMONEST ──
  //
  // The legend sheet is not in hand here, so the shape its symbols are drawn
  // in cannot be learned from it; the plan's commonest coded shape stands in,
  // which is what `tagsFromSymbols` falls back to when a legend's shape holds
  // too few of the coded symbols anyway. Camp Bow Wow's 39 pentagon window
  // marks lose to its 36 diamonds by the same count.
  const byShape = new Map<SymbolShape, number>();
  for (const s of symbols) {
    if (s.rejected !== null && s.rejected !== "sheet-reference") continue;
    if (!holdsCode(s)) continue;
    byShape.set(s.shape, (byShape.get(s.shape) ?? 0) + 1);
  }
  const shape = [...byShape].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const fromSymbols = tagsFromSymbols({ symbols, legendCodes: codes, shape, walls, feetPerUnit, widthPt });
  const bare = bareTextTags({ text, vocabulary: new Set(vocabulary.keys()), symbols, walls, feetPerUnit, widthPt });
  const bareTags: WallTypeTag[] = bare.map((b) => ({
    name: vocabulary.get(b.text.toUpperCase()) ?? b.text.toUpperCase(),
    x: b.x,
    y: b.y,
  }));

  const asLegend = (tag: WallTypeTag): WallTypeTag =>
    shortForm && short !== null ? { ...tag, name: short.get(tag.name.toUpperCase()) ?? tag.name } : tag;
  const direct = tagByRun(walls, [...fromSymbols.tags.map(asLegend), ...bareTags, ...textTags], feetPerUnit, wallTypes);
  const carried = propagateTypes({ walls, tagged: direct, feetPerUnit, defaultCode: null });
  const byRun = new Map<WallCandidate, string>(direct);
  let propagated = 0;
  for (const [run, type] of carried.byRun) {
    if (type.source !== "propagated") continue;
    byRun.set(run, propagatedTag(type.code));
    propagated += 1;
  }

  return {
    byRun,
    report: {
      symbols: symbols.length,
      coded: fromSymbols.counts.knownToLegend,
      bareText: bare.length,
      direct: direct.size,
      propagated,
      conflicts: carried.conflicts.length,
      shape,
      shortForm,
    },
  };
}
