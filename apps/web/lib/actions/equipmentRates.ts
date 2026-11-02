"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { EQUIPMENT_RATE_UNITS, overlapProblem, type EquipmentRateUnit } from "@/lib/equipment-rates";
import { prisma } from "@prova/db";
import { actionFail as fail, actionOk as ok, ownerRefusal, type ActionResult } from "./shared";

/** Rates are costs, so they answer to job cost access, like the change order form
 * that reads them. Refused in a sentence, because production redacts a throw. */
const COSTS_ONLY = "Job costs aren't part of your job function. The account owner sets who sees what, on the Team page.";
const PATH = "/equipment/rates";

function day(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) ? value : "";
}

const utc = (value: string) => new Date(`${value}T00:00:00.000Z`);

function read(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name the equipment." };
  const unit = String(formData.get("unit") ?? "") as EquipmentRateUnit;
  if (!EQUIPMENT_RATE_UNITS.some((row) => row.value === unit)) return { error: "Choose hour, day or week." };
  const raw = String(formData.get("rate") ?? "").trim().replace(/[$,]/g, "");
  const rate = Number(raw);
  if (!/^\d+(\.\d{1,2})?$/.test(raw) || rate <= 0 || rate >= 1e10) return { error: "Enter the rate in dollars, such as 450.00." };
  const effectiveFrom = day(formData, "effectiveFrom");
  if (!effectiveFrom) return { error: "Enter the date this rate starts." };
  const typedEnd = String(formData.get("effectiveTo") ?? "").trim();
  const effectiveTo = day(formData, "effectiveTo") || null;
  if (typedEnd && !effectiveTo) return { error: "That end date could not be read." };
  if (effectiveTo && effectiveTo < effectiveFrom) return { error: "The end date can't be before the start date." };
  const notes = String(formData.get("notes") ?? "").trim() || null;
  return { name, unit, rate, effectiveFrom, effectiveTo, notes };
}

async function clash(companyId: string, candidate: Parameters<typeof overlapProblem>[0]) {
  const rows = await prisma.equipmentRate.findMany({
    where: { companyId, unit: candidate.unit },
    select: { id: true, name: true, unit: true, effectiveFrom: true, effectiveTo: true },
  });
  return overlapProblem(
    candidate,
    rows.map((row) => ({
      ...row,
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
    })),
  );
}

const columns = (fields: { name: string; unit: EquipmentRateUnit; rate: number; effectiveFrom: string; effectiveTo: string | null; notes: string | null }) => ({
  name: fields.name,
  unit: fields.unit,
  rate: fields.rate.toFixed(2),
  effectiveFrom: utc(fields.effectiveFrom),
  effectiveTo: fields.effectiveTo ? utc(fields.effectiveTo) : null,
  notes: fields.notes,
});

export async function createEquipmentRate(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return fail(COSTS_ONLY);
  const fields = read(formData);
  if ("error" in fields) return fail(fields.error ?? "");
  const problem = await clash(context.company.id, fields);
  if (problem) return fail(problem);
  await prisma.equipmentRate.create({ data: { companyId: context.company.id, ...columns(fields) } });
  revalidatePath(PATH);
  return ok;
}

export async function updateEquipmentRate(rateId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return fail(COSTS_ONLY);
  const fields = read(formData);
  if ("error" in fields) return fail(fields.error ?? "");
  const problem = await clash(context.company.id, { ...fields, id: rateId });
  if (problem) return fail(problem);
  const { count } = await prisma.equipmentRate.updateMany({ where: { id: rateId, companyId: context.company.id }, data: columns(fields) });
  if (count === 0) return fail("That rate is gone. Reload the page.");
  revalidatePath(PATH);
  return ok;
}

/** Nothing depends on a rate once it is written onto a change order, so this
 * loses only the rate. */
export async function deleteEquipmentRate(rateId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return fail(COSTS_ONLY);
  const refusal = ownerRefusal(context, "Only the account owner can remove an equipment rate.");
  if (refusal) return refusal;
  const { count } = await prisma.equipmentRate.deleteMany({ where: { id: rateId, companyId: context.company.id } });
  if (count === 0) return fail("That rate is gone. Reload the page.");
  revalidatePath(PATH);
  return ok;
}
