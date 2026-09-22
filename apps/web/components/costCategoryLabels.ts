/**
 * What a `CostCategory` is called on screen.
 *
 * The four values were rendered RAW — a picker offering "LABOR",
 * "MATERIAL", "SUBCONTRACTOR", "OTHER", and then "(SUBCONTRACTOR)" printed
 * beside every logged cost on the Estimate tab. SCREAMING_SNAKE_CASE is a
 * database value, not a word anybody says, and this is a control a
 * contractor uses every time he logs a cost. Every other picker in this
 * app already has a `{ value, label }` table (`TRADE_SCOPE_OPTIONS` four
 * lines below the offending one, `INSURANCE_POLICY_TYPE_OPTIONS` in
 * settings); this enum never got one.
 *
 * A `Record` keyed on the union rather than an array of pairs, so a value
 * added to the Prisma enum without a label here is a TYPE ERROR at build
 * time rather than a raw token appearing on a screen. `COST_CATEGORY_ORDER`
 * carries the order the picker offers them in — the order is a UI decision
 * and does not belong in the schema.
 *
 * `costCategoryLabels.test.ts` asserts this table is exhaustive over the
 * enum as the SCHEMA FILE declares it, not as this file declares it: a
 * table checked against itself would pass on any pair of matching
 * mistakes.
 */

export type CostCategory = "LABOR" | "MATERIAL" | "SUBCONTRACTOR" | "OTHER";

export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  LABOR: "Labor",
  MATERIAL: "Material",
  SUBCONTRACTOR: "Sub",
  OTHER: "Other",
};

/** Commonest first, so the pick a contractor makes most often is nearest
 * the top of an open select. "Other" stays last: it is the fallback. */
export const COST_CATEGORY_ORDER: readonly CostCategory[] = [
  "LABOR",
  "MATERIAL",
  "SUBCONTRACTOR",
  "OTHER",
];

/**
 * The label for a category that came out of the database, which is a plain
 * string as far as the caller's types are concerned.
 *
 * Falls back to the raw value rather than to "Other" or to an empty string.
 * A value this table has never heard of means the enum grew and this file
 * did not, and showing the raw token is the honest version of that — it is
 * ugly exactly where someone will see it and fix it, where "Other" would
 * quietly mis-file a cost and an empty string would lose it.
 */
export function costCategoryLabel(value: string): string {
  return COST_CATEGORY_LABEL[value as CostCategory] ?? value;
}
