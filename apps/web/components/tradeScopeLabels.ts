/** Display labels for the TradeScope enum. Extracted so the vendors pages
 * and any future trade-tagged surface share one list instead of each
 * copying the labels inline. */
export const TRADE_SCOPE_LABELS = [
  { value: "METAL_FRAMING_DRYWALL", label: "Metal framing / drywall" },
  { value: "LATH_PLASTER", label: "Lath & plaster" },
  { value: "EIFS", label: "EIFS" },
  { value: "ACOUSTICAL_CEILINGS", label: "Acoustical ceilings" },
  { value: "FIREPROOFING", label: "Fireproofing" },
] as const;

export function tradeScopeLabel(value: string | null): string | null {
  return TRADE_SCOPE_LABELS.find((t) => t.value === value)?.label ?? null;
}
