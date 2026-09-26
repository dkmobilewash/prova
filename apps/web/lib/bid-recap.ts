/**
 * The bid recap: direct cost in, the number a GC is asked to pay out.
 *
 * A bid is direct cost plus markup on each kind of cost, plus escalation, sales
 * tax on the material, overhead, profit, the bond premium and contingency. Every
 * estimating product in the market has this layer; this app had none of it, so
 * the total on the estimate screen was a number somebody had to mark up in
 * their head.
 *
 * THE DIRECT COST IS `budgetedUnitCost`, AND THIS FILE SAID `unitPrice` FOR
 * THREE WEEKS. Issue #512. The sentence here used to read "a job's line items
 * are its DIRECT cost — what the work costs to do", and `lineExtended` was
 * `quantity × unitPrice`. But `jobs.prisma` calls that column the
 * "client-facing SALE PRICE" whose null means "$0 REVENUE", and nine other
 * surfaces read it that way — `wip.ts`'s `contractValue`, pay applications,
 * retainage, change-order value, the proposal, the e-sign documents and the GC
 * portal. One file read it as cost; nine read it as revenue.
 *
 * So a catalog line carrying `defaultUnitPrice 2.85` and
 * `defaultBudgetedUnitCost 1.90` was marked up FROM 2.85 — around $3.97/SF on
 * work that costs $1.90, a second margin stacked on the one the price already
 * carried. Every catalog-sourced, wall-schedule and AI-drafted line was affected,
 * because those writers fill `unitPrice` from the catalog's PRICE.
 *
 * Fixed by making the column mean one thing: `unitPrice` is the sale price, and
 * the cost this file marks up is `budgetedUnitCost`. `RecapLine.unitCost` is a
 * REQUIRED property for that reason — it makes a caller that still passes only a
 * price a typecheck failure rather than a silently wrong bid.
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
 * reported in `uncategorised` and carried into the bid at its direct cost. The
 * alternative — quietly marking it up at some default — is how a bid grows a
 * number nobody chose. Same rule as `unpricedLaborHours` in lib/wip.ts: the
 * thing that cannot be computed is named on screen instead of invented.
 *
 * A LINE WITH A PRICE AND NO COST IS THE SAME RULE, ONE STEP FURTHER, and it is
 * the case #512 turned from theoretical into common. It is counted in
 * `pricedWithNoCost`, left out of the cost base, and marked up at nothing —
 * never filled in from `unitPrice`, which would be the old double-markup
 * preserved for exactly the lines most likely to hit it. There is a real
 * population: the bid wizard's add-a-line form collects no cost at all, an
 * AI-drafted line falls back to the model's price with no cost, and a
 * QuickBooks service item routinely carries a sales price and none.
 *
 * So a job whose lines carry prices and no costs reads as $0 direct cost, with
 * every such line named on screen. That is the honest answer — you cannot mark
 * up a cost nobody recorded — and it is deliberately not softened by a
 * backfill, which would write a 0%-margin cost figure nobody typed.
 */

import {
  asCostCategory,
  COST_CATEGORY_VALUES as CANONICAL_COST_CATEGORY_VALUES,
  COST_CATEGORY_LONG_LABEL,
  type CostCategory,
} from "@/lib/cost-category";

/**
 * The second hand-written copy of the enum lived here, with its own labels —
 * and its `OTHER` label read "Other / equipment", which is what a missing
 * category looks like from inside the code that has to price it. All three are
 * aliases of the one list now; the names stay so no caller changes.
 */
export type CostCategoryValue = CostCategory;

export const COST_CATEGORY_VALUES = CANONICAL_COST_CATEGORY_VALUES;

export const COST_CATEGORY_LABELS = COST_CATEGORY_LONG_LABEL;

/** One estimate line, as the recap needs to read it. */
export type RecapLine = {
  id: string;
  quantity: number;
  /**
   * `JobLineItem.budgetedUnitCost` — the DIRECT COST per unit, and the only
   * figure this module marks up.
   *
   * REQUIRED, not optional, and that is the point (#512). An optional field
   * would let a caller keep passing a price alone and get a plausible, wrong
   * bid; a required one makes every such call site a typecheck failure. Four
   * call sites had to be found, one of them in another lane, and nothing but
   * the type would have found them all.
   *
   * Null is a real state, not an omission: no cost was recorded. A line with a
   * price and a null cost lands in `pricedWithNoCost` and is marked up at
   * nothing.
   */
  unitCost: number | null;
  /**
   * `JobLineItem.unitPrice` — the CLIENT-FACING SALE PRICE, as `jobs.prisma`
   * says. Never marked up and never part of the cost base. It is here for two
   * jobs only: reporting a line that carries a price but no cost, and telling
   * `spreadToLines` which lines are billable at all.
   *
   * Null on a cost-only line (general conditions, overhead, contingency) —
   * $0 revenue, the same rule `contractValue` uses. Such a line DOES carry
   * direct cost into the bid and receives no share of the spread back, because
   * general conditions are recovered through the billable lines.
   */
  unitPrice: number | null;
  costCategory: CostCategoryValue | null;
};

