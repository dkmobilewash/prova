/**
 * ── ROOM TAGS, READ BY POSITION ──
 *
 * A room tag is a short STACK of text: the name, the number under it, and on
 * some sets the area under that (`EVIDENCE ROOM / E102 / 93 SF`). `fixtures/
 * expected.ts`'s `roomsFromWords` reads the same thing from words in reading
 * order and has no idea where on the sheet a tag sits — fine for counting,
 * useless for saying WHICH detected region a tag belongs to. This reads the
 * stack from positions, so every tag comes back with a point.
 *
 * Measured on the training sets' own tags (2026-10-21) and shaped by them:
 *   - Bunkie prints partition codes (`P08`) ABOVE the name, which look exactly
 *     like a room number, so the number is the NEAREST number-shaped item
 *     above the area, not the first one found;
 *   - a dimension can sit between the number and the name (`STAFF TLT. /
 *     8'-3" / E101`), so dimensions are stepped over rather than ending the
 *     stack;
 *   - Baker's code plan prints NAME / SF with no number at all;
 *   - the synthetic sheets print NAME / NUMBER with no area;
 *   - SW's construction plan prints the NUMBER ABOVE the name (`104` over
 *     `RESTROOM`), so a bare number with no name above it is read downward.
 *
 * ponytail: a stack walker with three regexes. If a set prints tags in a box
 * beside the name rather than under it, add a horizontal walk then, not now.
 */

export type PositionedText = {
  str: string;
  /** Points from the left of the page. */
  x: number;
  /** Points from the TOP of the page — `PlanTextItem`'s convention. */
  y: number;
  width: number;
  height: number;
};

export type RoomTag = {
  /** Top-down, as printed, joined with one space: `STAFF TLT.`, `(E) OFFICE`. */
  name: string;
  number: string | null;
  /** Square feet when the tag prints one, else null. Metric is converted. */
  areaSf: number | null;
  /** The centre of the stack, in the same points as the input. */
  x: number;
  y: number;
  /**
   * Where the printed number sits, same points. A name can run over a wall
   * (glen-hazel's "Elevators" spans two shafts, Joplin's DECOMPRESSION sits
   * over its neighbour) while the number stays in its own room, so this places
   * the tag and the centre is the fallback.
   */
  numberAt?: { x: number; y: number } | null;
};

/** `93 SF`, `1,337 SF`, `3,780 SQFT`, `178 sq ft`, `32.6 m2`. */
export const AREA_TEXT = /^\s*(\d[\d,]*(?:\.\d+)?)\s*(SF|S\.F\.|SQ\.?\s*FT\.?|SQFT|m2|m²|SM)\s*$/i;
/** `101`, `E102`, `K107`, `1A03`, `1E15-A`, `01.1.1`: short, no spaces, at
 *  least one digit. `P08` matches too — see the header for why that is
 *  survivable. */
export const NUMBER_TEXT = /^(?=.*\d)[A-Z0-9.-]{1,8}$/;
/** `8' - 3"`, `24'-6 1/2"`, `12'-0"`. */
const DIMENSION_TEXT = /^\d+'\s*-?\s*\d*(?:\s+\d+\/\d+)?"?$/;
/** At least two letters, any case or alphabet (the BIM sheets print `WC
 *  Damen` and `ELUTUBA+KÖÖK`), with the punctuation tags carry — or a bare
 *  `#1`, which is how Bunkie names its interview rooms. */
const NAME_TEXT = /^(?=(?:.*\p{L}){2})[\p{L}0-9 #./&+()'-]+$|^#\d+$/u;

/** A detail callout printed on the sheet, `A1/ A-621`. Joplin prints these over its room names. */
const DRAWING_REFERENCE = /^[A-Z]{1,2}\d{0,2}\s*\/\s*[A-Z]{1,2}-?\d/;
/** A drafter's aside: it is printed near a tag and is never part of a room's name. */
const DRAFTING_WORD = /^(?:ALIGN|TYP\.?|TYPICAL|SIM\.?|SIMILAR|NEW|DESCRIPTION|EQ\.?|V\.?I\.?F\.?)$/i;
/** A sheet number, `A-411`: it reads as a room number and names no room. */
const SHEET_NUMBER = /^[A-Z]{1,2}-\d{3}$/;

const SQFT_PER_M2 = 10.7639;

/** How far above, in line heights, the next item of a stack may sit. */
const STACK_GAP = 1.6;

function areaSqft(str: string): number | null {
  const m = AREA_TEXT.exec(str);
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return /^(m2|m²|SM)$/i.test(m[2]) ? Math.round(value * SQFT_PER_M2 * 10) / 10 : value;
}

/**
 * ── TEXT THAT STACKS LIKE A TAG AND IS NOT ONE ──
 *
 * Baker's A101 listed "SHEET NUMBER A101" and "TEMPORARY MARKED EXIT ROUTES.
 * REFERENCE WALL ASSEMBLIES AND TAG LEGEND ARE TO BE PROVIDED…" under "Not
 * enclosed": a title-block label above its value, and a general note whose
 * lines stack over a keynote number, both read as NAME / NUMBER. A room tag
 * is a few words and no sentence; these are the title block's vocabulary, or
 * a sentence, or more words than any room is called.
 */
const TITLE_BLOCK_WORDS = /^(?:SHEET\s+(?:NUMBER|NO\.?|NAME|TITLE)|DRAWN\s+BY|CHECKED\s+BY|PROJECT\s+(?:NUMBER|NO\.?|NAME)|JOB\s+(?:NUMBER|NO\.?)|DATE|SCALE|REVISIONS?|ISSUE[DS]?|PHASE|KEY\s*PLAN|CONSULTANT|STAMP)\b/i;
export function looksLikeNoteText(name: string): boolean {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 6) return true;
  // A sentence: punctuation with more words after it. A trailing period is
  // an abbreviation ("STAFF TLT.") and stays.
  if (/[.;:]\s+\S/.test(name)) return true;
  if (TITLE_BLOCK_WORDS.test(name.trim())) return true;
  return false;
}

