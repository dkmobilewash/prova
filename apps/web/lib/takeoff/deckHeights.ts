import { feetInches } from "./typeHeights";
import { ABSOLUTE_FEET } from "./wallHeights";

/**
 * ── TO-DECK HEIGHTS, THE WAY AN ESTIMATOR TAKES THEM (H4', prereg-type-heights.md) ──
 *
 * "To deck/structure" is a height the structural and section drawings state, not one the
 * architect leaves open: top of steel, joist or truss bearing, bottom-of-deck spot elevations,
 * eave and ridge with the roof between, less the floor's elevation. Each value rules where it is
 * printed; a value marked "UNLESS NOTED OTHERWISE" rules everywhere no other value does; under a
 * slope the height follows the wall's position between the eave and the ridge.
 *
 * The to-deck lever that failed before priced decks the documents never stated. This prices only
 * a printed elevation, and a wall no printed value reaches stays a question.
 */
export type DeckValue = {
  kind: "top-of-steel" | "bearing" | "bottom-of-deck" | "eave" | "ridge";
  elevation: number;
  /** Marked as the plan's default ("UNO", "UNLESS NOTED OTHERWISE"). */
  uno: boolean;
  /** A grid callout printed with it, "(@ B.1)". */
  grid?: string;
  x: number;
  y: number;
  phrase: string;
};

const LABELS: [DeckValue["kind"], RegExp][] = [
  ["eave", /\b(?:T\.?\s?O\.?\s+)?(?:(?:LOW|HIGH)\s+)?EAVE(?:\s+EL(?:EV(?:ATION)?)?\.?)?/i],
  ["ridge", /\b(?:T\.?\s?O\.?\s+)?RIDGE(?:\s+EL(?:EV(?:ATION)?)?\.?)?/i],
  ["top-of-steel", /\bT\.?\s?O\.?\s?S\.?(?=\s|=|:|$)|\b(?:T\.?\s?O\.?|TOP\s+OF)\s+STEEL\b/i],
  ["bearing", /\b(?:JOIST|TRUSS)\s+(?:BRG\.?|BEARING)(?:\s+EL(?:EV(?:ATION)?)?\.?)?|\bJ\.?B\.?E\.?(?=\s|=|$)|\bBRG\.?\s+EL(?:EV)?\.?/i],
  ["bottom-of-deck", /\b(?:B\.?\s?O\.?|BOTTOM\s+OF|U\/S\s+OF|UNDERSIDE\s+OF)\s+(?:ROOF\s+)?DECK(?:ING)?\b|\bB\/(?:HIGH\s+|LOW\s+)?DECK\b|\bB\.?O\.?D\.?(?=\s|=|$)/i],
];
const UNO = /\bU\.?\s?N\.?\s?O\.?\b|\bU\.?O\.?N\.?\b|\bUNLESS\s+(?:NOTED|OTHERWISE\s+NOTED|SHOWN)(?:\s+OTHERWISE)?\b|\bTYP(?:ICAL|\.)?\b/i;
const FIGURE = /(\d{1,3})\s*'\s*[-–]?\s*\d{0,2}(?:\s+\d{1,2}\/\d{1,2})?\s*(?:"|''|”)?/;

