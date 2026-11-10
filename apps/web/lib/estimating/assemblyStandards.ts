/**
 * ── A COMPANY'S QUANTITY STANDARDS: how much of each material a square foot of wall takes ──
 *
 * The factors the automatic estimate multiplies by (`assemblyAccessories.ts`) and the waste it adds,
 * one set per company, editable on the Wall types page and stored on `CompanyBidDefaults.assemblyStandards`.
 * NEVER A PRICE: these say how many screws or how much compound, never what anything costs — prices come
 * only from the company's own catalog.
 *
 * The starting values are the commonly published drywall figures (USG's Gypsum Construction Handbook and
 * the Gypsum Association's guidance: about one screw per square foot of board, 370 lineal feet of tape and
 * about 140 lb of ready-mixed compound per 1,000 square feet finished). Stud spacing is used ONLY when
 * neither the drawing nor the spec states one, and the line says so.
 */
export type MaterialKind = "studs" | "track" | "board" | "screws" | "tape" | "compound" | "insulation";

export type AssemblyStandards = {
  wastePercent: Record<MaterialKind, number>;
  /** Studs o.c. when the drawing and the spec are both silent. */
  studSpacingIn: number;
  screwsPerSqFt: number;
  tapeLfPerSqFt: number;
  /** Tape is bought, and so counted, in rolls of this length: a price column of cents cannot hold tape by the foot. */
  tapeRollLf: number;
  compoundLbPerSqFt: number;
  /** Added to compound where the spec calls for a Level 5 finish. */
  level5SkimLbPerSqFt: number;
};

export const DEFAULT_ASSEMBLY_STANDARDS: AssemblyStandards = {
  wastePercent: { studs: 5, track: 5, board: 10, screws: 5, tape: 5, compound: 5, insulation: 5 },
  studSpacingIn: 16,
  screwsPerSqFt: 1,
  tapeLfPerSqFt: 0.37,
  tapeRollLf: 500,
  compoundLbPerSqFt: 0.14,
  level5SkimLbPerSqFt: 0.07,
};

export const MATERIAL_KINDS: readonly MaterialKind[] = ["studs", "track", "board", "screws", "tape", "compound", "insulation"];

const within = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;

/**
 * A stored JSON value back into standards; anything missing or out of range takes the default.
 * Board waste with nothing stored follows the company's own `defaultWastePercent`, the figure its
 * takeoff form already uses, so the two cannot disagree about the same sheet of board.
 */
export function standardsFrom(value: unknown, companyWastePercent: number | null = null): AssemblyStandards {
  const raw = (value ?? {}) as Partial<Record<keyof AssemblyStandards, unknown>>;
  const waste = (raw.wastePercent ?? {}) as Partial<Record<MaterialKind, unknown>>;
  const base = DEFAULT_ASSEMBLY_STANDARDS;
  const d = { ...base, wastePercent: { ...base.wastePercent, board: within(companyWastePercent, 0, 50, base.wastePercent.board) } };
  return {
    wastePercent: Object.fromEntries(MATERIAL_KINDS.map((k) => [k, within(waste[k], 0, 50, d.wastePercent[k])])) as Record<MaterialKind, number>,
    studSpacingIn: [12, 16, 19.2, 24].includes(raw.studSpacingIn as number) ? (raw.studSpacingIn as number) : d.studSpacingIn,
    screwsPerSqFt: within(raw.screwsPerSqFt, 0, 5, d.screwsPerSqFt),
    tapeLfPerSqFt: within(raw.tapeLfPerSqFt, 0, 3, d.tapeLfPerSqFt),
    tapeRollLf: within(raw.tapeRollLf, 50, 2000, d.tapeRollLf),
    compoundLbPerSqFt: within(raw.compoundLbPerSqFt, 0, 2, d.compoundLbPerSqFt),
    level5SkimLbPerSqFt: within(raw.level5SkimLbPerSqFt, 0, 2, d.level5SkimLbPerSqFt),
  };
}
