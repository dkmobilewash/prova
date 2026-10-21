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
 *   - the synthetic sheets print NAME / NUMBER with no area.
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

export function readRoomTags(items: readonly PositionedText[]): RoomTag[] {
  const trimmed = items.map((i) => ({ ...i, str: i.str.trim() })).filter((i) => i.str.length > 0);
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
    const names: string[] = [];
    const stack: PositionedText[] = [anchor];
    let at = anchor;
    for (let guard = 0; guard < 6; guard += 1) {
      const next = above(at);
      if (!next) break;
      if (DIMENSION_TEXT.test(next.str)) {
        at = next;
        continue;
      }
      if (number === null && names.length === 0 && areaSf !== null && NUMBER_TEXT.test(next.str)) {
        number = next.str;
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
    out.push({
      name: names.join(" "),
      number,
      areaSf,
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
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
  return out;
}
