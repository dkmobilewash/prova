import type { WallComponentBasis } from "@/lib/wall-assemblies";

/**
 * ── THE STARTER LIBRARY, IN A MODULE THE PAGE CAN READ ──
 *
 * Moved out of `lib/actions/wallTypes.ts` (issue #818) because that file is
 * `"use server"` and can export only async functions — and `/wall-types` now
 * needs the list too, to keep offering the starters while any is missing and
 * to say on the button how many it will add. ONE list and ONE rule for "which
 * are missing", used by the page and by `addStarterWallTypes`, so the number on
 * the button is the number the press writes.
 */

/**
 * Two common wall types, so the page is usable on day one rather than after a
 * month of setup — the competitive audit's honest claim against the incumbents.
 *
 * DELIBERATELY UNPRICED AND WITHOUT PRODUCTION RATES. The quantities follow
 * from the assembly (a stud is a stud); a price or a crew rate is this
 * company's own number, and inventing one would put a stranger's figure into a
 * bid. Default height is left blank for the same reason: each run says its own.
 */
/**
 * ── THE STARTER LIBRARY ──
 *
 * Editable DEFAULTS, not a specification. Every factor here is a common
 * convention rather than anybody's measured productivity, which is why the
 * screen that offers them says so and why nothing re-applies them: a company
 * that changes a factor has made a decision, and a later "refresh the
 * starters" would quietly take it back.
 *
 * ── THE WALL TYPES KEEP THEIR OWN SHARED PARTS; THE OTHER TRADES DO NOT ──
 *
 * `STARTER_COMPONENTS` is the stud-and-board list every partition shares.
 * A ceiling, a slab and a coat of paint share nothing with it, so they carry
 * their parts outright. The alternative — a single list with most rows
 * switched off per type — is the shape where a row nobody wanted gets priced
 * because somebody forgot a flag.
 *
 * ── NO PRICES ──
 *
 * Not one of these carries a unit price, deliberately. A part with no catalog
 * entry makes an UNPRICED estimate line, which an estimator fills in from
 * their own supplier — and a seeded price is a number that looks researched,
 * gets bid, and is nobody's.
 */
export type StarterPart = {
  description: string;
  unit: string;
  basis: WallComponentBasis;
  factor: string;
  wastePercent?: string;
  roundUp?: boolean;
  /**
   * The factor is for ONE layer of board, so the wall type's `boardLayers`
   * answer multiplies it. Set on the board and on HANGING it — each layer is
   * hung — but never on tape and finish, which cover the face layer whatever
   * is behind it. That is why the starters carry "Hang" and "Tape and finish"
   * as two parts rather than one "Hang, tape and finish" (2026-10-30: the
   * combined part could be neither per layer nor not). With no answer a
   * per-layer part prices as one layer.
   */
  perLayer?: boolean;
};

export type StarterType = { code: string; name: string; parts: StarterPart[] };

const STARTER_COMPONENTS: StarterPart[] = [
  { description: "3⅝″ 20ga studs", unit: "ea", basis: "STUDS", factor: "1", roundUp: true },
  { description: "3⅝″ 20ga track, top and bottom", unit: "lin ft", basis: "LINEAR_FT", factor: "2" },
  { description: "⅝″ Type X board, 4x8 sheets", unit: "sheets", basis: "BOARDED_SQFT", factor: "0.03125", wastePercent: "10", roundUp: true, perLayer: true },
  { description: "Hang ⅝″ board", unit: "sq ft", basis: "BOARDED_SQFT", factor: "1", perLayer: true },
  { description: "Tape and finish ⅝″ board", unit: "sq ft", basis: "BOARDED_SQFT", factor: "1" },
];

