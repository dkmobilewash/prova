import { heightBasis, type HeightFact } from "./wallHeights";

/**
 * ── A WALL'S HEIGHT FROM ITS OWN TYPE (prereg-type-heights.md, flag TAKEOFF_TYPE_HEIGHTS) ──
 *
 * The zero-touch chain gave every wall the SET's rule (one general note, the rooms' ceilings, the
 * roof) or the company's assumed answer. Plans print the height per partition type: a fixed
 * figure, N" above the ceiling, to the ceiling, to a soffit, to deck, a plate height, a partial
 * height, or no board at all (Round 36, 20 sets). This reads that rule per type and turns it into a
 * wall's height from the rooms either side, or says plainly that the documents leave it open.
 *
 * Built on `heightBasis` (the legend reader's phrase parser), with the phrasings it does not read
 * handled first: plate, soffit, partial height, masonry with no board, and inch fractions.
 */
export type TypeHeightRule =
  | { kind: "fixed"; feet: number; why: string }
  | { kind: "above-ceiling"; inches: number; why: string }
  | { kind: "to-ceiling"; why: string }
  | { kind: "to-soffit"; why: string }
  /** `feet` only where the set prints ONE structure/bearing value for it (H4); else a question. */
  | { kind: "to-structure"; feet: number | null; why: string }
  | { kind: "plate"; feet: number | null; why: string }
  | { kind: "partial"; feet: number | null; why: string }
  | { kind: "no-board"; why: string };

