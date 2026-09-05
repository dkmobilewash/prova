import { Prisma, prisma } from "@prova/db";

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
  /** Set once the proposal has been applied — see ChangeOrderProposal. */
  previousQuantity?: Prisma.Decimal | null;
  previousUnitPrice?: Prisma.Decimal | null;
  previousIsDeleted?: boolean | null;
};

/**
 * Whether this proposal has been written onto its line item.
 *
 * It matters for the arithmetic below: after approval the line item already
 * holds the proposal's values, so measuring the change against the *live*
 * row compares a number with itself and yields zero. The snapshot taken at
 * approval is the only record of what the change actually moved.
 */
function isApplied(proposal: ProposalForCalc) {
  return proposal.previousIsDeleted !== null && proposal.previousIsDeleted !== undefined;
}

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
      // Removing scope subtracts whatever that line was worth when it went.
      if (isApplied(proposal)) {
        return lineValue(proposal.previousQuantity ?? null, proposal.previousUnitPrice ?? null).neg();
      }
      if (!target) return ZERO;
      return lineValue(target.quantity, target.unitPrice).neg();

    case "EDIT": {
      // Applied: compare the proposal against what it replaced. Reading the
      // live line item here instead is what made an approved price change
      // render as +$0.00 -- the row had already become the proposal.
      if (isApplied(proposal)) {
        const wasQuantity = proposal.previousQuantity ?? null;
        const wasUnitPrice = proposal.previousUnitPrice ?? null;
        return lineValue(proposal.quantity ?? wasQuantity, proposal.unitPrice ?? wasUnitPrice).sub(
          lineValue(wasQuantity, wasUnitPrice),
        );
      }
      // Not applied: the live row is still the "before".
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

/**
 * Pending change orders, by value — "what we've asked the GC for that they
 * haven't answered". Never added to contract value; it is precisely the
 * money that is not yet ours to count.
 *
 * SUBMITTED only, and that is the definition of "pending" for this figure.
 * A DRAFT has not been asked for, so it is not outstanding with anybody.
 *
 * An exported `PENDING_CHANGE_ORDER_STATUSES = ["DRAFT", "SUBMITTED"]` used
 * to sit directly above this function, documented as "statuses whose
 * proposals have NOT been written to JobLineItem" — a different question
 * with a different answer. Nothing called it, so the two definitions never
 * met; wiring it in here, which is what its name and position invited,
 * would have silently added every draft to a money figure on the job page.
 * It was deleted rather than corrected: the filter below is the single
 * definition, and a constant that only ever has one call site is how the
 * disagreement got in.
 */
export function pendingChangeOrderExposure(
  changeOrders: { status: string; proposals: ProposalForCalc[] }[],
  targets: Map<string, LineItemForChangeOrder>,
): Prisma.Decimal {
  return changeOrders
    .filter((co) => co.status === "SUBMITTED")
    .reduce((sum, co) => sum.add(changeOrderValueDelta(co.proposals, targets)), ZERO);
}

/**
 * Everything that would be silently broken by unwinding an approved change
 * order. What counts as a blocker depends on what the reversal actually does
 * to the row, which differs by change type:
 *
 * - ADD is reversed by DELETING the line item it created, so anything hanging
 *   off that row would be destroyed or orphaned: costs, hours, pay
 *   application lines, and any other change order whose proposal targets it
 *   (that FK is ON DELETE SET NULL, so deleting the row would quietly empty
 *   out someone else's pending change order).
 * - EDIT is reversed by restoring the old quantity and price. Costs and hours
 *   against the line survive untouched, so they are not blockers. Billing is:
 *   a pay application was drawn against the changed value, and moving the
 *   contract value back underneath it would make the two disagree.
 * - REMOVE is reversed by un-deleting the line, which is purely additive.
 *   Nothing can be broken by scope coming back, so nothing blocks it.
 */
export async function reopenBlockers(changeOrder: {
  id: string;
  jobId: string;
  proposals: { id: string; changeType: string; lineItemId: string | null; previousIsDeleted: boolean | null }[];
}) {
  const addedLineItems = await prisma.jobLineItem.findMany({
    where: { originChangeOrderId: changeOrder.id },
    select: { id: true },
  });
  const deletedIds = addedLineItems.map((item) => item.id);
  const editedIds = changeOrder.proposals
    .filter((p) => p.changeType === "EDIT" && p.lineItemId)
    .map((p) => p.lineItemId as string);

  const blockers: string[] = [];

  if (deletedIds.length > 0) {
    const [costs, hours, billed, otherProposals] = await Promise.all([
      prisma.costEntry.count({ where: { lineItemId: { in: deletedIds } } }),
      prisma.timeEntry.count({ where: { lineItemId: { in: deletedIds } } }),
      prisma.invoiceLineItem.count({ where: { lineItemId: { in: deletedIds } } }),
      prisma.changeOrderProposal.count({
        where: { lineItemId: { in: deletedIds }, changeOrderId: { not: changeOrder.id } },
      }),
    ]);
    if (costs > 0)
      blockers.push(`${costs} cost ${costs === 1 ? "entry references" : "entries reference"} scope it added`);
    if (hours > 0)
      blockers.push(`${hours} time ${hours === 1 ? "entry references" : "entries reference"} scope it added`);
    if (billed > 0)
      blockers.push(`${billed} pay application ${billed === 1 ? "line has" : "lines have"} already billed scope it added`);
    if (otherProposals > 0)
      blockers.push(
        `${otherProposals} proposal${otherProposals === 1 ? "" : "s"} on another change order target${otherProposals === 1 ? "s" : ""} scope it added`,
      );
  }

  if (editedIds.length > 0) {
    const billed = await prisma.invoiceLineItem.count({ where: { lineItemId: { in: editedIds } } });
    if (billed > 0)
      blockers.push(
        `${billed} pay application ${billed === 1 ? "line was" : "lines were"} billed against a line it changed`,
      );
  }

  // A change order approved before reversal snapshots existed can't be put
  // back, because nothing recorded what it overwrote.
  const missingSnapshot = changeOrder.proposals.some(
    (p) => p.changeType !== "ADD" && p.previousIsDeleted === null,
  );
  if (missingSnapshot)
    blockers.push(
      "there is no record of the values it replaced (it was approved before reopening existed)",
    );

  return blockers;
}