export const STARTER_TYPES: readonly StarterType[] = [
  {
    code: "W1",
    name: "3⅝″ 20ga steel studs at 16″ o.c., ⅝″ Type X each side",
    parts: STARTER_COMPONENTS,
  },
  {
    code: "W2",
    name: "3⅝″ 20ga steel studs at 16″ o.c., ⅝″ Type X each side, R-13 batt",
    parts: [
      ...STARTER_COMPONENTS,
      { description: "R-13 batt insulation", unit: "sq ft", basis: "FACE_SQFT", factor: "1" },
    ],
  },
  {
    code: "W3",
    name: "2x4 wood studs at 16″ o.c., ½″ board each side",
    parts: [
      { description: "2x4 studs", unit: "ea", basis: "STUDS", factor: "1", roundUp: true },
      { description: "2x4 plate, one bottom and two top", unit: "lin ft", basis: "LINEAR_FT", factor: "3" },
      { description: "½″ board, 4x8 sheets", unit: "sheets", basis: "BOARDED_SQFT", factor: "0.03125", wastePercent: "10", roundUp: true, perLayer: true },
      { description: "Hang ½″ board", unit: "sq ft", basis: "BOARDED_SQFT", factor: "1", perLayer: true },
      { description: "Tape and finish ½″ board", unit: "sq ft", basis: "BOARDED_SQFT", factor: "1" },
    ],
  },
  {
    code: "EW1",
    name: "Exterior 6″ 18ga stud wall, sheathed and insulated, board inside",
    parts: [
      { description: "6″ 18ga studs", unit: "ea", basis: "STUDS", factor: "1", roundUp: true },
      { description: "6″ 18ga track, top and bottom", unit: "lin ft", basis: "LINEAR_FT", factor: "2" },
      { description: "½″ exterior sheathing", unit: "sq ft", basis: "FACE_SQFT", factor: "1", wastePercent: "10" },
      { description: "R-21 batt insulation", unit: "sq ft", basis: "FACE_SQFT", factor: "1" },
      { description: "⅝″ Type X board, inside face only", unit: "sq ft", basis: "FACE_SQFT", factor: "1", wastePercent: "10", perLayer: true },
      { description: "Hang inside face board", unit: "sq ft", basis: "FACE_SQFT", factor: "1", perLayer: true },
      { description: "Tape and finish inside face", unit: "sq ft", basis: "FACE_SQFT", factor: "1" },
    ],
  },
  {
    code: "FIN5",
    name: "Drywall finish — Level 5 skim over board already hung",
    parts: [
      { description: "Level 5 skim coat", unit: "sq ft", basis: "BOARDED_SQFT", factor: "1" },
      { description: "Joint compound for skim", unit: "sq ft", basis: "BOARDED_SQFT", factor: "1", wastePercent: "5" },
    ],
  },
  {
    code: "ACT1",
    name: "Acoustic ceiling — 2x4 lay-in grid and tile",
    parts: [
      // AREA_SQFT and PERIMETER_FT, which a wall run cannot produce at all —
      // this type exists for a TAKEOFF ITEM traced as an area.
      { description: "2x4 acoustic tile", unit: "sq ft", basis: "AREA_SQFT", factor: "1", wastePercent: "5" },
      { description: "Main tee and cross tee", unit: "lin ft", basis: "AREA_SQFT", factor: "1.1" },
      { description: "Wall angle", unit: "lin ft", basis: "PERIMETER_FT", factor: "1", wastePercent: "5" },
      { description: "Hang grid and lay tile", unit: "sq ft", basis: "AREA_SQFT", factor: "1" },
    ],
  },
  {
    code: "ACT2",
    name: "Acoustic ceiling — 2x2 lay-in grid and tile, each tee on its own line",
    parts: [
      // QUANTITY FACTORS FOR A 2x2 LAYOUT, per square foot of ceiling: mains
      // at 4' o.c. (0.25 lf/sf), 4' cross tees at 2' o.c. between them
      // (0.5 lf/sf), 2' cross tees closing each 2x2 cell (0.25 lf/sf), and
      // one hanger wire per 4x4 (1/16 per sf). Wall angle is the room's
      // perimeter, which is why this prices a TAKEOFF ITEM traced as an
      // area WITH a perimeter — the Rooms panel saves ceilings that way.
      { description: "2x2 acoustic tile", unit: "sq ft", basis: "AREA_SQFT", factor: "1", wastePercent: "5" },
      { description: "Main tee, 4' o.c.", unit: "lin ft", basis: "AREA_SQFT", factor: "0.25", wastePercent: "5" },
      { description: "4' cross tee", unit: "lin ft", basis: "AREA_SQFT", factor: "0.5", wastePercent: "5" },
      { description: "2' cross tee", unit: "lin ft", basis: "AREA_SQFT", factor: "0.25", wastePercent: "5" },
      { description: "Hanger wire, one per 4x4", unit: "ea", basis: "AREA_SQFT", factor: "0.0625", roundUp: true },
      { description: "Wall angle", unit: "lin ft", basis: "PERIMETER_FT", factor: "1", wastePercent: "5" },
      { description: "Hang grid and lay tile", unit: "sq ft", basis: "AREA_SQFT", factor: "1" },
    ],
  },
  {
    code: "GYPC1",
    name: "Gypsum board ceiling — ⅝″ board on hat channel at 16″ o.c.",
    parts: [
      // Priced off the item's AREA, not a boarded wall face: a ceiling item
      // has no height or sides, so BOARDED_SQFT would be zero on it.
      { description: "⅝″ board, 4x8 sheets", unit: "sheets", basis: "AREA_SQFT", factor: "0.03125", wastePercent: "10", roundUp: true },
      { description: "⅞″ hat channel at 16″ o.c.", unit: "lin ft", basis: "AREA_SQFT", factor: "0.75", wastePercent: "5" },
      { description: "1½″ carrying channel at 4' o.c.", unit: "lin ft", basis: "AREA_SQFT", factor: "0.25", wastePercent: "5" },
      { description: "Hanger wire, one per 4x4", unit: "ea", basis: "AREA_SQFT", factor: "0.0625", roundUp: true },
      // Split like the walls' (hanging and finishing are different crews and
      // rates), but neither is per layer: this type's board is not either.
      { description: "Hang ⅝″ ceiling board", unit: "sq ft", basis: "AREA_SQFT", factor: "1" },
      { description: "Tape and finish ⅝″ ceiling board", unit: "sq ft", basis: "AREA_SQFT", factor: "1" },
    ],
  },
  {
    code: "FLR1",
    name: "Flooring — underlayment, finish floor and base",
    parts: [
      { description: "Finish flooring", unit: "sq ft", basis: "AREA_SQFT", factor: "1", wastePercent: "10" },
      { description: "Underlayment", unit: "sq ft", basis: "AREA_SQFT", factor: "1", wastePercent: "5" },
      { description: "Base", unit: "lin ft", basis: "PERIMETER_FT", factor: "1", wastePercent: "10" },
      { description: "Install flooring", unit: "sq ft", basis: "AREA_SQFT", factor: "1" },
    ],
  },
  {
    code: "PT1",
    name: "Painting — one prime and two finish coats",
    parts: [
      { description: "Primer", unit: "sq ft", basis: "AREA_SQFT", factor: "1" },
      { description: "Finish paint, two coats", unit: "sq ft", basis: "AREA_SQFT", factor: "2" },
      { description: "Prime and paint", unit: "sq ft", basis: "AREA_SQFT", factor: "1" },
    ],
  },
  {
    code: "SLB1",
    name: "Concrete slab on grade — set the item's depth in inches",
    parts: [
      // VOLUME_CY reads the ITEM'S depth: `area × depth ÷ 27`. A slab with no
      // depth produces nothing rather than a guessed four inches, which is
      // the rule this whole codebase follows about numbers nobody supplied.
      { description: "Concrete", unit: "cu yd", basis: "VOLUME_CY", factor: "1", wastePercent: "5", roundUp: true },
      { description: "Welded wire mesh", unit: "sq ft", basis: "AREA_SQFT", factor: "1", wastePercent: "10" },
      { description: "Edge form", unit: "lin ft", basis: "PERIMETER_FT", factor: "1" },
      { description: "Place and finish slab", unit: "sq ft", basis: "AREA_SQFT", factor: "1" },
    ],
  },
  {
    code: "FTG1",
    name: "Concrete footing — set the item's depth in inches",
    parts: [
      { description: "Concrete", unit: "cu yd", basis: "VOLUME_CY", factor: "1", wastePercent: "5", roundUp: true },
      { description: "Form both sides", unit: "sq ft", basis: "LINEAR_FT", factor: "2" },
      { description: "Rebar", unit: "lin ft", basis: "LINEAR_FT", factor: "3" },
      { description: "Place and finish footing", unit: "lin ft", basis: "LINEAR_FT", factor: "1" },
    ],
  },
];

