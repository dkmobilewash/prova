"use server";

import { labelWallCandidates, type WallCandidateForLabel, type WallLabel } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { aiGate } from "@/lib/ai/settings";
import { claimAskAllowance, markAskAllowanceFailure } from "@/lib/ask/allowance";
import { recordAskUsage } from "@/lib/ask/usage";
import type { ActionResultWith } from "./shared";

/**
 * ── WHICH OF THE MEASURED RUNS ARE ACTUALLY WALLS ──
 *
 * The wall finder measures; this says what each measurement IS. The split is
 * the product rule ARCHITECTURE.md states for every AI feature that touches
 * money: the arithmetic stays deterministic and the model only judges. No
 * length, no thickness and no footage in a bid comes from here — the reply is a
 * label per run, and a run this never hears about is left exactly as the
 * geometry found it.
 *
 * WHY IT EXISTS. A countertop is two parallel lines a plausible distance apart,
 * and so is a bathtub, a cabinet run, a door leaf and a dimension string. They
 * pass every test the finder has, because those tests describe a shape and the
 * difference is meaning. Measured on a real permit set: one apartment floor
 * plan returned every kitchen counter, every tub and five reference lines below
 * the building alongside its walls.
 */

const MAX_CANDIDATES = 400;

/** `actionFail` returns the valueless `ActionResult`; this action returns a
 *  value, so its failures need the same shape the success has. */
const fail = (error: string): ActionResultWith<WallClassification> => ({ ok: false, error });
/** The same sentence and the same capability as every other action on this
 *  sheet — the takeoff tab is guarded by `VIEW_JOB_COSTS`, so an action
 *  reachable from it that answered a weaker one would be a hole in that guard.
 *  `action-capability-guards.test.ts` derives this and fails the build. */
const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

export type WallClassification = {
  labels: WallLabel[];
  /** What the model ran on, for the panel to show beside the result. */
  model: string;
};

export async function classifyWallCandidates(
  imageBase64: string,
  cropFeet: number,
  candidates: WallCandidateForLabel[],
): Promise<ActionResultWith<WallClassification>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return fail(JOB_COSTS_ONLY);
  const company = context.company;

  if (candidates.length === 0) {
    return fail("There are no runs to check yet. Find the walls on this sheet first.");
  }
  if (candidates.length > MAX_CANDIDATES) {
    // A BOUND ON WHAT ONE CALL CARRIES, not a judgement about the sheet. The
    // viewer sends one crop at a time; a request with hundreds of runs in it is
    // a crop that covers too much of the plan to be legible at the resolution
    // this is sent at, which is the one thing that makes the answer worthless.
    return fail(
      `That's ${candidates.length} runs in one go. Zoom in and check a part of the sheet at a time — ${MAX_CANDIDATES} at most.`,
    );
  }
  if (imageBase64.length > 7_000_000) {
    return fail("That image is too large to send. Zoom in on a smaller part of the sheet.");
  }

  // THE SWITCH FIRST, before the image is looked at or anything is claimed.
  // This is the feature that sends a PICTURE of the customer's floor plan, so
  // it is the one most worth being able to refuse — see `WALL_CLASSIFY` in
  // `ai-settings.prisma`.
  const gate = await aiGate(company.id, "WALL_CLASSIFY");
  if (!gate.ok) {
    return fail(`${gate.error} The runs are still measured — accept or reject them yourself.`);
  }

  // ONE PAGE PER CROP, claimed BEFORE the call. One crop is one image and one
  // request, whatever the run count, so a page is the honest unit — and a
  // refused claim stops here with nothing charged and the model never reached.
  const spend = await claimAskAllowance(company.id, { questions: 0, pages: 1 });
  if (!spend.ok) return fail(spend.error);

  let labels: WallLabel[];
  try {
    labels = await labelWallCandidates({
      imageBase64,
      cropFeet,
      candidates,
      model: gate.model,
      onUsage: (usage) =>
        recordAskUsage({
          companyId: company.id,
          userId: context.id,
          model: gate.model,
          usage,
          outcome: "answered",
          feature: "wall-classify",
          promptVersion: "wall-classify.1",
        }),
    });
  } catch (err) {
    // MARKED, NOT RELEASED — the rule the quote reader and the compliance
    // upload both follow: an allowance you can get back by making calls fail is
    // not a cap, and the provider bills a request that died halfway anyway.
    await markAskAllowanceFailure(spend.claim);
    // METADATA ONLY. Never the image, never the drawing, never the error's own
    // text, which can carry a key or a connection string.
    console.error("[wall-classify] the labeller failed after its allowance was claimed", {
      companyId: company.id,
      candidates: candidates.length,
      kind: err instanceof Error ? err.name : "unknown",
    });
    return fail(
      "The runs couldn't be checked just now. Nothing changed — accept or reject them yourself, or try again in a minute.",
    );
  }

  return { ok: true, value: { labels, model: gate.model } };
}
