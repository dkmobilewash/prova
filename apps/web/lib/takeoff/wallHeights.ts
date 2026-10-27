import { inchesFrom } from "./partitionAssembly";

/**
 * ── WHAT A DRAWING SAYS ABOUT HOW HIGH A WALL IS, IN WORDS A FORMULA CAN USE ──
 *
 * A legend rarely prints a height in feet. It says where the wall STOPS —
 * "TO DECK", "BOTTOM OF STRUCTURE", "UNDERSIDE OF STRUCTURAL CEILING ABOVE",
 * "6" ABOVE CEILING", "SEE NOTE A" — and the feet come from somewhere else
 * on the set: a section's deck elevation, a ceiling plan's `10'-0" A.F.F.`
 * tags, a general note. So a height is read in two steps that are kept
 * apart because they come from different sheets and carry different
 * confidence:
 *
 *   1. `heightBasis(text)` — the WORDS, from the legend's own lines or its
 *      height note: a basis (to the deck, to the ceiling, a fixed figure, a
 *      reference to a note or a sheet), with the phrase it came from. Pure
 *      vocabulary, measured against every height note on the sixteen
 *      training legends (2026-10-22).
 *   2. `resolveHeight(basis, facts)` — the FEET, from facts read elsewhere:
 *      the deck or structure elevation off a section, the ceiling height off
 *      the reflected ceiling plan, the general note a "SEE NOTE A" points at.
 *      Each fact names its sheet and phrase; the reading names the one it
 *      used; and nothing is guessed — a basis with no fact behind it stays
 *      unresolved and says so, rather than taking a default.
 *
 * Confidence is about the CHAIN, not the arithmetic: HIGH when a printed
 * figure answers directly (a fixed height on the legend, a deck elevation
 * beside the type's own "to deck"); MEDIUM when it resolves through one hop
 * (a note reference, a ceiling-plan tag for "above ceiling"); LOW when the
 * only thing that applies is a general note — "all walls to deck U.N.O." —
 * which `generalNoteOnly` flags on its own, because that is the case an
 * estimator checks against the sheet before bidding on it.
 */

export type HeightBasis =
  /** The wall runs to the structure above: deck, slab, joists, beam. */
  | { kind: "to-structure"; phrase: string }
  /** The wall stops at the ceiling. */
  | { kind: "to-ceiling"; phrase: string }
  /** The wall runs a stated distance past the ceiling. */
  | { kind: "above-ceiling"; inches: number; phrase: string }
  /** A height printed in feet and inches. */
  | { kind: "fixed"; feet: number; phrase: string }
  /** "SEE NOTE A", "SEE SHEET A300": the answer is somewhere else, named. */
  | { kind: "see"; target: string; phrase: string }
  /** Two heights for two faces or two sides — reported, never averaged. */
  | { kind: "mixed"; parts: HeightBasis[]; phrase: string };

const TO_STRUCTURE =
  /\b(?:TO|THRU|THROUGH)\s+(?:THE\s+)?(?:ROOF\s+)?(?:DECK(?:ING)?|STRUCTURE|SLAB|JOISTS?|ROOF)\b|\bFULL\s+HEIGHT\b|\b(?:BOTTOM|UNDERSIDE|U\/S|B\.O\.)\s+OF\s+(?:THE\s+)?(?:STRUCTURE|STRUCTURAL|DECK|SLAB|JOISTS?|ROOF|CONCRETE|EXISTING\s+BEAM|BEAM|FLOOR)\b|\bCONT(?:INUOUS|\.)?\s+TO\s+(?:ROOF\s+)?DECK/i;