/** The deck, bearing, eave and ridge elevations printed on a sheet (page-width units). */
export function deckValues(items: readonly { str: string; x: number; y: number; height: number }[]): DeckValue[] {
  const out: DeckValue[] = [];
  const clean = items.map((i) => ({ ...i, str: i.str.replace(/\s+/g, " ").trim() })).filter((i) => i.str !== "");
  for (const i of clean) {
    const label = LABELS.find(([, re]) => re.test(i.str));
    if (label === undefined) continue;
    const [kind, re] = label;
    const after = i.str.slice(re.exec(i.str)!.index);
    let figureText: string | null = FIGURE.test(after) ? after.slice(FIGURE.exec(after)!.index) : null;
    if (figureText === null) {
      // The figure printed beside the label, on its row.
      // The figure beside the label on its row, or stacked just above or below it (a level marker).
      const near = (o: (typeof clean)[number]) =>
        (Math.abs(o.y - i.y) < 2.5 * i.height && o.x > i.x && o.x - i.x < 0.1) || (Math.abs(o.x - i.x) < 0.05 && Math.abs(o.y - i.y) < 3 * i.height);
      const beside = clean
        .filter((o) => o !== i && near(o) && FIGURE.test(o.str) && !LABELS.some(([, r]) => r.test(o.str)))
        .sort((a, b) => Math.hypot(a.x - i.x, a.y - i.y) - Math.hypot(b.x - i.x, b.y - i.y))[0];
      figureText = beside?.str ?? null;
    }
    if (figureText === null) continue;
    const elevation = feetInches(figureText);
    if (elevation === null || elevation < 7 || elevation > 400) continue;
    const grid = /\(\s*@\s*([A-Z]{1,2}(?:\.\d)?(?:\s*\/\s*\d+(?:\.\d)?)?|\d+(?:\.\d)?)\s*\)/i.exec(i.str)?.[1];
    out.push({ kind, elevation, uno: UNO.test(i.str), ...(grid === undefined ? {} : { grid: grid.toUpperCase() }), x: i.x, y: i.y, phrase: i.str });
  }
  return out;
}

export type DeckZones = {
  /** The height every wall takes where no printed spot value reaches: the UNO value, relative. */
  defaultFeet: number | null;
  /** Printed spot values, relative to the floor. */
  points: { x: number; y: number; feet: number; phrase: string }[];
  eaves: { x: number; y: number; feet: number }[];
  ridges: { x: number; y: number; feet: number }[];
};

/** A printed value rules within this many feet of where it is printed. */
export const DECK_ZONE_REACH_FEET = 30;

/** The values as heights above the floor: absolute ones (over 40 ft) less the floor's elevation; dropped when there is none. */
export function deckZones(values: readonly DeckValue[], floor: { floorElevation: number | null }): DeckZones {
  const rel = (e: number): number | null => (e > ABSOLUTE_FEET ? (floor.floorElevation === null ? null : e - floor.floorElevation) : e);
  const out: DeckZones = { defaultFeet: null, points: [], eaves: [], ridges: [] };
  for (const v of values) {
    const feet = rel(v.elevation);
    if (feet === null || feet < 7) continue;
    if (v.kind === "eave") out.eaves.push({ x: v.x, y: v.y, feet });
    else if (v.kind === "ridge") out.ridges.push({ x: v.x, y: v.y, feet });
    else if (v.uno) out.defaultFeet = out.defaultFeet ?? feet;
    else out.points.push({ x: v.x, y: v.y, feet, phrase: v.phrase });
  }
  return out;
}

/** A to-deck wall's height at `at` (the deck sheet's page-width units), or null when nothing printed reaches it. */
export function deckHeightAt(z: DeckZones, at: { x: number; y: number }, feetPerUnit: number): { feet: number; from: string } | null {
  const dist = (p: { x: number; y: number }) => Math.hypot(p.x - at.x, p.y - at.y) * feetPerUnit;
  // Under a slope: between the nearest eave and the nearest ridge, by position along the line joining them.
  if (z.eaves.length > 0 && z.ridges.length > 0) {
    const e = [...z.eaves].sort((a, b) => dist(a) - dist(b))[0]!, r = [...z.ridges].sort((a, b) => dist(a) - dist(b))[0]!;
    const dx = r.x - e.x, dy = r.y - e.y, len2 = dx * dx + dy * dy;
    if (len2 > 0) {
      const t = Math.max(0, Math.min(1, ((at.x - e.x) * dx + (at.y - e.y) * dy) / len2));
      return { feet: e.feet + (r.feet - e.feet) * t, from: `between the eave ${e.feet.toFixed(2)} ft and the ridge ${r.feet.toFixed(2)} ft` };
    }
  }
  const near = [...z.points].sort((a, b) => dist(a) - dist(b))[0];
  if (near !== undefined && dist(near) <= DECK_ZONE_REACH_FEET) return { feet: near.feet, from: `"${near.phrase}"` };
  if (z.defaultFeet !== null) return { feet: z.defaultFeet, from: "the plan's default deck elevation (U.N.O.)" };
  const values = [...new Set(z.points.map((p) => Math.round(p.feet * 96) / 96))];
  if (values.length === 1) return { feet: values[0]!, from: `"${z.points[0]!.phrase}", the one value printed` };
  return null;
}

