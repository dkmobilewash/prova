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
 *
 * That sentence was right and only half-applied. `TRADE_SCOPES` — the bare
 * value list below — stayed in `lib/actions/shared.ts` until 2026-09-21, and
 * `components/ChangeOrders.tsx` ("use client") and `lib/catalog-import.ts`
 * imported it from there. The bundler did what it was told and shipped
 * PrismaClient to the browser on six routes; evaluating it throws
 * "PrismaClient is unable to run in this browser environment" and the error
 * boundary renders "This page didn't load". `shared.ts` re-exports the list
 * from here now, so every server caller is unchanged, and
 * `client-prisma-boundary.test.ts` fails the build if a client module reaches
 * prisma again by any route.
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

/**
 * The same five scopes as bare values, for validation and for the places that
 * only need the enum. DERIVED from the list above rather than written out a
 * second time — a second copy is the exact drift the docstring above is
 * about, and it would be the copy nobody updates.
 */
export const TRADE_SCOPES = TRADE_SCOPE_OPTIONS.map((option) => option.value);
