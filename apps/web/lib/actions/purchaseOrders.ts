"use server";

import { revalidatePath } from "next/cache";
import { Prisma, prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { parseNumericInput } from "@/lib/numeric-input";
import { unitKey } from "@/components/vendorPricing";
import { actionFail as fail, actionOk as ok, runAction, type ActionResult } from "./shared";

const COSTS_ONLY =
  "Buying out a job is part of job costs, which isn't part of your job function. The account owner sets who sees what, on the Team page.";

async function issuePurchaseOrderNumber(tx: Prisma.TransactionClient, jobId: string) {
  const counter = await tx.purchaseOrderCounter.upsert({
    where: { jobId },
    create: { jobId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return counter.lastNumber;
}

function figure(formData: FormData, key: string, label: string) {
  const parsed = parseNumericInput(String(formData.get(key) ?? ""), { label, maxDecimals: 2, min: 0 });
  if (!parsed.ok) return parsed;
  if (parsed.n <= 0) return { ok: false as const, error: `${label} has to be more than zero.` };
  return parsed;
}

/**
 * Puts one scope line on a DRAFT purchase order, from a chosen quote or a
 * typed price. Goes on that vendor's existing draft for the job when there is
 * one, so a vendor's lines land on one PO; otherwise opens the next number.
 *
 * WITH A QUOTE, THE PRICE IS READ FROM THE QUOTE ROW, never from the form, and
 * a quote in a different unit is refused: nothing here converts units. The
 * description, unit and category are snapshots of the scope line.
 */
export async function draftPurchaseOrderLine(jobId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const context = await requireCompanyContext();
    if (!can(context, "VIEW_JOB_COSTS")) return fail(COSTS_ONLY);
    const companyId = context.company.id;

    const job = await prisma.job.findFirst({ where: { id: jobId, companyId }, select: { id: true, status: true } });
    if (!job) return fail("That job is not on your account.");
    if (job.status === "ESTIMATE") return fail("Contract this job before buying it out.");

    const line = await prisma.jobLineItem.findFirst({
      where: { id: String(formData.get("lineItemId") ?? ""), jobId, isDeleted: false },
      select: { id: true, description: true, unit: true, costCategory: true },
    });
    if (!line) return fail("That line is no longer on this job.");

    const quantity = figure(formData, "quantity", "Quantity");
    if (!quantity.ok) return fail(quantity.error);

    const quoteId = String(formData.get("quoteId") ?? "");
    let vendorId: string;
    let unitPrice: number;
    if (quoteId) {
      const quote = await prisma.vendorPriceQuote.findFirst({
        where: { id: quoteId, companyId },
        select: { vendorId: true, unitPrice: true, unit: true },
      });
      if (!quote) return fail("That quote is gone. Reload the page.");
      if (unitKey(quote.unit) !== unitKey(line.unit)) {
        return fail(`That quote is per ${quote.unit ?? "no unit"} and this line is per ${line.unit ?? "no unit"}. Type the price instead.`);
      }
      vendorId = quote.vendorId;
      unitPrice = Number(quote.unitPrice);
    } else {
      const vendor = await prisma.vendor.findFirst({
        where: { id: String(formData.get("vendorId") ?? ""), companyId },
        select: { id: true },
      });
      if (!vendor) return fail("Pick a vendor.");
      const typed = figure(formData, "unitPrice", "Unit price");
      if (!typed.ok) return fail(typed.error);
      vendorId = vendor.id;
      unitPrice = typed.n;
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({
        where: { jobId, vendorId, status: "DRAFT" },
        orderBy: { number: "desc" },
        select: { id: true },
      });
      const purchaseOrderId =
        existing?.id ??
        (
          await tx.purchaseOrder.create({
            data: {
              companyId,
              jobId,
              vendorId,
              number: await issuePurchaseOrderNumber(tx, jobId),
              createdByUserId: context.id,
            },
            select: { id: true },
          })
        ).id;
      await tx.purchaseOrderLine.create({
        data: {
          purchaseOrderId,
          lineItemId: line.id,
          description: line.description,
          unit: line.unit,
          quantity: quantity.n.toFixed(2),
          unitPrice: unitPrice.toFixed(2),
          costCategory: line.costCategory,
          vendorPriceQuoteId: quoteId || null,
        },
      });
    });

    revalidatePath(`/jobs/${jobId}`);
    return ok;
  });
}

function enteredDay(formData: FormData, key: string): Date | null {
  const raw = String(formData.get(key) ?? "").trim();
  const date = new Date(`${raw}T00:00:00.000Z`);
  return raw && !Number.isNaN(date.getTime()) ? date : null;
}

/**
 * Issues a DRAFT: from here it counts as committed, and its lines are locked.
 * The status test is in the write, so two presses cannot both issue. Nothing is
 * sent to the vendor; the document is downloaded and sent by a person.
 */
export async function issuePurchaseOrder(purchaseOrderId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const context = await requireCompanyContext();
    if (!can(context, "VIEW_JOB_COSTS")) return fail(COSTS_ONLY);
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, companyId: context.company.id },
      select: { id: true, jobId: true, number: true, _count: { select: { lines: true } } },
    });
    if (!po) return fail("That purchase order is gone. Reload the page.");
    if (po._count.lines === 0) return fail(`PO ${po.number} has no lines to issue.`);
    const issuedOn = enteredDay(formData, "issuedOn");
    if (!issuedOn) return fail("Enter the date this was issued.");

    const { count } = await prisma.purchaseOrder.updateMany({
      where: { id: po.id, status: "DRAFT" },
      data: { status: "ISSUED", issuedOn },
    });
    if (count === 0) return fail(`PO ${po.number} has already been issued.`);

    revalidatePath(`/jobs/${po.jobId}`);
    return ok;
  });
}

