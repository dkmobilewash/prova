"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { reopenBlockers } from "@/lib/change-order";
import { Prisma } from "@prova/db";
import {
  actionFail as fail,
  actionOk as ok,
  assertEditableViaChangeOrder,
  assertJobInCompany,
  assertLineItemOnJob,
  decimalFromForm,
  nullableDecimalFromForm,
  tradeScopeFromForm,
  type ActionResult,
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

/**
 * #105 finding 8: every guard in this file used to `throw`, and Next.js
 * redacts a thrown Server Action message in a production build (verified
 * 2026-08-27) — so sentences like "CO #3 has already been sent — void it and
 * raise a new one" or "A change order can't be answered before it was sent"
 * reached a real PM as an opaque reference number, on the one workflow where
 * getting the next step wrong changes a contract value.
 *
 * Shaped like `lib/actions/submittals.ts`, this repo's own reference: an
 * `InputError` marks an expected, user-readable "no"; `runAction` catches it
 * at the boundary and returns `{ ok: false, error }`; anything else that
 * throws is a genuine bug and is rethrown untouched, still redacted, still
 * hitting the error boundary. Inside `approveChangeOrder`'s `$transaction`,
 * throwing an `InputError` still aborts the transaction exactly as the old
 * plain `throw` did — `runAction` only changes what happens to it once it
 * leaves the transaction.
 */
class InputError extends Error {}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required.`);
  return value;
}

/** decimalFromForm/nullableDecimalFromForm throw a plain Error written for a
 * person to read ("quantity" must be a number) — only the throwing was
 * wrong, so they're caught here and turned into InputError rather than
 * reimplemented. One parser, one rule about what a number is. */
function decimal(formData: FormData, key: string): string {
  try {
    return decimalFromForm(formData, key);
  } catch (err) {
    throw new InputError(err instanceof Error ? err.message : `"${key}" must be a number`);
  }
}

function nullableDecimal(formData: FormData, key: string): string | null {
  try {
    return nullableDecimalFromForm(formData, key);
  } catch (err) {
    throw new InputError(err instanceof Error ? err.message : `"${key}" must be a number`);
  }
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
  if (Number.isNaN(date.getTime())) throw new InputError("That date isn't a real date.");
  return date;
}

/**
 * Issues the next change order number for a job.
 *
 * Never max(number) + 1. That frees a number again as soon as a draft is
 * discarded, so the next one reissues it and two different documents have
 * both been called CO #3 — and a change order number is something a GC
 * quotes back at you. Incremented inside the same transaction as the insert
 * so two people starting a change order on one job can't collide. Same
 * mechanism as RfiCounter and SafetyCaseCounter.
 */
async function issueChangeOrderNumber(tx: Prisma.TransactionClient, jobId: string) {
  const counter = await tx.changeOrderCounter.upsert({
    where: { jobId },
    create: { jobId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return counter.lastNumber;
}

/** assertJobInCompany/assertEditableViaChangeOrder/assertLineItemOnJob throw
 * plain Errors, and every one of those messages is written for a person —
 * the only mode any of the three has is the expected-failure case, never a
 * bug, so wrapping the whole call is safe. */
async function requireJob(jobId: string, companyId: string) {
  try {
    return await assertJobInCompany(jobId, companyId);
  } catch (err) {
    throw new InputError(err instanceof Error ? err.message : "That job no longer exists.");
  }
}

function requireEditableViaChangeOrder(job: { status: string }) {
  try {
    assertEditableViaChangeOrder(job);
  } catch (err) {
    throw new InputError(err instanceof Error ? err.message : "This job isn't contracted yet.");
  }
}

async function requireLineItemOnJob(lineItemId: string, jobId: string) {
  try {
    return await assertLineItemOnJob(lineItemId, jobId);
  } catch (err) {
    throw new InputError(err instanceof Error ? err.message : "That line item isn't on this job.");
  }
}

async function assertChangeOrder(changeOrderId: string, companyId: string) {
  const changeOrder = await prisma.changeOrder.findUnique({
    where: { id: changeOrderId },
    include: { job: true, proposals: true },
  });
  if (!changeOrder || changeOrder.job.companyId !== companyId) {
    throw new InputError("That change order no longer exists.");
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
    throw new InputError(
      `CO #${changeOrder.number} has already been sent — void it and raise a new one instead of editing it.`,
    );
  }
}

/** Runs a body that may raise an InputError, turning it into a returned
 * failure. Anything else is a real bug and is rethrown untouched — same
 * shape as lib/actions/submittals.ts's runAction. */
