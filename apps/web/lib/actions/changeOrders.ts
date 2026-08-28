"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import {
  assertEditableViaChangeOrder,
  assertJobInCompany,
  assertLineItemOnJob,
  decimalFromForm,
  nextChangeOrderNumber,
  nullableDecimalFromForm,
  tradeScopeFromForm,
} from "./shared";

/**
 * The change order lifecycle: DRAFT -> SUBMITTED -> APPROVED | REJECTED,
 * with VOID as the "we withdrew it" exit.
 *
 * The rule that makes this safe: nothing before APPROVED writes to
 * JobLineItem. A change order's content lives in ChangeOrderProposal until
 * approveChangeOrder applies it. That keeps contract value, WIP, retainage
 * and pay applications reading a number the GC has actually agreed to,
 * without any of those ten separate `isDeleted: false` call sites needing to
 * learn that this lifecycle exists.
 */

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new Error(`${label} is required`);
  return value;
}

/** Dates are stored at UTC midnight so comparisons are between calendar
 * days, not instants — same rule as RFIs, submittals and the safety log. */
function utcMidnight(date: Date) {
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/**
 * Entered, not stamped. A change order logged after the fact has to record
 * the date it actually went to the GC — stamping `now()` would make every
 * backfilled PCO look same-day and turn the turnaround evidence into
 * fiction. Blank falls back to today, which is the honest default for one
 * being sent right now.
 */
function enteredDate(formData: FormData, key: string): Date {
  const raw = text(formData, key);
  if (!raw) return utcMidnight(new Date());
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Date is not valid");
  return date;
}

async function assertChangeOrder(changeOrderId: string, companyId: string) {
  const changeOrder = await prisma.changeOrder.findUnique({
    where: { id: changeOrderId },
    include: { job: true, proposals: true },
  });
  if (!changeOrder || changeOrder.job.companyId !== companyId) {
    throw new Error("Change order not found");
  }
  return changeOrder;
}

/**
 * A change order is only editable while it's a draft. Once it's been sent to
 * the GC, changing what it says without re-issuing it would mean the copy
 * they're holding and the copy we're holding disagree — which is exactly the
 * kind of thing a change order exists to prevent.
 */
function assertDraft(changeOrder: { status: string; number: number }) {
  if (changeOrder.status !== "DRAFT") {
    throw new Error(
      `CO #${changeOrder.number} has already been sent — void it and raise a new one instead of editing it.`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Building a draft                                                    */
/* ------------------------------------------------------------------ */

/**
 * Opens a new change order as a DRAFT with no proposals yet. The budget does
 * not move — nothing here touches JobLineItem.
 */
export async function createChangeOrder(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableViaChangeOrder(job);

  const title = required(formData, "title", "Change order title");
  const description = text(formData, "description");
  const number = await nextChangeOrderNumber(jobId);

  await prisma.changeOrder.create({
    data: { jobId, number, title, description: description || null, status: "DRAFT" },
  });

  revalidatePath(`/jobs/${jobId}`);
}

/**
 * Adds proposed NEW scope to a draft. On approval this becomes a
 * JobLineItem tagged with originChangeOrderId — the same row shape the
 * estimate was built from.
 */
export async function proposeAddedScope(changeOrderId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const changeOrder = await assertChangeOrder(changeOrderId, company.id);
  assertDraft(changeOrder);

  const description = required(formData, "itemDescription", "Line item description");
  const unit = text(formData, "unit");
  const budgetedUnitCost = nullableDecimalFromForm(formData, "budgetedUnitCost");

  await prisma.changeOrderProposal.create({
    data: {
      changeOrderId,
      changeType: "ADD",
      description,
      unit: unit || null,
      quantity: decimalFromForm(formData, "quantity"),
      unitPrice: nullableDecimalFromForm(formData, "unitPrice"),
      budgetedUnitCost,
      currentEstimatedUnitCost:
        nullableDecimalFromForm(formData, "currentEstimatedUnitCost") ?? budgetedUnitCost,
      tradeScope: tradeScopeFromForm(formData),
    },
  });

  revalidatePath(`/jobs/${changeOrder.jobId}`);
}

/**
 * Proposes a change to an EXISTING line item. A null field means "leave it
 * alone", so a price-only change stores only a price.
 */
export async function proposeLineItemChange(changeOrderId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const changeOrder = await assertChangeOrder(changeOrderId, company.id);
  assertDraft(changeOrder);

  const lineItemId = required(formData, "lineItemId", "Target line item");
  await assertLineItemOnJob(lineItemId, changeOrder.jobId);

  const quantity = nullableDecimalFromForm(formData, "quantity");
  const unitPrice = nullableDecimalFromForm(formData, "unitPrice");
  if (quantity === null && unitPrice === null) {
    throw new Error("Set a new quantity or a new unit price — otherwise this changes nothing.");
  }

  await prisma.changeOrderProposal.create({
    data: { changeOrderId, changeType: "EDIT", lineItemId, quantity, unitPrice },
  });

  revalidatePath(`/jobs/${changeOrder.jobId}`);
}

/** Proposes removing scope. Applied as a soft delete on approval. */
export async function proposeScopeRemoval(changeOrderId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const changeOrder = await assertChangeOrder(changeOrderId, company.id);
  assertDraft(changeOrder);

  const lineItemId = required(formData, "lineItemId", "Target line item");
  await assertLineItemOnJob(lineItemId, changeOrder.jobId);

  await prisma.changeOrderProposal.create({
    data: { changeOrderId, changeType: "REMOVE", lineItemId },
  });

  revalidatePath(`/jobs/${changeOrder.jobId}`);
}

export async function removeProposal(proposalId: string) {
  const { company } = await requireCompanyContext();
  const proposal = await prisma.changeOrderProposal.findUnique({
    where: { id: proposalId },
    include: { changeOrder: { include: { job: true } } },
  });
  if (!proposal || proposal.changeOrder.job.companyId !== company.id) {
    throw new Error("Proposal not found");
  }
  assertDraft(proposal.changeOrder);

  await prisma.changeOrderProposal.delete({ where: { id: proposalId } });
  revalidatePath(`/jobs/${proposal.changeOrder.jobId}`);
}

/** A draft nobody has seen can be thrown away. Anything sent cannot — see
 * voidChangeOrder. */
export async function deleteChangeOrderDraft(changeOrderId: string) {
  const { company } = await requireCompanyContext();
  const changeOrder = await assertChangeOrder(changeOrderId, company.id);
  assertDraft(changeOrder);

  await prisma.changeOrder.delete({ where: { id: changeOrderId } });
  revalidatePath(`/jobs/${changeOrder.jobId}`);
}

/* ------------------------------------------------------------------ */
/* The workflow with the GC                                            */
/* ------------------------------------------------------------------ */

/** DRAFT -> SUBMITTED. This is the PCO state: priced, sent, unanswered. */
export async function submitChangeOrder(changeOrderId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const changeOrder = await assertChangeOrder(changeOrderId, company.id);
  assertDraft(changeOrder);

  if (changeOrder.proposals.length === 0) {
    throw new Error("Add at least one proposed change before sending this to the GC.");
  }

  await prisma.changeOrder.update({
    where: { id: changeOrderId },
    data: { status: "SUBMITTED", submittedOn: enteredDate(formData, "submittedOn") },
  });

  revalidatePath(`/jobs/${changeOrder.jobId}`);
}

/**
 * SUBMITTED -> APPROVED, and the only place a proposal becomes live scope.
 *
 * Everything happens in one transaction: if any single proposal fails to
 * apply, none of them do and the status doesn't move. A partially applied
 * change order would put the contract value somewhere neither party agreed
 * to, which is worse than an error message.
 */
export async function approveChangeOrder(changeOrderId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const changeOrder = await assertChangeOrder(changeOrderId, company.id);

  if (changeOrder.status !== "SUBMITTED") {
    throw new Error(
      `Only a change order that's been sent to the GC can be approved — CO #${changeOrder.number} is ${changeOrder.status}.`,
    );
  }
  // Belt and braces alongside the status check: appliedAt is what actually
  // guarantees the budget can't absorb the same change order twice.
  if (changeOrder.appliedAt) {
    throw new Error(`CO #${changeOrder.number} has already been applied to the budget.`);
  }

  const decidedOn = enteredDate(formData, "decidedOn");
  if (changeOrder.submittedOn && decidedOn < changeOrder.submittedOn) {
    throw new Error("A change order can't be answered before it was sent.");
  }
  const decisionNotes = text(formData, "decisionNotes");

  await prisma.$transaction(async (tx) => {
    for (const proposal of changeOrder.proposals) {
      if (proposal.changeType === "ADD") {
        await tx.jobLineItem.create({
          data: {
            jobId: changeOrder.jobId,
            description: proposal.description ?? "Added scope",
            unit: proposal.unit,
            quantity: proposal.quantity ?? "1",
            unitPrice: proposal.unitPrice,
            budgetedUnitCost: proposal.budgetedUnitCost,
            currentEstimatedUnitCost: proposal.currentEstimatedUnitCost,
            tradeScope: proposal.tradeScope,
            originChangeOrderId: changeOrder.id,
          },
        });
        continue;
      }

      if (!proposal.lineItemId) {
        throw new Error("A change to existing scope has lost its target line item.");
      }
      const lineItem = await tx.jobLineItem.findUnique({ where: { id: proposal.lineItemId } });
      if (!lineItem || lineItem.jobId !== changeOrder.jobId) {
        throw new Error("A line item this change order targets is no longer on this job.");
      }
      // A line another change order has already removed can't be changed or
      // removed again — approving that would silently do nothing, or worse,
      // resurrect it into the budget.
      if (lineItem.isDeleted) {
        throw new Error(
          `"${lineItem.description}" was already removed by an earlier change order. Void CO #${changeOrder.number} and raise a new one against the current scope.`,
        );
      }

      if (proposal.changeType === "REMOVE") {
        await tx.jobLineItem.update({
          where: { id: lineItem.id },
          data: { isDeleted: true },
        });
        await tx.changeOrderLineItemEdit.create({
          data: {
            changeOrderId: changeOrder.id,
            lineItemId: lineItem.id,
            field: "deleted",
            oldValue: "false",
            newValue: "true",
          },
        });
        continue;
      }

      // EDIT — write only the fields the proposal actually set, and log the
      // before/after for each one that genuinely moved.
      const newQuantity = proposal.quantity ?? lineItem.quantity;
      const newUnitPrice = proposal.unitPrice ?? lineItem.unitPrice;

      if (!lineItem.quantity.equals(newQuantity)) {
        await tx.changeOrderLineItemEdit.create({
          data: {
            changeOrderId: changeOrder.id,
            lineItemId: lineItem.id,
            field: "quantity",
            oldValue: lineItem.quantity.toString(),
            newValue: newQuantity.toString(),
          },
        });
      }
      const oldPriceText = lineItem.unitPrice?.toString() ?? "(none)";
      const newPriceText = newUnitPrice?.toString() ?? "(none)";
      if (oldPriceText !== newPriceText) {
        await tx.changeOrderLineItemEdit.create({
          data: {
            changeOrderId: changeOrder.id,
            lineItemId: lineItem.id,
            field: "unitPrice",
            oldValue: oldPriceText,
            newValue: newPriceText,
          },
        });
      }

      await tx.jobLineItem.update({
        where: { id: lineItem.id },
        data: { quantity: newQuantity, unitPrice: newUnitPrice },
      });
    }

    await tx.changeOrder.update({
      where: { id: changeOrderId },
      data: {
        status: "APPROVED",
        decidedOn,
        decisionNotes: decisionNotes || null,
        appliedAt: new Date(),
      },
    });
  });

  revalidatePath(`/jobs/${changeOrder.jobId}`);
}

/**
 * SUBMITTED -> REJECTED. Nothing is applied and nothing is deleted: a
 * refused change order is evidence that the work was priced, asked for, and
 * turned down, which is precisely what a later claim is built on.
 */
export async function rejectChangeOrder(changeOrderId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const changeOrder = await assertChangeOrder(changeOrderId, company.id);

  if (changeOrder.status !== "SUBMITTED") {
    throw new Error(
      `Only a change order that's been sent to the GC can be rejected — CO #${changeOrder.number} is ${changeOrder.status}.`,
    );
  }

  const decidedOn = enteredDate(formData, "decidedOn");
  if (changeOrder.submittedOn && decidedOn < changeOrder.submittedOn) {
    throw new Error("A change order can't be answered before it was sent.");
  }

  await prisma.changeOrder.update({
    where: { id: changeOrderId },
    data: {
      status: "REJECTED",
      decidedOn,
      decisionNotes: text(formData, "decisionNotes") || null,
    },
  });

  revalidatePath(`/jobs/${changeOrder.jobId}`);
}

/**
 * Withdraws a change order before the GC has answered. Kept rather than
 * deleted once it has been sent — the GC has a copy, so the record that CO
 * #N existed and was pulled has to survive.
 */
export async function voidChangeOrder(changeOrderId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const changeOrder = await assertChangeOrder(changeOrderId, company.id);

  if (changeOrder.status !== "DRAFT" && changeOrder.status !== "SUBMITTED") {
    throw new Error(`CO #${changeOrder.number} is already ${changeOrder.status}.`);
  }

  await prisma.changeOrder.update({
    where: { id: changeOrderId },
    data: {
      status: "VOID",
      decidedOn: enteredDate(formData, "decidedOn"),
      decisionNotes: text(formData, "decisionNotes") || null,
    },
  });

  revalidatePath(`/jobs/${changeOrder.jobId}`);
}
