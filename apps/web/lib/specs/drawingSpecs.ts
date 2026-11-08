import type { SpecTradeRead } from "@prova/integrations/src/specTrade";

/**
 * ── DIVISION 09/07 REQUIREMENTS PRINTED ON THE DRAWINGS, FOUND FROM THE TEXT LAYER ALONE ──
 *
 * A small tenant-improvement set has no project manual: its specification is the
 * general notes, the partition notes and the spec sheets (G-series, A0.x) printed on
 * the drawings. This finds the requirements there that a drywall/framing, ceilings,
 * plaster/EIFS or fireproofing sub prices, with NO model call:
 *
 *   1. PARAGRAPHS ARE REBUILT PER COLUMN from the text's positions. A sheet sets notes
 *      in several columns side by side, and reading it row by row glues one column's
 *      line to its neighbour's — so a note is a run of lines that start at the same
 *      left edge (a hanging indent allowed) on consecutive rows.
 *   2. A NOTE IS KEPT ONLY IF IT STATES A REQUIREMENT ABOUT THIS TRADE WITH SOMETHING
 *      MEASURABLE IN IT: a trade word (gypsum, stud, ceiling, fireproofing, EIFS…), a
 *      requirement word (shall, provide, all … to be, minimum, typical, U.N.O.) and a
 *      spec token (a gauge, a thickness, Type X, a finish level, a UL design, a spacing,
 *      deflection). That is what drops the abbreviation tables ("ACT | ACOUSTIC CEILING
 *      TILE"), the wall legend's assembly lines (no requirement word) and every note
 *      about another trade.
 *   3. FACTS ARE READ OUT OF EACH NOTE BY CODE into the same shape the spec-book reader
 *      returns (`SpecTradeRead`), with the note itself as the quote, so the Specs panel
 *      and the wall-type check treat a drawing's notes exactly like a spec section.
 *
 * Every result names its sheet, so the estimator can open the drawing and read the note.
 */

/** Stored as a `SpecTradeReading`'s model and prompt version, so a drawing's notes are told apart from a model read. */
export const DRAWING_NOTES_MODEL = "drawing-text";
export const DRAWING_NOTES_VERSION = "drawing-notes.1";

export type TextItem = { str: string; x: number; y: number; width: number; height: number };

/** One rebuilt note: its words, and where it starts on the sheet (points, y down). */
export type Note = { text: string; x: number; y: number };

