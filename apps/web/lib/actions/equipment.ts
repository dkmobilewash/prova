"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { assertOwner } from "./shared";

/* `assignedJobIdFromForm` used to live here. Where a piece of equipment is
 * now comes from `EquipmentAssignment` — the newest stay with no return
 * date — so this no longer writes `Equipment.assignedJobId`, and the form
 * no longer offers it. Leaving the control in place while nothing read the
 * column would have shipped a field that looks like it works and does
 * nothing, which is the same defect as the QuickBooks chart-of-accounts
 * mapping that was collected, stored, displayed and never read. */

export async function createEquipment(formData: FormData) {
  const { company } = await requireCompanyContext();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    throw new Error("Equipment name is required");
  }

  const type = String(formData.get("type") ?? "").trim();
  const assetTag = String(formData.get("assetTag") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  await prisma.equipment.create({
    data: {
      companyId: company.id,
      name,
      type: type || null,
      assetTag: assetTag || null,
      notes: notes || null,
    },
  });

  revalidatePath("/equipment");
}

export async function updateEquipment(equipmentId: string, formData: FormData) {
  const { company } = await requireCompanyContext();

  const item = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!item || item.companyId !== company.id) {
    throw new Error("Equipment not found");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    throw new Error("Equipment name is required");
  }

  const type = String(formData.get("type") ?? "").trim();
  const assetTag = String(formData.get("assetTag") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  await prisma.equipment.update({
    where: { id: equipmentId },
    data: {
      name,
      type: type || null,
      assetTag: assetTag || null,
      notes: notes || null,
    },
  });

  revalidatePath("/equipment");
}

export async function deleteEquipment(equipmentId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const item = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!item || item.companyId !== company.id) {
    throw new Error("Equipment not found");
  }

  await prisma.equipment.delete({ where: { id: equipmentId } });

  revalidatePath("/equipment");
}