async function runAction(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    return ok;
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Building a draft                                                    */
/* ------------------------------------------------------------------ */

/**
 * Opens a new change order as a DRAFT with no proposals yet. The budget does
 * not move — nothing here touches JobLineItem.
 */
export async function createChangeOrder(jobId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { company } = await requireCompanyContext();
    const job = await requireJob(jobId, company.id);
    requireEditableViaChangeOrder(job);

    const title = required(formData, "title", "Change order title");
    const description = text(formData, "description");

    await prisma.$transaction(async (tx) => {
      const number = await issueChangeOrderNumber(tx, jobId);
      await tx.changeOrder.create({
        data: { jobId, number, title, description: description || null, status: "DRAFT" },
      });
    });

    revalidatePath(`/jobs/${jobId}`);
  });
}

/**
 * Adds proposed NEW scope to a draft. On approval this becomes a
 * JobLineItem tagged with originChangeOrderId — the same row shape the
 * estimate was built from.
 */
export async function proposeAddedScope(
  changeOrderId: string,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const { company } = await requireCompanyContext();
    const changeOrder = await assertChangeOrder(changeOrderId, company.id);
    assertDraft(changeOrder);

    const description = required(formData, "itemDescription", "Line item description");
    const unit = text(formData, "unit");
    const budgetedUnitCost = nullableDecimal(formData, "budgetedUnitCost");

    await prisma.changeOrderProposal.create({
      data: {
        changeOrderId,
        changeType: "ADD",
        description,
        unit: unit || null,
        quantity: decimal(formData, "quantity"),
        unitPrice: nullableDecimal(formData, "unitPrice"),
        budgetedUnitCost,
        currentEstimatedUnitCost: nullableDecimal(formData, "currentEstimatedUnitCost") ?? budgetedUnitCost,
        tradeScope: tradeScopeFromForm(formData),
      },
    });

    revalidatePath(`/jobs/${changeOrder.jobId}`);
  });
}

/**
 * Proposes a change to an EXISTING line item. A null field means "leave it
 * alone", so a price-only change stores only a price.
 */
export async function proposeLineItemChange(
  changeOrderId: string,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const { company } = await requireCompanyContext();
    const changeOrder = await assertChangeOrder(changeOrderId, company.id);
    assertDraft(changeOrder);

    const lineItemId = required(formData, "lineItemId", "Target line item");
    const lineItem = await requireLineItemOnJob(lineItemId, changeOrder.jobId);

    // #105 finding 5, closed at the source rather than only in the exposure
    // arithmetic: an approved change order may have already removed this
    // line. Proposing against it is a dead end — approveChangeOrder refuses
    // it outright — and until then it would sit in the pending-exposure
    // figure as money that can never be booked.
    if (lineItem.isDeleted) {
      throw new InputError(
        `"${lineItem.description}" was already removed from this contract by an earlier change order. Propose it as new scope instead of editing it.`,
      );
    }

    const quantity = nullableDecimal(formData, "quantity");
    const unitPrice = nullableDecimal(formData, "unitPrice");
    if (quantity === null && unitPrice === null) {
      throw new InputError("Set a new quantity or a new unit price — otherwise this changes nothing.");
    }

    await prisma.changeOrderProposal.create({
      data: { changeOrderId, changeType: "EDIT", lineItemId, quantity, unitPrice },
    });

    revalidatePath(`/jobs/${changeOrder.jobId}`);
  });
}

/** Proposes removing scope. Applied as a soft delete on approval. */
export async function proposeScopeRemoval(
  changeOrderId: string,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const { company } = await requireCompanyContext();
    const changeOrder = await assertChangeOrder(changeOrderId, company.id);
    assertDraft(changeOrder);

    const lineItemId = required(formData, "lineItemId", "Target line item");
    const lineItem = await requireLineItemOnJob(lineItemId, changeOrder.jobId);

    // Same reasoning as proposeLineItemChange above — there is nothing left
    // to take out.
    if (lineItem.isDeleted) {
      throw new InputError(
        `"${lineItem.description}" has already been removed from this contract by an earlier change order.`,
      );
    }

    await prisma.changeOrderProposal.create({
      data: { changeOrderId, changeType: "REMOVE", lineItemId },
    });

    revalidatePath(`/jobs/${changeOrder.jobId}`);
  });
}

export async function removeProposal(proposalId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company } = await requireCompanyContext();
    const proposal = await prisma.changeOrderProposal.findUnique({
      where: { id: proposalId },
      include: { changeOrder: { include: { job: true } } },
    });
    if (!proposal || proposal.changeOrder.job.companyId !== company.id) {
      throw new InputError("That proposed change no longer exists.");
    }
    assertDraft(proposal.changeOrder);

    await prisma.changeOrderProposal.delete({ where: { id: proposalId } });
    revalidatePath(`/jobs/${proposal.changeOrder.jobId}`);
  });
}

