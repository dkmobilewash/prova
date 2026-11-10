import type { TradeScope } from "@prova/db";
import { OWN_MARKUP_KEYS } from "@/lib/bid-recap";
import { STARTER_TYPES, TRADE_ONLY_STARTERS, type StarterType } from "@/lib/wall-type-starters";

/**
 * TRADE PRESETS (guided flow Phase 5). A new company taps its trade once on
 * `/welcome`, and that tap sets four things, every one a starting value the
 * company can change afterwards:
 *
 *   - the trade scopes it holds (`CompanyTradeScope`, primary first);
 *   - starter wall types and assemblies (`lib/wall-type-starters.ts`);
 *   - the takeoff switches' starting values (Settings keeps them editable);
 *   - one starter estimate template of default lines.
 *
 * NEVER A PRICE OR A PERCENTAGE. Diego, 2026-11-05: the preset sets no markup.
 * The company is asked for its own markup in empty boxes, and until all four
 * figures are set the estimate says so (`markupNeeded`). A seeded figure is a
 * number that gets bid and is nobody's, the same rule the starter assemblies
 * follow.
 *
 * Switches, Diego 2026-11-05: as proposed, with fireproofing's rooms ON
 * (deck fireproofing is priced by floor area). Scanned sheets stay off for
 * every trade.
 *
 * PLAN COMPARISON IS ON FOR EVERY TRADE — Diego's LATER decision (#1087,
 * 2026-11-08) that a new company starts with it on wins over the 11-05 table,
 * which had it off. The preset ran after sign-up and switched it back off, so
 * every company that picked a trade lost what #1087 gave it, and a renovation
 * set priced its existing walls as new. A preset sets starting values; it must
 * not undo a default decided after it.
 */
export type TradeChoice = "FRAMING_DRYWALL" | "ACOUSTICAL_CEILINGS" | "PLASTER_EIFS" | "FIREPROOFING" | "OTHER";

export type TakeoffSwitches = {
  wholeSetTakeoffOn: boolean;
  roomFinderOn: boolean;
  doorsWindowsOn: boolean;
  /** An OFF switch: false means "Count like this" is on. */
  symbolCountOff: boolean;
  scannedPlansOn: boolean;
  planCompareOn: boolean;
};

export type TradePreset = {
  choice: TradeChoice;
  label: string;
  /** Primary first. Empty for Other. */
  scopes: TradeScope[];
  switches: TakeoffSwitches;
  wallTypeCodes: string[];
  template: { name: string; lines: { description: string; unit: string }[] } | null;
};

const on = (walls: boolean, rooms: boolean, doors: boolean): TakeoffSwitches => ({
  wholeSetTakeoffOn: walls,
  roomFinderOn: rooms,
  doorsWindowsOn: doors,
  symbolCountOff: false,
  scannedPlansOn: false,
  planCompareOn: true,
});

export const TRADE_PRESETS: TradePreset[] = [
  {
    choice: "FRAMING_DRYWALL",
    label: "Framing and drywall",
    scopes: ["METAL_FRAMING_DRYWALL"],
    switches: on(true, true, true),
    wallTypeCodes: ["W1", "W2", "W3", "EW1", "FIN5", "GYPC1"],
    template: {
      name: "Framing and drywall — starter lines",
      lines: [
        { description: "Layout and mobilization", unit: "ls" },
        { description: "Metal stud framing", unit: "sq ft" },
        { description: "Blocking and backing", unit: "lin ft" },
        { description: "Insulation", unit: "sq ft" },
        { description: "Hang drywall", unit: "sq ft" },
        { description: "Tape and finish", unit: "sq ft" },
        { description: "Drywall ceilings and soffits", unit: "sq ft" },
        { description: "Clean up and haul off", unit: "ls" },
      ],
    },
  },
  {
    choice: "ACOUSTICAL_CEILINGS",
    label: "Acoustical ceilings",
    scopes: ["ACOUSTICAL_CEILINGS"],
    switches: on(true, true, false),
    wallTypeCodes: ["ACT1", "ACT2", "GYPC1"],
    template: {
      name: "Acoustical ceilings — starter lines",
      lines: [
        { description: "Ceiling grid", unit: "sq ft" },
        { description: "Ceiling tile", unit: "sq ft" },
        { description: "Wall angle and perimeter trim", unit: "lin ft" },
        { description: "Hanger wire and seismic bracing", unit: "sq ft" },
        { description: "Fixture and penetration cut-ins", unit: "ea" },
        { description: "Clean up and haul off", unit: "ls" },
      ],
    },
  },
  {
    choice: "PLASTER_EIFS",
    label: "Plaster and EIFS",
    scopes: ["LATH_PLASTER", "EIFS"],
    switches: on(true, false, true),
    wallTypeCodes: ["PL1", "EIFS1"],
    template: {
      name: "Plaster and EIFS — starter lines",
      lines: [
        { description: "Metal lath and accessories", unit: "sq ft" },
        { description: "Three-coat cement plaster", unit: "sq ft" },
        { description: "EIFS insulation board", unit: "sq ft" },
        { description: "EIFS base coat and mesh", unit: "sq ft" },
        { description: "EIFS finish coat", unit: "sq ft" },
        { description: "Control and expansion joints", unit: "lin ft" },
        { description: "Sealant at openings", unit: "lin ft" },
        { description: "Scaffolding", unit: "ls" },
      ],
    },
  },
  {
    choice: "FIREPROOFING",
    label: "Fireproofing",
    scopes: ["FIREPROOFING"],
    switches: on(false, true, false),
    wallTypeCodes: ["FP1", "FP2"],
    template: {
      name: "Fireproofing — starter lines",
      lines: [
        { description: "Spray fireproofing — deck", unit: "sq ft" },
        { description: "Spray fireproofing — beams", unit: "lin ft" },
        { description: "Spray fireproofing — columns", unit: "ea" },
        { description: "Intumescent coating", unit: "sq ft" },
        { description: "Masking and protection", unit: "ls" },
        { description: "Patching after other trades", unit: "ls" },
        { description: "Thickness and density testing", unit: "ls" },
      ],
    },
  },
  {
    // Today's new-company defaults, and nothing added.
    choice: "OTHER",
    label: "Something else",
    scopes: [],
    switches: on(true, true, true),
    wallTypeCodes: [],
    template: null,
  },
];

export function tradePreset(choice: string): TradePreset | null {
  return TRADE_PRESETS.find((preset) => preset.choice === choice) ?? null;
}

const ALL_STARTERS = [...STARTER_TYPES, ...TRADE_ONLY_STARTERS];

/** The starter wall types a preset adds, in the order it names them. */
export function presetWallTypes(preset: TradePreset): StarterType[] {
  return preset.wallTypeCodes.map((code) => {
    const type = ALL_STARTERS.find((starter) => starter.code === code);
    if (!type) throw new Error(`Trade preset ${preset.choice} names a starter wall type that does not exist: ${code}`);
    return type;
  });
}

export const MARKUP_FIELDS = OWN_MARKUP_KEYS;
export type MarkupField = (typeof MARKUP_FIELDS)[number];

/**
 * Whether this company still owes its own markup: asked its trade at signup,
 * and any of the four figures still blank. A company that predates the trade
 * question (`tradePresetAskedAt` null) never owes it, so nothing changes for
 * an existing company. Derived every time, never stored.
 */
export function markupNeeded(
  company: { tradePresetAskedAt: Date | null },
  defaults: Partial<Record<MarkupField, unknown>> | null,
): boolean {
  if (company.tradePresetAskedAt === null) return false;
  return MARKUP_FIELDS.some((field) => defaults?.[field] == null);
}
