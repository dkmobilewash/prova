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

// "SEAL TIGHT TO METAL DECK ABOVE" (SLN 3A–5A): a material word may name the DECK, and only
// the deck — Camp Bow Wow's "PLATE FASTENED TO CONC. SLAB" is the bottom plate, not the top.
const TO_STRUCTURE =
  /\b(?:TO|THRU|THROUGH)\s+(?:THE\s+)?(?:ROOF\s+)?(?:(?:METAL|STEEL|CONC(?:RETE|\.)?|COMPOSITE|FLOOR)\s+(?=DECK))?(?:DECK(?:ING)?|STRUCTURE|SLAB|JOISTS?|ROOF)\b|\bFULL\s+HEIGHT\b|\b(?:BOTTOM|UNDERSIDE|U\/S|B\.O\.)\s+OF\s+(?:THE\s+)?(?:STRUCTURE|STRUCTURAL|DECK|SLAB|JOISTS?|ROOF|CONCRETE|EXISTING\s+BEAM|BEAM|FLOOR)\b|\bCONT(?:INUOUS|\.)?\s+TO\s+(?:ROOF\s+)?DECK/i;
// "8" ABOVE HIGHEST ADJACENT CEILING" (Green Bay A4.0 note 9): up to two words between.
const ABOVE_CEILING = /(\d+(?:\s*[-–]\s*\d+\/\d+|\s+\d+\/\d+|\/\d+)?)\s*(?:"|''|IN(?:CH(?:ES)?)?\.?)\s*(?:ABOVE|A\.?F\.?C\.?|OVER)\s+(?:THE\s+)?(?:[A-Z]+\s+){0,2}?(?:FINISHED\s+)?(?:CEILING|CLG)/i;
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
  kind: "structure-elevation" | "bearing-elevation" | "ceiling-height" | "general-note" | "note" | "floor-datum" | "wall-height";
  /** Feet above finished floor, where the fact is a figure. */
  feet: number | null;
  /** For a note: its letter or number, so "SEE NOTE A" can find it. */
  label?: string;
  /** For a note, what it says — read again as a basis. */
  text?: string;
  sheet: string;
  phrase: string;
  /**
   * For a level line, the part of the building it is drawn for — the words
   * round the abbreviation: Joplin's "LOWER" BOD, "ADMIN" JBE, "CENTRAL" TOW;
   * Bunkie's T.O. WALL "2". Empty for a line that names none.
   */
  zone?: string;
  /** For a level line read off a roof framing plan rather than a section or elevation: a spot elevation, used only when no section prints one. */
  framing?: boolean;
  /** The buildings its sheet's drawings name — Bunkie's "EAST ELEVATION - WAREHOUSE" → WAREHOUSE (`buildingsOf`). */
  buildings?: string[];
};

/**
 * The building a drawing's caption names: what follows its last " - " or
 * sits in its closing brackets — "FLOOR PLAN - WAREHOUSE", "FINISH FLOOR
 * (ADDITION)". A number ("ELEVATION 1") or a drawing word is no building.
 */