/**
 * Which rate marks up each cost type, what the step is called, and the order
 * the steps are listed in.
 *
 * A TOTAL `Record` over `CostCategoryValue`, and that is the entire point of
 * its shape. This was a four-element array literal, and an array cannot be
 * INCOMPLETE — a category missing from it is marked up at nothing, which
 * understates the bid by the whole markup with no error, no warning and no
 * failing test anywhere. A `Record` over the union does not compile until
 * every category has a rate, so the next value added to the enum stops the
 * build here instead of quietly shipping a low bid.
 *
 * DECLARATION ORDER IS DISPLAY ORDER, and MATERIAL stays first: the sales-tax
 * step downstream needs material's MARKED-UP figure, and `bid-recap.test.ts`
 * pins each step's running total in sequence. Key order is insertion order for
 * non-numeric string keys under ES2015+, so this one list is both the set and
 * the order — there is no second array to fall out of step with the first.
 */
const MARKUP: Record<CostCategoryValue, { label: string; rate: keyof RecapRates }> = {
  MATERIAL: { label: "Material markup", rate: "materialMarkupPercent" },
  LABOR: { label: "Labor markup", rate: "laborMarkupPercent" },
  SUBCONTRACTOR: { label: "Subcontractor markup", rate: "subcontractorMarkupPercent" },
  EQUIPMENT: { label: "Equipment markup", rate: "equipmentMarkupPercent" },
  OTHER: { label: "Other markup", rate: "otherMarkupPercent" },
};

/** Every rate, all optional. Percentages, 0-100 — never fractions of one. */
export type RecapRates = {
  materialMarkupPercent?: number | null;
  laborMarkupPercent?: number | null;
  subcontractorMarkupPercent?: number | null;
  equipmentMarkupPercent?: number | null;
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
  /**
   * Lines carrying a sale price but NO recorded cost, and what those prices
   * come to. Not in `total`, not marked up, and counted so the screen can name
   * them — the same shape as `uncategorised` above and for the same reason.
   *
   * This is a PRICE total, not a cost one. It is the only figure in `DirectCost`
   * that is, and it is labelled on screen as such: its job is to say "there is
   * $X of scope here that this bid's cost base does not include", which is the
   * one sentence that stops those lines vanishing quietly.
   */
  pricedWithNoCost: number;
  pricedWithNoCostLineCount: number;
  total: number;
};

/**
 * The line's direct cost. `quantity × unitCost`, and 0 when no cost is
 * recorded.
 *
 * NAMED `extendedCost` RATHER THAN `lineExtended` ON PURPOSE. The old name said
 * only "extended" and was read as cost by this file and as price by nine
 * others, which is #512 in one identifier. Two functions with the units in
 * their names cannot be confused the same way. Free to rename — nothing outside
 * this file ever imported it.
 */
export function extendedCost(line: RecapLine): number {
  return line.unitCost == null ? 0 : line.quantity * line.unitCost;
}

/** The line's sale value. `quantity × unitPrice`, and 0 when unpriced. Never
 * marked up; used for reporting and for what the spread really lands at. */
export function extendedPrice(line: RecapLine): number {
  return line.unitPrice == null ? 0 : line.quantity * line.unitPrice;
}