const ABOVE_CEILING = /(\d+(?:\s*[-–]\s*\d+\/\d+|\s+\d+\/\d+|\/\d+)?)\s*(?:"|''|IN(?:CH(?:ES)?)?\.?)\s*(?:ABOVE|A\.?F\.?C\.?|OVER)\s+(?:THE\s+)?(?:FINISHED\s+)?(?:CEILING|CLG)/i;
const TO_CEILING = /\b(?:TO|AT)\s+(?:THE\s+)?(?:UNDERSIDE\s+OF\s+)?(?:FINISHED\s+)?(?:CEILING|CLG)\b|\bBOTTOM\s+OF\s+(?:THE\s+)?CEILING\b|\bCEILING\s+HEIGHT\b/i;
const SEE = /\bSEE\s+(NOTE\s+[A-Z0-9]+|SHEET\s+[A-Z]{1,3}[-.]?\d[\dA-Z.\-]*|[A-Z]{1,3}[-.]?\d{2,4}[A-Z]?|ELEVATIONS?|CEILING\s+PLANS?|RCP|STRUCTURAL|SECTIONS?)/i;
const FIXED = /(\d{1,2})\s*'\s*(?:-\s*)?(\d{1,2})?\s*(?:"|'')?(?!\s*(?:O\.?C|ON\s+CENTER))|(\d{1,2})\s*(?:FT|FEET|')\s*(?:HIGH|TALL|HT\.?|HEIGHT)/i;
const MIXED_SPLIT = /;|\s+AND\s+|\s*\/\s*(?=[A-Z0-9])/;

/** The basis a phrase states, or null when the words say nothing about height. */
export function heightBasis(text: string): HeightBasis | null {
  const phrase = text.replace(/\s+/g, " ").trim();
  if (phrase === "") return null;
  // Two sides, two answers — "9' HIGH (SHOP SIDE); TO DECK ABOVE (OFFICE SIDE)".
  const parts = phrase.split(MIXED_SPLIT).map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length > 1) {
    const read = parts.map((p) => heightBasis(p)).filter((b): b is HeightBasis => b !== null);
    const kinds = new Set(read.map((b) => b.kind));
    if (read.length > 1 && (kinds.size > 1 || read.some((b) => b.kind === "fixed"))) return { kind: "mixed", parts: read, phrase };
    if (read.length === 1) return read[0];
  }
  // "SEE STRUCTURAL" beside a CMU core is not about height. A reference
  // counts only when it points at a note, or the phrase itself says HEIGHT.
  const see = SEE.exec(phrase);
  if (see !== null && !TO_STRUCTURE.test(phrase) && !ABOVE_CEILING.test(phrase) && (/^NOTE\b/i.test(see[1]) || /HEIGHT|TOP OF WALL/i.test(phrase))) {
    return { kind: "see", target: see[1].toUpperCase().replace(/\s+/g, " "), phrase };
  }
  const above = ABOVE_CEILING.exec(phrase);
  if (above !== null) {
    const inches = inchesFrom(above[1]);
    if (inches !== null) return { kind: "above-ceiling", inches, phrase };
  }
  if (TO_STRUCTURE.test(phrase)) return { kind: "to-structure", phrase };
  if (TO_CEILING.test(phrase)) {
    // "10'-0", BOTTOM OF CEILING" — a figure AND the ceiling: the figure is the height.
    const fixed = fixedFeet(phrase);
    return fixed !== null ? { kind: "fixed", feet: fixed, phrase } : { kind: "to-ceiling", phrase };
  }
  const fixed = fixedFeet(phrase);
  if (fixed !== null) return { kind: "fixed", feet: fixed, phrase };
  return null;
}

/** `10'-6"` → 10.5, `8' HIGH` → 8; null for a figure that is a spacing or a size. */
function fixedFeet(phrase: string): number | null {
  if (/\bO\.?\s?C\.?\b|ON\s+CENTER|STUD|GA\.?\b|TYPE\s+X|LAYERS?/i.test(phrase) && !/HIGH|HEIGHT|TALL|HT\b/i.test(phrase)) return null;
  const m = FIXED.exec(phrase);
  if (m === null) return null;
  if (m[3] !== undefined) return Number(m[3]);
  const feet = Number(m[1]);
  const inches = m[2] === undefined ? 0 : Number(m[2]);
  if (!(feet > 0 && feet < 60)) return null;
  return feet + inches / 12;
}

/** A figure read off another sheet, with where it came from. */
export type HeightFact = {
  kind: "structure-elevation" | "bearing-elevation" | "ceiling-height" | "general-note" | "note";
  /** Feet above finished floor, where the fact is a figure. */
  feet: number | null;
  /** For a note: its letter or number, so "SEE NOTE A" can find it. */
  label?: string;
  /** For a note, what it says — read again as a basis. */
  text?: string;
  sheet: string;
  phrase: string;
};

