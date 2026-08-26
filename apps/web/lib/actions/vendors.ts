"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { assertOwner, tradeScopeFromForm } from "./shared";

/** Adds a supplier/vendor to the company directory. Trade scope is
 * optional — reuses tradeScopeFromForm, where an empty selection means
 * "serves any trade" rather than an error. */
export async function createVendor(formData: FormData) {
  const { company } = await requireCompanyContext();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    throw new Error("Vendor name is required");
  }

  const contactName = String(formData.get("contactName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  await prisma.vendor.create({
    data: {
      companyId: company.id,
      name,
      tradeScope: tradeScopeFromForm(formData),
      contactName: contactName || null,
      phone: phone || null,
      email: email || null,
      notes: notes || null,
    },
  });

  revalidatePath("/vendors");
}

/** Removes a vendor. Owner-only, matching how every other company-level
 * record deletion is gated. */
export async function deleteVendor(vendorId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || vendor.companyId !== company.id) {
    throw new Error("Vendor not found");
  }

  await prisma.vendor.delete({ where: { id: vendorId } });

  revalidatePath("/vendors");
}

/** Edits a vendor in place. Same field rules as createVendor — an empty
 * optional field means "not set", not "leave unchanged", so the form
 * always submits every field. */
export async function updateVendor(vendorId: string, formData: FormData) {
  const { company } = await requireCompanyContext();

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || vendor.companyId !== company.id) {
    throw new Error("Vendor not found");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    throw new Error("Vendor name is required");
  }

  const contactName = String(formData.get("contactName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  await prisma.vendor.update({
    where: { id: vendorId },
    data: {
      name,
      tradeScope: tradeScopeFromForm(formData),
      contactName: contactName || null,
      phone: phone || null,
      email: email || null,
      notes: notes || null,
    },
  });

  revalidatePath("/vendors");
}
// ---------------------------------------------------------------------------
// Equipment (Cyrus's lane — WORK-SPLIT.md task 4).
// ---------------------------------------------------------------------------
