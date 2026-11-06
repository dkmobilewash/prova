/**
 * ── A WALL TAKES ITS FLOOR PLAN'S LEVEL, AND THE LEVEL'S FLOOR-TO-FLOOR ──
 *
 * Diego, 2026-11-05: by LEVEL is automatic. A multi-storey set marks each
 * level on its sections and elevations — Crosslines A300 prints "1st Floor
 * 754'-0"", "2nd Floor 763'-8"" … "9th Floor 823'-9"", "Roof Plan (P2)
 * 832'-4"" — and each floor plan says which level it shows in its caption,
 * two to a sheet where the sheet holds two ("1st Floor Plan (P2)", "2nd - 9th
 * Floor Plan (P2)" on A100). So a wall's level is its plan's, and a wall that
 * runs to the structure above stops at the next level up: 9'-8" on the 1st
 * floor, 8'-7" on 2–9. By ZONE within one level (Joplin's 12'-0" / 12'-4" /
 * 16'-8") stays a choice in the review queue — nothing on a plan says which
 * wall is under which roof.
 */
export type LevelMark = {
  /** The storey, or null for a level above the numbered ones (the roof, a penthouse). */
  level: number | null;
  name: string;
  /** Its elevation, as printed: absolute (754'-0") or above the first floor. */
  feet: number;
  sheet: string;
  phrase: string;
};

const WORDS: Record<string, number> = { FIRST: 1, GROUND: 1, MAIN: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6, SEVENTH: 7, EIGHTH: 8, NINTH: 9, TENTH: 10, ELEVENTH: 11, TWELFTH: 12 };
const ORDINAL = String.raw`(?:(\d{1,2})(?:ST|ND|RD|TH)?|(${Object.keys(WORDS).join("|")}))`;
const n = (digits: string | undefined, word: string | undefined) => (digits !== undefined ? Number(digits) : WORDS[word!.toUpperCase()]!);
const PHASE = String.raw`(?:\s*\([A-Z]?\d{0,2}\))?`;
const MARK_NUMBERED = new RegExp(String.raw`^(?:${ORDINAL}\s+(?:FLOOR|LEVEL)|LEVEL\s+(\d{1,2}))${PHASE}$`, "i");
const MARK_ABOVE = new RegExp(String.raw`^(?:ROOF(?:\s+(?:PLAN|LEVEL|DECK))?|PENTHOUSE\s+(?:FLOOR|ROOF|LEVEL)|HIGH\s+ROOF|MAIN\s+ROOF)${PHASE}$`, "i");
const FEET = /^(\d{1,4})\s*'\s*(?:[-–]\s*)?(?:(\d{1,2})(?:\s+(\d{1,2})\/(\d{1,2}))?)?\s*(?:"|''|”)?$/;

const feetOf = (s: string): number | null => {
  const m = FEET.exec(s.trim());
  if (m === null) return null;
  return Number(m[1]) + ((m[2] === undefined ? 0 : Number(m[2])) + (m[3] === undefined ? 0 : Number(m[3]) / Number(m[4]))) / 12;
};

/** The level markers a section or elevation prints: a level's name with its elevation beside it, on one line. */
export function levelMarks(sheet: string, items: readonly { str: string; x: number; y: number; height: number }[]): LevelMark[] {
  const list = items.map((i) => ({ ...i, str: i.str.trim() })).filter((i) => i.str !== "");
  const out: LevelMark[] = [];
  for (const i of list) {
    const numbered = MARK_NUMBERED.exec(i.str);
    if (numbered === null && !MARK_ABOVE.test(i.str)) continue;
    const level = numbered === null ? null : numbered[3] !== undefined ? Number(numbered[3]) : n(numbered[1], numbered[2]);
    // The figure on the same line, nearest first: a section stacks its levels one under another.
    const figure = list
      .filter((o) => o !== i && Math.abs(o.y - i.y) < 1.5 * Math.max(i.height, 1) && Math.abs(o.x - i.x) < 200)
      .map((o) => ({ o, feet: feetOf(o.str) }))
      .filter((f): f is { o: (typeof list)[number]; feet: number } => f.feet !== null)
      .sort((a, b) => Math.abs(a.o.x - i.x) - Math.abs(b.o.x - i.x))[0];
    if (figure === undefined) continue;
    out.push({ level, name: i.str, feet: figure.feet, sheet, phrase: `${i.str} ${figure.o.str}` });
  }
  return out;
}

/** The levels a floor plan's caption names: "2nd - 9th Floor Plan" is 2–9; a ceiling, roof or site plan names none. */
export function planLevels(caption: string): number[] {
  const c = caption.toUpperCase();
  if (!/\bPLANS?\b/.test(c) || /CEILING|\bRCP\b|ROOF|SITE|FOUNDATION|FRAMING/.test(c)) return [];
  const range = new RegExp(String.raw`${ORDINAL}\s*(?:-|–|THRU|THROUGH|TO)\s*${ORDINAL}\s+FLOORS?\b`, "i").exec(c);
  if (range) return span(n(range[1], range[2]), n(range[3], range[4]));
  const levelRange = /\bLEVELS?\s+(\d{1,2})\s*(?:-|–|&|AND|THRU|THROUGH|TO|,)\s*(\d{1,2})\b/.exec(c);
  if (levelRange) return span(Number(levelRange[1]), Number(levelRange[2]));
  const one = new RegExp(String.raw`\b${ORDINAL}\s+FLOOR\b|\bLEVEL\s+(\d{1,2})\b`, "i").exec(c);
  if (one) return [one[3] !== undefined ? Number(one[3]) : n(one[1], one[2])];
  return [];
}
const span = (a: number, b: number) => (b >= a && b - a < 40 ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : []);

