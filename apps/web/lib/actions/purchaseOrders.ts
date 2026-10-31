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
