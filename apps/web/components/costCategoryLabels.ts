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
 *
 * THE TABLE ITSELF MOVED to `@/lib/cost-category` on 2026-09-26 and this
 * file re-exports it. It was one of FOUR hand-written copies of the enum,
 * and it was the only guarded one — the other three drifted, which is how a
 * fifth value reached the bid recap as an unknown key and produced a NaN bid
 * total. Nothing importing from here has to change; there is simply only one
 * list now, and the guard below covers it for everybody.
 */

export {
  COST_CATEGORY_LABEL,
  COST_CATEGORY_VALUES as COST_CATEGORY_ORDER,
  costCategoryLabel,
  type CostCategory,
} from "@/lib/cost-category";




