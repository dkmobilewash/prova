/**
 * How a trade scope is written for a person to read.
 *
 * One list, because the alternative already bit us: the catalog page had a
 * local options array while the import preview derived a label by lowercasing
 * the enum, so the same row previewed as "lath plaster" and then saved as
 * "Lath & plaster". Nothing was actually wrong with the data — but a preview
 * whose wording doesn't match what lands is a preview you stop trusting, and
 * the preview is the only thing standing between a bad file and the catalog.
 *
 * Deliberately its own module rather than living in lib/actions/shared.ts:
 * that file imports prisma, and this is rendered by client components.
 */
export const TRADE_SCOPE_OPTIONS = [
  { value: "METAL_FRAMING_DRYWALL", label: "Metal framing / drywall" },
  { value: "LATH_PLASTER", label: "Lath & plaster" },
  { value: "EIFS", label: "EIFS" },
  { value: "ACOUSTICAL_CEILINGS", label: "Acoustical ceilings" },
  { value: "FIREPROOFING", label: "Fireproofing" },
] as const;

export function tradeScopeLabel(value: string | null | undefined) {
  return TRADE_SCOPE_OPTIONS.find((option) => option.value === value)?.label ?? null;
}
