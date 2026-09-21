/**
 * Hours, as a number a person reads: "35.3", "8", "7.5" — never
 * "35.300000000000004" and never "8.00".
 *
 * WHY THIS FILE EXISTS. `TimeEntry.hours` is `Decimal(5,2)`, and every
 * figure on a payroll or compliance screen is a floating-point SUM of many
 * of them. `7 + 7 + 7 + 7.1 + 7.2` is `35.300000000000004` in JavaScript,
 * and the certified-payroll page printed exactly that — on the one screen
 * whose whole purpose is to be believed by somebody who checks arithmetic
 * for a living, and who is filing it with a government agency.
 *
 * WHY TRAILING ZEROES GO. Hours are read as a QUANTITY, not as money: a
 * day is "8", not "8.00". That is the distinction `money()` does not make
 * and why hours do not just borrow it.
 *
 * WHY TWO DECIMALS AND NOT MORE. The column is `Decimal(5,2)`, so two
 * places is every place a stored value can have. Rounding to the column's
 * own precision cannot lose an entered figure — it can only remove digits
 * the sum invented.
 *
 * THIS IS THE ONLY IMPLEMENTATION, and `hoursRenderCensus.test.ts` fails
 * the build if a second one appears. There were three before this file:
 * `hoursCell` in the WH-347 page, a byte-identical `hoursCell` in the
 * union remittance page, and `formatLoggedHours` in `lib/wip.ts` (issue
 * #287, which is the same bug found and fixed once already in one place).
 * A fix at a call site protects that call site and nothing else — the same
 * reason `lib/render-date.ts` exists next door.
 */

/** Two decimal places at most, trailing zeroes dropped. */
export function formatHours(hours: number): string {
  // `Math.round(x * 100) / 100` rather than `Number(x.toFixed(2))`: both
  // of the implementations this replaced used one each and agreed on every
  // value hours can take, so this keeps the one that is already tested in
  // `wip.test.ts` against the original issue.
  return String(Math.round(hours * 100) / 100);
}

/**
 * The same, for a value that may legitimately be absent — an apprentice
 * with no required classroom hours on record, a WH-347 cell for a day
 * nobody worked.
 *
 * `empty` is the caller's, not a default, because the pages disagree for
 * good reasons: a WH-347 grid cell is BLANK (the form is printed and a
 * dash in a box a federal reviewer reads as a number is worse than
 * nothing), while an on-screen table uses an em dash so the column does
 * not look like it failed to load.
 */
export function formatHoursOrNull(hours: number | null | undefined, empty = ""): string {
  if (hours == null) return empty;
  return formatHours(hours);
}
