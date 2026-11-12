"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { RECAP_RATE_FIELDS } from "@/lib/bid-recap";
import { MARKUP_FIELDS, presetWallTypes, tradePreset } from "@/lib/trade-presets";
import { STARTER_TYPE_NOTE } from "@/lib/wall-type-starters";
import { doorScopeFrom } from "@/lib/estimating/doorLines";
import { parseNumericInput } from "@/lib/numeric-input";
import { actionFail, actionOk, nullablePercentFromForm, ownerRefusal, runAction, type ActionResult } from "./shared";

const NO_SETTINGS =
  "Company settings aren't part of your job function. The account owner sets who sees what, on the Team page.";

/**
 * The trade tap on `/welcome`. NEW COMPANIES ONLY, enforced here and not only
 * by the page: a company whose onboarding is already behind it
 * (`businessScopeAskedAt` set — every company that predates this, by the
 * 20260921 backfill) is refused, so a hand-built request cannot re-seed an
 * existing account. A second tap after a first succeeded changes nothing and
 * says ok, because a double tap or a reload is not an error.
 *
 * Same two guards as `saveBusinessScope`, its sibling on the same screen.
 */
export async function applyTradePreset(choice: string, doorScopeChoice?: string, defaultWallHeight?: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NO_SETTINGS);
  const refusal = ownerRefusal(context, "Only the account owner can choose the company's trade.");
  if (refusal) return refusal;
  const preset = tradePreset(choice);
  if (!preset) return actionFail("Choose one of the trades shown.");
  // The trade step's own answer to "Doors and frames", else the preset's starting value.
  const doorScope = doorScopeChoice === undefined ? preset.doorScope : doorScopeFrom(doorScopeChoice);
  if (doorScope === null) return actionFail("Choose who installs the doors and frames.");
  // The height a wall is assumed to be when the drawing gives none; the preset's figure unless typed.
  let defaultWallHeightFt: number | null = preset.defaultWallHeightFt;
  if (defaultWallHeight !== undefined && defaultWallHeight.trim() !== "") {
    const parsed = parseNumericInput(defaultWallHeight, { label: "Your usual wall height", min: 6, max: 60, maxDecimals: 2, unit: " ft" });
    if (!parsed.ok) return actionFail(parsed.error);
    defaultWallHeightFt = parsed.n;
  }

  const companyId = context.company.id;
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { businessScopeAskedAt: true, tradePresetAskedAt: true },
  });
  if (company.tradePresetAskedAt !== null) return actionOk;
  if (company.businessScopeAskedAt !== null) {
    return actionFail("Your company is already set up. Change wall types on the Wall types page and takeoff switches in Settings.");
  }

  const types = presetWallTypes(preset);
  await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction: two taps racing must not both seed.
    const fresh = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { tradePresetAskedAt: true } });
    if (fresh.tradePresetAskedAt !== null) return;
    await tx.company.update({ where: { id: companyId }, data: { ...preset.switches, doorScope, defaultWallHeightFt, tradePresetAskedAt: new Date() } });
    if (preset.scopes.length > 0) {
      await tx.companyTradeScope.createMany({
        data: preset.scopes.map((tradeScope, index) => ({ companyId, tradeScope, isPrimary: index === 0, activeSince: new Date() })),
        skipDuplicates: true,
      });
    }
    // Never overwrites a code the company already has (the same rule as
    // `addStarterWallTypes`): a new company has none, so this is belt and braces.
    const taken = new Set((await tx.wallType.findMany({ where: { companyId }, select: { code: true } })).map((t) => t.code));
    for (const [index, type] of types.filter((t) => !taken.has(t.code)).entries()) {
      await tx.wallType.create({
        data: {
          companyId,
          code: type.code,
          name: type.name,
          sides: type.sides ?? 2,
          studSpacingIn: "16",
          sortOrder: index,
          notes: STARTER_TYPE_NOTE,
          components: { create: type.parts.map((part, order) => ({ ...part, sortOrder: order })) },
        },
      });
    }
    if (preset.template) {
      const exists = await tx.estimateTemplate.findFirst({ where: { companyId, name: preset.template.name }, select: { id: true } });
      if (!exists) {
        await tx.estimateTemplate.create({
          data: {
            companyId,
            name: preset.template.name,
            tradeScope: preset.scopes[0] ?? null,
            description: "Starter lines from your trade — unpriced. Add, remove or rename them.",
            items: { create: preset.template.lines.map((line, sortOrder) => ({ ...line, sortOrder })) },
          },
        });
      }
    }
    // The trade's usual inclusions and exclusions, into the clause library (once: this runs once per company).
    const clauses = [
      ...preset.clauses.inclusions.map((text) => ({ kind: "INCLUSION" as const, text })),
      ...preset.clauses.exclusions.map((text) => ({ kind: "EXCLUSION" as const, text })),
    ];
    if (clauses.length > 0 && (await tx.proposalClause.count({ where: { companyId } })) === 0) {
      await tx.proposalClause.createMany({ data: clauses.map((c, sortOrder) => ({ companyId, ...c, sortOrder })) });
    }
  });

  revalidatePath("/settings");
  revalidatePath("/wall-types");
  return actionOk;
}

/**
 * The company's own markup, asked once at signup in empty boxes. All four are
 * required here — a blank would leave the estimate's "Set your markup" banner
 * up, and "Later" is the way to leave them all blank. Zero is an answer.
 * Writes only these four columns, so it can never clear a figure Settings set.
 * MANAGE_COMPLIANCE, the capability Settings' own bid-defaults form asserts.
 */
export async function saveStarterMarkup(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NO_SETTINGS);
  const companyId = context.company.id;
  return runAction(async () => {
    const fields: Record<string, string> = {};
    for (const field of MARKUP_FIELDS) {
      const value = nullablePercentFromForm(formData, field, { label: RECAP_RATE_FIELDS[field].label });
      if (value === null) return actionFail(`Fill in all four — ${RECAP_RATE_FIELDS[field].label} is blank. Zero is fine, or choose Later.`);
      fields[field] = value;
    }
    await prisma.companyBidDefaults.upsert({ where: { companyId }, create: { companyId, ...fields }, update: fields });
    revalidatePath("/settings");
    return actionOk;
  });
}
