"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import {
  actionFail as fail,
  actionOk as ok,
  InputError,
  ownerRefusal,
  plural,
  runAction,
  type ActionResult,
} from "./shared";
import { can } from "@/lib/permissions";
import { issuePurchaseOrderNumber } from "@/lib/purchasing/purchase-order-number";

/**
 * Purchase orders — the priced commitment to a vendor. See
 * `packages/db/prisma/schema/purchasing.prisma` for how this differs from a
 * material order, which is the delivery half and carries no money at all.
 *
 * EVERY ACTION HERE RETURNS ITS FAILURES INSTEAD OF THROWING THEM. Next.js
 * redacts the message of any error thrown from a Server Action in a
 * production build (verified 2026-08-27 against a real production build),
 * so a thrown refusal renders as a dead button: the click does nothing and
 * nothing says why. `lib/actions/submittals.ts` is the reference shape.
 *
 * THE CAPABILITY CHECK IS THE FIRST STATEMENT IN EVERY ONE OF THEM, before
 * any query. A Server Action is its own HTTP endpoint with a stable id and
 * answers whoever posts to it — a guarded page in front of an open action
 * is not a guard. `lib/action-capability-guards.test.ts` executes each of
 * these as a principal without MANAGE_BILLING and fails the build if any of
 * them touches the database first.
 */

/** Why MANAGE_BILLING rather than the MANAGE_FIELD that material orders
 * carry, since the two sit next to each other in the nav and this is the
 * one arguable decision in the package.
 *
 * A purchase order is a priced commitment of the company's own money: unit
 * costs, extended totals, payment terms. `MANAGE_FIELD`'s own definition in
 * lib/permissions.ts says the FIELD function's exclusion from cost and
 * billing is "not withheld out of distrust — they are simply not this job",
 * and a document whose entire content is what we are paying is exactly that
 * kind of number. `MANAGE_ESTIMATING` was the other candidate and is worse:
 * it would admit an estimator, who does not commit company money, and
 * refuse ACCOUNTING, who has to match this document against the vendor's
 * invoice when it arrives.
 *
 * So: EXECUTIVE, PROJECT_MANAGER and ACCOUNTING. The PM raises it, the
 * accountant reconciles it, and an owner holds every capability regardless.
 */
const BILLING_ONLY =
  "Purchase orders aren't part of your job function. The account owner sets who sees what, on the Team page.";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required`);
  return value;
}

/** Stored at UTC midnight so a date comparison is a calendar-day
 * comparison rather than an instant comparison — the same rule every other
 * date in this app is stored under. */
function optionalDate(formData: FormData, key: string): Date | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new InputError("Date is not valid");
  return date;
}

function requiredDate(formData: FormData, key: string, label: string): Date {
  const date = optionalDate(formData, key);
  if (!date) throw new InputError(`${label} is required`);
  return date;
}

/** A quantity or a unit cost, as a string Prisma hands straight to a
 * `Decimal(12, 2)` column — parsing it to a JS number here and back again
 * would be a lossy round trip for no reason.
 *
 * NEGATIVES ARE REFUSED. A negative quantity or a negative unit cost makes
 * an order total that is smaller than the lines it is made of, which reads
 * as arithmetic being wrong rather than as a credit being recorded. A
 * credit from a vendor is a real thing and it is not a purchase order. */
function decimal(formData: FormData, key: string, label: string): string {
  const raw = required(formData, key, label);
  const value = Number(raw);
  if (Number.isNaN(value)) throw new InputError(`${label} must be a number`);
  if (value < 0) throw new InputError(`${label} can't be negative`);
  return raw;
}

async function findOrder(orderId: string, companyId: string) {
  const order = await prisma.purchaseOrder.findUnique({
    where: { id: orderId },
    include: { lines: true },
  });
  if (!order || order.companyId !== companyId) return null;
  return order;
}

/** Validates the optional cost-code link on a line. Must be a live SOV line
 * on the SAME job as the order — a line from another job would attribute a
 * commitment to scope it has nothing to do with. Attribution only: no money
 * is read from or written through it. */
async function optionalLineItemId(formData: FormData, jobId: string): Promise<string | null> {
  const id = text(formData, "lineItemId");
  if (!id) return null;
  const line = await prisma.jobLineItem.findUnique({ where: { id } });
  if (!line || line.jobId !== jobId) throw new InputError("That cost code isn't on this job");
  return line.id;
}

/** Raises a purchase order. Header only — lines are added one at a time
 * afterwards, which is how the order is written in real life and is what
 * the customer described: you pick the vendor and the job, and then enter
 * what you are buying line by line. */
export async function createPurchaseOrder(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company, ...user } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_BILLING")) return fail(BILLING_ONLY);

    const jobId = required(formData, "jobId", "Job");
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.companyId !== company.id) return fail("Job not found");

    const vendorId = required(formData, "vendorId", "Vendor");
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor || vendor.companyId !== company.id) return fail("Vendor not found");

    const awardedOn = requiredDate(formData, "awardedOn", "Date awarded");
    const expectedOn = optionalDate(formData, "expectedOn");
    if (expectedOn && expectedOn < awardedOn) {
      return fail("The expected date can't be before the order was awarded");
    }

    // The number and the insert are ONE transaction. Split them and two
    // orders raised at the same moment on one job both read the same
    // counter and the second collides on @@unique([jobId, number]).
    await prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.create({
        data: {
          companyId: company.id,
          jobId,
          number: await issuePurchaseOrderNumber(tx, jobId),
          vendorId,
          title: required(formData, "title", "What this order is for"),
          shipToAddress: text(formData, "shipToAddress") || null,
          paymentTerms: text(formData, "paymentTerms") || null,
          awardedOn,
          expectedOn,
          notes: text(formData, "notes") || null,
          issuedByUserId: user.id,
        },
      });
    });

    revalidatePath("/purchase-orders");
    return ok;
  });
}

