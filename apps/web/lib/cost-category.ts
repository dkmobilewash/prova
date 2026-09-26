/**
 * THE cost categories. One list, because three of them produced a NaN bid
 * total.
 *
 * `CostCategory` is a Prisma enum, and until now three separate files each
 * kept their own hand-written union over it:
 *
 *   components/costCategoryLabels.ts   guarded — its test reads jobs.prisma
 *   lib/bid-recap.ts                   not guarded
 *   lib/actions/bidRecap.ts:84         not guarded, and not even exported
 *
 * Only the first would have failed when the enum grew. The consequence was
 * measured rather than argued, by adding a fifth value and running the real
 * function — a probe at the time, and `EQUIPMENT` below is that fifth value
 * arriving for real one commit later:
 *
 *   byCategory: {"MATERIAL":1200,…,"EQUIPMENT":null}
 *   total: NaN
 *
 * `directCostByCategory` initialises one accumulator per KNOWN category and
 * does `byCategory[line.costCategory] += extended`. An unknown key is
 * `undefined`, `undefined + 2500` is NaN, and that NaN flows into markup,
 * sales tax and the bid total — a $3,700 direct cost rendering as blank on
 * a document somebody prices work from.
 *
 * WHAT MADE IT INVISIBLE was not the missing guard, it was the cast.
 * `lib/actions/bidRecap.ts` read a row and wrote
 * `row.costCategory as CostCategoryValue | null`, which is an assertion
 * that the database only ever holds values this file knows — exactly the
 * claim that stops being true the moment the enum grows. TypeScript had the
 * information and was told to ignore it.
 *
 * So: one list here, everything else imports it, and `asCostCategory`
 * replaces the cast. It NARROWS instead of asserting — an unrecognised
 * value comes back null and is handled as uncategorised, which is a
 * visible "nobody has coded this line" rather than a silent NaN.
 *
 * `costCategoryLabels.test.ts` checks THIS file against the schema, so
 * adding a value to `jobs.prisma` and nothing else fails the build in one
 * place instead of passing in two and breaking a bid in the third.
 */

export type CostCategory = "LABOR" | "MATERIAL" | "SUBCONTRACTOR" | "EQUIPMENT" | "OTHER";

/**
 * Every value, in the order a picker offers them: commonest first, `OTHER`
 * last because it is the fallback. The order is a UI decision and
 * deliberately does not live in the schema.
 */
export const COST_CATEGORY_VALUES: readonly CostCategory[] = [
  "LABOR",
  "MATERIAL",
  "SUBCONTRACTOR",
  "EQUIPMENT",
  "OTHER",
];

/** Short, for a table cell or a chip beside a logged cost. */
export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  LABOR: "Labor",
  MATERIAL: "Material",
  SUBCONTRACTOR: "Sub",
  EQUIPMENT: "Equipment",
  OTHER: "Other",
};

/** Full, for a form label or a recap line where there is room to say it. */
export const COST_CATEGORY_LONG_LABEL: Record<CostCategory, string> = {
  LABOR: "Labor",
  MATERIAL: "Material",
  SUBCONTRACTOR: "Subcontractor",
  EQUIPMENT: "Equipment",
  OTHER: "Other",
};

/**
 * A database string, narrowed — or null when this build has never heard of
 * it.
 *
 * THE POINT OF THIS FUNCTION IS THAT IT CAN RETURN NULL. A cast cannot,
 * which is why one produced a NaN bid total. A caller that gets null must
 * treat the line as uncategorised, which every caller here already knows
 * how to do and already shows on screen.
 */
export function asCostCategory(value: unknown): CostCategory | null {
  return typeof value === "string" && (COST_CATEGORY_VALUES as readonly string[]).includes(value)
    ? (value as CostCategory)
    : null;
}

/**
 * The label for a category that came out of the database.
 *
 * Falls back to the RAW value rather than to "Other" or to an empty
 * string. A value this table has never heard of means the enum grew and
 * this file did not, and the raw token is the honest version of that — ugly
 * exactly where somebody will see it and fix it, where "Other" would
 * quietly mis-file a cost and an empty string would lose it.
 */
export function costCategoryLabel(value: string): string {
  return COST_CATEGORY_LABEL[value as CostCategory] ?? value;
}

/**
 * The date `EQUIPMENT` started existing, and the sentence the screen owes
 * anyone reading an equipment figure.
 *
 * WHY THIS IS A CONSTANT RATHER THAN PROSE IN A COMPONENT. Equipment was
 * booked under `OTHER` from the day the enum was written until 2026-09-26,
 * and nothing in the data says which `OTHER` rows were equipment — so there
 * is no backfill, and a backfill guessed from descriptions would invent cost
 * attribution on real jobs. The consequence is permanent and one-directional:
 * an equipment total is complete for work categorised from here on and
 * understated for everything entered before, and an `OTHER` total is
 * correspondingly overstated.
 *
 * A number that is understated for a reason nobody can see reads exactly like
 * a number that is wrong. So whatever shows an equipment figure says this,
 * and it lives here so the wording cannot drift from the migration that
 * caused it.
 */
export const EQUIPMENT_SPLIT_ON = "2026-09-26";

export const EQUIPMENT_SPLIT_NOTE =
  "Equipment became its own category on 2026-09-26. Lines entered before that " +
  "were booked under Other and were not reclassified, so equipment is complete " +
  "going forward and understated for earlier work.";