/** Closes an ISSUED order. Closed still counts as committed: the money was
 * agreed. A PO is evidence, so it closes and never deletes. */
export async function closePurchaseOrder(purchaseOrderId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const context = await requireCompanyContext();
    if (!can(context, "VIEW_JOB_COSTS")) return fail(COSTS_ONLY);
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, companyId: context.company.id },
      select: { id: true, jobId: true, number: true, issuedOn: true },
    });
    if (!po) return fail("That purchase order is gone. Reload the page.");
    const closedOn = enteredDay(formData, "closedOn");
    if (!closedOn) return fail("Enter the date this was closed.");
    if (po.issuedOn && closedOn < po.issuedOn) return fail("A purchase order can't close before it was issued.");

    const { count } = await prisma.purchaseOrder.updateMany({
      where: { id: po.id, status: "ISSUED" },
      data: { status: "CLOSED", closedOn },
    });
    if (count === 0) return fail(`Only an issued purchase order can be closed. PO ${po.number} is not issued.`);

    revalidatePath(`/jobs/${po.jobId}`);
    return ok;
  });
}

/**
 * Takes a line off a DRAFT purchase order. Taking the last one removes the
 * draft; its number is not reissued, because the counter only goes up. Nothing
 * past DRAFT changes here: that is a commitment and a vendor has it.
 */
export async function removePurchaseOrderLine(lineId: string): Promise<ActionResult> {
  return runAction(async () => {
    const context = await requireCompanyContext();
    if (!can(context, "VIEW_JOB_COSTS")) return fail(COSTS_ONLY);
    const line = await prisma.purchaseOrderLine.findFirst({
      where: { id: lineId, purchaseOrder: { companyId: context.company.id } },
      select: { id: true, purchaseOrder: { select: { id: true, jobId: true, status: true, number: true } } },
    });
    if (!line) return fail("That line is gone. Reload the page.");
    const po = line.purchaseOrder;
    if (po.status !== "DRAFT") return fail(`PO ${po.number} has been issued, so its lines stay as they are.`);

    await prisma.$transaction(async (tx) => {
      await tx.purchaseOrderLine.delete({ where: { id: line.id } });
      const left = await tx.purchaseOrderLine.count({ where: { purchaseOrderId: po.id } });
      if (left === 0) await tx.purchaseOrder.delete({ where: { id: po.id } });
    });

    revalidatePath(`/jobs/${po.jobId}`);
    return ok;
  });
}