/** Edits an order's heading. The job and the number are deliberately not
 * editable: they are what the vendor files the order under and what their
 * invoice will quote back, so moving either one retroactively rewrites a
 * commitment somebody is holding a copy of. */
export async function updatePurchaseOrder(orderId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_BILLING")) return fail(BILLING_ONLY);

    const order = await findOrder(orderId, company.id);
    if (!order) return fail("Purchase order not found");

    const vendorId = required(formData, "vendorId", "Vendor");
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor || vendor.companyId !== company.id) return fail("Vendor not found");

    const awardedOn = requiredDate(formData, "awardedOn", "Date awarded");
    const expectedOn = optionalDate(formData, "expectedOn");
    if (expectedOn && expectedOn < awardedOn) {
      return fail("The expected date can't be before the order was awarded");
    }

    await prisma.purchaseOrder.update({
      where: { id: order.id },
      data: {
        vendorId,
        title: required(formData, "title", "What this order is for"),
        shipToAddress: text(formData, "shipToAddress") || null,
        paymentTerms: text(formData, "paymentTerms") || null,
        awardedOn,
        expectedOn,
        notes: text(formData, "notes") || null,
      },
    });

    revalidatePath("/purchase-orders");
    return ok;
  });
}

/** Removes an order raised in error. Owner-only, and only while it is
 * empty.
 *
 * `ownerRefusal`, not `assertOwner`: this action's declared type promises a
 * sentence the row can render, and `assertOwner` throws it instead — which
 * production redacts to a digest. `ownerRefusalCensus.test.ts` fails the
 * build if that ever slips back.
 *
 * The number is NOT freed by this. `PurchaseOrderCounter` only increments,
 * so PO 3 stays retired and the next one is 4 — which is the whole reason
 * the number comes from a counter rather than from `max(number) + 1`. */
export async function deletePurchaseOrder(orderId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_BILLING")) return fail(BILLING_ONLY);

    const refusal = ownerRefusal(context, "Only the account owner can delete a purchase order");
    if (refusal) return refusal;

    const order = await findOrder(orderId, context.company.id);
    if (!order) return fail("Purchase order not found");

    // An order with lines on it is a priced commitment somebody wrote out,
    // and the database would take the lines with it (they cascade). Refuse
    // and name the count instead, so removing one is a deliberate act of
    // emptying it first rather than a click that quietly takes five lines.
    if (order.lines.length > 0) {
      return fail(
        `This order has ${plural(order.lines.length, "line", "lines")} on it. ` +
          `Remove the lines first if it was raised in error — deleting it would take them with it.`,
      );
    }

    await prisma.purchaseOrder.delete({ where: { id: order.id } });

    revalidatePath("/purchase-orders");
    return ok;
  });
}

/** Adds one line to an order: cost code, description, quantity, unit, unit
 * cost. The extended total is not stored — see
 * `components/purchaseOrderTotals.ts`. */
export async function addPurchaseOrderLine(orderId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_BILLING")) return fail(BILLING_ONLY);

    const order = await findOrder(orderId, company.id);
    if (!order) return fail("Purchase order not found");

    // Appended at the end, in the order the person entered them — which is
    // the order they will read them back in. Computed from the lines this
    // order already has rather than from a count, so a removed line does
    // not make two lines share a position.
    const sortOrder = order.lines.reduce((highest, line) => Math.max(highest, line.sortOrder), -1) + 1;

    await prisma.purchaseOrderLine.create({
      data: {
        purchaseOrderId: order.id,
        lineItemId: await optionalLineItemId(formData, order.jobId),
        description: required(formData, "description", "Description"),
        quantity: decimal(formData, "quantity", "Quantity"),
        unit: text(formData, "unit") || null,
        unitCost: decimal(formData, "unitCost", "Unit cost"),
        sortOrder,
      },
    });

    revalidatePath("/purchase-orders");
    return ok;
  });
}

async function findLine(lineId: string, companyId: string) {
  const line = await prisma.purchaseOrderLine.findUnique({
    where: { id: lineId },
    include: { purchaseOrder: { select: { id: true, companyId: true, jobId: true } } },
  });
  if (!line || line.purchaseOrder.companyId !== companyId) return null;
  return line;
}

export async function updatePurchaseOrderLine(lineId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_BILLING")) return fail(BILLING_ONLY);

    const line = await findLine(lineId, company.id);
    if (!line) return fail("Line not found");

    await prisma.purchaseOrderLine.update({
      where: { id: line.id },
      data: {
        lineItemId: await optionalLineItemId(formData, line.purchaseOrder.jobId),
        description: required(formData, "description", "Description"),
        quantity: decimal(formData, "quantity", "Quantity"),
        unit: text(formData, "unit") || null,
        unitCost: decimal(formData, "unitCost", "Unit cost"),
      },
    });

    revalidatePath("/purchase-orders");
    return ok;
  });
}

/** Removes a line. Not owner-gated, unlike deleting the order itself: a
 * mistyped line on an order nobody has sent is an ordinary correction, and
 * the order — the thing with a number on it — stays. */
export async function deletePurchaseOrderLine(lineId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_BILLING")) return fail(BILLING_ONLY);

    const line = await findLine(lineId, company.id);
    if (!line) return fail("Line not found");

    await prisma.purchaseOrderLine.delete({ where: { id: line.id } });

    revalidatePath("/purchase-orders");
    return ok;
  });
}
