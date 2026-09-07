"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { Prisma, prisma } from "@prova/db";
import { actionFail as fail, actionOk as ok, assertOwner, type ActionResult } from "./shared";
import { can } from "@/lib/permissions";

/** Every entry point to these records is a page guarded by MANAGE_FIELD,
 * so every write here answers to the same capability. A guarded page in
 * front of an open action is not a guard: a Server Action is its own
 * endpoint and answers whoever posts to it.
 *
 * Returned rather than thrown — production redacts a thrown Server
 * Action message, so the sentence explaining why the button did nothing
 * would never arrive. Same reasoning as the owner check in
 * deleteCloseoutSubmission. */
const FIELD_ONLY =
  "Field records aren't part of your job function. The account owner sets who sees what, on the Team page.";

/** Actions in this module RETURN their failures instead of throwing them.
 *
 * Next.js redacts the message of any error thrown from a Server Action in
 * a production build — verified on 2026-08-27 against a real production
 * build, not inferred. The `ActionResult` type and its helpers live in
 * `./shared` so every feature returns the identical shape — see the note
 * there. `lib/actions/submittals.ts` is the reference implementation.
 */

/** Thrown by the parsers below, caught at each action's boundary and
 * converted to a returned failure. Anything else that throws is a real
 * bug and is rethrown. */