/**
 * The floor's absolute elevation where a sentence states it ("ARCHITECTURAL FINISH FLOOR ELEVATION
 * OF 100'-0" EQUALS …", 114026; "FIRST FLOOR EL. 100'-0""), anywhere in a text item. A floor-to-floor
 * figure, a slab thickness, or a relative 0" is not one.
 */
export function floorElevationIn(text: string): number | null {
  return floorStatement(text)?.feet ?? null;
}

/** As `floorElevationIn`, saying whether the sentence names the FINISH FLOOR (strong) or a slab top (weak: K-4 prints depressed slabs). */
export function floorStatement(text: string): { feet: number; slab: boolean } | null {
  const m = /\b(?:(?:ARCHITECTURAL\s+)?FIN(?:ISH(?:ED)?)?\.?\s+FL(?:OO)?R\.?|(?:FIRST|1ST|GROUND|MAIN)\s+FLOOR|F\.?F\.?E\.?|T\.?\s?O\.?\s+(?:CONC(?:RETE|\.)?\s+)?SLAB)\s*(?:ELEVATION|ELEV\.?|EL\.?)?\s*(?:OF|=|:|@)?\s*(\d{2,3}\s*'\s*[-–]?\s*\d{0,2}(?:\s+\d\/\d)?\s*(?:"|”)?)/i.exec(text);
  if (m === null || /\bFLOOR\s+TO\s+FLOOR\b/i.test(text)) return null;
  const feet = feetInches(m[1]!);
  return feet !== null && feet > ABSOLUTE_FEET ? { feet, slab: /\bSLAB\b/i.test(m[0]) } : null;
}

/**
 * A sloped roof's eave and ridge, placed: the ROOF PLAN prints where they are ("LOW EAVE", "RIDGE",
 * no figure) and the sections print how high (Camp Clark: "T.O. LOW EAVE EL. 112'-0"",
 * "T.O. RIDGE EL. 120'-1 1/2""). Placed only when the sections give ONE eave and ONE ridge value.
 */
export function slopeFromRoofPlan(roofItems: readonly { str: string; x: number; y: number }[], sectionValues: readonly DeckValue[]): DeckValue[] {
  const one = (kind: "eave" | "ridge") => {
    const v = [...new Set(sectionValues.filter((s) => s.kind === kind).map((s) => Math.round(s.elevation * 96) / 96))];
    return v.length === 1 ? v[0]! : null;
  };
  const eave = one("eave"), ridge = one("ridge");
  if (eave === null || ridge === null) return [];
  const out: DeckValue[] = [];
  for (const i of roofItems) {
    const s = i.str.replace(/\s+/g, " ").trim();
    if (FIGURE.test(s)) continue;
    if (/^(?:T\.?\s?O\.?\s+)?(?:LOW\s+)?EAVE$/i.test(s)) out.push({ kind: "eave", elevation: eave, uno: false, x: i.x, y: i.y, phrase: `${s} (sections: ${eave.toFixed(2)})` });
    else if (/^(?:T\.?\s?O\.?\s+)?RIDGE$/i.test(s)) out.push({ kind: "ridge", elevation: ridge, uno: false, x: i.x, y: i.y, phrase: `${s} (sections: ${ridge.toFixed(2)})` });
  }
  return out;
}

/** The level a framing plan frames (its walls are the level below), "roof" for the roof, null when it does not say. */
export function framingLevel(caption: string): number | "roof" | null {
  const c = caption.toUpperCase();
  if (/\bROOF\b/.test(c)) return "roof";
  if (!/\bFRAMING\b/.test(c)) return null;
  const words: Record<string, number> = { FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6 };
  const m = /\b(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|(\d{1,2})(?:ST|ND|RD|TH))\s+FLOOR\b|\bLEVEL\s+(\d{1,2})\b/.exec(c);
  if (m === null) return null;
  return m[3] !== undefined ? Number(m[3]) : m[2] !== undefined ? Number(m[2]) : words[m[1]!]!;
}
