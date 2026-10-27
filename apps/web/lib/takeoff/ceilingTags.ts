import type { PositionedText } from "./roomTags";
import type { HeightFact } from "./wallHeights";

/**
 * ── WHAT A REFLECTED CEILING PLAN PRINTS ABOUT EACH ROOM'S CEILING ──
 *
 * Read from fourteen training RCPs (`coordination/ceiling-tagtext.txt`),
 * a ceiling tag is one of a few shapes, and this reads all of them:
 *
 *   - a STACK: type code over a height — Baker `GB` / `10'-0" A.F.F.`,
 *     Topeka `C2` / `9' - 0" AFF`; the room's name is often the line above;
 *   - ONE ITEM carrying both — Murray `8'-0" ACT`, `10'-6" GWB`;
 *   - a height ALONE — Joplin's hexagon `8'-0"`, MHK `9'-0"` — where the
 *     type is the sheet's default or its hatch, which this does not read;
 *   - a height SPLIT across items — NG `9'` + `0" A.F.F.`, with `CLG.`
 *     printed above it; Bunkie `10' - 0"` + `A.F.F.`;
 *   - a type ALONE — Crosslines `2X4 ACT`, Supreme Court `OPEN TO ABOVE`.
 *
 * Codes mean what the sheet's CEILING LEGEND says they mean (`ACT`, `GB`,
 * `ES`, `C1`…`C5`, `L=LAY-IN ACOUST. TILE`), so the legend is read first and
 * every code is folded to a FAMILY an estimator prices: ACT, GYP, OPEN or
 * OTHER. A code with no legend row is kept with its family guessed from the
 * code's own letters, and said so.
 *
 * Two things that look like ceiling tags and are not: a DETAIL CALLOUT —
 * Joplin's circled `D5` over `A-103` — is a code with a sheet number right
 * under it; and a legend row is a code with its description beside it.
 * Both are refused here rather than downstream.
 *
 * Heights are also handed back as the second session's `HeightFact`s
 * (`ceilingHeightFacts`), the shape `wallHeights.resolveHeight` consumes,
 * so the wall-height chain can take the RCP's figures from here instead of
 * re-reading the sheet.
 */
export type CeilingFamily = "ACT" | "GYP" | "OPEN" | "OTHER";

export type CeilingLegendRow = {
  code: string;
  description: string;
  family: CeilingFamily;
  /** Where the row was read: this sheet, or another page of the set (`set p25`), or a keynote table. */
  from?: string;
  /** The words say the ceiling is EXISTING or TO REMAIN: nothing to bid, whatever the pattern shows. */
  existing?: boolean;
};

export type CeilingTag = {
  /** Page-width units, from the left and from the top. */
  x: number;
  y: number;
  heightFeet: number | null;
  code: string | null;
  family: CeilingFamily | null;
  /** The words say existing / to remain / no ceiling: nothing to bid, and the pattern does not get a say. */
  existing?: boolean;
  /** Whether the family came from the legend, from the code's own letters, from a prefix GUESS, or nowhere. */
  familyFrom: "legend" | "code" | "prefix" | null;
  /** The printed text, for the report and the crop. */
  phrase: string;
  /** The room name printed as the line above the tag — Baker's `STORAGE` over `GB`. */
  roomName: string | null;
};

/** A stroke in page-width units, for telling a tag in a hexagon from a dimension. */
export type UnitStroke = { x1: number; y1: number; x2: number; y2: number };

export type CeilingDefaults = {
  heightFeet: number | null;
  family: CeilingFamily | null;
  /** The note it was read from. */
  phrase: string | null;
};