/**
 * ── WHICH PRODUCT IS ASKING ──
 *
 * C Stream Bid is for framing/drywall, plaster, EIFS, ceilings and
 * fireproofing subs, so it offers only the partitions, the finish and the
 * ceilings. Flooring, paint, slab and footing are other trades' work and stay
 * a CRM-only offer — a Bid user pressing "Start from…" got four assemblies
 * they will never bid (browser test, 2026-10-30). The CRM keeps all of them.
 */
export type StarterSurface = "crm" | "bid";

const BID_STARTER_CODES: ReadonlySet<string> = new Set(["W1", "W2", "W3", "EW1", "FIN5", "ACT1", "ACT2", "GYPC1"]);

/** The starters `surface` offers, in the starter order. */
export function startersFor(surface: StarterSurface): readonly StarterType[] {
  return surface === "bid" ? STARTER_TYPES.filter((type) => BID_STARTER_CODES.has(type.code)) : STARTER_TYPES;
}

/**
 * The name a starter type had BEFORE its layer count came out of it
 * (2026-10-30), mapped to the name it has now. "one layer" in a name, beside a
 * "Board layers each side" answer of 2, is a name that lies — and a guide tap
 * answering the layers cannot see the name it is contradicting.
 *
 * Only these exact strings: a name somebody typed is theirs, and is never
 * rewritten — not even one that happens to say "one layer".
 */