export type HeightConfidence = "HIGH" | "MEDIUM" | "LOW";

export type HeightReading = {
  code: string;
  basis: HeightBasis | null;
  feet: number | null;
  /** The fact the feet came from, when they did. */
  from: HeightFact | null;
  confidence: HeightConfidence;
  /** True when nothing on the type itself says a height and only a sheet-wide note applies. */
  generalNoteOnly: boolean;
  why: string;
};

/**
 * The height of one type, from its own words and the set's facts.
 *
 * `ownPhrases` are the type's legend lines and height note; `generalNote` is
 * the sheet-wide rule ("ALL WALLS TO DECK ABOVE U.N.O."), applied only when
 * the type's own words say nothing.
 */
export function resolveHeight(input: {
  code: string;
  /** The legend's own height field, where it has one — a bare figure here IS the height. */
  heightNote?: string | null;
  /** The type's other legend lines: a figure counts only beside a height word, since `1'-0"` alone is as likely a board width. */
  ownPhrases: readonly string[];
  generalNote: HeightFact | null;
  facts: readonly HeightFact[];
}): HeightReading {
  const HEIGHT_WORD = /HEIGHT|HIGH|TALL|\bHT\b|A\.?F\.?F|TOP OF WALL|EXTEND/i;
  const fromNote = input.heightNote ? heightBasis(input.heightNote) : null;
  const fromLines = input.ownPhrases
    .map(heightBasis)
    .find((b): b is HeightBasis => b !== null && (b.kind !== "fixed" || HEIGHT_WORD.test(b.phrase))) ?? null;
  const own = fromNote ?? fromLines;
  let basis = own;
  let generalNoteOnly = false;
  let hops = 0;
  let via: HeightFact | null = null;
  // A reference is followed once: "SEE NOTE A" → the note's own words.
  if (basis !== null && basis.kind === "see") {
    const note = input.facts.find((f) => f.kind === "note" && f.label !== undefined && basis !== null && basis.kind === "see" && basis.target === `NOTE ${f.label}`.toUpperCase());
    const noteBasis = note?.text === undefined ? null : heightBasis(note.text);
    if (note !== undefined && noteBasis !== null && noteBasis.kind !== "see") {
      basis = noteBasis;
      via = note;
      hops = 1;
    }
  }
  if (basis === null && input.generalNote !== null && input.generalNote.text !== undefined) {
    const general = heightBasis(input.generalNote.text);
    if (general !== null && general.kind !== "see") {
      basis = general;
      via = input.generalNote;
      generalNoteOnly = true;
      hops = 1;
    }
  }
  // The ceiling plan prints many tags; a soffit at 1'-0" must not stand in
  // for the room height. The commonest figure is the one a wall meets.
  const ceilingFact = ((): HeightFact | undefined => {
    const tally = new Map<number, { n: number; fact: HeightFact }>();
    for (const f of input.facts) {
      if (f.kind !== "ceiling-height" || f.feet === null) continue;
      const e = tally.get(f.feet) ?? { n: 0, fact: f };
      e.n += 1;
      tally.set(f.feet, e);
    }
    return [...tally.values()].sort((a, b) => b.n - a.n)[0]?.fact;
  })();
  const chain = own !== null && via !== null ? `${own.phrase} → ` : "";
  const unresolved = (why: string): HeightReading => ({ code: input.code, basis, feet: null, from: via, confidence: "LOW", generalNoteOnly, why });
  if (basis === null) return unresolved("nothing on the legend or the sheet says how high this wall is");
  const grade = (direct: boolean): HeightConfidence => (generalNoteOnly ? "LOW" : direct && hops === 0 ? "HIGH" : "MEDIUM");
  switch (basis.kind) {
    case "fixed":
      return { code: input.code, basis, feet: basis.feet, from: via, confidence: grade(true), generalNoteOnly, why: `the legend prints ${basis.phrase}` };
    case "to-structure": {
      // Sections that print two different deck heights are two zones, and
      // which one a wall is under is a room question nobody has answered —
      // so both are named and nothing is picked.
      const distinct = (kind: HeightFact["kind"]) => {
        const seen = new Map<number, HeightFact>();
        for (const f of input.facts) if (f.kind === kind && f.feet !== null && !seen.has(f.feet)) seen.set(f.feet, f);
        return [...seen.values()];
      };
      const decks = distinct("structure-elevation");
      if (decks.length > 1) return unresolved(`"${basis.phrase}", but the sections print more than one structure height — ${decks.map((d) => `${d.sheet} ${d.phrase}`).join("; ")} — and which applies depends on the room`);
      if (decks.length === 1) {
        const deck = decks[0];
        return { code: input.code, basis, feet: deck.feet, from: deck, confidence: grade(true), generalNoteOnly, why: `${chain}${generalNoteOnly ? "general note " : ""}"${basis.phrase}"; ${deck.sheet} prints ${deck.phrase}` };
      }
      // "T.O. WALL" / "TOP OF PLATE" is where the roof framing BEARS; the deck
      // is higher by the joist depth, which nothing here reads. Offered as a
      // floor on the height, at LOW, never as the height itself.
      const bearings = distinct("bearing-elevation");
      if (bearings.length > 1) return unresolved(`"${basis.phrase}", and the only elevations printed are bearing lines that disagree — ${bearings.map((d) => `${d.sheet} ${d.phrase}`).join("; ")}`);
      if (bearings.length === 1) {
        const b = bearings[0];
        return { code: input.code, basis, feet: b.feet, from: b, confidence: "LOW", generalNoteOnly, why: `${chain}"${basis.phrase}"; ${b.sheet} prints ${b.phrase}, a BEARING line — the deck sits above it by the joist depth, which was not read` };
      }
      return unresolved(`"${basis.phrase}" needs the structure's elevation from a section, and none was read`);
    }
    case "to-ceiling": {
      const ceiling = ceilingFact;
      if (ceiling === undefined) return unresolved(`"${basis.phrase}" needs a ceiling height from the ceiling plan, and none was read`);
      return { code: input.code, basis, feet: ceiling.feet, from: ceiling, confidence: grade(false), generalNoteOnly, why: `${chain}"${basis.phrase}"; ${ceiling.sheet} prints ${ceiling.phrase}` };
    }
    case "above-ceiling": {
      const ceiling = ceilingFact;
      if (ceiling === undefined) return unresolved(`"${basis.phrase}" needs a ceiling height from the ceiling plan, and none was read`);
      const feet = (ceiling.feet as number) + basis.inches / 12;
      return { code: input.code, basis, feet, from: ceiling, confidence: grade(false), generalNoteOnly, why: `${chain}"${basis.phrase}"; ${ceiling.sheet} prints ${ceiling.phrase}, plus ${basis.inches}"` };
    }
    case "see":
      return unresolved(`the legend says "${basis.phrase}" and that was not read`);
    case "mixed":
      return unresolved(`the legend gives more than one height — "${basis.phrase}" — which is two quantities, not one`);
  }
}

