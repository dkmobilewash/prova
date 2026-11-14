import { DIMENSION_MARK, SHEET_REFERENCE, tagSymbols, type TextForSymbol } from "./tagSymbols";

/**
 * ── THE WALL LEGEND READ FROM THE PDF'S TEXT, WITH NO MODEL ──
 *
 * The legend read (`extractWallLegend`) is a model call, so with the company's switch off or the
 * provider out of credit a new set gets NO wall types (0% typed on USU and Riverbend, ROUND 16b).
 * Most legends are text: each type is a code (S6B, PS3a, IW-4, 1A) printed in or beside a small
 * section, with its assembly written around it — studs, board, batts, rating, height. This reads
 * that layout from the text items' POSITIONS and returns the model read's own shape, so
 * everything downstream (`readPartitionAssembly`, heights, crops) runs unchanged. Marked
 * `source: "legend text"`.
 *
 *   1. LINES: items on one baseline and close together are one line — a cell, not the page row
 *      (`pageLines` joins a whole row with " | ", which is right for a model and wrong here: two
 *      neighbouring details share every row).
 *   2. CODES: a line that IS a designation (optionally "WALL TYPE X"), with assembly words in the
 *      window a legend detail occupies around it. A bare number or a single letter is a code only
 *      inside a closed symbol (keynotes, grid letters and dimensions are all bare numbers and
 *      letters). The printing with the most evidence is the type's; the rest are mentions.
 *   3. LINES TO CODES: each line inside some code's window goes to the NEAREST code — legends
 *      print the code above, below or left of its words, and the nearest code is the one whose
 *      detail it is.
 *   4. U.N.O.: "PARTITIONS ARE TYPE X UNLESS NOTED" anywhere on the page, for a code read here.
 *
 * Points, page coordinates, `y` down (the text item's `y` is its baseline).
 */

