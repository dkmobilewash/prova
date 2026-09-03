/**
 * What material is on order against a scope line, and whether it is late.
 *
 * THE GAP THIS CLOSES, AND THE ONE IT DELIBERATELY DOES NOT
 *
 * The competitor research names "no committed cost" as the reason actuals
 * have to be typed in by hand. That is half right for this product. The
 * other half is that a costing row today cannot say anything at all about
 * material already ordered — so a line reading "$0 actual" looks identical
 * whether nothing has been bought or three orders are sitting at the vendor.
 * That is a real hole and it needs no money to fill.
 *
 * COMMITTED COST IS NOT COMPUTED HERE, ON PURPOSE AND BY AGREEMENT.
 *
 * `MaterialOrder.lineItemId` carries this instruction in the schema:
 *
 *   "ATTRIBUTION ONLY — nullable, and nothing may ever sum money through
 *    it. Material cost lives on CostEntry against the same JobLineItem;
 *    this exists so a late delivery can be tied to the scope it holds up,
 *    not so an order can become a second source of line-item cost.
 *    Agreed with Diego 2026-08-28 on exactly those terms."
 *
 * And the model has no money on it to sum even if that were allowed — no
 * amount, no unit cost, nothing. So this counts orders and reads dates. It
 * reports PRESSURE, not dollars.
 *
 * The research agrees with the agreement, which is the part worth noticing.
 * Finding 02's complaint about Buildertrend is that its budget-vs-actual
 * shows "expenses plus committed POs" — a committed figure folded into
 * actuals is the failure, not the fix. Whatever this eventually gains, a
 * commitment must never be added to a cost.
 *
 * Pure and argument-taking, like wip.ts and retainage.ts beside it.
 */

export type CommitmentOrder = {
  orderId: string;
  /** Null when the order was logged against the job but no scope line. */
  lineItemId: string | null;
  number: number;
  vendorName: string;
  description: string;
  promisedFor: Date | null;
  /**
   * Whether any delivery on this order was marked as completing it.
   *
   * Partial deliveries do NOT close an order — a load of board arriving
   * short is the case this whole feature exists to surface, and treating
   * the first truck as the end of it would hide exactly that.
   */
  completed: boolean;
};

export type LineCommitments = {
  openCount: number;
  /** Open orders past their promised date, as of the day being rendered. */
  overdueCount: number;
  /** The soonest promise still outstanding, for a row that wants one date. */
  nextPromisedFor: Date | null;
  vendors: string[];
};

/**
 * Is this order still outstanding as of `today`?
 *
 * An order with no promised date is open but never overdue. Guessing a
 * date would manufacture a late delivery out of missing data, and this
 * codebase's rule everywhere else is to say "unknown" rather than invent —
 * see the job-health copy that refuses to forecast under 80% coverage.
 */
export function isOverdue(order: CommitmentOrder, today: Date): boolean {
  if (order.completed) return false;
  if (order.promisedFor === null) return false;
  return order.promisedFor.getTime() < today.getTime();
}

/**
 * Groups open orders by the scope line they were attributed to.
 *
 * Orders with no `lineItemId` are dropped rather than pooled under a
 * pseudo-line: they belong to the job, and a costing ROW that claimed them
 * would be attributing material to scope nobody attributed it to. The job
 * total below counts them.
 */
export function commitmentsByLineItem(
  orders: CommitmentOrder[],
  today: Date,
): Map<string, LineCommitments> {
  const byLine = new Map<string, LineCommitments>();

  for (const order of orders) {
    if (order.completed || order.lineItemId === null) continue;

    const existing = byLine.get(order.lineItemId) ?? {
      openCount: 0,
      overdueCount: 0,
      nextPromisedFor: null,
      vendors: [],
    };

    existing.openCount += 1;
    if (isOverdue(order, today)) existing.overdueCount += 1;
    if (
      order.promisedFor !== null &&
      (existing.nextPromisedFor === null ||
        order.promisedFor.getTime() < existing.nextPromisedFor.getTime())
    ) {
      existing.nextPromisedFor = order.promisedFor;
    }
    if (!existing.vendors.includes(order.vendorName)) {
      existing.vendors.push(order.vendorName);
    }

    byLine.set(order.lineItemId, existing);
  }

  return byLine;
}

/** Every open order on the job, attributed to a line or not. */
export function jobCommitmentSummary(
  orders: CommitmentOrder[],
  today: Date,
): { openCount: number; overdueCount: number; unattributedCount: number } {
  const open = orders.filter((order) => !order.completed);
  return {
    openCount: open.length,
    overdueCount: open.filter((order) => isOverdue(order, today)).length,
    // Worth its own number rather than being folded in: an order nobody
    // attributed to a scope line is invisible on every costing row, and the
    // only place a person can find out is a total that says so.
    unattributedCount: open.filter((order) => order.lineItemId === null).length,
  };
}

/**
 * One short phrase for a costing row. Null when there is nothing to say —
 * a row with no orders should render nothing rather than "0 orders", which
 * is noise on every line of a job that buys no material.
 */
export function commitmentLabel(commitments: LineCommitments | undefined): string | null {
  if (!commitments || commitments.openCount === 0) return null;
  const orders = `${commitments.openCount} order${commitments.openCount === 1 ? "" : "s"} open`;
  if (commitments.overdueCount > 0) {
    return `${orders} · ${commitments.overdueCount} overdue`;
  }
  if (commitments.nextPromisedFor) {
    return `${orders} · due ${commitments.nextPromisedFor.toISOString().slice(0, 10)}`;
  }
  return `${orders} · no promised date`;
}
