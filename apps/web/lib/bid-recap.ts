/**
 * The bid recap: direct cost in, the number a GC is asked to pay out.
 *
 * A job's line items are its DIRECT cost — what the work costs to do. A bid is
 * that plus markup on each kind of cost, plus escalation, sales tax on the
 * material, overhead, profit, the bond premium and contingency. Every
 * estimating product in the market has this layer; this app had none of it, so
 * the total on the estimate screen was a number somebody had to mark up in
 * their head.
 *
 * Pure and argument-taking, like lib/takeoff.ts and lib/wip.ts. No database, no
 * rounding surprises hidden in a query: the arithmetic a bid rests on can be
 * checked without one.
 *
 * NOTHING IS GUESSED, AND A BLANK RATE IS NOT A ZERO-BY-ACCIDENT. Every rate is
 * optional and an absent one contributes nothing, which is the same thing a 0
 * would do — but the caller can tell them apart, so the screen can say "this
 * bid carries no overhead" rather than implying somebody typed a zero.
 *
 * AN UNCATEGORISED LINE IS NEVER MARKED UP. A line with no cost type is
 * reported in `uncategorised` and carried into the bid at its direct price. The
 * alternative — quietly marking it up at some default — is how a bid grows a
 * number nobody chose. Same rule as `unpricedLaborHours` in lib/wip.ts: the
 * thing that cannot be computed is named on screen instead of invented.
 */

export type CostCategoryValue = "LABOR" | "MATERIAL" | "SUBCONTRACTOR" | "OTHER";

export const COST_CATEGORY_VALUES: readonly CostCategoryValue[] = [
  "MATERIAL",
  "LABOR",
  "SUBCONTRACTOR",
  "OTHER",
];

export const COST_CATEGORY_LABELS: Record<CostCategoryValue, string> = {
  MATERIAL: "Material",
  LABOR: "Labor",
  SUBCONTRACTOR: "Subcontractor",
  // Equipment has no member of its own yet and belongs here — said on screen,
  // not just in this comment.
  OTHER: "Other / equipment",
};

/** One estimate line, as the recap needs to read it. */
export type RecapLine = {
  id: string;
  quantity: number;
  /** Null on a cost-only line (general conditions, overhead, contingency),
   * which contributes $0 — the same rule `contractValue` uses. */
  unitPrice: number | null;
  costCategory: CostCategoryValue | null;
};

/** Every rate, all optional. Percentages, 0-100 — never fractions of one. */
export type RecapRates = {
  materialMarkupPercent?: number | null;
  laborMarkupPercent?: number | null;
  subcontractorMarkupPercent?: number | null;
  otherMarkupPercent?: number | null;
  escalationPercent?: number | null;
  materialTaxPercent?: number | null;
  overheadPercent?: number | null;
  profitPercent?: number | null;
  bondPercent?: number | null;
  contingencyPercent?: number | null;
};

export type DirectCost = {
  byCategory: Record<CostCategoryValue, number>;
  /** Lines carrying no cost type, and their total. Marked up at nothing. */
  uncategorised: number;
  uncategorisedLineCount: number;
  total: number;
};

export function lineExtended(line: RecapLine): number {
  return line.unitPrice == null ? 0 : line.quantity * line.unitPrice;
}

export function directCostByCategory(lines: readonly RecapLine[]): DirectCost {
  const byCategory: Record<CostCategoryValue, number> = { MATERIAL: 0, LABOR: 0, SUBCONTRACTOR: 0, OTHER: 0 };
  let uncategorised = 0;
  let uncategorisedLineCount = 0;

  for (const line of lines) {
    const extended = lineExtended(line);
    if (line.costCategory == null) {
      // Counted even at $0 extended: a cost-only line with no type is still a
      // line nobody has coded, and the screen offers to code it.
      uncategorisedLineCount += 1;
      uncategorised += extended;
      continue;
    }
    byCategory[line.costCategory] += extended;
  }

  const total = uncategorised + Object.values(byCategory).reduce((sum, value) => sum + value, 0);
  return { byCategory, uncategorised, uncategorisedLineCount, total };
}