/** Items on one baseline, split where the gap is wider than a few characters (a column gutter). */
function segments(items: readonly TextItem[]): { x: number; right: number; y: number; h: number; text: string }[] {
  const rows = new Map<number, TextItem[]>();
  for (const it of items) {
    if (it.str.trim() === "") continue;
    const key = Math.round(it.y / 3);
    rows.set(key, [...(rows.get(key) ?? []), it]);
  }
  const out: { x: number; right: number; y: number; h: number; text: string }[] = [];
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    let cur: { x: number; right: number; y: number; h: number; text: string } | null = null;
    for (const it of row) {
      const h = Math.max(it.height, 4);
      // A bare note number or bullet ("6.", "-", "•") is set wide of its text; it still belongs to it.
      const bare = cur !== null && /^(?:\(?(?:\d{1,2}|[A-Za-z])[.)]|[-•–·*])$/.test(cur.text);
      if (cur && it.x - cur.right <= h * (bare ? 4 : 1.5)) {
        cur.text += (it.x - cur.right > h * 0.15 ? " " : "") + it.str.trim();
        cur.right = it.x + it.width;
      } else {
        if (cur) out.push(cur);
        cur = { x: it.x, right: it.x + it.width, y: it.y, h, text: it.str.trim() };
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** A note marker that opens a new paragraph: "1.", "A.", "a.", "12)", "(3)". */
const MARKER = /^(?:\(?\d{1,2}[.)]|\(?[A-Za-z][.)])\s+/;

/**
 * Paragraphs, column by column: a segment continues the note above it when it sits on the
 * next row (within 1.8 line heights) at the same left edge or a hanging indent of up to six
 * characters, and does not open with its own note marker.
 */
export function notesFrom(items: readonly TextItem[]): Note[] {
  const segs = segments(items).sort((a, b) => a.y - b.y || a.x - b.x);
  const open: { note: Note; x: number; lastY: number; h: number }[] = [];
  const done: Note[] = [];
  for (const s of segs) {
    const marker = MARKER.test(s.text);
    const inColumn = (o: (typeof open)[number]) => s.x >= o.x - o.h * 0.5 && s.x <= o.x + o.h * 4;
    if (marker) {
      // A new note in this column ends the one above it — a heading or the previous note — so the
      // lines under it cannot be claimed by the note above (which once took every continuation line
      // on a sheet and left each lettered note with only its first line).
      for (let i = open.length - 1; i >= 0; i--) if (inColumn(open[i])) done.push(...open.splice(i, 1).map((o) => o.note));
    }
    // Continuing: the MOST RECENT open note in this column on the row above, never just the first found.
    let at = -1;
    if (!marker) {
      for (let i = 0; i < open.length; i++) {
        const o = open[i];
        if (s.y - o.lastY > 0 && s.y - o.lastY <= o.h * 1.8 && inColumn(o) && (at < 0 || o.lastY > open[at].lastY)) at = i;
      }
    }
    if (at >= 0) {
      const o = open[at];
      o.note.text = `${o.note.text} ${s.text}`.replace(/(\w)- (\w)/g, "$1$2");
      o.lastY = s.y;
    } else {
      open.push({ note: { text: s.text, x: s.x, y: s.y }, x: s.x, lastY: s.y, h: s.h });
    }
    // A note not continued for three line heights is finished.
    for (let i = open.length - 1; i >= 0; i--) {
      if (s.y - open[i].lastY > open[i].h * 3) done.push(...open.splice(i, 1).map((o) => o.note));
    }
  }
  done.push(...open.map((o) => o.note));
  return done.map((n) => ({ ...n, text: n.text.replace(/\s+/g, " ").trim() }));
}

const TRADE =
  /\b(GYP(?:SUM)?|GWB|GYP\.?\s*BD|DRYWALL|WALLBOARD|STUDS?|TRACK|RUNNERS?|FURRING|ACOUSTICAL|ACT\b|CEILING|GRID|SUSPENSION|FIREPROOFING|SFRM|SPRAY[-\s]APPLIED|EIFS|PLASTER|STUCCO|VENEER|LATH|SHAFT\s*WALL|PARTITIONS?|LEVEL\s*[0-5]\s*FINISH|FINISH\s*LEVEL)\b/i;
// A requirement is a VERB or a bound, never "TYP." alone: a detail's label says TYP. and specifies nothing.
const REQUIRES =
  /\b(SHALL|PROVIDE[DS]?|REQUIRED|INSTALL(?:ED)?|USE[D]?|U\.?N\.?O\.?|UNLESS OTHERWISE|ALL\b[^.]{0,80}\b(?:TO BE|SHALL)\b)\b|\b(?:MIN(?:IMUM)?|MAX(?:IMUM)?)\.?\s*(?=\d|OF\s+\d)|\d\S*\s*(?:MIN|MAX)\.?\b/i;
// Another trade's work that shares this trade's words: wood framing, plywood, roofing, structural steel.
const NOT_THIS_TRADE = /\b(PLYWOOD|LUMBER|2X\d*|LVL|LSL|TJI|ROOFING|MEMBRANE|SIMPSON|NAILS?|NAILING|JOISTS?|RAFTERS?|SHEAR\s*WALLS?|ANCHOR\s*BOLTS?|PIPE|DRAIN|CONDUIT|DUCT|ALARMS?|STROBES?|VALVES?|HOODS?|EXHAUST|PLUMBING|ELECTRICAL)\b/i;
// A code analysis cites the building code about the building; it is not a requirement on this work.
// Code-analysis wording, not a mere citation: a requirement note may cite "IBC SECTION 808" and still be one.
const CODE_ANALYSIS = /\b(OCCUPANCY|CHAPTER\s+\d+|TABLE\s+\d{3,4})\b/i;
const CLEARLY_THIS_TRADE = /\b(GYP(?:SUM)?|GWB|DRYWALL|WALLBOARD|(?:METAL|STEEL|MTL\.?|STL\.?)\s*STUDS?|ACOUSTICAL|CEILING\s*(?:TILE|GRID)|FIREPROOFING|SFRM|EIFS|PLASTER)\b/i;
const TOKEN =
  /(\b\d{2}\s*(?:GA\.?|GAUGE|GAGE|MILS?)\b|\b\d+\s*-?\s*\d*\/?\d+\s*(?:"|''|IN\.?|INCH)|TYPE\s*['"]?\s*[XC]\b|LEVEL\s*[0-5]\b|\bUL\b|\b[UVWXY]\d{3}\b|O\.?\s*C\.?\b|DEFLECTION|SLOTTED|ABUSE|IMPACT|MOISTURE|MOLD|\bL\/\d{3}\b|\d\s*-?\s*(?:HR|HOUR)\b|NO\s+SUBSTITUTIONS?)/i;

/** True when a note states a requirement this trade prices, with something to measure it by. */
// Plainly this trade's element, for a note that states a requirement without a number in it.
const TRADE_ELEMENT =
  /\b(GYP(?:SUM)?|GWB|DRYWALL|WALLBOARD|(?:METAL|STEEL|MTL\.?|STL\.?)\s*STUDS?|ACOUSTICAL|(?:CEILING|T-?BAR)\s*GRID|SUSPENDED\s*CEILINGS?|SUSPENSION\s*SYSTEMS?|BULKHEADS?|FURRING|DEFLECTION\s*TRACK|SHAFT\s*WALL|FIREPROOFING|SFRM|EIFS|PLASTER|LAY-IN)\b/i;
// A requirement stated as an order or an obligation: "SHALL", "MUST", "ALL … TO BE", or a note that opens with a verb.
const OBLIGES =
  /\b(SHALL|MUST|PROVIDE[DS]?|ALL\b[^.]{0,80}\bTO BE|ARE TO|IS TO)\b|^(?:\(?[\dA-Za-z]{1,2}[.)]\s*)?(?:INSTALL|PROVIDE|WRAP|CENTER|ATTACH|APPLY|EXTEND|SECURE|FURNISH|MAINTAIN|ERECT|REPAIR|PATCH|SEAL|USE)\b(?!\s+OF\b)/i;
// Prefinished metal wall or soffit panels: siding, which carries a gauge and "studs" but is not this work.
const METAL_PANELS = /\b(?:PRE-?FINISHED\s+METAL|METAL\s+(?:WALL|SOFFIT)\s+PANELS?|KYNAR|PAC-CLAD)\b/i;

export function isTradeRequirement(text: string): boolean {
  if (METAL_PANELS.test(text)) return false;
  // A note explaining the drawings' own conventions ("THE ALPHANUMERIC DESIGNATION IN EACH PARTITION TYPE
  // SYMBOL DESCRIBES…") says how to read a sheet, not what to build, unless it also gives an order.
  if (/\b(SYMBOLS?|DESIGNATIONS?|ALPHANUMERIC)\b/i.test(text) && !/\b(SHALL|PROVIDE|USE|INSTALL)\b/i.test(text)) return false;
  if (text.length < 20 || text.length > 900) return false;
  // An abbreviations table row: short code | expansion pairs, no sentence.
  if (/^[A-Z.&/]{1,6}\s+[A-Z ,/&-]+$/.test(text) && !REQUIRES.test(text)) return false;
  if (CODE_ANALYSIS.test(text)) return false;
  if (NOT_THIS_TRADE.test(text) && !CLEARLY_THIS_TRADE.test(text)) return false;
  // Demolition says what comes out, not what goes in.
  if (/^(?:\(?[\dA-Za-z]{1,2}[.)]\s*)?(?:DEMOLISH|REMOVE)\b/i.test(text)) return false;
  // A run of keynotes or callouts glued together: numbers standing alone ("2 3 4"), or a long
  // stretch with no sentence in it. Its parts belong to different things, so it is no one note.
  if (/(?:\s\d{1,2}){3}\s/.test(` ${text} `)) return false;
  if (text.length > 250 && (text.match(/\.(?:\s|$)/g) ?? []).length < 2) return false;
  if (TRADE.test(text) && REQUIRES.test(text) && TOKEN.test(text)) return true;
  // No number in it, but an obligation about this trade's own element: still a requirement it prices.
  // (Letting a numbered note qualify on a broad word — STUD, GRID, PARTITION — was measured and refused:
  // false hits went from 11 to 35 on the key sets, every one a dimension or coordination note.)
  return TRADE_ELEMENT.test(text) && OBLIGES.test(text);
}

/** Which section a note belongs with: a number it prints, else its trade's usual one. */
export function sectionForNote(text: string): string {
  const printed = text.match(/\b(0[79])\s?(\d{2})\s?(\d{2})\b/);
  if (printed) return `${printed[1]} ${printed[2]} ${printed[3]}`;
  if (/FIREPROOF|SFRM|SPRAY[-\s]APPLIED/i.test(text)) return "07 81 00";
  if (/\bEIFS\b|EXTERIOR INSULATION AND FINISH/i.test(text)) return "07 24 00";
  if (/PLASTER|STUCCO|\bLATH\b/i.test(text) && !/GYP|GWB|DRYWALL|WALLBOARD/i.test(text)) return "09 24 00";
  if (/ACOUSTICAL|\bACT\b|CEILING TILE|\bGRID\b|SUSPENSION|(?:MAIN|CROSS)\s+RUNNERS?|HANGER\s+WIRE|SPLAY\s+WIRE|\bPANELS?\b.*CEILING/i.test(text)) return "09 51 13";
  if (/GYP|GWB|DRYWALL|WALLBOARD|FINISH LEVEL|LEVEL\s*[0-5]|SHEATHING/i.test(text)) return "09 21 16";
  return "09 22 16";
}

const MANUFACTURERS = [
  "USG", "CertainTeed", "National Gypsum", "Georgia-Pacific", "PABCO", "American Gypsum", "Continental",
  "ClarkDietrich", "Marino\\WARE", "SCAFCO", "Telling", "Armstrong", "Rockfon", "CertainTeed Ceilings",
  "Isolatek", "Cafco", "Carboline", "Monokote", "GCP", "Dryvit", "Sto", "Parex", "Hilti", "Fire Trak",
];

/** One note's facts, in the spec-book reader's shape, the note itself the quote. */
export function factsFromNote(text: string): SpecTradeRead {
  const read: SpecTradeRead = { products: [], studs: [], boards: [], fireRatings: [], ceilings: [], finishLevels: [], priceDrivers: [], requirements: [{ quote: text }], reason: "" };
  const quote = text;
  const pick = (re: RegExp) => text.match(re)?.[0].trim() ?? null;

  if (/\bSTUDS?\b|FRAMING|\bTRACK\b|RUNNER/i.test(text)) {
    const gauge = pick(/\b\d{2}\s*(?:GA\.?|GAUGE|GAGE)\b(?:\s*\(\s*\d{2}\s*MILS?\s*\))?|\b\d{2}\s*MILS?\b(?:\s*\(\s*\d{2}\s*GA\.?\s*\))?/i);
    const spacing = pick(/\b\d{1,2}\s*(?:"|''|IN\.?|INCHES?)?\s*O\.?\s*C\.?/i);
    const depth = pick(/\b\d+(?:\s*-?\s*\d\/\d+)?\s*(?:"|''|IN\.?|INCH)\s*(?=[^;]{0,24}\bSTUD)/i);
    if (gauge || spacing) read.studs.push({ gauge, depth, spacing, quote });
  }
  if (/GYP|GWB|DRYWALL|WALLBOARD|\bBOARD\b|SHEATHING/i.test(text)) {
    const thickness = pick(/\b\d\s*\/\s*\d\s*(?:"|''|IN\.?|INCH)/i);
    const kinds: string[] = [];
    if (/TYPE\s*['"]?\s*X\b/i.test(text)) kinds.push("Type X");
    if (/TYPE\s*['"]?\s*C\b/i.test(text)) kinds.push("Type C");
    if (/ABUSE/i.test(text)) kinds.push("abuse-resistant");
    if (/IMPACT/i.test(text)) kinds.push("impact-resistant");
    if (/MOISTURE|\bMR\b|WATER[-\s]RESISTANT/i.test(text)) kinds.push("moisture-resistant");
    if (/MOLD/i.test(text)) kinds.push("mold-resistant");
    if (/SHAFT\s*(?:WALL|LINER)/i.test(text)) kinds.push("shaftliner");
    if (/CEMENT\s*BOARD|CEMENTITIOUS\s*BACKER/i.test(text)) kinds.push("cement board");
    const where = pick(/\b(?:AT|IN|FOR)\s+(?:ALL\s+)?(?:FIRE[-\s]?)?(?:RATED|WET|CORRIDOR|TOILET|RESTROOM|SHAFT|EXTERIOR|LOBBY)[^.,;]{0,40}/i);
    for (const kind of kinds.length > 0 ? kinds : thickness ? ["gypsum board"] : []) read.boards.push({ kind, thickness, where, quote });
  }
  for (const m of text.matchAll(/\b(?:UL\s*(?:DESIGN|DES\.?|ASSEMBLY|NO\.?|#)?\s*)([UVWXY]\d{3})\b/gi)) {
    const rating = pick(/\b\d\s*-?\s*(?:HR|HOUR)\b/i) ?? "rated";
    read.fireRatings.push({ rating, assembly: `UL ${m[1].toUpperCase()}`, quote });
  }
  if (read.fireRatings.length === 0 && /\b\d\s*-?\s*(?:HR|HOUR)\b/i.test(text) && /RATED|FIRE/i.test(text)) {
    read.fireRatings.push({ rating: pick(/\b\d\s*-?\s*(?:HR|HOUR)\b/i)!, assembly: null, quote });
  }
  if (/ACOUSTICAL|\bACT\b|CEILING TILE|\bGRID\b|SUSPENSION/i.test(text)) {
    const tile = pick(/\b(?:\d{1,2}\s*"?\s*X\s*\d{1,2}\s*"?|2\s*'\s*X\s*[24]\s*')[^.;]{0,40}/i);
    const grid = pick(/\b\d+\s*\/\s*\d+\s*(?:"|IN\.?|INCH)?\s*(?:EXPOSED\s*)?(?:TEE|GRID)[^.;]{0,30}|\bGRID\b[^.;]{0,40}/i);
    if (tile || grid) read.ceilings.push({ tile, grid, quote });
  }
  for (const m of text.matchAll(/\bLEVEL\s*([0-5])\b/gi)) {
    if (!/FINISH|GYP|GWB|DRYWALL|TAPE/i.test(text)) continue;
    // Where the note puts it ("… AT THE LOBBY"); none, or "all", means it is the typical level.
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 70);
    const at = after.match(/\b(?:AT|IN)\s+((?:THE\s+)?[^.;,]{3,50})/i)?.[1]?.trim() ?? null;
    read.finishLevels.push({ level: Number(m[1]), where: at !== null && !/^ALL\b/i.test(at) ? at : null, quote });
  }
  for (const name of MANUFACTURERS) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) read.products.push({ manufacturer: name, product: null, quote });
  }
  const driver = (label: string, why: string) => read.priceDrivers.push({ label, why, quote });
  if (/\bLEVEL\s*5\b/i.test(text)) driver("Level 5 finish", "A skim coat over the whole surface, beyond the Level 4 most bids carry.");
  if (/ABUSE|IMPACT/i.test(text)) driver("Abuse- or impact-resistant board", "Costs more than standard board and is heavier to hang.");
  if (/DEFLECTION|SLOTTED/i.test(text)) driver("Deflection track", "Slotted or deep-leg track at the head costs more than standard runner.");
  if (/\bL\/360\b|\bL\/600\b/i.test(text)) driver("Tight deflection limit", "A stiffer limit than L/240 can mean heavier studs or closer spacing.");
  if (/NO\s+SUBSTITUTIONS?/i.test(text)) driver("No substitutions", "The named product must be used.");
  if (/MOCK[-\s]?UP/i.test(text)) driver("Mock-up", "A sample to build and have approved before the work.");
  if (/ATTIC\s+STOCK/i.test(text)) driver("Attic stock", "Extra material left on site.");
  if (/SEISMIC/i.test(text) && /CEILING|GRID|BRAC/i.test(text)) driver("Seismic bracing", "Ceiling or partition bracing beyond standard hanger wire.");
  return read;
}

export type DrawingSpecNote = { sectionNumber: string; text: string; read: SpecTradeRead };

/**
 * Whose sheet it is, from its number: structural, mechanical, plumbing, electrical, fire
 * protection, civil, landscape and telecom sheets print this trade's words about their own
 * work (a GRID drain, a 16 GA strap), so only general, architectural and interiors sheets —
 * and a sheet whose number could not be read — are searched.
 */
export function searchesSheet(sheetNumber: string | null): boolean {
  if (sheetNumber === null) return true;
  return /^(?:G|GN|GI|A|AD|AE|AF|AS|I|ID|N|X)[-.\s]?\d/i.test(sheetNumber.trim()) || /^(?:G|A|I)\d/i.test(sheetNumber.trim());
}

/** Every trade requirement on one sheet, each with whatever facts code reads out of it; repeats are dropped. */
export function drawingSpecNotes(items: readonly TextItem[]): DrawingSpecNote[] {
  const seen = new Set<string>();
  return notesFrom(items)
    .filter((n) => isTradeRequirement(n.text))
    .filter((n) => !seen.has(n.text) && seen.add(n.text) !== undefined)
    // Every kept note is a requirement in its own words (`requirements`), with whatever facts code reads out of it.
    .map((n) => ({ sectionNumber: sectionForNote(n.text), text: n.text, read: factsFromNote(n.text) }));
}