// Camp Clark prints `8'-0"±` — the ± is a tolerance on a tag, not a dimension.
const HEIGHT = /^(\d{1,2})'\s*-?\s*(?:(\d{1,2})(?:\s+(\d)\/(\d{1,2}))?\s*(?:"|'')?)?\s*±?\s*(?:A\.?F\.?F\.?)?\s*±?$/i;
const FEET_ONLY = /^(\d{1,2})'$/;
const INCHES_AFF = /^-?\s*(\d{1,2})(?:\s+(\d)\/(\d{1,2}))?\s*"\s*(?:A\.?F\.?F\.?)?(?:\s+(?:TYP\.?|U\.?N\.?O\.?))?$/i;
const AFF_ALONE = /^A\.?F\.?F\.?$/i;
const COMBINED = /^(\d{1,2})'\s*-?\s*(\d{1,2})?\s*"?\s+([A-Z][A-Z0-9.\-/ ]{0,12})$/;
const CODE = /^(?:ACT(?:-?\d{1,2})?|ACP|GB|GWB(?:-?\d)?|GYP(?:\.?\s*BD\.?)?|ES|NC|[A-Z]{1,2}-?\d{1,2}|[A-Z])$/;
const PHRASE_TYPE = /^(?:2\s*[xX×]\s*[24]\s*ACT|OPEN\s+TO\s+(?:ABOVE|STRUCTURE|DECK|STRUCT\.?)(?:\s+ABOVE)?|EXPOSED(?:\s+TO)?\s+STRUCTURE|EXPOSED|LAY-?IN(?:\s+CEIL\.?)?|GYP\.?\s*BD\.?(?:\s*CLG\.?)?|GWB|ACT)$/i;
const SHEET_NUMBER = /^[A-Z]{1,2}-?\d{3}[A-Z]?$/;
/** A note that says there is no ceiling to bid: existing, open, none. The WORDS win over any drawn pattern. */
const NOTE_TYPE = /^(?:NO\s+(?:NEW\s+)?CEILING(?:\s+OPEN\s+TO\s+(?:EXIST(?:ING)?|STRUCT(?:URE)?|ABOVE|DECK))?|OPEN\s+TO\s+(?:EXIST(?:ING)?|STRUCT(?:URE)?|ABOVE|DECK)(?:\s+(?:ABOVE|STRUCTURE))?|EXIST(?:ING)?\s+(?:[A-Z. ]+\s+)?(?:CEILING|CLG)\s+TO\s+REMAIN|EXIST(?:ING)?\s+EXPOSED\s+[A-Z. ]+)$/i;
const CLG_LABEL = /^(?:CLG|CEILING)\.?(?:\s*(?:HT|HGT|HEIGHT)\.?)?:?$/i;
const LEGEND_WORDS = /ACOUST|LAY-?IN|TILE|\bACT\b|\bACP\b|GRID|GYP|GWB|PLASTER|BOARD|EXPOSED|OPEN TO|STRUCTURE|SUSPEND|CEILING|SOFFIT|PANEL|DECK|\d{2}"?\s*[xX]\s*\d{2}"?/i;
const LEGEND_TITLE = /CEILING\s+(?:PLAN\s+)?(?:LEGEND|TYPES?|FINISH\s+SCHEDULE|MATERIALS?(?:\s+LEGEND)?|SYMBOLS?)|RCP\s+(?:SYMBOL\s+)?LEGEND|REFLECTED\s+CEILING\s+(?:PLAN\s+)?(?:LEGEND|SYMBOLS)/i;
// "911 CALL CENTER" starts with a digit; a bare number, a height or a code is not a name.
const ROOM_NAME = /^(?=.*[A-Z]{2})[A-Z0-9][A-Z0-9 .,'\-\/&#()]{1,30}$/;

export function familyOf(description: string): CeilingFamily {
  const d = description.toUpperCase();
  if (/EXPOSED|OPEN\s+TO|NO\s+CEILING|\bNC\b|STRUCTURE\b(?!.*(?:GYP|BOARD|TILE))/.test(d)) return "OPEN";
  if (/ACOUST|LAY-?IN|TILE|\bACT\b|\bACP\b|TEGULAR|GRID|\d{2}"?\s*X\s*\d{2}"?\s/.test(d + " ")) return "ACT";
  if (/GYP|GWB|\bG\.?B\.?\b|PLASTER|DRYWALL|BOARD/.test(d)) return "GYP";
  return "OTHER";
}

/** A family from the code's own letters, for a code the legend does not explain. */
export function familyOfCode(code: string): CeilingFamily | null {
  const c = code.toUpperCase().replace(/[^A-Z]/g, "");
  if (/^ACT|^ACP|^L$/.test(c)) return "ACT";
  if (/^GB|^GWB|^GYP|^G$/.test(c)) return "GYP";
  if (/^ES$|^NC$|^OPEN|^EXPOSED/.test(c)) return "OPEN";
  return null;
}

/**
 * A GUESS from a finish code's prefix, for a code no legend in the set
 * explains — KSU's `AC01` / `PA01` had their legend on a sheet the reader
 * never saw. `AC` = acoustical, `GB`/`GY`/`GW` = gypsum, `PA` = paint on
 * what is there (kept as GYP, the family a painted board or plaster ceiling
 * bids as). Every tag that takes this carries `familyFrom: "prefix"`, so a
 * report can say which families are guessed.
 */
export function familyOfPrefix(code: string): CeilingFamily | null {
  const c = code.toUpperCase();
  if (!/^[A-Z]{2}-?\d{1,2}$/.test(c)) return null;
  const prefix = c.slice(0, 2);
  if (prefix === "AC" || prefix === "AT" || prefix === "CT") return "ACT";
  if (prefix === "GB" || prefix === "GY" || prefix === "GW" || prefix === "PA" || prefix === "PL") return "GYP";
  if (prefix === "ES" || prefix === "EX" || prefix === "OS") return "OPEN";
  return null;
}

const feetOf = (m: RegExpExecArray): number =>
  Number(m[1]) + (m[2] === undefined ? 0 : Number(m[2]) + (m[3] === undefined ? 0 : Number(m[3]) / Number(m[4]))) / 12;

type Item = PositionedText & { u: number; v: number; h: number };

function items(input: readonly PositionedText[], widthPt: number): Item[] {
  return input
    .map((i) => ({ ...i, str: i.str.trim(), u: i.x / widthPt, v: i.y / widthPt, h: Math.max(i.height, 1) / widthPt }))
    .filter((i) => i.str !== "");
}

/** The legend's rows: a code with a ceiling description on the same line to its right, or `L=LAY-IN …`. */
export function readCeilingLegend(input: readonly PositionedText[], widthPt: number): CeilingLegendRow[] {
  const all = items(input, widthPt);
  const rows = new Map<string, CeilingLegendRow>();
  // ── ONLY UNDER A TITLE THAT SAYS CEILING ──
  // The first version read any code with a ceiling word beside it and took
  // Murray's keynote table (CF4 "G.C. TO PROVIDE … GYPSUM BOARD") and Supreme
  // Court's finish codes (EL2, PT1) as ceiling types. A legend row sits in a
  // block under a title, so the title is required and the block is bounded.
  const titles = all.filter((i) => LEGEND_TITLE.test(i.str) && i.str.length < 60);
  const inABlock = (i: Item) => titles.some((t) => i.v > t.v && i.v - t.v < 0.32 && i.u > t.u - 0.16 && i.u < t.u + 0.3);
  for (const i of all) {
    const inline = /^([A-Z]{1,3})\s*=\s*(.+?)[,.;]?$/.exec(i.str);
    if (inline && LEGEND_WORDS.test(inline[2])) {
      rows.set(inline[1], { code: inline[1], description: inline[2], family: familyOf(inline[2]) });
      continue;
    }
    // A single letter in a titled block is a light-fixture type as often as a ceiling (Murray's G, J, K);
    // one-letter ceiling codes come only from an inline `G=GYP. BD.` legend.
    if (!CODE.test(i.str) || !inABlock(i) || /^[A-Z]$/.test(i.str)) continue;
    // SW's schedule prints "CEILING:" / "MFG:" / "FINISH:" as short column labels between
    // the code and the words, and its rows sit up to two line-heights off the code.
    const beside = all.find(
      (o) =>
        o !== i && Math.abs(o.v - i.v) < 1.8 * i.h && o.u > i.u && o.u - i.u < 0.3 && o.str.length < 70 && LEGEND_WORDS.test(o.str.slice(0, 45)) && !CODE.test(o.str) && !/^[A-Z. ]{1,12}:$/.test(o.str),
    );
    if (beside === undefined) continue;
    const description = beside.str.replace(/^[:\-–\s]+/, "");
    const builtIn = familyOfCode(i.str);
    if (!rows.has(i.str)) rows.set(i.str, { code: i.str, description, family: builtIn ?? familyOf(description) });
  }
  return [...rows.values()];
}

/** Sheet-wide defaults: "ALL CEILINGS SHALL BE 9'-0" AFF UNLESS OTHERWISE NOTED", "ALL CEILINGS ARE EXPOSED U.N.O.". */
export function readCeilingDefaults(input: readonly PositionedText[], widthPt: number): CeilingDefaults {
  const all = items(input, widthPt).sort((a, b) => a.v - b.v || a.u - b.u);
  const lines: string[] = [];
  let line: Item[] = [];
  for (const i of all) {
    if (line.length > 0 && Math.abs(i.v - line[0].v) > 0.6 * line[0].h) {
      lines.push(line.map((l) => l.str).join(" "));
      line = [];
    }
    line.push(i);
  }
  if (line.length > 0) lines.push(line.map((l) => l.str).join(" "));
  for (const text of lines) {
    const m = /ALL\s+([A-Z.\s]*?)\s*CEILINGS?\s+(?:SHALL\s+BE|ARE|TO\s+BE|@|AT)\s+(.+?)\s*(?:UNLESS\s+(?:OTHERWISE\s+)?NOTED(?:\s+OTHERWISE)?|U\.?\s?N\.?\s?O\.?|$)/i.exec(text);
    if (m === null) continue;
    // "ALL GYP. BD CEILINGS @ 9'-0"" names the family before the word; "ALL CEILINGS ARE EXPOSED" after it.
    const body = `${m[1]} ${m[2]}`;
    const hm = /(\d{1,2})'\s*-?\s*(\d{1,2})?\s*"?/.exec(body);
    const heightFeet = hm === null ? null : Number(hm[1]) + (hm[2] === undefined ? 0 : Number(hm[2])) / 12;
    const words = body.replace(/(\d{1,2})'\s*-?\s*(\d{1,2})?\s*"?\s*(?:A\.?F\.?F\.?)?/i, "").trim();
    const family = words === "" ? null : familyOf(words);
    if (heightFeet === null && family === "OTHER") continue;
    return { heightFeet, family: family === "OTHER" ? null : family, phrase: text.slice(0, 120) };
  }
  return { heightFeet: null, family: null, phrase: null };
}

/** Every ceiling tag on the sheet, with its height and type where printed. */
export function readCeilingTags(
  input: readonly PositionedText[],
  widthPt: number,
  legend: readonly CeilingLegendRow[] = readCeilingLegend(input, widthPt),
  strokes: readonly UnitStroke[] = [],
): CeilingTag[] {
  const all = items(input, widthPt);
  /**
   * A bare height — Joplin's hexagon `8'-0"`, MHK's `9'-0"` — is a ceiling
   * tag when something is DRAWN round it and a dimension when a line runs
   * through it. Four or more short strokes within three line-heights, in
   * two or more directions, and no long stroke through the middle.
   */
  const enclosed = (i: Item): boolean => {
    if (strokes.length === 0) return false;
    const cx = i.u + (i.width / widthPt) / 2;
    const cy = i.v - i.h / 2;
    const r = 3 * i.h;
    let short = 0;
    const sides = new Set<string>();
    for (const s of strokes) {
      const mx = (s.x1 + s.x2) / 2;
      const my = (s.y1 + s.y2) / 2;
      if (Math.abs(mx - cx) > r || Math.abs(my - cy) > r) continue;
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      if (len > 8 * i.h) {
        // A long stroke through or just under the text is a dimension string.
        const t = Math.max(0, Math.min(1, ((cx - s.x1) * (s.x2 - s.x1) + (cy - s.y1) * (s.y2 - s.y1)) / (len * len)));
        if (Math.hypot(cx - (s.x1 + t * (s.x2 - s.x1)), cy - (s.y1 + t * (s.y2 - s.y1))) < 2 * i.h) return false;
        continue;
      }
      if (len < 0.6 * i.h) continue;
      short += 1;
      // A box or a hexagon has strokes on all four sides of the text; a dimension's
      // two ticks and two extension lines do not.
      sides.add(Math.abs(mx - cx) > Math.abs(my - cy) ? (mx > cx ? "R" : "L") : my > cy ? "B" : "T");
    }
    return short >= 4 && sides.size === 4;
  };
  // Three letters at least: "OS" (an occupancy sensor) and "EQ" sit between a room's name and its tag on Baker.
  const isName = (o: Item) => o.str.length >= 3 && ROOM_NAME.test(o.str) && !CODE.test(o.str) && !HEIGHT.test(o.str) && !CLG_LABEL.test(o.str) && !AFF_ALONE.test(o.str);
  const roomNameAbove = (anchor: Item): string | null => {
    const above = all.filter(
      (o) => o !== anchor && Math.abs(centre(o) - centre(anchor)) < 0.02 && o.v < anchor.v && anchor.v - o.v < 2.2 * anchor.h && isName(o),
    );
    if (above.length === 0) return null;
    // The nearest line up, and on that line the best-centred name (IDF's tag sits beside HAM RADIO/COMM.'s).
    const first = above.sort((a, b) => b.v - a.v || Math.abs(centre(a) - centre(anchor)) - Math.abs(centre(b) - centre(anchor)))[0];
    // "HAM RADIO/" over "COMM.": a name wrapped onto two lines.
    const second = all.find((o) => o !== first && Math.abs(centre(o) - centre(first)) < 0.035 && o.v < first.v && first.v - o.v < 1.6 * first.h && isName(o));
    return second ? `${second.str} ${first.str}` : first.str;
  };
  const byCode = new Map(legend.map((r) => [r.code.toUpperCase(), r]));
  const used = new Set<Item>();
  const out: CeilingTag[] = [];
  const near = (a: Item, b: Item, dxMax: number, dyMax: number) => Math.abs(a.u - b.u) < dxMax && Math.abs(a.v - b.v) < dyMax;
  const centre = (o: Item) => o.u + o.width / widthPt / 2;
  /** MHK prints the height in its own box under the room's number: a bare height stacked under a room tag is a ceiling tag. */
  const NUMBER = /^(?=.*\d)[A-Z0-9.-]{1,8}$/;
  const underRoomTag = (i: Item): boolean =>
    all.some((o) => o !== i && Math.abs(centre(o) - centre(i)) < 0.02 && o.v < i.v && i.v - o.v < 5 * i.h && NUMBER.test(o.str) && !HEIGHT.test(o.str) && !CODE.test(o.str));
  const isLegendRow = (i: Item) =>
    all.some((o) => o !== i && Math.abs(o.v - i.v) < 1.2 * i.h && o.u > i.u && o.u - i.u < 0.12 && LEGEND_WORDS.test(o.str) && !CODE.test(o.str));
  const isDetailCallout = (i: Item) =>
    all.some((o) => o !== i && SHEET_NUMBER.test(o.str) && Math.abs(o.u - i.u) < 0.02 && o.v > i.v && o.v - i.v < 2.2 * i.h);
  const typeOf = (text: string): { code: string; family: CeilingFamily | null; familyFrom: CeilingTag["familyFrom"]; existing?: boolean } | null => {
    const row = byCode.get(text.toUpperCase());
    if (row !== undefined) return { code: row.code, family: familyOfCode(row.code) ?? row.family, familyFrom: "legend", existing: row.existing };
    if (PHRASE_TYPE.test(text)) return { code: text.toUpperCase(), family: familyOf(text), familyFrom: "code" };
    if (CODE.test(text)) {
      const guessed = familyOfCode(text);
      if (guessed !== null) return { code: text, family: guessed, familyFrom: "code" };
      const prefixed = familyOfPrefix(text);
      if (prefixed !== null) return { code: text, family: prefixed, familyFrom: "prefix" };
      return null;
    }
    return null;
  };
  /** A type item within the tag's box: the line above or below, nearly the same x. */
  const typeBeside = (anchor: Item) => {
    let best: Item | null = null;
    for (const o of all) {
      // The tag's own stack: centred over or under the height, not a neighbour's code 30 ft away.
      if (o === anchor || used.has(o) || Math.abs(centre(o) - centre(anchor)) > 0.015 || Math.abs(o.v - anchor.v) > 2.4 * anchor.h) continue;
      if (CLG_LABEL.test(o.str) || HEIGHT.test(o.str) || AFF_ALONE.test(o.str)) continue;
      if (typeOf(o.str) === null || isLegendRow(o) || isDetailCallout(o)) continue;
      // KEYNOTE codes beside a height are the room's keynote, which is a type only through the table.
      if (KEYNOTE_CODE.test(o.str) && !byCode.has(o.str.toUpperCase())) continue;
      if (best === null || Math.abs(o.v - anchor.v) < Math.abs(best.v - anchor.v)) best = o;
    }
    return best;
  };

  // 1. One item with both: `8'-0" ACT`.
  for (const i of all) {
    const m = COMBINED.exec(i.str);
    if (m === null) continue;
    const type = typeOf(m[3].trim());
    if (type === null) continue;
    used.add(i);
    out.push({ x: i.u, y: i.v, heightFeet: Number(m[1]) + (m[2] === undefined ? 0 : Number(m[2])) / 12, ...type, phrase: i.str, roomName: roomNameAbove(i) });
  }
  // 2. A height item, whole or split, with the type above or below it.
  for (const i of all) {
    if (used.has(i)) continue;
    let heightFeet: number | null = null;
    let phrase = i.str;
    const whole = HEIGHT.exec(i.str);
    if (whole !== null && !FEET_ONLY.test(i.str)) heightFeet = feetOf(whole);
    else if (FEET_ONLY.test(i.str)) {
      const inch = all.find((o) => o !== i && !used.has(o) && INCHES_AFF.test(o.str) && Math.abs(o.v - i.v) < 0.8 * i.h && o.u > i.u && o.u - i.u < 0.03);
      if (inch === null || inch === undefined) continue;
      const im = INCHES_AFF.exec(inch.str)!;
      heightFeet = Number(whole![1]) + (Number(im[1]) + (im[2] === undefined ? 0 : Number(im[2]) / Number(im[3]))) / 12;
      phrase = `${i.str} ${inch.str}`;
      used.add(inch);
    } else continue;
    if (heightFeet === null || heightFeet < 5 || heightFeet > 40) continue;
    // A bare figure is a dimension unless something says ceiling: AFF on it, a CLG. label, or a type beside it.
    const saysAff = /A\.?F\.?F/i.test(phrase) || all.some((o) => AFF_ALONE.test(o.str) && near(i, o, 0.03, 1.2 * i.h) && o.u > i.u);
    const clgLabel = all.find((o) => CLG_LABEL.test(o.str) && near(i, o, 0.03, 2.5 * i.h));
    const type = typeBeside(i);
    if (!saysAff && clgLabel === undefined && type === null && !enclosed(i) && !underRoomTag(i)) continue;
    used.add(i);
    if (type !== null) used.add(type);
    const t = type === null ? null : typeOf(type.str);
    out.push({
      x: i.u,
      y: i.v,
      heightFeet,
      code: t?.code ?? null,
      family: t?.family ?? null,
      familyFrom: t?.familyFrom ?? null,
      existing: t?.existing,
      phrase: type === null ? phrase : `${type.str} ${phrase}`,
      roomName: roomNameAbove(type ?? i),
    });
  }
  /** The lines stacked under `first` that read as one note, joined. */
  const wrappedPhrase = (first: Item): { text: string; items: Item[] } => {
    const items: Item[] = [first];
    let last = first;
    for (let step = 0; step < 3; step += 1) {
      const next = all.find(
        (o) => !items.includes(o) && !used.has(o) && Math.abs(centre(o) - centre(last)) < 0.03 && o.v > last.v && o.v - last.v < 1.8 * last.h && o.h <= 1.3 * first.h && /^[A-Z][A-Z ,.'\-/()]{1,30}$/.test(o.str) && !HEIGHT.test(o.str) && !CODE.test(o.str),
      );
      if (next === undefined) break;
      items.push(next);
      last = next;
    }
    // Take the longest prefix of the stack that is a type or a note; a room name under a note is not part of it.
    for (let n = items.length; n >= 1; n -= 1) {
      const text = items.slice(0, n).map((o) => o.str).join(" ").replace(/,\s+/g, " ");
      if (PHRASE_TYPE.test(text) || NOTE_TYPE.test(text) || n === 1) return { text, items: items.slice(0, n) };
    }
    return { text: first.str, items: [first] };
  };
  // 3. A type with no height: `2X4 ACT`, `OPEN TO ABOVE`, a lone `GB` — and notes
  //    wrapped over two or three lines.
  for (const i of all) {
    if (used.has(i) || HEIGHT.test(i.str) || CLG_LABEL.test(i.str)) continue;
    // A note wrapped over lines — MHK's `OPEN TO` / `STRUCTURE` / `ABOVE`, KSU's
    // `NO CEILING,` / `OPEN TO EXIST`, Supreme Court's `OPEN TO` / `ABOVE` — is one
    // phrase: the lines are centred on each other, a line-height apart.
    const wrapped = wrappedPhrase(i);
    const text = wrapped.text;
    const t = typeOf(text) ?? (NOTE_TYPE.test(text) ? { code: text.toUpperCase(), family: "OPEN" as const, familyFrom: "code" as const, existing: true } : null);
    if (t !== null) for (const o of wrapped.items) used.add(o);
    if (t === null || t.family === null || isLegendRow(i) || isDetailCallout(i)) continue;
    // A one- or two-letter code on its own is more often a grid line or a detail mark than a ceiling.
    if (/^[A-Z]{1,2}-?\d{0,2}$/.test(i.str) && t.familyFrom === "code" && !byCode.has(i.str.toUpperCase()) && !/^(?:GB|ES|NC|ACT)$/.test(i.str)) continue;
    // A prefix guess needs a height stacked with it; a lone AC01 in a keynote list is not a ceiling tag.
    if (t.familyFrom === "prefix") continue;
    used.add(i);
    out.push({ x: i.u, y: i.v, heightFeet: null, code: t.code, family: t.family, familyFrom: t.familyFrom, existing: t.existing, phrase: text, roomName: roomNameAbove(i) });
  }
  return out;
}

/** The tags' heights in the wall-height chain's own shape. */
export function ceilingHeightFacts(sheet: string, tags: readonly CeilingTag[]): HeightFact[] {
  return tags
    .filter((t) => t.heightFeet !== null)
    .map((t) => ({ kind: "ceiling-height" as const, feet: t.heightFeet, sheet, phrase: t.phrase }));
}

export type RoomCeiling = {
  roomIndex: number;
  tags: CeilingTag[];
  /** A room name printed over a tag inside the room, when the room's own tag has none. */
  roomName: string | null;
  family: CeilingFamily | null;
  code: string | null;
  heightFeet: number | null;
  /** Where the answer came from: a tag in the room, the sheet's note, or nothing. */
  source: "tag" | "note" | "none";
  /** More than one tag disagrees on height or family. */
  disagreeing: boolean;
};

function inside(xs: readonly number[], ys: readonly number[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i, i += 1) {
    const cross = ys[i] > y !== ys[j] > y && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i];
    if (cross) hit = !hit;
  }
  return hit;
}

/** Each room's ceiling from the tags inside it, falling back to the sheet's defaults. */
export function assignCeilings(
  rooms: readonly { xs: number[]; ys: number[] }[],
  tags: readonly CeilingTag[],
  defaults: CeilingDefaults,
): RoomCeiling[] {
  return rooms.map((room, roomIndex) => {
    const own = tags.filter((t) => inside(room.xs, room.ys, t.x, t.y));
    const heights = [...new Set(own.map((t) => t.heightFeet).filter((h): h is number => h !== null))];
    const families = [...new Set(own.map((t) => t.family).filter((f): f is CeilingFamily => f !== null))];
    const codes = [...new Set(own.map((t) => t.code).filter((c): c is string => c !== null))];
    const heightFeet = heights[0] ?? defaults.heightFeet;
    const family = families[0] ?? defaults.family;
    const source: RoomCeiling["source"] = own.length > 0 ? "tag" : heightFeet !== null || family !== null ? "note" : "none";
    return {
      roomIndex,
      tags: own,
      roomName: own.map((t) => t.roomName).find((n): n is string => n !== null) ?? null,
      family,
      code: codes[0] ?? null,
      heightFeet,
      source,
      disagreeing: heights.length > 1 || families.length > 1,
    };
  });
}

/** Square feet per family, over rooms whose ceiling is known. */
export function areaByFamily(
  rooms: readonly { squareFeet: number }[],
  ceilings: readonly RoomCeiling[],
): Record<CeilingFamily | "UNKNOWN", number> {
  const out: Record<CeilingFamily | "UNKNOWN", number> = { ACT: 0, GYP: 0, OPEN: 0, OTHER: 0, UNKNOWN: 0 };
  for (const c of ceilings) out[c.family ?? "UNKNOWN"] += rooms[c.roomIndex]?.squareFeet ?? 0;
  return out;
}

/**
 * ── THE ROOM IS THE TAG, NOT THE POLYGON ──
 *
 * A reflected ceiling plan draws its walls thin and its ceiling grid heavy,
 * so the room finder closes few rooms on one (Baker A111: 5 of 13; the grid
 * pairs into hundreds of "walls" if the rules are loosened). What the RCP
 * DOES repeat is each room's name and number — and the ceiling tag sits
 * under or beside it. So each ceiling tag is paired with a printed room
 * tag: the one named over it (Baker), the one directly above it, else the
 * nearest within `maxFeet`. Areas still need a polygon, from the floor plan
 * or from this sheet where it closes; the type and height do not.
 */
export type RoomTagPoint = { name: string; number: string | null; x: number; y: number };

export type RoomCeilingByTag = {
  room: RoomTagPoint;
  tags: CeilingTag[];
  /** A tag's words said existing / to remain / no ceiling: the family stands and no pattern overrides it. */
  existing: boolean;
  family: CeilingFamily | null;
  code: string | null;
  heightFeet: number | null;
  source: "tag" | "note" | "none";
  disagreeing: boolean;
};

export function pairTagsToRoomTags(
  roomTags: readonly RoomTagPoint[],
  tags: readonly CeilingTag[],
  widthPt: number,
  feetPerUnit: number,
  defaults: CeilingDefaults,
  maxFeet = 25,
  /** Closed rooms, where the sheet has them: a tag inside the same polygon as exactly one room tag is that room's. */
  polygons: readonly { xs: number[]; ys: number[] }[] = [],
): RoomCeilingByTag[] {
  const rooms = roomTags.map((r) => ({ r, u: r.x / widthPt, v: r.y / widthPt, own: [] as CeilingTag[] }));
  const normName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9#]+/g, " ").trim();
  const maxUnits = maxFeet / feetPerUnit;
  const polygonOf = (x: number, y: number) => polygons.findIndex((p) => inside(p.xs, p.ys, x, y));
  const roomPolygon = rooms.map((x) => polygonOf(x.u, x.v));
  for (const t of tags) {
    let best: (typeof rooms)[number] | null = null;
    if (t.roomName !== null) {
      best = rooms.find((x) => normName(x.r.name) === normName(t.roomName!)) ?? null;
    }
    if (best === null && polygons.length > 0) {
      const at = polygonOf(t.x, t.y);
      const within = at < 0 ? [] : rooms.filter((_, i) => roomPolygon[i] === at);
      if (within.length === 1) best = within[0];
    }
    if (best === null) {
      // The room's stack directly above the tag, Baker-style; else the nearest.
      let bestD = Number.POSITIVE_INFINITY;
      for (const x of rooms) {
        const dx = Math.abs(x.u - t.x);
        const dy = t.y - x.v;
        const stacked = dx < 0.03 && dy > 0 && dy < 0.03;
        const d = stacked ? 0 : Math.hypot(dx, dy);
        if (d < bestD && (stacked || d <= maxUnits)) {
          best = x;
          bestD = d;
        }
      }
    }
    if (best !== null) best.own.push(t);
  }
  return rooms.map(({ r, own }) => {
    const heights = [...new Set(own.map((t) => t.heightFeet).filter((h): h is number => h !== null))];
    // A material that stays (E Street's `EXISTING GYPSUM BOARD CEILING TO REMAIN`) outranks a
    // demolition note in the same room; otherwise the tags' own order.
    const ranked = [...own].sort((a, b) => Number(b.existing === true && b.family !== null && b.family !== "OPEN") - Number(a.existing === true && a.family !== null && a.family !== "OPEN"));
    const families = [...new Set(ranked.map((t) => t.family).filter((f): f is CeilingFamily => f !== null))];
    const codes = [...new Set(ranked.map((t) => t.code).filter((c): c is string => c !== null))];
    // Two bare heights in one room — Joplin's ceiling hexagon and its soffit hexagon —
    // the ceiling is the higher one; the room is flagged as disagreeing either way.
    const heightFeet = (heights.length > 1 ? Math.max(...heights) : heights[0]) ?? defaults.heightFeet;
    const family = families[0] ?? defaults.family;
    const source: RoomCeilingByTag["source"] = own.length > 0 ? "tag" : heightFeet !== null || family !== null ? "note" : "none";
    return { room: r, tags: own, existing: own.some((t) => t.existing === true), family, code: codes[0] ?? null, heightFeet, source, disagreeing: heights.length > 1 || families.length > 1 };
  });
}

/**
 * SW prints the room's ceiling code in a box under its number, and the room-tag
 * reader takes that box for the number. Where a room tag's "number" is a
 * ceiling code or type phrase, the number is the NUMBER_TEXT item just above it.
 */
export function roomTagsUnderCeilingCodes(
  roomTags: readonly RoomTagPoint[],
  input: readonly PositionedText[],
  widthPt: number,
  legend: readonly CeilingLegendRow[],
): RoomTagPoint[] {
  const all = items(input, widthPt);
  const codes = new Set(legend.map((r) => r.code.toUpperCase()));
  const NUMBER = /^(?=.*\d)[A-Z0-9.-]{1,8}$/;
  return roomTags.map((r) => {
    const n = r.number?.toUpperCase() ?? "";
    if (n === "" || !(codes.has(n) || PHRASE_TYPE.test(n) || familyOfCode(n) !== null)) return r;
    const u = r.x / widthPt;
    const v = r.y / widthPt;
    const above = all
      .filter((o) => NUMBER.test(o.str) && !HEIGHT.test(o.str) && !codes.has(o.str.toUpperCase()) && familyOfCode(o.str) === null && Math.abs(o.u + o.width / widthPt / 2 - u) < 0.03 && o.v < v + 0.004 && v - o.v < 0.02)
      .sort((a, b) => b.v - a.v)[0];
    return above ? { ...r, number: above.str } : { ...r, number: null };
  });
}

const SET_LEGEND_TITLE = /CEILING\s+(?:TYPES?|LEGEND|FINISH(?:ES)?|MATERIALS?|SCHEDULE)|FINISH\s+(?:LEGEND|TYPES)|CEILING\s+ASSEMBL/i;
const KEYNOTE_TITLE = /^KEY\s*NOTES?(?:\s*[-–]\s*RCP)?$|^RCP\s+KEY\s*NOTES?$|^REFLECTED\s+CEILING\s+PLAN\s+KEY\s*NOTES?$/i;
const KEYNOTE_CODE = /^(?:[A-Z]\d{1,2}\.\d{2}|\d{1,2}\.\d{2}|\d{1,2})$/;
const EXISTING = /\bEXIST(?:ING|\.)?\b|TO\s+REMAIN|\(E\)/i;

/**
 * ── A LEGEND ON ANOTHER SHEET OF THE SET ──
 *
 * KSU's `AC01` had its legend on a finish sheet; Baker's A601 draws the
 * ceiling TYPES as assembly details, `ACT` and `GYP-3` with the words in a
 * callout rather than a row. So, for a page whose text carries a ceiling
 * legend title: the rows the sheet legend reader finds, plus any code with
 * ceiling words within a window round it. Every row says which page it came
 * from, and a row from the RCP's own sheet wins over one from elsewhere.
 */
export function readSetLegendPage(input: readonly PositionedText[], widthPt: number, page: number): CeilingLegendRow[] {
  const all = items(input, widthPt);
  if (!all.some((i) => SET_LEGEND_TITLE.test(i.str) && i.str.length < 60)) return [];
  const rows = new Map<string, CeilingLegendRow>();
  for (const r of readCeilingLegend(input, widthPt)) rows.set(r.code.toUpperCase(), { ...r, from: `set p${page}` });
  // Detail-callout style: a code set large — half again the page's usual line — with the words near it.
  const heights = all.map((i) => i.h).sort((a, b) => a - b);
  const usual = heights[Math.floor(heights.length / 2)] ?? 0;
  for (const i of all) {
    if (!/^(?:ACT|ACP|GB|GWB|GYP)(?:-?\d{1,2})?$|^[A-Z]{1,3}-?\d{1,2}$/.test(i.str) || rows.has(i.str.toUpperCase())) continue;
    if (i.h < 1.5 * usual) continue;
    const near = all.filter((o) => o !== i && Math.abs(o.u - i.u) < 0.18 && o.v > i.v - 0.02 && o.v - i.v < 0.12 && LEGEND_WORDS.test(o.str) && !CODE.test(o.str));
    if (near.length === 0) continue;
    const words = near.map((o) => o.str).join("; ");
    const family = familyOfCode(i.str) ?? familyOf(words);
    rows.set(i.str.toUpperCase(), { code: i.str, description: words.slice(0, 80), family, from: `set p${page}` });
  }
  return [...rows.values()];
}

/**
 * ── KEYNOTES THAT NAME A CEILING ──
 *
 * E Street tags its rooms with keynote hexagons — `C11.01`, `C11.03` — and
 * the KEYNOTES table says `EXISTING SUSPENDED 2X4 CEILING GRID SYSTEM TO
 * REMAIN`, `EXISTING GYPSUM BOARD CEILING TO REMAIN`. Keynote codes have
 * their own shape, so reading this table cannot pollute the legend the way
 * Murray's did; only rows whose words are about a ceiling are kept, and a
 * row that says existing or to remain is flagged — the words win over any
 * pattern drawn in the room.
 */
export function readKeynoteCeilings(input: readonly PositionedText[], widthPt: number): CeilingLegendRow[] {
  const all = items(input, widthPt);
  const titles = all.filter((i) => KEYNOTE_TITLE.test(i.str));
  if (titles.length === 0) return [];
  const out: CeilingLegendRow[] = [];
  for (const i of all) {
    if (!KEYNOTE_CODE.test(i.str)) continue;
    if (!titles.some((t) => i.v > t.v && i.v - t.v < 0.45 && i.u > t.u - 0.2 && i.u < t.u + 0.25)) continue;
    const row = all
      .filter((o) => o !== i && Math.abs(o.v - i.v) < 1.2 * i.h && o.u > i.u && o.u - i.u < 0.3)
      .sort((a, b) => a.u - b.u)
      .map((o) => o.str)
      .join(" ");
    if (!/CEILING|CLG|ACOUST|GYP|GWB|LAY-?IN|OPEN\s+TO/i.test(row)) continue;
    if (/LIGHT|FIXTURE|GRILLE|DIFFUSER|SPEAKER|CAMERA|SENSOR|DETECTOR|SPRINKLER|SIGN\b/i.test(row) && !/CEILING\s+(?:GRID|SYSTEM|TO\s+REMAIN)|GYP|ACOUST|LAY-?IN/i.test(row)) continue;
    // A note about PART of a ceiling, or about a hazard or a stain on it, names no family.
    if (/REMOVE\s+PORTION|PORTION\s+OF|ALONG\s+EXISTING|AS\s+REQUIRED\s+FOR|HAZARDOUS|STAIN|MODIFY/i.test(row)) continue;
    const family = /REMOVE|DEMOLISH/i.test(row) && !/TO\s+REMAIN/i.test(row) ? "OPEN" : familyOf(row);
    out.push({ code: i.str, description: row.slice(0, 90), family, from: "keynote", existing: EXISTING.test(row) || /REMOVE|DEMOLISH/i.test(row) });
  }
  return out;
}
