"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { outboundConfig, runOutboundPush, type PushReport } from "@/lib/smartlead/run";
import { ownerRefusal, type ActionResultWith } from "./shared";

/**
 * The nightly push, on demand — the owner's button on /sales. Same runner as
 * the cron (`lib/smartlead/run.ts`), so the same rules: NEW, emailable,
 * unsuppressed leads only, and the same rolling-24-hour cap across both, so
 * pressing this after 7am does not double the day's sends.
 *
 * Every refusal is a sentence, including "the keys are not set", which names
 * the variables — that is the one the owner can do something about.
 */
export async function pushLeadsNow(limit?: number): Promise<ActionResultWith<PushReport>> {
  const { company, ...user } = await requireCompanyContext();
  if (!company.isProvaOperator) return { ok: false, error: "Not found" };
  const refusal = ownerRefusal(user, "Only the account owner can push leads to the sequencer");
  if (refusal) return refusal;

  const config = outboundConfig(process.env);
  if (!config.ok) {
    return {
      ok: false,
      error: `Nothing was sent: ${config.missing.join(", ")} ${config.missing.length === 1 ? "is" : "are"} not set on this deployment.`,
    };
  }

  const report = await runOutboundPush({
    companyId: company.id,
    config,
    limit: typeof limit === "number" && Number.isInteger(limit) && limit >= 0 ? limit : undefined,
  });
  revalidatePath("/sales");
  return { ok: true, value: report };
}
