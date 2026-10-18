"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { agentSettingsFor, type AgentSettings } from "@/lib/agents/core";
import { actionFail, actionOk, ownerRefusal, type ActionResult } from "./shared";

/**
 * Which agents run for this company, and what they may spend.
 *
 * OWNER-ONLY on top of /ai's MANAGE_ESTIMATING: the spend cap is the
 * company's money and the switches decide what runs over every estimator's
 * bids. `ownerRefusal`, never `assertOwner` — a thrown refusal reaches a real
 * user as a redacted digest.
 *
 * Two input shapes. A FormData is the whole settings form, so an absent
 * checkbox means OFF (an unchecked box posts nothing). A plain object is a
 * partial update — only the keys present change.
 */

const NO_ACCESS =
  "AI agent settings aren't part of your job function. The account owner sets who sees what, on the Team page.";
const NOT_OWNER = "Only the account owner can change what the AI agents do and spend.";

const SWITCHES = ["watcherEnabled", "researchOnNewBid", "checkerBeforeSend", "recommendationsEnabled"] as const;

function fromForm(form: FormData): Partial<Record<keyof AgentSettings, unknown>> {
  const out: Partial<Record<keyof AgentSettings, unknown>> = {};
  for (const key of SWITCHES) out[key] = form.get(key) !== null;
  out.dueSoonDays = form.get("dueSoonDays");
  out.monthlySpendCapUsd = form.get("monthlySpendCapUsd");
  out.notifyUserIds = form.getAll("notifyUserIds");
  return out;
}

export async function saveAgentSettings(input: FormData | Partial<AgentSettings>): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ACCESS);
  const refusal = ownerRefusal(context, NOT_OWNER);
  if (refusal) return refusal;
  const companyId = context.companyId;

  const raw: Partial<Record<keyof AgentSettings, unknown>> = input instanceof FormData ? fromForm(input) : input;
  const next: Partial<AgentSettings> = {};

  for (const key of SWITCHES) {
    if (raw[key] !== undefined) next[key] = raw[key] === true;
  }

  if (raw.dueSoonDays !== undefined) {
    const days = Number(raw.dueSoonDays);
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      return actionFail("Days before a due date must be a whole number from 1 to 30.", {
        dueSoonDays: "1 to 30 days",
      });
    }
    next.dueSoonDays = days;
  }

  if (raw.monthlySpendCapUsd !== undefined) {
    const v = raw.monthlySpendCapUsd;
    if (v === null || (typeof v === "string" && v.trim() === "")) {
      next.monthlySpendCapUsd = null;
    } else {
      const usd = Number(typeof v === "string" ? v.replace(/[$,\s]/g, "") : v);
      if (!Number.isFinite(usd) || usd < 0 || usd > 999_999.99) {
        return actionFail("The monthly cap must be a dollar amount of zero or more, or blank for no cap.", {
          monthlySpendCapUsd: "A dollar amount, or blank",
        });
      }
      next.monthlySpendCapUsd = Math.round(usd * 100) / 100;
    }
  }

  if (raw.notifyUserIds !== undefined) {
    const ids = [...new Set((raw.notifyUserIds as unknown[]).map(String).filter(Boolean))];
    if (ids.length) {
      const found = await prisma.user.count({ where: { companyId, id: { in: ids } } });
      if (found !== ids.length) {
        return actionFail("Someone in the notify list is not on this company's team.", {
          notifyUserIds: "Pick people from your team",
        });
      }
    }
    next.notifyUserIds = ids;
  }

  const current = await agentSettingsFor(companyId);
  await prisma.companyAgentSettings.upsert({
    where: { companyId },
    create: { ...current, ...next, companyId, updatedByUserId: context.id },
    update: { ...next, updatedByUserId: context.id },
  });
  revalidatePath("/ai");
  revalidatePath("/ai/activity");
  return actionOk;
}