/** A draft nobody has seen can be thrown away. Anything sent cannot — see
 * voidChangeOrder. */
export async function deleteChangeOrderDraft(changeOrderId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { company } = await requireCompanyContext();
    const changeOrder = await assertChangeOrder(changeOrderId, company.id);
    assertDraft(changeOrder);

    await prisma.changeOrder.delete({ where: { id: changeOrderId } });
    revalidatePath(`/jobs/${changeOrder.jobId}`);
  });
}

/* ------------------------------------------------------------------ */
/* The workflow with the GC                                            */
/* ------------------------------------------------------------------ */

/** DRAFT -> SUBMITTED. This is the PCO state: priced, sent, unanswered. */
export async function submitChangeOrder(
  changeOrderId: string,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const { company } = await requireCompanyContext();
    const changeOrder = await assertChangeOrder(changeOrderId, company.id);
    assertDraft(changeOrder);

    if (changeOrder.proposals.length === 0) {
      throw new InputError("Add at least one proposed change before sending this to the GC.");
    }

    await prisma.changeOrder.update({
      where: { id: changeOrderId },
      data: { status: "SUBMITTED", submittedOn: enteredDate(formData, "submittedOn") },
    });

    revalidatePath(`/jobs/${changeOrder.jobId}`);
  });
}

/**
 * SUBMITTED -> APPROVED, and the only place a proposal becomes live scope.
 *
 * Everything happens in one transaction: if any single proposal fails to
 * apply, none of them do and the status doesn't move. A partially applied
 * change order would put the contract value somewhere neither party agreed
 * to, which is worse than an error message.
 */
export async function approveChangeOrder(
  changeOrderId: string,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const { company } = await requireCompanyContext();
    const changeOrder = await assertChangeOrder(changeOrderId, company.id);

    if (changeOrder.status !== "SUBMITTED") {
      throw new InputError(
        `Only a change order that's been sent to the GC can be approved — CO #${changeOrder.number} is ${changeOrder.status}.`,
      );
    }
    // Belt and braces alongside the status check: appliedAt is what actually
    // guarantees the budget can't absorb the same change order twice.
    if (changeOrder.appliedAt) {
      throw new InputError(`CO #${changeOrder.number} has already been applied to the budget.`);
    }

    const decidedOn = enteredDate(formData, "decidedOn");
    if (changeOrder.submittedOn && decidedOn < changeOrder.submittedOn) {
      throw new InputError("A change order can't be answered before it was sent.");
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
          throw new InputError("A change to existing scope has lost its target line item.");
        }
        const lineItem = await tx.jobLineItem.findUnique({ where: { id: proposal.lineItemId } });
        if (!lineItem || lineItem.jobId !== changeOrder.jobId) {
          throw new InputError("A line item this change order targets is no longer on this job.");
        }
        // A line another change order has already removed can't be changed
        // or removed again — approving that would silently do nothing, or
        // worse, resurrect it into the budget.
        if (lineItem.isDeleted) {
          throw new InputError(
            `"${lineItem.description}" was already removed by an earlier change order. Void CO #${changeOrder.number} and raise a new one against the current scope.`,
          );
        }

        // Snapshot what this proposal is about to overwrite, so reopening can
        // put it back without reading the audit log. See ChangeOrderProposal.
        await tx.changeOrderProposal.update({
          where: { id: proposal.id },
          data: {
            previousQuantity: lineItem.quantity,
            previousUnitPrice: lineItem.unitPrice,
            previousIsDeleted: lineItem.isDeleted,
          },
        });

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
  });
}

/**
 * SUBMITTED -> REJECTED. Nothing is applied and nothing is deleted: a
 * refused change order is evidence that the work was priced, asked for, and
 * turned down, which is precisely what a later claim is built on.
 */
export async function rejectChangeOrder(
  changeOrderId: string,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const { company } = await requireCompanyContext();
    const changeOrder = await assertChangeOrder(changeOrderId, company.id);

    if (changeOrder.status !== "SUBMITTED") {
      throw new InputError(
        `Only a change order that's been sent to the GC can be rejected — CO #${changeOrder.number} is ${changeOrder.status}.`,
      );
    }

    const decidedOn = enteredDate(formData, "decidedOn");
    if (changeOrder.submittedOn && decidedOn < changeOrder.submittedOn) {
      throw new InputError("A change order can't be answered before it was sent.");
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
  });
}

