"use server";

import { revalidatePath } from "next/cache";
import { prisma, type AiFeature } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { AI_FEATURE_KEYS } from "@/lib/ai/settings";
import { KNOWN_MODELS } from "@prova/integrations/src/models";
import { actionFail, actionOk, ownerRefusal, runAction, type ActionResult } from "./shared";

/**
 * The write half of the per-company AI switch.
 *
 * `/settings/assistant`'s own header said "nothing on this page writes" from
 * the day it was built. This is the first thing that does, and it exists
 * because the switch it sets is the answer to a question a contractor is
 * entitled to ask — whether their plan sets, specs and quotes go to a model at
 * all — and a setting only they can change through a support request is not
 * really their setting.
 *
 * OWNER-ONLY ON TOP OF THE ROUTE'S MANAGE_COMPLIANCE, and both are asserted
 * here rather than left to the page. The page refuses a non-owner in its own
 * right, but a Server Action is a separate HTTP endpoint with a stable id that
 * answers whoever posts to it — the scar `lib/action-capability-guards.test.ts`
 * exists for, and #383's rule: an action asserts what its own page withholds.
 * Turning AI off for a company stops work for every one of its members, and
 * turning it back ON is a decision about where their documents may go. Neither
 * belongs to one estimator.
 *
 * IT REFUSES BY RETURNING, never by throwing. `ownerRefusal` rather than
 * `assertOwner`, which throws and would reach a real user as a production
 * digest on a dead button — the pair `lib/actions/shared.ts` documents at
 * length, and the mistake `ownerRefusalCensus.test.ts` fails the build over.
 */

const NOT_YOURS =
  "Only the account owner can change what AI is allowed to do for this company.";
const NO_SETTINGS =
  "Company settings aren't part of your job function. The account owner sets who sees what, on the Team page.";

/**
 * What the form may set, and one field it deliberately may NOT.
 *
 * `planSheetsPerMonth` is absent from this list on purpose and the omission is
 * the security of it: it is what the company's PLAN includes, not a preference,
 * and a form that posted it would let an owner raise their own paid allowance
 * to any number by editing one input. It is ours to set — for now by hand, and
 * by whatever prices the plans when there is more than one.
 *
 * `modelOverride` IS settable because the wrong value cannot cost anybody
 * anything: `modelFor` ignores an id it does not know (`models.ts` says why),
 * and this action refuses one before it is stored, so the two checks are belt
 * and braces rather than one.
 */
export async function saveCompanyAiSettings(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NO_SETTINGS);
  const refusal = ownerRefusal(context, NOT_YOURS);
  if (refusal) return refusal;
  const companyId = context.company.id;
  const updatedByUserId = context.id;

  return runAction(async () => {
    // A checkbox that is off posts NOTHING, so absence is the "off" signal and
    // there is no tri-state to get wrong. `aiEnabled` reads the other way from
    // the feature boxes below — the master switch is a positive ("AI is on")
    // and `disabledFeatures` is a negative — which matches the schema: a
    // feature shipped later is available unless somebody turned it off, so
    // nobody has to opt in to a feature before it works.
    const aiEnabled = formData.get("aiEnabled") !== null;

    const disabledFeatures: AiFeature[] = AI_FEATURE_KEYS.filter(
      (feature) => formData.get(`feature:${feature}`) === null,
    ) as AiFeature[];

    const overrideRaw = String(formData.get("modelOverride") ?? "").trim();
    if (overrideRaw && !KNOWN_MODELS.includes(overrideRaw)) {
      // Refused rather than silently dropped. A stored id nothing routes to
      // would read on this very page as the model the company runs on, while
      // every call ran on something else — the worst of the three possible
      // behaviours, and the reason `modelFor` ALSO ignores it at call time.
      return actionFail("That isn't a model this app can use. Leave it on the default unless C Stream has told you otherwise.");
    }
    const modelOverride = overrideRaw || null;

    const settings = { aiEnabled, disabledFeatures, modelOverride, updatedByUserId };
    await prisma.companyAiSettings.upsert({
      where: { companyId },
      // `planSheetsPerMonth` is absent from BOTH branches, so a create takes
      // the schema default and an update never touches it. See above.
      create: { companyId, ...settings },
      update: settings,
    });

    revalidatePath("/settings/assistant");
    // The switch changes what the Ask box will do, and the box is on every
    // page, so the shell's own copy can be stale the moment this returns.
    revalidatePath("/settings");
    return actionOk;
  });
}