/** The figures printed as elevations and ceiling tags, read off a sheet's text items. */
export function heightFactsFromText(input: {
  sheet: string;
  items: readonly { str: string; x: number; y: number; height: number }[];
}): HeightFact[] {
  const out: HeightFact[] = [];
  const items = input.items.map((i) => ({ ...i, str: i.str.trim() })).filter((i) => i.str !== "");
  const FEET = /^(\d{1,2})'\s*-?\s*(\d{1,2})?\s*(?:"|'')?(?:\s*A\.?F\.?F\.?)?$/i;
  const INCHES = /^-?\s*(\d{1,2})"$/;
  const STRUCTURE = /^(?:\(E\)\s*)?(?:(?:T\.?O\.?|TOP\s+OF)\s+(?:ROOF\s+)?(?:FRAMING|DECK(?:ING)?|STEEL|STRUCT(?:URE)?\.?|JOISTS?|SLAB)|(?:B\.?O\.?|BOTTOM\s+OF|U\/S|UNDERSIDE\s+OF)\s+(?:ROOF\s+)?(?:DECK(?:ING)?|STEEL|STRUCT(?:URE)?\.?|JOISTS?|SLAB|BEAM))\b/i;
  const BEARING = /^(?:\(E\)\s*)?(?:T\.?O\.?|TOP\s+OF)\s+(?:WALL|PLATE|BEARING|BRG\.?|MASONRY|CMU)\b/i;
  const CEILING_LABEL = /^(?:B\.?O\.?\s+)?(?:CLG|CEILING)\.?(?:\s*(?:HT|HEIGHT)\.?)?$/i;
  const feetOf = (s: string): number | null => {
    const m = FEET.exec(s);
    return m === null ? null : Number(m[1]) + (m[2] === undefined ? 0 : Number(m[2])) / 12;
  };
  /** The figure beside a label — one item, or `15'` with its `0"` printed as the next item. */
  const figureBeside = (label: (typeof items)[number]) => {
    const row = items.filter((o) => o !== label && Math.abs(o.y - label.y) < 2.5 * label.height && Math.abs(o.x - label.x) < 260);
    // "CLG. 1'-0" BELOW JOISTS" is an offset, not a height.
    if (row.some((o) => /\b(?:BELOW|ABOVE)\b/i.test(o.str))) return null;
    for (const o of row) {
      const feet = feetOf(o.str);
      if (feet === null || feet < 1 || feet > 60) continue;
      let text = o.str;
      let value = feet;
      if (/^\d{1,2}'$/.test(o.str)) {
        const inch = row.find((p) => p !== o && Math.abs(p.y - o.y) < label.height && p.x > o.x && p.x - o.x < 40 && INCHES.test(p.str));
        if (inch !== undefined) {
          value += Number(INCHES.exec(inch.str)?.[1] ?? 0) / 12;
          text = `${o.str} ${inch.str}`;
        }
      }
      return { value, text };
    }
    return null;
  };
  for (const i of items) {
    // "10'-0" A.F.F." in one item: a ceiling height tag.
    if (/A\.?F\.?F\.?$/i.test(i.str)) {
      const feet = feetOf(i.str);
      if (feet !== null) out.push({ kind: "ceiling-height", feet, sheet: input.sheet, phrase: i.str });
      continue;
    }
    const kind: HeightFact["kind"] | null = STRUCTURE.test(i.str) ? "structure-elevation" : BEARING.test(i.str) ? "bearing-elevation" : CEILING_LABEL.test(i.str) ? "ceiling-height" : null;
    if (kind === null) continue;
    const beside = figureBeside(i);
    if (beside !== null) out.push({ kind, feet: beside.value, sheet: input.sheet, phrase: `${i.str} ${beside.text}` });
  }
  return out;
}