/** `9'-1 1/8"` → 9.09375, `42"` → 3.5; null when the text holds no figure. */
export function feetInches(text: string): number | null {
  const ft = /(\d{1,3})\s*'\s*(?:[-–]\s*)?(?:(\d{1,2})(?:\s+(\d{1,2})\/(\d{1,2}))?)?\s*(?:"|''|”)?/.exec(text);
  if (ft !== null) return Number(ft[1]) + ((ft[2] === undefined ? 0 : Number(ft[2])) + (ft[3] === undefined ? 0 : Number(ft[3]) / Number(ft[4]))) / 12;
  const inch = /(\d{1,3})(?:\s+(\d{1,2})\/(\d{1,2}))?\s*(?:"|''|”|\s*IN(?:CH(?:ES)?)?\b)/i.exec(text);
  return inch === null ? null : (Number(inch[1]) + (inch[2] === undefined ? 0 : Number(inch[2]) / Number(inch[3]))) / 12;
}

const PLATE = /\b(?:(?:TOP\s+)?PLATE\s+(?:HT|HEIGHT|HGT|EL(?:EV(?:ATION)?)?)\.?|T\.?\s*O\.?\s*(?:TOP\s+)?PLATE|TO\s+(?:THE\s+)?TOP\s+PLATE)\b/i;
const SOFFIT = /\bTO\s+(?:THE\s+)?(?:UNDERSIDE\s+OF\s+|U\/S\s+OF\s+|BOTTOM\s+OF\s+)?(?:THE\s+)?SOFFIT\b/i;
const PARTIAL_WORDS = /\bPARTIAL\s+(?:HEIGHT|HT)\b|\bPONY\s+WALL\b|\bHEIGHT\s+VARIES\b|\bKNEE\s+WALL\b|\bHALF\s+WALL\b|\bLOW\s+WALL\b/i;
const SEE_ELEVATIONS = /\bSEE\s+(?:INTERIOR\s+)?ELEVATIONS?\b/i;
/** A height of only inches, "42" HIGH", "36" A.F.F.": a counter-height wall. */
const INCH_HEIGHT = /^\s*(\d{2})(?:\s+\d\/\d)?\s*(?:"|''|”)\s*(?:HIGH|TALL|HT\.?|A\.?F\.?F\.?)/i;
const MASONRY = /\bCMU\b|\bCONCRETE\s+MASONRY\b|\bMASONRY\s+UNIT\b|\bBRICK\b|\bCONC(?:RETE|\.)?\s+WALL\b/i;
const BOARD = /\bGWB\b|\bGYP(?:SUM|\.)?\b|\bDRYWALL\b|\bSHEETROCK\b|\bBOARD\b|\bFURRING\b|\bHAT\s+CHANNEL\b|\bVENEER\s+PLASTER\b/i;
/** Below this a fixed figure is a partial-height wall, not a room-height one. */
export const PARTIAL_UNDER_FEET = 7;

function onePhrase(phrase: string, facts: readonly HeightFact[]): TypeHeightRule | null {
  const why = phrase.replace(/\s+/g, " ").trim();
  if (why === "") return null;
  if (PLATE.test(why)) return { kind: "plate", feet: feetInches(why.slice(PLATE.exec(why)!.index)), why };
  if (SOFFIT.test(why)) return { kind: "to-soffit", why };
  const inch = INCH_HEIGHT.exec(why);
  if (inch !== null) return { kind: "partial", feet: Number(inch[1]) / 12, why };
  if (PARTIAL_WORDS.test(why) || (SEE_ELEVATIONS.test(why) && /HEIGHT|HT\b/i.test(why))) {
    const feet = feetInches(why);
    return { kind: "partial", feet: feet !== null && feet < PARTIAL_UNDER_FEET ? feet : null, why };
  }
  const basis = heightBasis(why);
  if (basis === null) return null;
  switch (basis.kind) {
    case "fixed": return { kind: "fixed", feet: feetInches(why) ?? basis.feet, why };
    case "above-ceiling": return { kind: "above-ceiling", inches: basis.inches, why };
    case "to-ceiling": return { kind: "to-ceiling", why };
    case "to-structure": return { kind: "to-structure", feet: oneStructureValue(facts), why };
    default: return null;
  }
}

/** The ONE structure/bearing height a set prints (relative to its floor, 7 ft or more); null for none or several. */
export function oneStructureValue(facts: readonly HeightFact[]): number | null {
  const values = [...new Set(facts.filter((f) => (f.kind === "structure-elevation" || f.kind === "bearing-elevation") && f.feet !== null && f.feet >= 7).map((f) => Math.round(f.feet! * 96) / 96))];
  return values.length === 1 ? values[0]! : null;
}

/** A partition type's height rule, from its height note first and then its assembly lines; null when they say nothing. */
export function typeHeightRule(type: { code: string; heightNote: string | null; lines: readonly string[] }, set: { facts: readonly HeightFact[] }): TypeHeightRule | null {
  const words = [type.heightNote ?? "", ...type.lines].join(" ");
  // No board: masonry named and no board, furring or plaster anywhere in the type (H5).
  if (MASONRY.test(words) && !BOARD.test(words)) return { kind: "no-board", why: words.replace(/\s+/g, " ").trim() };
  for (const phrase of [type.heightNote, ...type.lines]) {
    if (phrase === null) continue;
    const r = onePhrase(phrase, set.facts);
    if (r !== null) return r;
  }
  return null;
}

/**
 * The plan's rule for walls it does not type: a rule ("ALL WALLS TO DECK ABOVE U.N.O.") or a type
 * the untyped walls are ("UNTYPED WALLS SHALL BE TYPE A", "ALL INTERIOR WALLS M6F U.N.O.").
 */
export function generalTypeRule(notes: readonly string[], facts: readonly HeightFact[] = []): { typeCode: string } | { rule: TypeHeightRule } | null {
  const UNO = /\bU\.?\s?N\.?\s?O\.?\b|\bUNLESS\s+(?:NOTED|OTHERWISE\s+NOTED|SHOWN)(?:\s+OTHERWISE)?\b|\bU\.?O\.?N\.?\b/i;
  for (const raw of notes) {
    const note = raw.replace(/\s+/g, " ").trim();
    const named = /\bUNTYPED\s+(?:WALLS?|PARTITIONS?)\s+(?:SHALL\s+BE|ARE|=|TO\s+BE)\s+(?:WALL\s+)?TYPE\s+([A-Z0-9][A-Z0-9-]{0,5})\b/i.exec(note)
      ?? (UNO.test(note) ? /\b(?:WALLS?|PARTITIONS?)\s+(?:SHALL\s+BE\s+)?(?:WALL\s+)?(?:TYPE\s+)?([A-Z]{0,2}\d{1,2}[A-Z]{0,2})\s+(?:U\.?\s?N\.?\s?O|UNLESS|U\.?O\.?N)/i.exec(note) ?? /\bWALL\s+TYPE\s+([A-Z0-9]{1,5})\s+(?:U\.?\s?N\.?\s?O|UNLESS)/i.exec(note) : null);
    if (named !== null) return { typeCode: named[1]!.toUpperCase() };
    if (UNO.test(note) && /\bALL\s+(?:INTERIOR\s+)?(?:WALLS|PARTITIONS|STUDS)\b/i.test(note)) {
      const r = onePhrase(note, facts);
      if (r !== null) return { rule: r };
    }
  }
  return null;
}

export type WallTypeHeight =
  | { kind: "height"; feet: number; from: string }
  | { kind: "needs-answer"; why: string }
  | { kind: "no-board"; why: string };

/**
 * One wall's height from its type's rule and the ceilings of the rooms on its two sides (null where
 * no room or no ceiling). Null when the type gives no rule: the wall falls through to today's chain.
 */
export function wallTypeHeight(rule: TypeHeightRule | null, sideCeilings: readonly (number | null)[], setCeilingFt: number | null): WallTypeHeight | null {
  if (rule === null) return null;
  const ceilings = sideCeilings.filter((c): c is number => c !== null && c > 0);
  const ceiling = ceilings.length > 0 ? Math.max(...ceilings) : setCeilingFt;
  const where = ceilings.length > 0 ? "the higher adjacent ceiling" : "the set's ceiling";
  const ask = (why: string): WallTypeHeight => ({ kind: "needs-answer", why: `${why} — "${rule.why}"` });
  switch (rule.kind) {
    case "fixed": return { kind: "height", feet: rule.feet, from: `type: "${rule.why}"` };
    case "plate":
    case "partial":
    case "to-structure":
      return rule.feet === null ? ask(rule.kind === "to-structure" ? "to deck/structure, and the set prints no one structure height for it" : rule.kind === "plate" ? "to the plate, and no plate height is printed" : "partial height, and no dimension is printed") : { kind: "height", feet: rule.feet, from: `type: "${rule.why}"` };
    case "to-soffit": return ask("to a soffit, whose height the type does not print");
    case "no-board": return { kind: "no-board", why: `type: "${rule.why}"` };
    case "above-ceiling":
      return ceiling === null ? ask("N above the ceiling, and no ceiling is known on either side") : { kind: "height", feet: ceiling + rule.inches / 12, from: `type: "${rule.why}"; ${where} ${ceiling} ft + ${rule.inches}"` };
    case "to-ceiling":
      return ceiling === null ? ask("to the ceiling, and no ceiling is known on either side") : { kind: "height", feet: ceiling, from: `type: "${rule.why}"; ${where} ${ceiling} ft` };
  }
}
