"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { actionFail as fail, actionOk as ok, type ActionResult } from "./shared";

/** Failures are RETURNED — production redacts a thrown Server Action
 * message to a digest. */

const TIERS = ["JOURNEYMAN", "APPRENTICE", "FOREMAN"] as const;

/**
 * Records whether a craft classification is journeyman-side or
 * apprentice-side.
 *
 * `CraftClassification` is a GLOBAL reference table, so this edit is
 * visible to every company working under the same local. That is
 * deliberate and correct: whether "Drywall Finisher Apprentice Period 3"
 * is an apprentice classification is a fact about the classification, not
 * an opinion one company holds about it — the same reasoning that makes
 * `name` global. Access is gated by the company actually holding an
 * agreement with that local, which is the same join
 * craftClassificationIdFromForm already uses as its access check.
 */
export async function setCraftTier(craftId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  const craft = await prisma.craftClassification.findFirst({
    where: { id: craftId, unionLocal: { companyAgreements: { some: { companyId: company.id } } } },
  });
  if (!craft) {
    return fail("That classification isn't under a local you hold an agreement with");
  }

  const raw = String(formData.get("tier") ?? "").trim();
  const periodRaw = String(formData.get("apprenticePeriod") ?? "").trim();

  // Empty is a real value: nobody has said. The ratio check reports those
  // hours as unclassified rather than counting them as journeyman hours,
  // so clearing a tier makes a job read INCOMPLETE — never compliant.
  if (raw === "") {
    await prisma.craftClassification.update({
      where: { id: craft.id },
      data: { tier: null, apprenticePeriod: null },
    });
    revalidatePath("/union-compliance");
    return ok;
  }

  if (!TIERS.includes(raw as (typeof TIERS)[number])) {
    return fail("That isn't one of the classification tiers");
  }

  let apprenticePeriod: number | null = null;
  if (raw === "APPRENTICE" && periodRaw) {
    const value = Number(periodRaw);
    if (!Number.isInteger(value) || value < 1 || value > 10) {
      return fail("An apprentice period is a whole number between 1 and 10");
    }
    apprenticePeriod = value;
  }

  await prisma.craftClassification.update({
    where: { id: craft.id },
    // A period only means anything on an apprentice; moving a
    // classification to journeyman clears it rather than leaving a stale
    // "period 3" hanging off a journeyman row.
    data: { tier: raw as (typeof TIERS)[number], apprenticePeriod },
  });

  revalidatePath("/union-compliance");
  return ok;
}