/** One row of the recap as it prints: what it is, the rate it used, and the
 * money it added. `amount` is the ADDITION, `runningTotal` the sum after it. */
export type RecapStep = {
  key: string;
  label: string;
  /** Null when the step is a subtotal rather than a rate. */
  ratePercent: number | null;
  amount: number;
  runningTotal: number;
};

export type BidRecap = {
  direct: DirectCost;
  steps: RecapStep[];
  /** What the GC is asked to pay. */
  bidTotal: number;
  /** bidTotal − direct.total, i.e. everything this layer added. */
  addedTotal: number;
};

const rate = (value: number | null | undefined): number => (value == null || !Number.isFinite(value) ? 0 : value);
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * THE ORDER BELOW IS THE DECISION, and it is the one thing in this file that
 * cannot be read off the arithmetic. It follows the convention estimating
 * software has used for decades (On-Screen Takeoff / Quick Bid's Section
 * Markups is the reference):
 *
 *   1. MARKUP PER COST TYPE — material, labor, subcontractor and other are
 *      sold at their own rates. This is the layer that needs a cost type on
 *      the line, and the reason JobLineItem grew one.
 *   2. ESCALATION — on the marked-up cost, because it escalates the price of
 *      the work rather than its raw cost. A long job priced today and built
 *      next year.
 *   3. SALES TAX — on the MATERIAL portion only, after its markup, because tax
 *      is charged on what the material is sold at. Labor is not taxed here.
 *   4. OVERHEAD — on everything so far. Overhead is part of the cost base.
 *   5. PROFIT — on the total INCLUDING overhead. That is deliberate and is the
 *      difference between profit-on-cost and profit-on-everything: a profit
 *      computed before overhead silently earns less than the rate says.
 *   6. BOND — on the taxed, marked-up, overheaded, profited sum, because a
 *      surety bonds the contract amount, not the cost.
 *   7. CONTINGENCY — last, on the whole bid.
 *
 * Reordering any two of these changes the bid, so the order is asserted in
 * bid-recap.test.ts against worked figures rather than left to reading.
 */
export function bidRecap(lines: readonly RecapLine[], rates: RecapRates): BidRecap {
  const direct = directCostByCategory(lines);
  const steps: RecapStep[] = [];
  let running = direct.total;

  const add = (key: string, label: string, ratePercent: number | null, amount: number) => {
    const rounded = round2(amount);
    // A step that adds nothing is not a row. An "8% sales tax — $0.00" line on
    // a job with no material tells a reader nothing they did not know.
    if (rounded === 0) return;
    running = round2(running + rounded);
    steps.push({ key, label, ratePercent, amount: rounded, runningTotal: running });
  };

  // 1. Markup per cost type. Tracked separately for the material figure, which
  //    the tax step below needs AFTER its markup.
  const markups: [CostCategoryValue, string, number][] = [
    ["MATERIAL", "Material markup", rate(rates.materialMarkupPercent)],
    ["LABOR", "Labor markup", rate(rates.laborMarkupPercent)],
    ["SUBCONTRACTOR", "Subcontractor markup", rate(rates.subcontractorMarkupPercent)],
    ["OTHER", "Other markup", rate(rates.otherMarkupPercent)],
  ];
  let materialSold = direct.byCategory.MATERIAL;
  for (const [category, label, percent] of markups) {
    const base = direct.byCategory[category];
    const amount = (base * percent) / 100;
    if (category === "MATERIAL") materialSold = base + amount;
    if (base === 0 && amount === 0) continue;
    add(`markup:${category}`, label, percent, amount);
  }

  // 2. Escalation, on everything so far.
  const escalation = rate(rates.escalationPercent);
  const escalationAmount = (running * escalation) / 100;
  add("escalation", "Escalation", escalation, escalationAmount);
  // Escalating the material escalates the base the tax is charged on with it.
  materialSold = materialSold * (1 + escalation / 100);

  // 3. Sales tax — MATERIAL only, at what the material is sold for.
  const tax = rate(rates.materialTaxPercent);
  add("materialTax", "Sales tax on material", tax, (materialSold * tax) / 100);

  // 4. Overhead, then 5. profit ON TOP OF overhead.
  const overhead = rate(rates.overheadPercent);
  add("overhead", "Overhead", overhead, (running * overhead) / 100);
  const profit = rate(rates.profitPercent);
  add("profit", "Profit", profit, (running * profit) / 100);

  // 6. Bond on the contract amount, then 7. contingency on the whole bid.
  const bond = rate(rates.bondPercent);
  add("bond", "Bond premium", bond, (running * bond) / 100);
  const contingency = rate(rates.contingencyPercent);
  add("contingency", "Contingency", contingency, (running * contingency) / 100);

  const bidTotal = round2(running);
  return { direct, steps, bidTotal, addedTotal: round2(bidTotal - direct.total) };
}

