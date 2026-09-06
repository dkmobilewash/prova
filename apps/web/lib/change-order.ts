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
 * Whether a proposal could still be approved as written.
 *
 * An unapplied EDIT or REMOVE against a line that has already gone —
 * soft-deleted by an earlier change order, or missing entirely —
 * cannot be booked: approveChangeOrder refuses exactly this case
 * ("was already removed by an earlier change order"). It is NOT a
 * neutral row to leave in a total. Removing five thousand dollars of
 * scope that is already gone would take another five thousand off the
 * contract, so the exposure figure asked the GC for money that could
 * never be booked, and the change order it sat on could never be
 * approved to book it.
 *
 * An APPLIED proposal is always bookable-past-tense: it has already
 * landed, and its snapshot is the record of what it moved. The live row
 * being deleted afterwards says nothing about what this one did.
 */
export function proposalIsBookable(
  proposal: ProposalForCalc,
  target: LineItemForChangeOrder | null,
): boolean {
  if (proposal.changeType === "ADD") return true;
  if (isApplied(proposal)) return true;
  return target !== null && !target.isDeleted;
}

/**
 * The delta a single proposal would apply to contract value.
 *
 * EDIT is the subtle one: a proposal stores only the fields being changed,
 * so a null quantity means "leave quantity alone", not "quantity is zero".
 * Falling back to the line item's current value is what makes a
 * price-only change come out as a price-only delta.
 *
 * Zero for a proposal that can no longer be booked — see
 * proposalIsBookable. Whatever renders a total containing one has to SAY
 * so rather than let it silently shrink the number; countUnbookable is
 * there for that.
 */
export function proposalValueDelta(
  proposal: ProposalForCalc,
  target: LineItemForChangeOrder | null,
): Prisma.Decimal {
  if (!proposalIsBookable(proposal, target)) return ZERO;

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
 * How many of these proposals can no longer be booked.
 *
 * The companion to changeOrderValueDelta, and not optional: a total that
 * drops rows has to say how many it dropped, or it is a floor presented
 * as a total. Same rule as the unpriced won bids on /pipeline.
 */
export function countUnbookable(
  proposals: ProposalForCalc[],
  targets: Map<string, LineItemForChangeOrder>,
): number {
  return proposals.filter(
    (proposal) =>
      !proposalIsBookable(
        proposal,
        proposal.lineItemId ? targets.get(proposal.lineItemId) ?? null : null,
      ),
  ).length;
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

/** How many pending proposals the exposure figure above had to drop. */
export function pendingChangeOrderUnbookable(
  changeOrders: { status: string; proposals: ProposalForCalc[] }[],
  targets: Map<string, LineItemForChangeOrder>,
): number {
  return changeOrders
    .filter((co) => co.status === "SUBMITTED")
    .reduce((count, co) => count + countUnbookable(co.proposals, targets), 0);
}

/**
 * Which of the approved change orders that also touched these lines landed
 * AFTER this one, phrased as a blocker.
 *
 * Split out from the query for the usual reason: the deciding is worth a
 * test with hand-written inputs, and the ordering rule is the whole of the
 * bug. Reopening CO #2 restores the values CO #2 replaced. If CO #4 has
 * since changed the same line, that restore silently reverts CO #4 while
 * CO #4 goes on rendering its delta -- so the log claims two changes and
 * the contract value agrees with neither.
 *
 * An EARLIER approved change order is not a conflict: this one's snapshot
 * was taken after theirs landed, so putting it back restores the state
 * they left. Order is therefore the entire question, and where it cannot
 * be established -- either side missing appliedAt, which happens on rows
 * approved before that column was written -- this refuses. A false block
 * costs a revision instead of a reopen; a false allow silently rewrites a
 * contract value.
 */
export function laterApprovedConflict(
  appliedAt: Date | null,
  others: { number: number; appliedAt: Date | null }[],
): string | null {
  const later = others
    .filter((other) => appliedAt === null || other.appliedAt === null || other.appliedAt > appliedAt)
    .map((other) => other.number);

  const numbers = [...new Set(later)].sort((a, b) => a - b);
  if (numbers.length === 0) return null;

  const labels = numbers.map((n) => `CO #${n}`);
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${list} ${labels.length === 1 ? "has" : "have"} since changed a line it changed, and putting its values back would silently revert ${labels.length === 1 ? "that" : "those"}`;
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
 *
 * The fourth thing that breaks is not billing at all but ANOTHER CHANGE
 * ORDER — see laterApprovedConflict.
 */
export async function reopenBlockers(changeOrder: {
  id: string;
  jobId: string;
  /** When this change order's proposals were written onto the line items.
   * Null on one approved before appliedAt existed, which is why the
   * ordering below treats null as "cannot establish". */
  appliedAt?: Date | null;
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

  // Whether a LATER approved change order has since written to the same
  // rows. Reversing an EDIT restores this change order's snapshot, and a
  // snapshot taken before somebody else's approved change knows nothing
  // about it -- so the restore lands on top of theirs and the two
  // documents disagree about a contract value only one of them can be
  // right about. EDIT and REMOVE both restore quantity, price AND
  // isDeleted, so a reopened EDIT can also resurrect a line a later
  // change order removed.
  const touchedIds = changeOrder.proposals
    .filter((p) => p.changeType !== "ADD" && p.lineItemId)
    .map((p) => p.lineItemId as string);

  if (touchedIds.length > 0) {
    const others = await prisma.changeOrderProposal.findMany({
      where: {
        lineItemId: { in: touchedIds },
        changeOrderId: { not: changeOrder.id },
        // Applied, so it has actually written to the row. A draft or
        // pending proposal has moved nothing and blocks nothing.
        previousIsDeleted: { not: null },
        changeOrder: { status: "APPROVED" },
      },
      select: { changeOrder: { select: { number: true, appliedAt: true } } },
    });

    const conflict = laterApprovedConflict(
      changeOrder.appliedAt ?? null,
      others.map((row) => row.changeOrder),
    );
    if (conflict) blockers.push(conflict);
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
