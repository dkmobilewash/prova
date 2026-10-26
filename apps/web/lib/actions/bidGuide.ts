"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { applyBidRecap } from "./bidRecap";
import { usePastPrice as applyPastPrice } from "./bidGuidePastPrice";
import { actionFail, actionOk, type ActionResult } from "./shared";

/**
 * The server side of the buttons on a job's guide card (`GuideAction.actionId`
 * in `lib/bid/guide/types.ts`).
 *
 * THE GUIDE ONLY NAMES AN ACTION; it carries no figure. Each case below
 * re-reads everything it needs on this side — `applyBidRecap` re-runs the recap
 * maths from the job's own lines and rates, so nothing a browser posts can
 * change what is written (ARCHITECTURE.md: the model narrates, code computes).
 *
 * Gate: MANAGE_ESTIMATING, the one capability the whole Bid surface asks for.
 * `applyBidRecap` additionally asserts VIEW_JOB_COSTS and that the job is this
 * company's and still an estimate; its refusal sentence is passed through as it
 * is. Every refusal is RETURNED, never thrown — production redacts a thrown
 * message (CLAUDE.md, Errors).
 *
 * `actionId` is a plain string at this boundary, not `GuideActionId`: a Server
 * Action's arguments come from the network, so an id this build does not know is
 * answered with a sentence rather than trusted to be in the union.
 */
export async function runGuideAction(jobId: string, actionId: string, actionArg?: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail(
      "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.",
    );
  }
  switch (actionId) {
    case "applyRecap": {
      const result = await applyBidRecap(jobId);
      if (!result.ok) return actionFail(result.error);
      // The guide lives in the Bid layout, which `applyBidRecap`'s own
      // revalidation (the CRM job paths) does not reach.
      revalidatePath(`/bid/estimates/${jobId}`, "layout");
      return actionOk;
    }
    case "usePastPrice": {
      // `actionArg` is the suggestion's own `wt:<id>:<token>`; the action
      // re-derives the suggestion server-side and refuses a stale one, so the
      // browser chooses WHICH suggestion, never the figures.
      if (typeof actionArg !== "string" || actionArg.length === 0) {
        return actionFail("That price suggestion is no longer available. Reload the page.");
      }
      const result = await applyPastPrice(jobId, actionArg);
      if (!result.ok) return actionFail(result.error);
      revalidatePath(`/bid/estimates/${jobId}`, "layout");
      return actionOk;
    }
    default:
      return actionFail("That action isn't one this screen knows how to run.");
  }
}