export type SpreadLine = {
  id: string;
  /** The new unit price, as a 2-decimal string ready for a Decimal column. */
  unitPrice: string;
};

/**
 * Spreads a bid total back across the lines, pro-rata by extended price.
 *
 * WHY THE BID IS PUSHED INTO THE LINES AT ALL. `contractValue` in this app is
 * one number doing two jobs — what we bid and what the contract is worth — and
 * it is read by every invoice, retainage and WIP surface. After the GC accepts,
 * that number has to BE the bid, or every figure downstream is quietly short by
 * the markup. So applying the recap raises each line's unit price rather than
 * storing a second total beside the first.
 *
 * THE CENTS GO WHERE THEY ARE OWED — largest remainder first, the same rule
 * lib/fringe-remittance.ts uses so a trust-fund cheque reconciles. Three $1
 * lines splitting $100.00 come back as 33.33 / 33.33 / 33.34 rather than
 * $99.99.
 *
 * AND WHERE THEY CANNOT: a stored unit price holds two decimals, so on a line
 * of 1,000 units the smallest change to that line's total is TEN DOLLARS, not
 * one cent. An exact spread is therefore impossible in general, and claiming
 * one would be the kind of number that looks right and gets bid. What this
 * function guarantees is the closest unit price to each line's true share;
 * `spreadTotal` below reports what those prices ACTUALLY come to, and the
 * screen shows that figure beside the bid whenever the two differ, rather than
 * printing the bid and quietly writing something else.
 *
 * Lines with no price stay unpriced: a cost-only line is not a share of the
 * bid, and giving it one would make a general-conditions line look sold.
 */
export function spreadToLines(lines: readonly RecapLine[], bidTotal: number): SpreadLine[] {
  const priced = lines.filter((line) => line.unitPrice != null && line.quantity > 0 && lineExtended(line) > 0);
  const directTotal = priced.reduce((sum, line) => sum + lineExtended(line), 0);
  if (priced.length === 0 || directTotal <= 0) return [];

  const targetCents = Math.round(bidTotal * 100);
  const shares = priced.map((line) => {
    const exact = (lineExtended(line) / directTotal) * targetCents;
    return { line, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });

  let assigned = shares.reduce((sum, share) => sum + share.floor, 0);
  // Largest remainder first, so the cents go where they are most owed.
  const order = [...shares].sort((a, b) => b.remainder - a.remainder || lineExtended(b.line) - lineExtended(a.line));
  let index = 0;
  while (assigned < targetCents && order.length > 0) {
    order[index % order.length].floor += 1;
    assigned += 1;
    index += 1;
  }

  return shares.map(({ line, floor }) => ({
    id: line.id,
    // The line's TOTAL is what the spread decides; the unit price is that over
    // the quantity, which is the column the app actually stores.
    unitPrice: (floor / 100 / line.quantity).toFixed(2),
  }));
}

/** What `spreadToLines` will actually produce once the unit prices are rounded
 * to the cent — the figure to show beside "Apply", because a unit price with
 * more than two decimals cannot be stored and the total moves by the rounding. */
export function spreadTotal(lines: readonly RecapLine[], spread: readonly SpreadLine[]): number {
  const byId = new Map(spread.map((line) => [line.id, line]));
  return round2(
    lines.reduce((sum, line) => {
      const next = byId.get(line.id);
      if (!next) return sum + lineExtended(line);
      return sum + Number(next.unitPrice) * line.quantity;
    }, 0),
  );
}