/**
 * Withdraws a change order before the GC has answered. Kept rather than
 * deleted once it has been sent — the GC has a copy, so the record that CO
 * #N existed and was pulled has to survive.
 */
export async function voidChangeOrder(
  changeOrderId: string,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const { company } = await requireCompanyContext();
    const changeOrder = await assertChangeOrder(changeOrderId, company.id);

    if (changeOrder.status !== "DRAFT" && changeOrder.status !== "SUBMITTED") {
      throw new InputError(`CO #${changeOrder.number} is already ${changeOrder.status}.`);
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
  });
}

/* ------------------------------------------------------------------ */
/* Correcting a change order that was already approved                 */
/* ------------------------------------------------------------------ */

/**
 * APPROVED -> DRAFT, undoing the change order's effect on the contract value
 * so it can be corrected and re-approved.
 *
 * Only while its scope is untouched. Once anyone has costed, logged hours
 * against, or billed that scope — or once a LATER approved change order has
 * written to the same lines (#105 finding 1) — unwinding it would put the
 * contract value somewhere that contradicts a pay application already sent
 * to the GC, or silently revert somebody else's approved change.
 * reviseChangeOrder is the way through at that point.
 */
export async function reopenChangeOrder(
  changeOrderId: string,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const { company } = await requireCompanyContext();
    const changeOrder = await assertChangeOrder(changeOrderId, company.id);

    if (changeOrder.status !== "APPROVED") {
      throw new InputError(
        `Only an approved change order can be reopened — CO #${changeOrder.number} is ${changeOrder.status}.`,
      );
    }

    const blockers = await reopenBlockers(changeOrder);
    if (blockers.length > 0) {
      throw new InputError(
        `CO #${changeOrder.number} can't be reopened: ${blockers.join("; ")}. ` +
          "Raise a revision instead — it corrects the scope without contradicting what has already been costed or billed.",
      );
    }

    await prisma.$transaction(async (tx) => {
      for (const proposal of changeOrder.proposals) {
        if (proposal.changeType === "ADD") continue;
        if (!proposal.lineItemId) continue;
        await tx.jobLineItem.update({
          where: { id: proposal.lineItemId },
          data: {
            quantity: proposal.previousQuantity ?? undefined,
            unitPrice: proposal.previousUnitPrice,
            isDeleted: proposal.previousIsDeleted ?? false,
          },
        });
        await tx.changeOrderProposal.update({
          where: { id: proposal.id },
          data: { previousQuantity: null, previousUnitPrice: null, previousIsDeleted: null },
        });
      }

      // Added scope goes away entirely. reopenBlockers has already established
      // nothing points at these rows, so there is nothing to orphan.
      await tx.jobLineItem.deleteMany({ where: { originChangeOrderId: changeOrder.id } });

      // The edits describe a change that no longer happened.
      await tx.changeOrderLineItemEdit.deleteMany({ where: { changeOrderId: changeOrder.id } });

      await tx.changeOrder.update({
        where: { id: changeOrderId },
        data: {
          status: "DRAFT",
          appliedAt: null,
          decidedOn: null,
          decisionNotes: null,
          submittedOn: null,
          reopenedAt: new Date(),
          reopenNote: text(formData, "reopenNote") || null,
        },
      });
    });

    revalidatePath(`/jobs/${changeOrder.jobId}`);
  });
}

/**
 * Raises a new change order that corrects an approved one.
 *
 * The original stays APPROVED. It was approved, and it did move the contract
 * value; rewriting it to say otherwise would put the job's history out of
 * step with the pay applications drawn from it. The revision is an ordinary
 * change order against the job's current state, linked back to what it
 * corrects — so it goes through the same submit/approve workflow and the GC
 * sees a document rather than a silent adjustment.
 */
export async function reviseChangeOrder(
  changeOrderId: string,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const { company } = await requireCompanyContext();
    const original = await assertChangeOrder(changeOrderId, company.id);

    if (original.status !== "APPROVED") {
      throw new InputError(
        `Only an approved change order needs revising — CO #${original.number} is ${original.status}, so edit or void it directly.`,
      );
    }

    const title = text(formData, "title") || `Revision of CO #${original.number}`;

    await prisma.$transaction(async (tx) => {
      const number = await issueChangeOrderNumber(tx, original.jobId);
      await tx.changeOrder.create({
        data: {
          jobId: original.jobId,
          number,
          title,
          description: text(formData, "description") || null,
          status: "DRAFT",
          supersedesId: original.id,
        },
      });
    });

    revalidatePath(`/jobs/${original.jobId}`);
  });
}
