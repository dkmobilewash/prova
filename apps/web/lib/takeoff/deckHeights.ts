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
  ["top-of-steel", /\bT\.?\s?O\.?\s?S\.?(?=\s|=|$)|\b(?:T\.?\s?O\.?|TOP\s+OF)\s+STEEL\b/i],
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
      const beside = clean
        .filter((o) => o !== i && Math.abs(o.y - i.y) < 2.5 * i.height && o.x > i.x && o.x - i.x < 0.1 && FIGURE.test(o.str) && !LABELS.some(([, r]) => r.test(o.str)))
        .sort((a, b) => a.x - b.x)[0];
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
