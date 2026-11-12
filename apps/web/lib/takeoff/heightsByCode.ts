import { roofPartHeights } from "./roofParts";
import { heightBasis, type HeightBasis, type HeightFact } from "./wallHeights";

/**
 * ── D. A WALL'S HEIGHT FROM THE DRAWING, BY CODE, WITH NO TYPE AND NO MODEL ──
 *
 * With no presses a wall carries no type, so the only height it can have is one the drawing gives
 * every wall: the set's general rule ("ALL WALLS TO DECK ABOVE U.N.O.", "TERMINATE ALL PARTITIONS
 * 8" ABOVE HIGHEST ADJACENT CEILING") read through the set's own facts, and the ceilings of the
 * rooms the wall bounds.
 *
 *   - to deck / structure: the structure elevation, when the set prints exactly one; with several,
 *     the roof the wall's rooms sit under (`roofParts.ts`: the highest level where the roof is
 *     pitched, the next where it is flat; a wall between the two runs to the higher);
 *   - N" above the ceiling: the higher of the two adjacent rooms' ceilings, else the set's one
 *     ceiling height, plus N;
 *   - to the ceiling: the same, with nothing added.
 *
 * Anything else answers nothing, and the wall's height stays a question: two structure
 * elevations, two ceiling heights and no room to choose between them, or no general rule at all.
 * A wrong height on every wall is worse than a question (AUTOMATION-PLAN.md).
 */
export type SetHeightRule =
  | { kind: "to-structure"; feet: number; from: string }
  | { kind: "to-structure-by-roof"; pitchedFeet: number; flatFeet: number; from: string }
  | { kind: "above-ceiling"; inches: number; setCeilingFeet: number | null; from: string }
  | { kind: "to-ceiling"; setCeilingFeet: number | null; from: string };

export type WallHeightByCode = { feet: number; from: string };

const toTwelfths = (feet: number) => Math.round(feet * 12) / 12;
/** The one value a list holds, to the inch, or null when it holds none or several. */
function onlyValue(values: readonly number[]): number | null {
  const distinct = [...new Set(values.map(toTwelfths))];
  return distinct.length === 1 ? distinct[0]! : null;
}

/**
 * "ALL STUDS ARE CONTINUOUS FROM FLOOR STRUCTURE TO CEILING STRUCTURE" (Joplin G-111): a set-wide
 * to-structure rule that names studs, not walls, and the structure as the CEILING's.
 */
const STUDS_TO_STRUCTURE = /\bALL\s+(?:STUDS|WALLS|PARTITIONS)\b[^.]*?\b(?:TO|THRU|THROUGH)\s+(?:THE\s+)?(?:CEILING\s+|ROOF\s+)?(?:STRUCTURE|DECK)\b/i;

/** The set's rule for every wall, from its general note and its printed facts; null when the drawing gives none. */
export function setHeightRule(generalNote: HeightFact | null, facts: readonly HeightFact[]): SetHeightRule | null {
  let general = generalNote;
  let basis: HeightBasis | null = general?.text ? heightBasis(general.text) : null;
  if (basis === null) {
    const studs = facts.find((f) => f.kind === "note" && f.text !== undefined && STUDS_TO_STRUCTURE.test(f.text));
    if (studs) {
      general = studs;
      basis = { kind: "to-structure", phrase: studs.text! };
    }
  }
  if (basis === null) return null;
  const from = `general note: "${general!.text!.slice(0, 80)}"`;
  // ponytail: 7 ft floors out the ceiling facts a stray "1'-0"" or a soffit depth produces; a rule per
  // fact kind if a set prints real ceilings under it.
  const setCeilingFeet = onlyValue(facts.filter((f) => f.kind === "ceiling-height" && f.feet !== null && f.feet >= 7).map((f) => f.feet!));
  if (basis.kind === "to-structure") {
    const feet = onlyValue(facts.filter((f) => f.kind === "structure-elevation" && f.feet !== null && f.feet >= 7).map((f) => f.feet!));
    if (feet !== null) return { kind: "to-structure", feet, from };
    const roof = roofPartHeights(facts);
    return roof === null ? null : { kind: "to-structure-by-roof", pitchedFeet: roof.pitched.feet, flatFeet: roof.flat.feet, from };
  }
  if (basis.kind === "above-ceiling") return { kind: "above-ceiling", inches: basis.inches, setCeilingFeet, from };
  if (basis.kind === "to-ceiling") return { kind: "to-ceiling", setCeilingFeet, from };
  return null;
}

/**
 * One wall's height under the set's rule, from the rooms either side: their ceiling heights (null
 * where there is no room, or one with no ceiling height) and whether the roof over each is pitched
 * (null where the roof plan does not say).
 */
export function wallHeightByCode(rule: SetHeightRule | null, sides: readonly (number | null)[], roofPitched: readonly (boolean | null)[] = []): WallHeightByCode | null {
  if (rule === null) return null;
  if (rule.kind === "to-structure") return { feet: rule.feet, from: rule.from };
  if (rule.kind === "to-structure-by-roof") {
    if (roofPitched.some((p) => p === true)) return { feet: toTwelfths(rule.pitchedFeet), from: `${rule.from}; under the pitched roof` };
    if (roofPitched.some((p) => p === false)) return { feet: toTwelfths(rule.flatFeet), from: `${rule.from}; under the flat roof` };
    return null;
  }
  const adjacent = sides.filter((h): h is number => h !== null && h > 0);
  const ceiling = adjacent.length > 0 ? Math.max(...adjacent) : rule.setCeilingFeet;
  if (ceiling === null) return null;
  const where = adjacent.length > 0 ? "the higher adjacent ceiling" : "the set's ceiling height";
  return rule.kind === "above-ceiling"
    ? { feet: toTwelfths(ceiling + rule.inches / 12), from: `${rule.from}; ${where} ${ceiling} ft + ${rule.inches}"` }
    : { feet: toTwelfths(ceiling), from: `${rule.from}; ${where} ${ceiling} ft` };
}

/**
 * ── THE CHAIN: EVERY WALL A HEIGHT, AND ITS SOURCE (Diego, 2026-11-12) ──
 *
 *   1. what the drawing prints (`wallHeightByCode`): training 92.7% right, 3.6% wrong on the 86% of wall
 *      footage it answers;
 *   2. the room's ceiling or the floor-to-floor — MEASURED AND NOT SHIPPED: 98.6% and 28.7% wrong on
 *      held-out, where walls run past the ceiling to the structure (zzHeightsByCode.eval.ts);
 *   3. the company's default wall height, ASSUMED, which the estimate and bid check ask to confirm.
 *
 * Null only when the drawing says nothing and the company has no default.
 */
export type ChainHeight = { feet: number; from: string; assumed: boolean };
export function wallHeightChain(rule: SetHeightRule | null, sides: readonly (number | null)[], roofPitched: readonly (boolean | null)[], defaultFt: number | null): ChainHeight | null {
  const drawn = wallHeightByCode(rule, sides, roofPitched);
  if (drawn !== null) return { ...drawn, assumed: false };
  return defaultFt !== null && defaultFt > 0 ? { feet: defaultFt, from: `assumed: your default wall height, ${defaultFt} ft`, assumed: true } : null;
}
