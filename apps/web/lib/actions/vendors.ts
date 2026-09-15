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
  tradeScopeFromForm,
  type ActionResult,
} from "./shared";

/** Actions in this module RETURN their failures instead of throwing them.
 *
 * "Vendor name is required" was thrown, and production replaces a thrown
 * Server Action message with React's own "the specific message is omitted in
 * production builds" paragraph — so nobody adding a vendor has ever been
 * told which field was empty. `throw` is reserved for genuine bugs, which
 * SHOULD be redacted. `submittals.ts` is the reference for this shape.
 *
 * No capability check here, unlike punchLists.ts and equipment.ts: `/vendors`
 * is not in `ROUTE_CAPABILITY` (lib/permissions.ts), so the page is open to
 * everyone in the company and gating the action would refuse people the page
 * admits. That asymmetry is the page's decision to change, not this file's.
 */

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/** Read the same way for create and edit, so the two forms cannot disagree
 * about what a valid vendor is. An empty optional field means "not set"
 * rather than "leave unchanged", which is why the form always submits all
 * of them. */
function readFields(formData: FormData) {
  const name = text(formData, "name");
  if (!name) throw new InputError("Vendor name is required");

  return {
    name,
    // An empty selection means "serves any trade", not an error.
    tradeScope: tradeScopeFromForm(formData),
    contactName: text(formData, "contactName") || null,
    phone: text(formData, "phone") || null,
    email: text(formData, "email") || null,
    notes: text(formData, "notes") || null,
  };
}

async function findOwnVendor(vendorId: string, companyId: string) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || vendor.companyId !== companyId) return null;
  return vendor;
}

/** Adds a supplier/vendor to the company directory. */
export async function createVendor(formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    await prisma.vendor.create({
      data: { companyId: company.id, ...readFields(formData) },
    });

    revalidatePath("/vendors");
    return ok;
  });
}

/** Removes a vendor. Owner-only, matching how every other company-level
 * record deletion is gated. */
export async function deleteVendor(vendorId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    // `ownerRefusal`, not `assertOwner`: this action's declared type promises
    // a sentence the row can render, and `assertOwner` throws it instead.
    const refusal = ownerRefusal(context, "Only the account owner can remove a vendor");
    if (refusal) return refusal;

    const vendor = await findOwnVendor(vendorId, company.id);
    if (!vendor) return fail("Vendor not found");

    // MATERIAL ORDERS BLOCK THE DELETE, and this guard exists because the
    // database already refused it — just unreadably. `MaterialOrder.vendor`
    // has no `onDelete` (operations.prisma), so it is RESTRICT: deleting a
    // vendor with orders against it raised a raw Prisma foreign-key error,
    // which production redacts, so the Remove button appeared to do nothing
    // at all. Now it says what is in the way and how many.
    //
    // Counted rather than assumed to be zero, and named rather than
    // summarised — the same shape as `deleteSalesLead`, which refuses while
    // any child row exists and names the kinds that are non-zero.
    const orders = await prisma.materialOrder.count({ where: { vendorId: vendor.id } });
    if (orders > 0) {
      return fail(
        `${vendor.name} is on ${plural(orders, "material order", "material orders")}, so the record stays — ` +
          `deleting it would leave those orders with nobody on the hook for them.`,
      );
    }

    await prisma.vendor.delete({ where: { id: vendor.id } });

    revalidatePath("/vendors");
    return ok;
  });
}

/** Edits a vendor in place. */
export async function updateVendor(vendorId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const vendor = await findOwnVendor(vendorId, company.id);
    if (!vendor) return fail("Vendor not found");

    await prisma.vendor.update({
      where: { id: vendor.id },
      data: readFields(formData),
    });

    revalidatePath("/vendors");
    return ok;
  });
}
