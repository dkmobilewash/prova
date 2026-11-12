"use server";

import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { syncLaborLines } from "@/lib/estimating/laborLines";
import { ratesFromJson } from "@/lib/estimating/productionRates";
import { actionFail, InputError, nullableDecimalFromForm, runAction, type ActionResultWith } from "./shared";

const NO_ESTIMATING = "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";

/**
 * The company's production rates (`productionRates.ts`). A blank field stays BLANK — there is no
 * default to fall back to — and saving re-works the labor on every estimate-stage job, so a rate
 * entered today shows up on the bids still open.
 */
export async function saveProductionRates(formData: FormData): Promise<ActionResultWith<{ jobs: number }>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING) as ActionResultWith<never>;
  const companyId = context.company.id;
  let jobs = 0;
  const result = await runAction(async () => {
    const n = (key: string, label: string, max: number) => {
      const v = nullableDecimalFromForm(formData, key, { label, min: 0, max });
      if (v !== null && !(Number(v) > 0)) throw new InputError(`${label} has to be more than zero, or blank.`, key);
      return v === null ? null : Number(v);
    };
    const over10 = n("over10Multiplier", "The over-10 ft multiplier", 5);
    const over14 = n("over14Multiplier", "The over-14 ft multiplier", 5);
    if ((over10 !== null && over10 < 1) || (over14 !== null && over14 < 1)) throw new InputError("A height multiplier is 1 or more — a taller wall never goes faster.");
    const level = String(formData.get("defaultFinishLevel") ?? "4");
    const raw = {
      framingLfPerHr: n("framingLfPerHr", "Framing", 1000),
      boardSfPerHr: { regular: n("boardRegular", "Regular board", 2000), typeX: n("boardTypeX", "Type X board", 2000), special: n("boardSpecial", "Abuse, impact or moisture-resistant board", 2000) },
      finishSfPerHr: { level3: n("finishLevel3", "Level 3 finish", 2000), level4: n("finishLevel4", "Level 4 finish", 2000), level5: n("finishLevel5", "Level 5 finish", 2000) },
      defaultFinishLevel: level === "3" ? 3 : level === "5" ? 5 : 4,
      ceilingSfPerHr: n("ceilingSfPerHr", "Ceilings", 2000),
      doorFramesPerHr: n("doorFramesPerHr", "Door frames", 100),
      doorsPerHr: n("doorsPerHr", "Doors", 100),
      windowFramesPerHr: n("windowFramesPerHr", "Window frames", 100),
      over10Multiplier: over10,
      over14Multiplier: over14,
      crewRatePerHr: n("crewRatePerHr", "Crew rate", 1000),
    };
    const stored = JSON.parse(JSON.stringify(ratesFromJson(raw))) as Prisma.InputJsonValue;
    await prisma.companyBidDefaults.upsert({ where: { companyId }, create: { companyId, productionRates: stored }, update: { productionRates: stored } });
    const open = await prisma.job.findMany({ where: { companyId, status: "ESTIMATE" }, select: { id: true } });
    for (const job of open) await prisma.$transaction((tx) => syncLaborLines(tx, companyId, job.id), { timeout: 30_000 });
    jobs = open.length;
    revalidatePath("/wall-types");
    revalidatePath("/jobs", "layout");
    return { ok: true };
  });
  return result.ok ? { ok: true, value: { jobs } } : result;
}