/** Lettered general notes on a sheet — "A. ALL WALLS WILL BE TO DECK ABOVE U.N.O." — by letter. */
export function lettersNotesFromLines(sheet: string, lines: readonly string[]): HeightFact[] {
  const out: HeightFact[] = [];
  for (const line of lines) {
    for (const cell of line.split(" | ")) {
      const m = /^([A-Z]|\d{1,2})\.\s+(.{8,})$/.exec(cell.trim());
      if (m !== null && /WALL|PARTITION|HEIGHT|DECK|CEILING/i.test(m[2])) out.push({ kind: "note", feet: null, label: m[1].toUpperCase(), text: m[2], sheet, phrase: cell.trim() });
    }
    // The letter and the note split across cells: "A. | ALL WALLS WILL BE…".
    const cells = line.split(" | ").map((c) => c.trim());
    for (let k = 0; k + 1 < cells.length; k++) {
      if (/^([A-Z]|\d{1,2})\.$/.test(cells[k]) && /WALL|PARTITION|HEIGHT|DECK|CEILING/i.test(cells[k + 1])) {
        out.push({ kind: "note", feet: null, label: cells[k].slice(0, -1).toUpperCase(), text: cells[k + 1], sheet, phrase: `${cells[k]} ${cells[k + 1]}` });
      }
    }
  }
  return out;
}
