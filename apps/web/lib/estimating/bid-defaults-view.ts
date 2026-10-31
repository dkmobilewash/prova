import { RECAP_RATE_KEYS } from "@/lib/bid-recap";

/**
 * The company's standing markup, as the form shows it: every rate in
 * `RECAP_RATE_KEYS`, as the STRING that is stored (a Decimal column crossing
 * into a client component — strings, so the form shows exactly what is stored
 * and no float rounding happens on the way), or null for a rate never set.
 *
 * Moved out of `app/(app)/settings/page.tsx` unchanged so C Stream Bid's
 * settings page builds the same view from the same list. The list is the
 * shared one, not written again: a key missing here means a stored rate never
 * reaches the form, which looks exactly like a rate that failed to save.
 *
 * Null in, null out: no row at all is a company that has set nothing.
 */
export function bidDefaultsView(
  row: Partial<Record<(typeof RECAP_RATE_KEYS)[number], { toString(): string } | null>> | null,
): Record<string, string | null> | null {
  if (!row) return null;
  return Object.fromEntries(RECAP_RATE_KEYS.map((key) => [key, row[key]?.toString() ?? null]));
}
