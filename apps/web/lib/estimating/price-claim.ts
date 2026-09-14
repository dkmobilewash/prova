/**
 * Did this edit move the line's price?
 *
 * The two sides are written differently and must still compare as one
 * number: the row holds a `Prisma.Decimal` and the form sends the digits
 * the person typed (`nullableDecimalFromForm` returns the trimmed string,
 * or null for an empty field). "3.250" and Decimal(3.25) are the same
 * price, and a comparison that called them different would retire a
 * machine's price claim on every save — including the saves that never
 * touched the price.
 *
 * Not stored anywhere, and deliberately so: this is the question asked at
 * the moment of the edit, not a flag about the row.
 */
export function priceChanged(stored: unknown, submitted: string | null): boolean {
  return asPrice(stored) !== asPrice(submitted);
}

/** Null for "no price", a number otherwise. Anything unreadable is treated
 * as no price rather than as a number nobody can see — the form has
 * already refused a non-numeric string by here, so this is the Decimal's
 * side of the comparison being defensive, not a second validator. */
function asPrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value.trim() : String(value);
  if (!text) return null;
  const numeric = Number(text);
  return Number.isNaN(numeric) ? null : numeric;
}