export function readRoomTags(items: readonly PositionedText[]): RoomTag[] {
  return readRoomTagsRaw(items).filter((tag) => !looksLikeNoteText(tag.name) && !(tag.number !== null && SHEET_NUMBER.test(tag.number)));
}

function readRoomTagsRaw(items: readonly PositionedText[]): RoomTag[] {
  // Asides are dropped up front, so a stack closes over them and `A3 / SIM` is never a tag.
  const trimmed = items.map((i) => ({ ...i, str: i.str.trim() })).filter((i) => i.str.length > 0 && !DRAWING_REFERENCE.test(i.str) && !DRAFTING_WORD.test(i.str));
  const centre = (i: PositionedText) => i.x + i.width / 2;
  const used = new Set<PositionedText>();

  /** The item sitting directly above `from`, or null. */
  const above = (from: PositionedText): PositionedText | null => {
    let best: PositionedText | null = null;
    for (const i of trimmed) {
      if (i === from || used.has(i)) continue;
      const gap = from.y - (i.y + i.height);
      if (gap < -0.5 * i.height || gap > STACK_GAP * Math.max(i.height, from.height)) continue;
      if (Math.abs(centre(i) - centre(from)) > Math.max(i.width, from.width) / 2 + 0.5 * from.height) continue;
      if (!best || i.y > best.y) best = i;
    }
    return best;
  };

  const out: RoomTag[] = [];
  const readStack = (anchor: PositionedText, areaSf: number | null) => {
    let number: string | null = null;
    let numberItem: PositionedText | null = null;
    const names: string[] = [];
    const stack: PositionedText[] = [anchor];
    let at = anchor;
    for (let guard = 0; guard < 6; guard += 1) {
      const next = above(at);
      if (!next) break;
      if (DIMENSION_TEXT.test(next.str) || next.str.startsWith("_")) {
        at = next;
        continue;
      }
      if (number === null && names.length === 0 && areaSf !== null && NUMBER_TEXT.test(next.str)) {
        number = next.str;
        numberItem = next;
        stack.push(next);
        at = next;
        continue;
      }
      if (NAME_TEXT.test(next.str) && !NUMBER_TEXT.test(next.str) && !AREA_TEXT.test(next.str)) {
        names.unshift(next.str);
        stack.push(next);
        at = next;
        continue;
      }
      break;
    }
    if (names.length === 0) return;
    for (const i of stack) used.add(i);
    const xs = stack.flatMap((i) => [i.x, i.x + i.width]);
    const ys = stack.flatMap((i) => [i.y, i.y + i.height]);
    const numbered = numberItem ?? (areaSf === null ? anchor : null);
    out.push({
      name: names.join(" "),
      number,
      areaSf,
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
      numberAt: numbered && { x: centre(numbered), y: numbered.y + numbered.height / 2 },
    });
  };

  /** An area with another area directly under it is a column of a tally
   *  table (Baker's code plan sums its rooms beside the drawing), never a tag. */
  const inAColumn = (a: PositionedText) =>
    trimmed.some(
      (i) =>
        i !== a &&
        areaSqft(i.str) !== null &&
        i.y > a.y &&
        i.y - (a.y + a.height) <= STACK_GAP * a.height &&
        Math.abs(centre(i) - centre(a)) <= Math.max(i.width, a.width) / 2,
    );

  // Areas first: the richest stacks, and the ones whose number must be the
  // nearest rather than the first.
  for (const i of trimmed) {
    const sf = areaSqft(i.str);
    if (sf !== null && !inAColumn(i)) readStack(i, sf);
  }
  // Then bare NAME / NUMBER tags.
  for (const i of trimmed) {
    if (used.has(i) || !NUMBER_TEXT.test(i.str)) continue;
    const before = out.length;
    readStack(i, null);
    if (out.length > before) out[out.length - 1].number = i.str;
  }
  // And NUMBER / NAME, the other way up: a number nobody used with a name
  // directly BELOW it.
  const below = (from: PositionedText): PositionedText | null => {
    let best: PositionedText | null = null;
    for (const i of trimmed) {
      if (i === from || used.has(i)) continue;
      const gap = i.y - (from.y + from.height);
      if (gap < -0.5 * i.height || gap > STACK_GAP * Math.max(i.height, from.height)) continue;
      if (Math.abs(centre(i) - centre(from)) > Math.max(i.width, from.width) / 2 + 0.5 * from.height) continue;
      if (!best || i.y < best.y) best = i;
    }
    return best;
  };
  for (const i of trimmed) {
    if (used.has(i) || !NUMBER_TEXT.test(i.str)) continue;
    const names: PositionedText[] = [];
    let at = i;
    for (let guard = 0; guard < 3; guard += 1) {
      const next = below(at);
      if (!next || !NAME_TEXT.test(next.str) || NUMBER_TEXT.test(next.str) || AREA_TEXT.test(next.str)) break;
      names.push(next);
      at = next;
    }
    if (names.length === 0) continue;
    used.add(i);
    for (const n of names) used.add(n);
    const stack = [i, ...names];
    const xs = stack.flatMap((t) => [t.x, t.x + t.width]);
    const ys = stack.flatMap((t) => [t.y, t.y + t.height]);
    out.push({
      name: names.map((n) => n.str).join(" "),
      number: i.str,
      areaSf: null,
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
      numberAt: { x: centre(i), y: i.y + i.height / 2 },
    });
  }
  return out;
}
