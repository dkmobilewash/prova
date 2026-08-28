import { Prisma } from "@prova/db";

/**
 * What a change order would do to the contract value, computed from its
 * proposals rather than stored anywhere.
 *
 * This is the number a PM needs before the GC has agreed to anything: "how
 * much are we asking for." It deliberately has no counterpart on the
 * ChangeOrder row. Storing it would create a second source of truth for
 * money that, once approved, lives on JobLineItem — and the two would drift
 * the first time anyone edited a proposal. Same rule as
 * lib/pay-application.ts deriving previous-period totals instead of storing
 * them.
 *
 * Once a change order is APPROVED its proposals have been written onto
 * JobLineItem, so the live contract value already includes them. At that
 * point this figure is history: what this change order added when it landed.
 */

const ZERO = new Prisma.Decimal(0);

/** A line item as much of it as this calculation needs. */
export type LineItemForChangeOrder = {
  id: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal | null;
  isDeleted: boolean;
};

export type ProposalForCalc = {
  changeType: "ADD" | "EDIT" | "REMOVE";
  lineItemId: string | null;
  quantity: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
};

/**
 * Revenue value of a line: quantity * unitPrice, with a null unitPrice
 * treated as $0 revenue. That is the same rule the contract summary and
 * invoicing totals use for a cost-only budget line (see JobLineItem.unitPrice
 * in the schema) — a line with no sale price still carries quantity and cost,
 * it just isn't billed.
 */
function lineValue(quantity: Prisma.Decimal | null, unitPrice: Prisma.Decimal | null) {
  if (!quantity || !unitPrice) return ZERO;
  return quantity.mul(unitPrice);
}

/**
 * The delta a single proposal would apply to contract value.
 *
 * EDIT is the subtle one: a proposal stores only the fields being changed,
 * so a null quantity means "leave quantity alone", not "quantity is zero".
 * Falling back to the line item's current value is what makes a
 * price-only change come out as a price-only delta.
 */
export function proposalValueDelta(
  proposal: ProposalForCalc,
  target: LineItemForChangeOrder | null,
): Prisma.Decimal {
  switch (proposal.changeType) {
    case "ADD":
      return lineValue(proposal.quantity, proposal.unitPrice);

    case "REMOVE":
      // Removing scope subtracts whatever that line is currently worth.
      if (!target) return ZERO;
      return lineValue(target.quantity, target.unitPrice).neg();

    case "EDIT": {
      if (!target) return ZERO;
      const before = lineValue(target.quantity, target.unitPrice);
      const after = lineValue(
        proposal.quantity ?? target.quantity,
        proposal.unitPrice ?? target.unitPrice,
      );
      return after.sub(before);
    }
  }
}

/**
 * Total contract-value delta of a change order — the sum of its proposals.
 *
 * `targets` maps line item id -> line item, for the EDIT/REMOVE proposals
 * that reference one. A proposal whose target is missing contributes zero
 * rather than throwing: this runs on a render path, and a half-rendered
 * change order log is worse than one row reading $0.
 */
export function changeOrderValueDelta(
  proposals: ProposalForCalc[],
  targets: Map<string, LineItemForChangeOrder>,
): Prisma.Decimal {
  return proposals.reduce(
    (sum, proposal) =>
      sum.add(
        proposalValueDelta(proposal, proposal.lineItemId ? targets.get(proposal.lineItemId) ?? null : null),
      ),
    ZERO,
  );
}

/** Statuses whose proposals have NOT been written to JobLineItem. */
export const PENDING_CHANGE_ORDER_STATUSES = ["DRAFT", "SUBMITTED"] as const;

/**
 * Pending change orders, by value — "what we've asked the GC for that they
 * haven't answered". Never added to contract value; it is precisely the
 * money that is not yet ours to count.
 */
export function pendingChangeOrderExposure(
  changeOrders: { status: string; proposals: ProposalForCalc[] }[],
  targets: Map<string, LineItemForChangeOrder>,
): Prisma.Decimal {
  return changeOrders
    .filter((co) => co.status === "SUBMITTED")
    .reduce((sum, co) => sum.add(changeOrderValueDelta(co.proposals, targets)), ZERO);
}