export type LevelHeight = { feet: number; from: string };

/** A floor-to-floor this far out is a misread figure, not a storey. */
const STOREY = { min: 7, max: 30 };

/**
 * The floor-to-floor of the levels a plan shows: from each level's elevation
 * to the next one up (the roof above the top floor). One figure when every
 * level shown agrees; null when they differ, or a level is not marked.
 */
export function levelHeight(marks: readonly LevelMark[], levels: readonly number[]): LevelHeight | null {
  if (levels.length === 0) return null;
  // Each level's commonest elevation across the set's sheets.
  const at = new Map<number, LevelMark>();
  for (const level of new Set(marks.flatMap((m) => (m.level === null ? [] : [m.level])))) {
    const counts = new Map<number, LevelMark[]>();
    for (const m of marks.filter((m) => m.level === level)) counts.set(round(m.feet), [...(counts.get(round(m.feet)) ?? []), m]);
    at.set(level, [...counts.values()].sort((a, b) => b.length - a.length)[0]![0]!);
  }
  const elevations = [...new Set(marks.map((m) => round(m.feet)))].sort((a, b) => a - b);
  const steps = levels.map((level) => {
    const here = at.get(level);
    if (here === undefined) return null;
    const above = elevations.find((e) => e > round(here.feet));
    if (above === undefined) return null;
    const next = marks.find((m) => round(m.feet) === above)!;
    const feet = round(above - here.feet);
    return feet < STOREY.min || feet > STOREY.max ? null : { feet, here, next };
  });
  if (steps.some((s) => s === null)) return null;
  const first = steps[0]!;
  if (steps.some((s) => Math.abs(s!.feet - first.feet) > 1 / 24)) return null;
  const shown = levels.length === 1 ? first.here.name : `levels ${levels[0]}–${levels[levels.length - 1]}`;
  return { feet: first.feet, from: `floor to floor, ${shown}: ${first.here.phrase} to ${first.next.phrase} (${first.here.sheet})` };
}
const round = (feet: number) => Math.round(feet * 1200) / 1200;

/** Walls closer than this belong to one drawing; two plans on a sheet sit farther apart (Crosslines A100: 21 ft of paper). */
export const SAME_DRAWING_FEET = 4;

type Run = { x1: number; y1: number; x2: number; y2: number };
const toSegment = (p: { x: number; y: number }, r: Run) => {
  const dx = r.x2 - r.x1, dy = r.y2 - r.y1, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - r.x1) * dx + (p.y - r.y1) * dy) / l2));
  return Math.hypot(p.x - (r.x1 + t * dx), p.y - (r.y1 + t * dy));
};

/**
 * Each run's level, from the floor plan it is drawn in: the runs are joined
 * into drawings (ends within `SAME_DRAWING_FEET` of another run), and each
 * drawing takes the levels of the nearest caption at or below its top. Empty where
 * the nearest caption names no level. Page-width units throughout.
 */
export function runLevels(runs: readonly Run[], captions: readonly { name: string; captionX: number; captionY: number }[], feetPerUnit: number): number[][] {
  // ponytail: O(n²) join; fine for a sheet's few thousand runs, a grid if it ever is not.
  const reach = SAME_DRAWING_FEET / feetPerUnit;
  const parent = runs.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  for (let i = 0; i < runs.length; i++)
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i]!, b = runs[j]!;
      const near = [{ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }].some((p) => toSegment(p, b) <= reach) || [{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }].some((p) => toSegment(p, a) <= reach);
      if (near) parent[root(i)] = root(j);
    }
  const levelsOf = new Map<number, number[]>();
  for (const r of new Set(runs.map((_, i) => root(i)))) {
    const members = runs.filter((_, i) => root(i) === r);
    const box = { x1: Math.min(...members.flatMap((m) => [m.x1, m.x2])), x2: Math.max(...members.flatMap((m) => [m.x1, m.x2])), y1: Math.min(...members.flatMap((m) => [m.y1, m.y2])), y2: Math.max(...members.flatMap((m) => [m.y1, m.y2])) };
    const gap = (c: { captionX: number; captionY: number }) => Math.hypot(Math.max(box.x1 - c.captionX, 0, c.captionX - box.x2), Math.max(box.y1 - c.captionY, 0, c.captionY - box.y2));
    // A drawing's caption sits under it: a caption above the drawing's top belongs to the drawing above
    // (Crosslines A100 stacks the roof, floors 2–9 and the 1st floor, each captioned below).
    const below = captions.filter((c) => c.captionY >= box.y1);
    const nearest = [...(below.length > 0 ? below : captions)].sort((a, b) => gap(a) - gap(b))[0];
    levelsOf.set(r, nearest === undefined ? [] : planLevels(nearest.name));
  }
  return runs.map((_, i) => levelsOf.get(root(i))!);
}