class InputError extends Error {}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required`);
  return value;
}

/** Stored at UTC midnight so date comparisons are calendar-day
 * comparisons, not instant comparisons — same rule as RFIs and
 * submittals. */
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

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }
}

async function findOrder(orderId: string, companyId: string) {
  const order = await prisma.materialOrder.findUnique({
    where: { id: orderId },
    include: { deliveries: { orderBy: { deliveredOn: "asc" } } },
  });
  if (!order || order.companyId !== companyId) return null;
  return order;
}

/** Issues the next material order number for a job. Reads nothing from
 * MaterialOrder on purpose — same counter rule as RFI, submittal and
 * safety case numbers. A number derived from surviving rows is reissued
 * the moment the highest row is deleted, and then two different orders
 * carry one number in the same purchasing conversation. */
async function issueOrderNumber(tx: Prisma.TransactionClient, jobId: string) {
  const counter = await tx.materialOrderCounter.upsert({
    where: { jobId },
    create: { jobId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return counter.lastNumber;
}


/** Validates an optional SOV line for attribution. Must belong to the SAME
 * job as the order — a line from another job would attribute a delivery to
 * scope it has nothing to do with. Attribution only: no money is read from
 * or written through this. */
async function optionalLineItemId(formData: FormData, jobId: string): Promise<string | null> {
  const id = text(formData, "lineItemId");
  if (!id) return null;
  const line = await prisma.jobLineItem.findUnique({ where: { id } });
  if (!line || line.jobId !== jobId) throw new InputError("That line item isn't on this job");
  return line.id;
}

export async function createMaterialOrder(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company, ...user } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);
    const jobId = required(formData, "jobId", "Job");
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.companyId !== company.id) return fail("Job not found");

    const vendorId = required(formData, "vendorId", "Vendor");
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor || vendor.companyId !== company.id) return fail("Vendor not found");

    const description = required(formData, "description", "What was ordered");

    // Entered, not stamped: logging orders you placed last week must not
    // record them all as ordered today.
    const orderedOn = requiredDate(formData, "orderedOn", "Date ordered");
    const promisedFor = optionalDate(formData, "promisedFor");
    if (promisedFor && promisedFor < orderedOn) {
      return fail("The promised date can't be before the order was placed");
    }

    await prisma.$transaction(async (tx) => {
      await tx.materialOrder.create({
        data: {
          companyId: company.id,
          jobId,
          number: await issueOrderNumber(tx, jobId),
          vendorId,
          description,
          vendorReference: text(formData, "vendorReference") || null,
          notes: text(formData, "notes") || null,
          orderedOn,
          promisedFor,
          lineItemId: await optionalLineItemId(formData, jobId),
          orderedByUserId: user.id,
        },
      });
    });

    revalidatePath("/material-orders");
    return ok;
  });
}

export async function updateMaterialOrder(orderId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);
    const order = await findOrder(orderId, company.id);
    if (!order) return fail("Order not found");

    const vendorId = required(formData, "vendorId", "Vendor");
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor || vendor.companyId !== company.id) return fail("Vendor not found");

    // The promised date is the only date editable here: a vendor moving
    // their own commitment is the normal case and has to be recordable.
    // Job, number and the ordered date are not editable — they are what
    // every delivery under this order is measured against, and moving the
    // start of the clock retroactively would rewrite the lateness of
    // deliveries already recorded.
    const promisedFor = optionalDate(formData, "promisedFor");
    if (promisedFor && promisedFor < order.orderedOn) {
      return fail("The promised date can't be before the order was placed");
    }

    await prisma.materialOrder.update({
      where: { id: order.id },
      data: {
        vendorId,
        description: required(formData, "description", "What was ordered"),
        vendorReference: text(formData, "vendorReference") || null,
        notes: text(formData, "notes") || null,
        promisedFor,
        lineItemId: await optionalLineItemId(formData, order.jobId),
      },
    });

    revalidatePath("/material-orders");
    return ok;
  });
}

/** Records one delivery against an order. Partial deliveries are normal,
 * so this appends rather than overwriting. */
export async function recordMaterialDelivery(orderId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);
    const order = await findOrder(orderId, company.id);
    if (!order) return fail("Order not found");

    const deliveredOn = requiredDate(formData, "deliveredOn", "Date delivered");
    if (deliveredOn < order.orderedOn) {
      return fail("It can't have arrived before it was ordered");
    }

    // Read the closing delivery INSIDE the transaction. Checked outside,
    // two people receiving the same truck both pass the guard and the
    // order ends up closed out twice, with two different "this completed
    // it" dates and no way to tell which one the vendor is owed against.
    await prisma.$transaction(async (tx) => {
      const closing = await tx.materialOrderDelivery.findFirst({
        where: { orderId: order.id, completesOrder: true },
      });
      if (closing) {
        throw new InputError(
          `This order was closed out by the delivery on ${isoDay(closing.deliveredOn)} — delete that delivery first if more is still coming`,
        );
      }
      await tx.materialOrderDelivery.create({
        data: {
          orderId: order.id,
          deliveredOn,
          completesOrder: text(formData, "completesOrder") === "on",
          notes: text(formData, "notes") || null,
        },
      });
    });

    revalidatePath("/material-orders");
    return ok;
  });
}

/** Removes a mis-entered delivery. This is also how an order that was
 * wrongly closed out gets reopened. */
export async function deleteMaterialDelivery(deliveryId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);
    const delivery = await prisma.materialOrderDelivery.findUnique({
      where: { id: deliveryId },
      include: { order: { select: { companyId: true } } },
    });
    if (!delivery || delivery.order.companyId !== company.id) return fail("Delivery not found");

    await prisma.materialOrderDelivery.delete({ where: { id: delivery.id } });

    revalidatePath("/material-orders");
    return ok;
  });
}

export async function deleteMaterialOrder(orderId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);
    try {
      assertOwner(context, "Only the account owner can delete a material order");
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Only the account owner can do that");
    }
    const order = await findOrder(orderId, context.company.id);
    if (!order) return fail("Order not found");

    // Once something has physically shown up against this order, the
    // record of what arrived and when is the point of it. The number
    // stays retired either way, so deleting frees nothing.
    if (order.deliveries.length > 0) {
      return fail(
        "Something has already been delivered against this order, so its record stays. Delete the deliveries first if it was logged in error.",
      );
    }

    await prisma.materialOrder.delete({ where: { id: order.id } });
    revalidatePath("/material-orders");
    return ok;
  });
}