const LAYERLESS_STARTER_NAME: ReadonlyMap<string, string> = new Map([
  ["3⅝″ 20ga steel studs at 16″ o.c., one layer ⅝″ Type X each side", "3⅝″ 20ga steel studs at 16″ o.c., ⅝″ Type X each side"],
  ["3⅝″ 20ga steel studs at 16″ o.c., one layer ⅝″ Type X each side, R-13 batt", "3⅝″ 20ga steel studs at 16″ o.c., ⅝″ Type X each side, R-13 batt"],
  ["2x4 wood studs at 16″ o.c., one layer ½″ board each side", "2x4 wood studs at 16″ o.c., ½″ board each side"],
]);

/** `name` without an old starter's "one layer", or `name` itself when it is not one. */
export function starterNameWithoutLayerCount(name: string): string {
  return LAYERLESS_STARTER_NAME.get(name) ?? name;
}

/**
 * The starter types this company does not have yet, in the starter order.
 *
 * A code counts as HAD case-insensitively and ignoring surrounding space, the
 * rule `addWallTypesFromSchedule` already uses: a company whose own `w1` is a
 * different wall must not be handed a second `W1` beside it for a drawing tag
 * to match ambiguously. Nothing here ever touches a type the company has — the
 * action only CREATES the missing ones.
 */
export function missingStarterTypes(existingCodes: Iterable<string>, surface: StarterSurface = "crm"): StarterType[] {
  const had = new Set<string>();
  for (const code of existingCodes) had.add(code.trim().toUpperCase());
  return startersFor(surface).filter((type) => !had.has(type.code.toUpperCase()));
}