export type LegendTextRead = {
  /** `at`: where the code itself is printed (points, `y` the baseline), for diagnosis. */
  types: { code: string; name: string | null; lines: string[]; at?: { x: number; y: number; h: number }; evidence?: LegendTextEvidence }[];
  uno: { code: string; note: string }[];
  reason: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

export const LEGEND_TEXT_SOURCE = "legend text";

/**
 * How a type was read, so a source can be measured by its evidence: a key/schedule ROW (code, then
 * its words on the same baseline), a DETAIL (the words around a code in a legend's grid of
 * sections), or INLINE (the code starting a line whose own words describe the assembly —
 * Wendell's "S4 3 5/8" MTL STUD & GYP BD TO DECK"). `boxed`: printed inside a closed symbol;
 * `labelled`: "WALL TYPE X".
 */
export type LegendTextEvidence = { how: "row" | "detail" | "inline"; boxed: boolean; labelled: boolean };

type Line = { text: string; x0: number; x1: number; y: number; h: number };

/** Words that only appear where an assembly is described (`legendSight.ts`'s, plus rating and height words). */
const ASSEMBLY_WORD = /\bSTUDS?\b|\bGYP|\bBOARD\b|\bBATT|\bINSUL|\bO\.?\s?C\.?\b|\bTRACK\b|\bCMU\b|\bCONCRETE\b|\bLAYERS?\b|\bRATED\b|\bRATING\b|\bGA\.?\b|\bGAUGE\b|\bMTL\b|\bMETAL\b|\bDECK\b|\bSTC\b|\bHR\b|\bHOUR\b|\bFURR/i;
/** A designation as legends print one: S6B, PS3a, IW-4, 1A, XW-1, A3, 12. */
// v2: also digit-led codes with letters inside (cmb's 0SF1B, 0S3, 1SW4) and a dash-numbered variant (Wendell's SW2-1).
const DESIGNATION = /^(?:[A-Z]{1,4}-?\d{1,3}[A-Za-z]{0,2}(?:-\d{1,2})?|\d{1,3}[A-Z]{0,2}|\d{1,2}[A-Z]{1,3}\d{1,2}[A-Z]?)$/;
const LETTER = /^[A-Z]{1,2}$/;
/** A detail's window around its code, in inches: notes run right, the section above or below. */
/** Fewest types a page must yield to be a legend. */
export const MIN_TYPES = 3;
const WINDOW = { left: 1.25, right: 4.5, above: 4, below: 4.5 };
/** Joplin's order: "UNLESS NOTED OTHERWISE …, ALL INTERIOR DRYWALL PARTITIONS … ARE TYPE 'A' PARTITIONS". */
const UNO_FIRST = /\b(?:UNLESS\s+(?:NOTED|INDICATED|SHOWN)\s+OTHERWISE|UNLESS\s+OTHERWISE\s+(?:NOTED|INDICATED|SHOWN)|U\.?\s*N\.?\s*O\.?)\b[\s\S]{0,160}?\bPARTITIONS?\b[\s\S]{0,160}?\bARE\s+TYPE\s+["'“‘]?([A-Z0-9][A-Z0-9-]{0,5})["'”’]?/i;
const UNO = /\bPARTITIONS?\b[^.]{0,80}?\bTYPE\s+["'“‘]?([A-Z0-9][A-Z0-9 .-]{0,6}?)["'”’]?\s*,?\s*(?:PARTITIONS?\s*,?\s*)?(?:U\.?\s*N\.?\s*O\b|UNLESS\b|OTHERWISE\b)/i;

/** Items on one baseline and within a word gap of each other, as cells. */
export function textLines(items: readonly TextForSymbol[]): Line[] {
  const sorted = items.filter((i) => i.str.trim() !== "").sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Line[] = [];
  for (const item of sorted) {
    const h = Math.max(item.height, 3);
    const line = out.find((l) => Math.abs(l.y - item.y) <= Math.max(1.5, h * 0.35) && item.x >= l.x0 - 2 && item.x - l.x1 <= h * 1.6);
    if (line) {
      line.text += (item.x - line.x1 > h * 0.15 ? " " : "") + item.str.trim();
      line.x1 = Math.max(line.x1, item.x + item.width);
    } else {
      out.push({ text: item.str.trim(), x0: item.x, x1: item.x + item.width, y: item.y, h });
    }
  }
  return out.map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }));
}