export function buildingsOf(captions: readonly string[]): string[] {
  const out = new Set<string>();
  for (const c of captions) {
    const tail = /\(([^()]+)\)\s*$/.exec(c)?.[1] ?? /\s[-–]\s+([^-–]+)$/.exec(c)?.[1];
    const word = tail?.trim().toUpperCase().replace(/\s+/g, " ");
    // A phase is not a building: Bunkie's AD101 is captioned "- DEMOLITION".
    if (word && !/^\d+$/.test(word) && !/\b(?:TYP(?:ICAL)?|PLAN|SECTION|ELEVATION|DETAIL|N\.?T\.?S\.?|DEMO(?:LITION)?|EXISTING|NEW|PHASE)\b/.test(word)) out.add(word);
  }
  return [...out];
}

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
  /** Where the drawing gives more than one height for the type: each, with its sheet and words, for a person to pick. */
  options?: HeightFact[];
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
  /** The buildings the plan sheet asking names (`buildingsOf` on its captions): picks the zone drawn for that building. */
  buildings?: readonly string[];
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
    // A ceiling plan's own "ALL DROPPED CEILINGS ARE 8'-0" … U.N.O." is the answer it gives; the tags only tally.
    const stated = input.facts.find((f) => f.kind === "ceiling-height" && f.feet !== null && f.label === "U.N.O.");
    if (stated !== undefined) return stated;
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
      // ── ONE LEVEL PER PART OF THE BUILDING, AND THE PARTS AS OPTIONS ──
      //
      // Round 14's key: Joplin's A, B and L run to 12'-0" under the lower
      // roofs, 12'-4" in admin and 16'-8" in the central tower — the sections'
      // LOWER BOD, ADMIN JBE and CENTRAL TOW; Bunkie's to 10'-0" in the main
      // building and 14'-4" in the warehouses — T.O. WALL and T.O. WALL 2.
      // Each zone takes its deck where it prints one, else its bearing line;
      // a roof framing plan's spot elevations count only where no section or
      // elevation prints a level at all. One height answers; several are
      // options, one per part of the building, for the estimator to place.
      const levels = input.facts.filter((f) => (f.kind === "structure-elevation" || f.kind === "bearing-elevation") && f.feet !== null);
      const drawn = levels.some((f) => !f.framing) ? levels.filter((f) => !f.framing) : levels;
      const byZone = new Map<string, HeightFact[]>();
      for (const f of drawn) byZone.set(f.zone ?? "", [...(byZone.get(f.zone ?? "") ?? []), f]);
      const perZone: HeightFact[] = [];
      for (const facts of byZone.values()) {
        const decks = facts.filter((f) => f.kind === "structure-elevation");
        const pool = decks.length > 0 ? decks : facts;
        // Two decks in one zone are both offered; nothing is picked between them.
        perZone.push(...pool);
      }
      let distinct = [...new Map(perZone.sort((a, b) => (a.feet as number) - (b.feet as number)).map((f) => [Math.round((f.feet as number) * 12), f])).values()];
      // ── THE PLAN SHEET'S OWN BUILDING ──
      // Bunkie: T.O. WALL 2 14'-4" is printed on the "- WAREHOUSE" elevations,
      // so a "FLOOR PLAN - WAREHOUSE" takes it; the addition's plan names a
      // building no level sheet does, and takes the one zone that names none.
      if (distinct.length > 1 && input.buildings !== undefined && input.buildings.length > 0) {
        const named = (f: HeightFact) => levels.filter((g) => (g.zone ?? "") === (f.zone ?? "")).flatMap((g) => g.buildings ?? []);
        const mine = distinct.filter((f) => named(f).some((b) => input.buildings!.includes(b)));
        const unnamed = distinct.filter((f) => named(f).length === 0);
        if (mine.length > 0) distinct = mine;
        else if (unnamed.length === 1) distinct = unnamed;
      }
      if (distinct.length === 0) return unresolved(`"${basis.phrase}" needs the structure's elevation from a section, and none was read`);
      const only = distinct.length === 1 ? distinct[0]! : null;
      if (only !== null) {
        const bearing = only.kind === "bearing-elevation";
        return { code: input.code, basis, feet: only.feet, from: only, confidence: bearing ? "LOW" : grade(true), generalNoteOnly, why: `${chain}${generalNoteOnly ? "general note " : ""}"${basis.phrase}"; ${only.sheet} prints ${only.phrase}${bearing ? " (a bearing line: the deck may sit above it)" : ""}` };
      }
      return { ...unresolved(`"${basis.phrase}": the sections print ${distinct.length} levels by part of the building — ${distinct.map((d) => `${d.sheet} ${d.phrase}`).join("; ")} — one per zone, to place`), options: distinct };
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
    case "see": {
      // ── FOLLOW "SEE SHEET A300" — Grand Junction's types send every height there ──
      // The named sheet's own figures, by its number; "SEE ELEVATIONS" takes every
      // interior elevation's. One figure answers; several are options, never averaged.
      const target = basis.target.replace(/^SHEET\s+/, "").replace(/[-.\s]/g, "");
      const there = input.facts.filter(
        (f) => f.feet !== null && f.kind !== "note" && f.kind !== "general-note" && f.kind !== "floor-datum" &&
          (/^ELEVATIONS?$/.test(target) ? f.kind === "wall-height" : f.sheet.replace(/[-.\s]/g, "").toUpperCase() === target),
      );
      const distinct = [...new Map(there.map((f) => [f.feet as number, f])).values()].sort((a, b) => (a.feet as number) - (b.feet as number));
      if (distinct.length === 0) return unresolved(`the legend says "${basis.phrase}", and no height was read there`);
      if (distinct.length === 1) {
        const only = distinct[0]!;
        return { code: input.code, basis, feet: only.feet, from: only, confidence: "MEDIUM", generalNoteOnly, why: `"${basis.phrase}"; ${only.sheet} prints ${only.phrase}` };
      }
      return { ...unresolved(`"${basis.phrase}": ${distinct[0]!.sheet} gives ${distinct.length} heights — ${distinct.map((f) => f.phrase).join("; ")} — one per wall, to pick`), options: distinct };
    }
    case "mixed":
      return unresolved(`the legend gives more than one height — "${basis.phrase}" — which is two quantities, not one`);
  }
}