export function directCostByCategory(lines: readonly RecapLine[]): DirectCost {
  // DERIVED from the canonical list, not written out. As a literal this was
  // `Record<CostCategoryValue, number>`, so adding a value to the enum made it
  // a type error — which is a real guard, and it is still weaker than not being
  // able to be wrong. Every category starts at zero, always; there has never
  // been a decision to make here, only a list to keep in step. Built this way
  // it is in step by construction.
  const byCategory = Object.fromEntries(COST_CATEGORY_VALUES.map((category) => [category, 0])) as Record<
    CostCategoryValue,
    number
  >;
  let uncategorised = 0;
  let uncategorisedLineCount = 0;
  let pricedWithNoCost = 0;
  let pricedWithNoCostLineCount = 0;

  for (const line of lines) {
    const extended = extendedCost(line);

    // A price with no cost, counted and then left out of every bucket below.
    // Checked FIRST and reported independently of the cost type: such a line is
    // missing the figure this whole module marks up, and saying "it has no cost
    // type" about it would name the smaller of its two problems.
    if (line.unitCost == null && line.unitPrice != null) {
      pricedWithNoCostLineCount += 1;
      pricedWithNoCost += extendedPrice(line);
      continue;
    }

    if (line.costCategory == null) {
      // Counted even at $0 extended: a cost-only line with no type is still a
      // line nobody has coded, and the screen offers to code it.
      uncategorisedLineCount += 1;
      uncategorised += extended;
      continue;
    }
    // NARROWED AGAIN, HERE, even though every caller narrows at its own
    // boundary. This accumulator is what turned a fifth enum value into a NaN
    // bid total — `byCategory["EQUIPMENT"]` was undefined and `undefined +
    // 2500` is NaN, which then flowed into markup, tax and the total. Callers
    // being careful is not a guarantee; this is. It also covers the Ask
    // handler, which builds recap lines in another lane.
    //
    // An unknown category counts as UNCATEGORISED rather than being dropped:
    // the screen already offers to code an uncategorised line, so the money
    // stays visible and somebody can act on it. Dropping it would understate
    // the bid silently, which is the same failure wearing a tidier number.
    const known = asCostCategory(line.costCategory);
    if (known === null) {
      uncategorisedLineCount += 1;
      uncategorised += extended;
      continue;
    }
    byCategory[known] += extended;
  }

  // `pricedWithNoCost` is deliberately NOT in this sum. It is a price total, and
  // adding it would put revenue into the cost base — the exact confusion #512
  // is about, reintroduced one line below the fix.
  const total = uncategorised + Object.values(byCategory).reduce((sum, value) => sum + value, 0);
  return {
    byCategory,
    uncategorised,
    uncategorisedLineCount,
    pricedWithNoCost,
    pricedWithNoCostLineCount,
    total,
  };
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
 *   1. MARKUP PER COST TYPE — every category in `MARKUP` above is sold at its
 *      own rate. This is the layer that needs a cost type on the line, and the
 *      reason JobLineItem grew one. Named there rather than listed here, so a
 *      new category does not leave this sentence quietly wrong.
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
  const markups = (Object.keys(MARKUP) as CostCategoryValue[]).map(
    (category) =>
      [category, MARKUP[category].label, rate(rates[MARKUP[category].rate])] as [
        CostCategoryValue,
        string,
        number,
      ],
  );
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
  // A recipient must be BILLABLE (it carries a price, so raising that price is
  // meaningful) and must carry COST (so it has a share of the bid to receive).
  //
  // Both halves matter and they exclude different lines. A cost-only general
  // conditions line has cost and no price: it belongs in the cost base and gets
  // no share back, because general conditions are recovered through the billable
  // lines. A price-with-no-cost line is the reverse, and excluding it is what
  // stops the destructive case — with no cost share it would receive $0, and
  // writing that back as its unit price would WIPE a price somebody set.
  const priced = lines.filter(
    (line) => line.unitPrice != null && line.quantity > 0 && extendedCost(line) > 0,
  );
  const directTotal = priced.reduce((sum, line) => sum + extendedCost(line), 0);
  if (priced.length === 0 || directTotal <= 0) return [];

  const targetCents = Math.round(bidTotal * 100);
  const shares = priced.map((line) => {
    const exact = (extendedCost(line) / directTotal) * targetCents;
    return { line, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });

  let assigned = shares.reduce((sum, share) => sum + share.floor, 0);
  // Largest remainder first, so the cents go where they are most owed.
  const order = [...shares].sort((a, b) => b.remainder - a.remainder || extendedCost(b.line) - extendedCost(a.line));
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
      // A line the spread did not pay keeps the price it already had, so what it
      // contributes is its PRICE. This read `lineExtended` before #512, which
      // then meant quantity × unitPrice and was accidentally right; under the
      // corrected meaning the same call would have returned that line's COST and
      // quietly understated what Apply produces.
      //
      // It matters most on exactly the job that needs it: a price-with-no-cost
      // line is not in the spread, so this is where its price is accounted for.
      // That makes the gap between the bid and the real line total visible
      // through the figure the panel already shows whenever the two differ — no
      // second warning to build and no third number to keep in step.
      if (!next) return sum + extendedPrice(line);
      return sum + Number(next.unitPrice) * line.quantity;
    }, 0),
  );
}
