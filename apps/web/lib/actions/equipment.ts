"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@prova/db";
import {
  actionFail as fail,
  actionOk as ok,
  InputError,
  ownerRefusal,
  runAction,
  type ActionResult,
} from "./shared";

/** Every entry point to these records is a page guarded by MANAGE_FIELD,
 * so every write here answers to the same capability. A guarded page
 * in front of an open action is not a guard: the action is its own
 * endpoint and answers whoever posts to it.
 *
 * Returned rather than thrown — production redacts a thrown Server Action
 * message, so the sentence naming where access is granted would never
 * arrive. See the note below. */
const FIELD_ONLY = "Field records aren't part of your job function. The account owner sets who sees what, on the Team page.";

/** Actions in this module RETURN their failures instead of throwing them.
 *
 * "Equipment name is required" was thrown, and a thrown Server Action
 * message is replaced in production by React's own "the specific message is
 * omitted in production builds" paragraph — so a foreman who left the name
 * blank got two hundred characters about production builds. `throw` is
 * reserved for genuine bugs, which SHOULD be redacted. `submittals.ts` is
 * the reference for this shape.
 */

/* `assignedJobIdFromForm` used to live here. Where a piece of equipment is
 * now comes from `EquipmentAssignment` — the newest stay with no return
 * date — so this no longer writes `Equipment.assignedJobId`, and the form
 * no longer offers it. Leaving the control in place while nothing read the
 * column would have shipped a field that looks like it works and does
 * nothing, which is the same defect as the QuickBooks chart-of-accounts
 * mapping that was collected, stored, displayed and never read. */

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/** The one required field, plus the three optional ones, read the same way
 * for create and edit so the two forms cannot disagree. */
function readFields(formData: FormData) {
  const name = text(formData, "name");
  if (!name) throw new InputError("Equipment name is required");

  return {
    name,
    type: text(formData, "type") || null,
    assetTag: text(formData, "assetTag") || null,
    notes: text(formData, "notes") || null,
  };
}

async function findOwnEquipment(equipmentId: string, companyId: string) {
  const item = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!item || item.companyId !== companyId) return null;
  return item;
}

export async function createEquipment(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

    await prisma.equipment.create({
      data: { companyId: company.id, ...readFields(formData) },
    });

    revalidatePath("/equipment");
    return ok;
  });
}

export async function updateEquipment(equipmentId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

    const item = await findOwnEquipment(equipmentId, company.id);
    if (!item) return fail("Equipment not found");

    await prisma.equipment.update({
      where: { id: item.id },
      data: readFields(formData),
    });

    revalidatePath("/equipment");
    return ok;
  });
}

export async function deleteEquipment(equipmentId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

    // `ownerRefusal`, not `assertOwner`: this action's declared type promises
    // a sentence the row can render, and `assertOwner` throws it instead.
    // The message names the button rather than using the bare default.
    const refusal = ownerRefusal(context, "Only the account owner can remove a piece of equipment");
    if (refusal) return refusal;

    const item = await findOwnEquipment(equipmentId, company.id);
    if (!item) return fail("Equipment not found");

    // EquipmentAssignment cascades from Equipment (operations.prisma), so
    // the deployment history goes with it and there is nothing to refuse
    // for — unlike Vendor, whose material orders block the delete.
    await prisma.equipment.delete({ where: { id: item.id } });

    revalidatePath("/equipment");
    return ok;
  });
}