/**
 * The figures printed as elevations and ceiling tags, read off a sheet's text items.
 *
 * ── AND THE SPELLINGS A SECTION ACTUALLY USES ──
 *
 * Joplin's sections mark levels "LOWER BOD 112'-0"" (bottom of deck),
 * "ADMIN JBE 112'-4"" (joist bearing), "CENTRAL TOW 116'-8"" (top of wall)
 * over "FIRST FLOOR 100'-0"", and its roof framing plan prints
 * "B/DECK EL = 112' - 6"". A zone word may lead the label, the figure may be
 * an absolute elevation split across three items ("112'", "-", "0""), and a
 * floor level is read as a `floor-datum` so `relativeToFloor` can turn the
 * absolute figures into heights.
 */
export function heightFactsFromText(input: {
  sheet: string;
  items: readonly { str: string; x: number; y: number; height: number }[];
}): HeightFact[] {
  const out: HeightFact[] = [];
  const items = input.items.map((i) => ({ ...i, str: i.str.trim() })).filter((i) => i.str !== "");
  const FEET = /^=?\s*(\d{1,4})\s*'\s*(?:[-–]\s*)?(?:(\d{1,2})(?:\s+(\d{1,2})\/(\d{1,2}))?)?\s*(?:"|''|”)?(?:\s*A\.?F\.?F\.?)?$/i;
  const INCHES = /^[-–]?\s*(\d{1,2})(?:\s+(\d{1,2})\/(\d{1,2}))?\s*(?:"|''|”)$/;
  const ZONE = String.raw`(?:\(E\)\s*)?(?:[A-Z]{2,}\s+){0,2}`;
  // T.O. and B.O. with their dots: "ANGLE ATTACHMENT TO JOIST" is not a top of joist (Joplin S-202).
  const STRUCTURE = new RegExp(String.raw`^${ZONE}(?:(?:T\.\s?O\.?|T\/O|TOP\s+OF)\s+(?:ROOF\s+)?(?:FRAMING|DECK(?:ING)?|STEEL|STRUCT(?:URE)?\.?|JOISTS?|SLAB)|(?:B\.\s?O\.?|B\/O|BOTTOM\s+OF|U\/S|UNDERSIDE\s+OF)\s+(?:ROOF\s+)?(?:DECK(?:ING)?|STEEL|STRUCT(?:URE)?\.?|JOISTS?|SLAB|BEAM)|B\/(?:HIGH\s+|LOW\s+)?DECK(?:\s+EL\.?)?|B\.?O\.?D\.?)(?=\s|=|$)`, "i");
  const BEARING = new RegExp(String.raw`^${ZONE}(?:(?:T\.\s?O\.?|T\/O|TOP\s+OF)\s+(?:WALL|PLATE|BEARING|BRG\.?|MASONRY|CMU)|T\.?O\.?W\.?|J\.?B\.?E\.?)(?=\s|=|$)`, "i");
  const CEILING_LABEL = /^(?:B\.?O\.?\s+)?(?:CLG|CEILING)\.?(?:\s*(?:HT|HEIGHT)\.?)?$/i;
  const DATUM = /^(?:(?:FIRST|1ST|GROUND|MAIN)\s+FLOOR|(?:FIN(?:ISH(?:ED)?)?\.?\s+)?(?:FIRST\s+)?FL(?:OO)?R\.?(?:\s+EL(?:EV(?:ATION)?)?\.?)?|(?:ARCHITECTURAL\s+)?F\.?F\.?E\.?|LEVEL\s+(?:1|ONE)|T\.?O\.?\s+(?:CONC(?:RETE)?\.?\s+)?SLAB(?:\s+EL(?:EV(?:ATION)?)?\.?)?)\s*(?:=|:)?\s*/i;
  const feetOf = (s: string): number | null => {
    const m = FEET.exec(s);
    if (m === null) return null;
    const inches = (m[2] === undefined ? 0 : Number(m[2])) + (m[3] === undefined ? 0 : Number(m[3]) / Number(m[4]));
    return Number(m[1]) + inches / 12;
  };
  /** The figure beside a label — one item, or `112'` with its `0"` (and a lone `-`) printed as the next items. */
  const figureBeside = (label: (typeof items)[number]) => {
    const row = items.filter((o) => o !== label && Math.abs(o.y - label.y) < 2.5 * label.height && Math.abs(o.x - label.x) < 260);
    // "CLG. 1'-0" BELOW JOISTS" is an offset, not a height.
    if (row.some((o) => /\b(?:BELOW|ABOVE)\b/i.test(o.str))) return null;
    // Nearest first: a section prints several levels one under the other.
    row.sort((a, b) => Math.hypot(a.x - label.x, a.y - label.y) - Math.hypot(b.x - label.x, b.y - label.y));
    for (const o of row) {
      const feet = feetOf(o.str);
      if (feet === null || feet < 1 || feet > 400) continue;
      let text = o.str;
      let value = feet;
      if (/^=?\s*\d{1,4}\s*'$/.test(o.str)) {
        const inch = row.find((p) => p !== o && Math.abs(p.y - o.y) < label.height && p.x > o.x && p.x - o.x < 40 && INCHES.test(p.str));
        if (inch !== undefined) {
          const m = INCHES.exec(inch.str)!;
          value += (Number(m[1]) + (m[2] === undefined ? 0 : Number(m[2]) / Number(m[3]))) / 12;
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
      // Not beside a bulkhead, soffit or chase: Green Bay A11.2's "8' - 0" AFF"
      // is "B.O BULKHEAD", how low the bulkhead comes, not a ceiling.
      const hung = items.some((o) => o !== i && Math.abs(o.y - i.y) < 3 * i.height && Math.abs(o.x - i.x) < 200 && /\bBULKHEAD\b|\bSOFFIT\b|\bCHASE\b|^B\.\s?O\b/i.test(o.str));
      if (feet !== null && feet <= 60 && !hung) out.push({ kind: "ceiling-height", feet, sheet: input.sheet, phrase: i.str });
      continue;
    }
    // A floor level with its figure in the same item: "ARCHITECTURAL FFE = 100'-0"".
    const datumHere = DATUM.exec(i.str);
    if (datumHere !== null && datumHere[0].trim() !== "") {
      const rest = i.str.slice(datumHere[0].length).replace(/\.?\s*U\.?N\.?O\.?$/i, "").trim();
      const inline = rest === "" ? null : feetOf(rest);
      const beside = rest === "" ? figureBeside(i) : null;
      const feet = inline ?? beside?.value ?? null;
      if (feet !== null) out.push({ kind: "floor-datum", feet, sheet: input.sheet, phrase: rest === "" ? `${i.str} ${beside!.text}` : i.str });
      continue;
    }
    const kind: HeightFact["kind"] | null = STRUCTURE.test(i.str) ? "structure-elevation" : BEARING.test(i.str) ? "bearing-elevation" : CEILING_LABEL.test(i.str) ? "ceiling-height" : null;
    if (kind === null) continue;
    // "B/DECK EL = 112' - 6"" can be one item.
    const after = i.str.replace(kind === "structure-elevation" ? STRUCTURE : kind === "bearing-elevation" ? BEARING : CEILING_LABEL, "").trim();
    const inline = after === "" ? null : feetOf(after);
    const beside = inline !== null ? { value: inline, text: after } : figureBeside(i);
    if (beside === null || (kind === "ceiling-height" && beside.value > 60)) continue;
    const lead = new RegExp(`^${ZONE}`, "i").exec(i.str)?.[0].replace(/\(E\)/i, "") ?? "";
    const zone = kind === "ceiling-height" ? undefined : `${lead} ${inline === null ? after.replace(/^=\s*/, "") : ""}`.replace(/\s+/g, " ").trim().toUpperCase();
    out.push({ kind, feet: beside.value, sheet: input.sheet, phrase: inline !== null ? i.str : `${i.str} ${beside.text}`, ...(zone === undefined ? {} : { zone }) });
  }
  return out;
}

/**
 * Heights an interior elevation dimensions and names: Grand Junction's A300
 * prints `8'-0"` beside `"T" WALL`, `12'-0"` beside `AT SALES`. A dimension
 * with no wall named beside it is an opening, a sill or trim, and is left.
 */
export function labelledWallHeights(input: { sheet: string; items: readonly { str: string; x: number; y: number; height: number }[] }): HeightFact[] {
  const FIGURE = /^(\d{1,2})\s*'\s*[-–]?\s*(\d{1,2})?(?:\s+(\d{1,2})\/(\d{1,2}))?\s*(?:"|”)?$/;
  // A bulkhead or soffit hangs from above: its dimension is how low it comes, not how high a wall goes.
  const LABEL = /\bWALL\b|^AT\s+[A-Z]|\bPARTITION\b/i;
  const items = input.items.map((i) => ({ ...i, str: i.str.trim() })).filter((i) => i.str !== "");
  const out: HeightFact[] = [];
  for (const i of items) {
    const m = FIGURE.exec(i.str);
    if (m === null) continue;
    const feet = Number(m[1]) + ((m[2] === undefined ? 0 : Number(m[2])) + (m[3] === undefined ? 0 : Number(m[3]) / Number(m[4]))) / 12;
    if (feet < 6 || feet > 30) continue;
    // ponytail: 24 pt either way; the PDF's rotation is not carried, so a rotated label is found by distance alone.
    const label = items
      .filter((o) => o !== i && Math.abs(o.x - i.x) < 24 && Math.abs(o.y - i.y) < 24 && LABEL.test(o.str) && !/^SEE\b/i.test(o.str))
      .sort((a, b) => Math.hypot(a.x - i.x, a.y - i.y) - Math.hypot(b.x - i.x, b.y - i.y))[0];
    if (label !== undefined) out.push({ kind: "wall-height", feet, sheet: input.sheet, phrase: `${i.str} ${label.str}` });
  }
  return out;
}

/** A figure this high is an elevation above a datum (Joplin's 100'-0"), not a height above the floor. */
export const ABSOLUTE_FEET = 40;

/**
 * Absolute elevations as heights above the floor: each sheet's own floor
 * level first ("FIRST FLOOR 100'-0""), else the set's commonest
 * ("ARCHITECTURAL FFE = 100'-0""). An absolute figure with no floor to
 * measure from says nothing about height and is dropped; the datums go too.
 */
export function relativeToFloor(facts: readonly HeightFact[]): HeightFact[] {
  const datums = facts.filter((f) => f.kind === "floor-datum" && f.feet !== null && f.feet >= ABSOLUTE_FEET);
  const commonest = (list: readonly HeightFact[]) => {
    const n = new Map<number, number>();
    for (const f of list) n.set(f.feet as number, (n.get(f.feet as number) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const setDatum = commonest(datums);
  const out: HeightFact[] = [];
  for (const f of facts) {
    if (f.kind === "floor-datum") continue;
    if (f.feet === null || f.feet < ABSOLUTE_FEET) {
      out.push(f);
      continue;
    }
    const floor = commonest(datums.filter((d) => d.sheet === f.sheet)) ?? setDatum;
    if (floor === null || f.feet <= floor) continue;
    const feet = Math.round((f.feet - floor) * 1200) / 1200;
    if (feet > 60) continue;
    out.push({ ...f, feet, phrase: `${f.phrase} (floor ${floorLabel(floor)})` });
  }
  return out;
}

function floorLabel(feet: number): string {
  const whole = Math.floor(feet);
  return `${whole}'-${Math.round((feet - whole) * 12)}"`;
}

/**
 * A ceiling plan's sentence for every ceiling — "ALL DROPPED CEILINGS ARE 8'-0"
 * ABOVE FINISH FLOOR, UNLESS OTHERWISE NOTED." (Green Bay A4.0 note 2), printed
 * across cells — as a ceiling height labelled U.N.O.
 */
export function ceilingNotesFromLines(sheet: string, lines: readonly string[]): HeightFact[] {
  const out: HeightFact[] = [];
  for (const line of lines) {
    const joined = line.replace(/\s*\|\s*/g, " ");
    const m = /\bALL\s+(?:(?:DROPPED|SUSPENDED|ACOUSTIC(?:AL)?|GYP(?:SUM)?\.?\s+BD\.?)\s+)?CEILINGS?\s+(?:ARE|SHALL\s+BE|TO\s+BE|AT)\s+(\d{1,2})\s*'\s*[-–]?\s*(\d{1,2})?\s*(?:"|'')?\s*(?:A\.?F\.?F\.?|ABOVE\s+FIN(?:ISH(?:ED)?)?\.?\s+FLOOR)/i.exec(joined);
    if (m === null) continue;
    out.push({ kind: "ceiling-height", feet: Number(m[1]) + (m[2] === undefined ? 0 : Number(m[2])) / 12, label: "U.N.O.", sheet, phrase: m[0] });
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