/** "WALL TYPE 1 - NON-RATED", "TYPE A1", "PARTITION TYPE S6B:": the code, and the name after it. */
const LABELLED = /^(?:(?:WALL|PARTITION|PART\.?|INTERIOR\s+WALL|EXTERIOR\s+WALL)\s+)?TYPE\s*[:#]?\s*["'“‘]?([A-Z0-9][A-Za-z0-9.-]{0,6}?)["'”’]?(?:\s*[-–—:]\s*(.*))?$/i;
/**
 * ── C3, CANDIDATE RECALL, OFF UNLESS `LEGEND_TEXT_RECALL=1` ──
 *
 * On the 22b training keys the true code was not a candidate for 48% of key-code feet (2026-11-13).
 * Two general layouts the read missed: a detail titled "PARTITION - 0S3" (no word TYPE, cmb), and
 * one printing that lists several codes sharing a detail ("A1 A2 A3 A4", "A1A A2A A3A A4A",
 * Pottawattamie). A legend code with a suffix on the plan (UCCS's P0A6A beside P0A) needs nothing
 * here: the tag reader already types it as the family's variant (`familyOf`), and putting it in
 * the vocabulary stops that (tried: UCCS 923 ft right to 0). Gated so the held-out sets decide it.
 */
export const LEGEND_RECALL_ON = () => process.env.LEGEND_TEXT_RECALL === "1";
/** "PARTITION - 0S3", "WALL: S6B": a detail's title naming its code without the word TYPE. */
const TITLED = /^(?:WALL|PARTITION)\s*[-–—:]\s*["'“‘]?([A-Z0-9][A-Za-z0-9.-]{0,6})["'”’]?$/i;

/** Words a type's own description is made of — not merely words near it. */
const CORE_WORD = /\bSTUDS?\b|\bGYP|\bG\.?W\.?B\b|\bBOARD\b|\bBD\b|\bCMU\b|\bMASONRY\b|\bCONCRETE\b|\bBATTS?\b|\bINSUL|\bFURR|\bSHEATH|\bPLASTER\b|\bBLOCK\b|\bTRACK\b|\bO\.?\s?C\.?\b/i;

function codeOf(text: string, recall = false): { code: string; name: string | null; labelled: boolean } | null {
  const t = text.trim();
  const titled = recall ? t.match(TITLED) : null;
  if (titled !== null && DESIGNATION.test(titled[1]!)) return { code: titled[1]!, name: null, labelled: true };
  const labelled = t.match(LABELLED);
  if (labelled !== null && /TYPE/i.test(t) && (DESIGNATION.test(labelled[1]!) || LETTER.test(labelled[1]!))) return { code: labelled[1]!, name: labelled[2]?.trim() || null, labelled: true };
  const bare = t.replace(/^["'“‘]|["'”’]$/g, "").trim();
  if (bare.length === 0 || bare.length > 7) return null;
  // A UL design number, a rating, a schedule header or an abbreviation is a cell, not a type.
  if (/^(?:U\s?\d{3}|NR|HR|OC|GA|EQ|TYP|SIM|NIC|NTS|IMAGE|TAG|MARK|DIM|CLR|MIN|MAX)$/i.test(bare)) return null;
  if (SHEET_REFERENCE.test(bare.toUpperCase()) && /\d{3}|\./.test(bare)) return null;
  if (DIMENSION_MARK.test(bare)) return null;
  if (DESIGNATION.test(bare) || LETTER.test(bare)) return { code: bare, name: null, labelled: false };
  return null;
}

export function readLegendFromText(input: {
  items: readonly TextForSymbol[];
  widthPt: number;
  heightPt: number;
  /** Closed symbols on the page (`tagSymbols`), so a boxed code counts. */
  symbols?: readonly { x: number; y: number; radius: number }[];
  pointsPerInch?: number;
  /** C3's recall reads (`LEGEND_RECALL_ON`); the env decides when unset. */
  recall?: boolean;
}): LegendTextRead {
  const ppi = input.pointsPerInch ?? 72;
  const recall = input.recall ?? LEGEND_RECALL_ON();
  // A printing that only lists codes ("A1 A2 A3 A4"): each one a code, all sharing the detail.
  const listed = (text: string): { code: string; name: string | null; labelled: boolean }[] => {
    if (!recall) return [];
    const parts = text.trim().split(/\s+/);
    if (parts.length < 2) return [];
    const reads = parts.map((p) => codeOf(p));
    return reads.every((r) => r !== null && !/^\d{1,3}[A-Z]?$/.test(r.code) && !/^[A-Z]{1,2}$/.test(r.code)) ? (reads as { code: string; name: string | null; labelled: boolean }[]) : [];
  };
  const lines = textLines(input.items);
  const inWindow = (c: Line, l: Line) => {
    const cx = (c.x0 + c.x1) / 2;
    const lx = (l.x0 + l.x1) / 2;
    return lx >= cx - WINDOW.left * ppi && l.x0 <= cx + WINDOW.right * ppi && l.y >= c.y - WINDOW.above * ppi && l.y <= c.y + WINDOW.below * ppi;
  };

  // ── 2. CANDIDATE CODES, THE BEST PRINTING OF EACH ──
  type Cand = { key: string; code: string; name: string | null; line: Line; score: number; boxed: boolean; labelled: boolean };
  const best = new Map<string, Cand>();
  const weakLetters = new Set<string>();
  const boxedLetters = new Set<string>();
  for (const line of lines) {
    const one = codeOf(line.text, recall);
    for (const read of one === null ? listed(line.text) : [one]) {
      const cx = (line.x0 + line.x1) / 2;
      const cy = line.y - line.h / 2;
      const inSymbol = (input.symbols ?? []).some((s) => Math.hypot(s.x - cx, s.y - cy) <= s.radius + 1);
      // A bare number is a section bubble, a keynote or a dimension unless labelled ("WALL TYPE 1").
      if (/^\d{1,3}[A-Z]?$/.test(read.code) && !read.labelled) continue;
      // A single letter is a grid line unless boxed or labelled; two letters an abbreviation unless
      // boxed, labelled or in a rated schedule (`kind` below).
      const letters = /^[A-Z]{1,2}$/.test(read.code);
      if (/^[A-Z]$/.test(read.code) && !inSymbol && !read.labelled) continue;
      const near = lines.filter((l) => l !== line && inWindow(line, l));
      const assembly = near.filter((l) => ASSEMBLY_WORD.test(l.text)).length;
      if (assembly < 1) continue;
      if (letters && !inSymbol && !read.labelled) weakLetters.add(read.code.toUpperCase());
      const score = (inSymbol ? 1000 : 0) + (read.labelled ? 500 : 0) + assembly * 10 + Math.min(near.length, 9);
      const key = read.code.toUpperCase();
      const held = best.get(key);
      if (letters && (read.labelled || (inSymbol && key.length === 1))) boxedLetters.add(key);
      if (held === undefined || score > held.score) best.set(key, { key, code: read.code, name: read.name, line, score, boxed: inSymbol, labelled: read.labelled });
    }
  }
  // A two-letter code seen only bare stays only as a schedule row; a boxed single letter is a type
  // only on a page with no stronger codes (Joplin's A/B/C beside nothing else; a grid bubble beside S6B).
  for (const key of weakLetters) if (boxedLetters.has(key)) weakLetters.delete(key);
  // A single letter is a type where the page letters its types (three or more, nothing stronger);
  // alone, or beside S6B, it is a section cut or a grid line.
  const strong = [...best.keys()].some((k) => !/^[A-Z]{1,2}$/.test(k));
  const single = [...best.keys()].filter((k) => /^[A-Z]$/.test(k));
  // C3 (recall): a boxed letter in a ROW of boxed codes that holds a coded type too is a legend's
  // detail tag, even beside A1 (Aspen's A B C D1 under "PARTITION TYPES"). A row of letters alone
  // is a grid (Macon-Bibb's A B D E: kept, they made its A5-1 callouts "variants" of A, 58 ft wrong).
  const inRow = (c: Cand) => {
    if (!recall || !c.boxed) return false;
    const row = [...best.values()].filter((o) => o !== c && o.boxed && Math.abs(o.line.y - c.line.y) <= c.line.h * 0.6);
    return row.length >= 2 && row.some((o) => !/^[A-Z]{1,2}$/.test(o.key));
  };
  for (const key of single) if ((strong || single.length < 3) && !/TYPE/i.test(best.get(key)!.line.text) && !inRow(best.get(key)!)) best.delete(key);


  // ── 3. EVERY LINE TO ITS NEAREST CODE — TWICE ──
  // First among every candidate, so a keynote or a grid letter takes the words around IT rather
  // than a real type taking them; a candidate whose own words hold fewer than two assembly words
  // is not a type. Then again among the types alone.
  const mentions = new Set(lines.filter((l) => codeOf(l.text, recall) !== null || listed(l.text).length > 0));
  const attribute = (cands: readonly Cand[], taken: ReadonlySet<Line>) => {
    const owned = new Map<string, Line[]>(cands.map((c) => [c.key, []]));
    for (const line of lines) {
      if (mentions.has(line) || taken.has(line)) continue;
      let pick: { key: string; d: number } | null = null;
      for (const c of cands) {
        if (!inWindow(c.line, line)) continue;
        const dx = Math.max(0, c.line.x0 - line.x1, line.x0 - c.line.x1);
        const d = Math.hypot(dx, Math.abs(line.y - c.line.y));
        if (pick === null || d < pick.d) pick = { key: c.key, d };
      }
      // Codes listed on one printing share its detail (only `listed` puts two codes on one line).
      if (pick !== null) { const at = cands.find((c) => c.key === pick!.key)!.line; for (const c of cands) if (c.line === at) owned.get(c.key)!.push(line); }
    }
    return owned;
  };
  // ── A KEY OR A SCHEDULE: THE CODE, THEN ITS WORDS ON THE SAME ROW ──
  // "M8 | 8" CMU WALL CONSTRUCTION." (a key in a plan's margin, K-4) or "MA | | U493 | 1 HR" (a
  // schedule, ELEVEN03): the words start to the right of the code on its baseline and may wrap
  // onto the lines below them. Such a code owns its row outright.
  const RATING = /\b\d(?:\.\d)?\s*-?\s*(?:HR|HOUR)\b|\bU\s?\d{3}\b|\bNR\b|\bNON-?RATED\b/i;
  const printing = new Set([...best.values()].map((c) => c.line));
  const rowOf = (c: Cand): Line[] => {
    const row = lines
      .filter((l) => !printing.has(l) && l.x0 > c.line.x1 - 1 && l.x0 - c.line.x1 < 3 * ppi && Math.abs(l.y - c.line.y) <= Math.max(c.line.h, l.h) * 0.6)
      .sort((a, b) => a.x0 - b.x0);
    if (row.length === 0) return [];
    const out = [...row];
    // Wrapped words: directly under the first cell, line after line, until a gap or another code's row.
    let prev = row[0]!;
    for (;;) {
      const next = lines
        .filter((l) => !printing.has(l) && !out.includes(l) && Math.abs(l.x0 - row[0]!.x0) < 8 && l.y > prev.y && l.y - prev.y <= 1.9 * prev.h)
        .sort((a, b) => a.y - b.y)[0];
      if (next === undefined) break;
      if (lines.some((m) => printing.has(m) && Math.abs(m.y - next.y) <= m.h * 0.6 && m.x1 <= next.x0 + 2 && next.x0 - m.x1 < 3 * ppi)) break;
      out.push(next);
      prev = next;
    }
    return out;
  };
  const all = [...best.values()];
  // A key row describes an assembly (two core words: "8" CMU WALL", "5/8" GWB ON 3-5/8" STUDS");
  // an abbreviation list ("BD | BOARD") has one. A schedule row may carry only a rating
  // ("MA | U493 | 1 HR"), so it counts when three or more such codes stand in one column.
  const coreCount = (ls: readonly Line[]) => ls.reduce((n, l) => n + (l.text.match(new RegExp(CORE_WORD.source, "gi"))?.length ?? 0), 0);
  const rowFor = new Map(all.map((c) => [c.key, rowOf(c)]));
  const rated = all.filter((c) => rowFor.get(c.key)!.some((l) => RATING.test(l.text)));
  const inColumn = (c: Cand) => rated.filter((o) => Math.abs(o.line.x0 - c.line.x0) <= 4).length >= 3;
  const rows = new Map<string, Line[]>();
  for (const c of all) {
    const row = rowFor.get(c.key)!;
    if (row.length === 0) continue;
    const schedule = rated.includes(c) && inColumn(c);
    if (weakLetters.has(c.key) ? schedule : coreCount(row) >= 2 || schedule) rows.set(c.key, row);
  }
  const taken = new Set([...rows.values()].flat());
  const detailCands = all.filter((c) => !rows.has(c.key));
  const first = attribute(detailCands, taken);
  const details = detailCands.filter((c) => !weakLetters.has(c.key) && first.get(c.key)!.filter((l) => CORE_WORD.test(l.text)).length >= 2);
  const codes = [...all.filter((c) => rows.has(c.key)), ...details];
  const owned = attribute(details, taken);
  for (const [key, row] of rows) owned.set(key, row);

  const found = codes
    .map((c) => ({
      code: c.code,
      name: c.name,
      lines: owned
        .get(c.key)!
        .filter((l) => !/^SCALE\s*:/i.test(l.text) && !/^\d{1,3}$/.test(l.text))
        .sort((a, b) => a.y - b.y || a.x0 - b.x0)
        .map((l) => l.text),
      at: c.line,
      evidence: { how: rows.has(c.key) ? "row" : "detail", boxed: c.boxed, labelled: c.labelled } as LegendTextEvidence,
    }))
    .filter((t) => t.lines.length > 0);
  // ── INLINE: THE CODE STARTS A LINE THAT DESCRIBES ITS ASSEMBLY (Wendell's partition legend) ──
  // "S4 3 5/8" MTL STUD & GYP BD TO DECK (STC 43-45)": the code and its words share one line, so no
  // line IS a code and the rules above see nothing. Two core assembly words in the rest of the line
  // say it is a type; a code already read stays as read.
  const have = new Set(found.map((t) => t.code.toUpperCase()));
  for (const line of lines) {
    const m = line.text.match(/^([A-Z][A-Z0-9]{0,4}(?:-\d{1,2})?|\d{1,2}[A-Z]{1,3}\d{0,2}[A-Z]?)\s+(.+)$/);
    if (m === null || !DESIGNATION.test(m[1]!) || have.has(m[1]!.toUpperCase())) continue;
    if ((m[2]!.match(new RegExp(CORE_WORD.source, "gi"))?.length ?? 0) < 2) continue;
    have.add(m[1]!.toUpperCase());
    found.push({ code: m[1]!, name: null, lines: [m[2]!], at: line, evidence: { how: "inline", boxed: false, labelled: false } });
  }
  found.sort((a, b) => a.at.y - b.at.y || a.at.x0 - b.at.x0);
  const typesRead = found.map(({ code, name, lines: ls, at, evidence }) => ({ code, name, lines: ls, at: { x: (at.x0 + at.x1) / 2, y: at.y, h: at.h }, evidence }));
  // A legend lists several types. A page that yields one or two is a plan or a detail sheet whose
  // keynotes happened to sit by assembly words; it is read as having none.
  if (typesRead.length < MIN_TYPES) typesRead.length = 0;

  // ── 4. THE PAGE'S OWN "UNLESS NOTED" DEFAULT, FOR A CODE READ HERE ──
  const types = typesRead;
  const read = new Set(types.map((t) => t.code.toUpperCase().replace(/[\s-]/g, "")));
  // Note numbers ("3. ") interleave a wrapped sentence on a notes column; they are not its periods.
  const page = lines.map((l) => l.text).join(" ").replace(/(^|\s)\d{1,2}\.(?=\s)/g, "$1");
  const uno: { code: string; note: string }[] = [];
  const sentences = [...page.matchAll(new RegExp(UNO.source, "gi")), ...page.matchAll(new RegExp(UNO_FIRST.source, "gi"))];
  for (const m of sentences) {
    const code = m[1]!.replace(/\s+/g, "").toUpperCase();
    const match = types.find((t) => t.code.toUpperCase().replace(/[\s-]/g, "") === code.replace(/-/g, ""));
    if (match && read.has(match.code.toUpperCase().replace(/[\s-]/g, "")) && !uno.some((u) => u.code === match.code)) uno.push({ code: match.code, note: m[0].trim() });
  }

  return {
    types,
    uno,
    reason: `Read from the page's text, with no model: ${types.length} type${types.length === 1 ? "" : "s"}, each with the words printed around its code.`,
    confidence: types.length >= 2 ? "MEDIUM" : "LOW",
  };
}

/**
 * ── A LEGEND CODE READ FROM TEXT IS TRUSTED ONLY WHERE THE PLAN PRINTS IT AS A WALL TAG ──
 *
 * The keyless read takes sheet-zone and detail references for types: on USU it read A1–E6, J1–J4
 * and F1–F4, and those letters-and-numbers, printed on the plan as callouts and grid marks, typed
 * walls wrong (held-out, 66% of what it typed; logged 2026-11-12). A wall tag is printed beside a
 * wall, in the sheet's tag symbol or as bare text; a reference is printed as a callout (a split
 * symbol, or a symbol or word beside a sheet number such as A-501) or at a grid line's end. So a
 * code read from the legend's text types walls on a sheet only where that sheet prints it at least
 * once as a tag: not a reference, and within `reachFeet` of a found wall.
 */
export function wallTagCodes(input: {
  /** The sheet's text, points, `y` the baseline. */
  text: readonly TextForSymbol[];
  /** The sheet's strokes, points. */
  segments: readonly { x1: number; y1: number; x2: number; y2: number }[];
  /** The sheet's walls, page-width units. */
  walls: readonly { x1: number; y1: number; x2: number; y2: number }[];
  widthPt: number;
  feetPerUnit: number;
  codes: readonly string[];
  reachFeet?: number;
}): Set<string> {
  const { text, widthPt: W, feetPerUnit } = input;
  const want = new Set(input.codes.map((c) => c.toUpperCase()));
  const reach = (input.reachFeet ?? 4) / feetPerUnit;
  const symbols = tagSymbols({ segments: input.segments as never, text, unitsPerPaperInch: 72 });
  // A SHEET NUMBER as a callout prints it (A-501, A5.01, A501): never one of the legend's own codes
  // (IW-2 has a sheet number's shape too).
  const sheetNumber = (s: string) => {
    const t = s.replace(/\s+/g, "").toUpperCase();
    return !want.has(t) && /^[A-Z]{1,2}-?\d{1,2}(?:\.\d{1,2}|\d{2})$/.test(t);
  };
  const sheetRefs = text.filter((i) => sheetNumber(i.str)).map((i) => ({ x: i.x + i.width / 2, y: i.y - i.height / 2 }));
  // A grid bubble: a CIRCLE that a grid line ends in. A leader ends at its tag symbol too, so the line
  // must be a grid line's length: two paper inches or more.
  const gridEnd = (s: { x: number; y: number; radius: number; shape: string }) =>
    s.shape === "circle" &&
    input.segments.some((g) => {
      const long = Math.hypot(g.x2 - g.x1, g.y2 - g.y1) >= 2 * 72;
      return long && (Math.hypot(g.x1 - s.x, g.y1 - s.y) <= s.radius * 2 || Math.hypot(g.x2 - s.x, g.y2 - s.y) <= s.radius * 2);
    });
  const nearWall = (x: number, y: number) =>
    input.walls.some((w) => {
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1, l2 = dx * dx + dy * dy;
      const k = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / l2));
      return Math.hypot(x - (w.x1 + k * dx), y - (w.y1 + k * dy)) <= reach;
    });
  const out = new Set<string>();
  for (const item of text) {
    const code = item.str.trim().toUpperCase();
    if (!want.has(code) || out.has(code)) continue;
    const c = { x: item.x + item.width / 2, y: item.y - item.height / 2 };
    const sym = symbols.find((s) => Math.hypot(s.x - c.x, s.y - c.y) <= s.radius + 1);
    // A callout is a symbol carrying a sheet number (a split one, the detail over its sheet); a
    // split symbol alone is a tag too (Green Bay's IW-2 over its divider).
    if (sym !== undefined && (sym.parts.some(sheetNumber) || gridEnd(sym))) continue;
    if (sheetRefs.some((r) => Math.hypot(r.x - c.x, r.y - c.y) <= 0.5 * 72)) continue;
    // A tag with a leader names the wall its leader ends on.
    const at = sym?.leader ?? c;
    if (nearWall(at.x / W, at.y / W)) out.add(code);
  }
  return out;
}
