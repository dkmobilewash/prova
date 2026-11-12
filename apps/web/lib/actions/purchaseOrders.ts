"use server";

import { revalidatePath } from "next/cache";
import { Prisma, prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { parseNumericInput } from "@/lib/numeric-input";
import { unitKey } from "@/components/vendorPricing";
import { actionFail as fail, actionOk as ok, runAction, type ActionResult, type ActionResultWith } from "./shared";
import { planMaterialOrder } from "@/lib/estimating/materialOrder";
import { standardsFrom } from "@/lib/estimating/assemblyStandards";
import { viewerAsOf } from "@/lib/viewerToday";

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

export type MaterialOrderResult = {
  orders: { id: string; number: number; phase: string | null; lines: number; amount: number }[];
  skipped: { description: string; why: string }[];
};

/**
 * ── "ORDER MATERIALS": THE ESTIMATE'S MATERIAL LINES AS DRAFT POs FOR ONE SUPPLIER ──
 *
 * Every material line the supplier's imported price list (#1094) prices becomes a
 * DRAFT PO line: the supplier's words, whole packs rounded UP, the pack's price
 * (`lib/estimating/materialOrder.ts`). One draft per phase code the lines carry, and
 * one for the lines with none. What the list cannot price is skipped and named.
 *
 * DRAFT ONLY, THE EXISTING FLOW. Nothing is issued or sent: the person checks the
 * drafts on Buyout, issues them and emails them as for any PO. Like every buyout,
 * a job must be contracted first. A second press while a draft from this supplier
 * is open is refused, so nothing is ordered twice; the draft is edited on Buyout.
 */
export async function orderMaterials(jobId: string, vendorId: string): Promise<ActionResultWith<MaterialOrderResult>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return fail(COSTS_ONLY) as ActionResultWith<never>;
  const companyId = context.company.id;
  const job = await prisma.job.findFirst({ where: { id: jobId, companyId }, select: { id: true, status: true, isSample: true } });
  if (!job) return fail("That job is no longer here. Reload the page.") as ActionResultWith<never>;
  if (job.status === "ESTIMATE") return fail("Contract this job before ordering its materials.") as ActionResultWith<never>;
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, companyId }, select: { id: true, name: true } });
  if (!vendor) return fail("Pick a supplier.") as ActionResultWith<never>;
  const open = await prisma.purchaseOrder.findFirst({ where: { jobId, vendorId: vendor.id, status: "DRAFT" }, orderBy: { number: "asc" }, select: { number: true } });
  if (open) return fail(`PO ${open.number} from ${vendor.name} is still a draft on this job. Finish or remove it on Buyout before ordering again.`) as ActionResultWith<never>;

  const today = await viewerAsOf();
  const [lines, quotes, defaults] = await Promise.all([
    prisma.jobLineItem.findMany({
      where: { jobId, isDeleted: false, costCategory: "MATERIAL" },
      orderBy: { sortOrder: "asc" },
      select: { id: true, description: true, quantity: true, unit: true, sourceCatalogEntryId: true, phaseCode: { select: { id: true, code: true, name: true } } },
    }),
    prisma.vendorPriceQuote.findMany({
      where: { companyId, vendorId: vendor.id, catalogEntryId: { not: null }, OR: [{ validUntil: null }, { validUntil: { gte: today } }] },
      orderBy: [{ quotedOn: "desc" }, { createdAt: "desc" }],
      select: { id: true, catalogEntryId: true, description: true, unit: true, unitPrice: true },
    }),
    prisma.companyBidDefaults.findUnique({ where: { companyId }, select: { assemblyStandards: true, defaultWastePercent: true } }),
  ]);
  const rollLf = standardsFrom(defaults?.assemblyStandards, defaults?.defaultWastePercent == null ? null : Number(defaults.defaultWastePercent)).tapeRollLf;
  const plan = planMaterialOrder(
    lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: Number(line.quantity),
      unit: line.unit,
      phase: line.phaseCode,
      quotes: quotes
        .filter((q) => line.sourceCatalogEntryId !== null && q.catalogEntryId === line.sourceCatalogEntryId)
        .map((q) => ({ id: q.id, description: q.description, unit: q.unit, unitPrice: Number(q.unitPrice) })),
    })),
    vendor.name,
    rollLf,
  );
  if (plan.orders.length === 0) {
    return fail(lines.length === 0 ? "This estimate has no material lines to order." : `Nothing on this estimate is on ${vendor.name}'s price list. Import their list on the Price book, or order by hand on Buyout.`) as ActionResultWith<never>;
  }
  const costCategory = "MATERIAL" as const;
  const orders = await prisma.$transaction(async (tx) => {
    const made: MaterialOrderResult["orders"] = [];
    for (const order of plan.orders) {
      const number = await issuePurchaseOrderNumber(tx, jobId);
      const po = await tx.purchaseOrder.create({ data: { companyId, jobId, vendorId: vendor.id, number, createdByUserId: context.id }, select: { id: true } });
      await tx.purchaseOrderLine.createMany({
        data: order.lines.map((l) => ({ purchaseOrderId: po.id, lineItemId: l.lineItemId, description: l.description, unit: l.unit, quantity: l.quantity.toFixed(2), unitPrice: l.unitPrice.toFixed(2), costCategory, vendorPriceQuoteId: l.quoteId })),
      });
      made.push({ id: po.id, number, phase: order.phase ? `${order.phase.code} ${order.phase.name}` : null, lines: order.lines.length, amount: order.lines.reduce((n, l) => n + Number(l.quantity.toFixed(2)) * Number(l.unitPrice.toFixed(2)), 0) });
    }
    return made;
  });
  revalidatePath(`/jobs/${jobId}`, "layout");
  return { ok: true, value: { orders, skipped: plan.skipped } };
}
