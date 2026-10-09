"use server";

import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { actionFail, actionOk, type ActionResult } from "./shared";
import { readPlanBytes } from "@/lib/plan-ingest/planBytes";
import { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import {
  indexCheck,
  readDrawingIndex,
  INDEX_PAGES_TO_SCAN,
  type IndexCheckResult,
} from "@/lib/plan-ingest/drawingIndex";

/**
 * Accepting and rejecting what a title-block reading proposed.
 *
 * THE ROW IS THE PROPOSAL, NOT THE FILING — `intake.prisma`'s rule, and accepting
 * here means exactly what `confirmIntakeRows` means by filing: the accepted values
 * are written onto the SAME ROW, beside what was proposed. Nothing else is created.
 *
 * IN PARTICULAR, `TakeoffPlanPage.label` IS NOT WRITTEN, and that is the decision
 * most likely to be read as a missing step. That column's comment says a label is
 * "TYPED, never parsed off the title block: reading a sheet number out of a drawing
 * is OCR, and a wrong one labels somebody's quantities with another floor's name."
 * The distinction that matters is not human-versus-machine — it is AUTHORED versus
 * NOT-NOTICED. A typed label is a person asserting something; an accepted label on
 * row 147 of 300 is a person failing to notice, and a bulk accept would arrive with
 * a human alibi attached. `lib/intake/review.ts` reaches the same conclusion in its
 * own words: this pass records the acceptance on the intake row and creates no
 * Submittal, Rfi or ComplianceDocument, because "a label promising it before it
 * exists is how a demo becomes a lie."
 *
 * What an accepted sheet number is FOR, then: finding the sheet you meant to
 * measure. The calibration dialog can prefill from one later — prefilling is not a
 * write, and the person still submits the form that authors the label.
 *
 * THE CAPABILITY IS `VIEW_JOB_COSTS`, matching every other action in this feature.
 * It is the capability the DOOR takes — `/jobs/[id]/takeoff` is hard-gated on it —
 * not the one the feature's name suggests. #538's first version asserted
 * `MANAGE_ESTIMATING` here, which sounds right for a plan set and would have
 * refused an estimator who can open the page while answering somebody who cannot.
 */

const NOT_YOURS =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

/** One page's confirmed identity, as the review screen submits it. */
export type SheetAcceptance = {
  proposalId: string;
  /** What the person settled on — usually the proposal, sometimes their
   *  correction. Null is refused: accepting nothing is a reject. */
  sheetNumber: string;
  title: string | null;
};

/**
 * Accept several sheets at once.
 *
 * ONE TRANSACTION, for the reason `confirmIntakeRows` gives: sixty rows half
 * succeeding is a state nobody can recover from by hand, because the screen can no
 * longer tell which half. A three-hundred-sheet set makes that worse, not better.
 *
 * EVERY ROW IS RE-READ AND RE-SCOPED inside the transaction rather than trusted
 * from the argument. The ids in the request are a claim; the `companyId` on the
 * join is the check. Without it this action would accept any company's proposals
 * for anybody who knew an id — and a Server Action is a separate endpoint with a
 * stable id that answers whoever posts to it, which is why the page's own gate is
 * not enough.
 */
export async function acceptPlanSheets(acceptances: SheetAcceptance[]): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NOT_YOURS);

  if (acceptances.length === 0) return actionFail("Nothing was selected, so nothing was confirmed.");
  // A ceiling, so one request cannot be a whole-database update. A plan set is
  // bounded at 2,000 pages by `startPlanIngest`, so this refuses nothing real.
  if (acceptances.length > 2_000) return actionFail("That's more sheets than one plan set can hold.");

  const cleaned: SheetAcceptance[] = [];
  for (const one of acceptances) {
    const sheetNumber = one.sheetNumber.trim();
    // A BLANK SHEET NUMBER IS REFUSED RATHER THAN STORED. "Accepted, with no
    // number" is a state the index cannot show and nobody asked for: a person who
    // does not want this reading rejects it.
    if (!sheetNumber) {
      return actionFail("A sheet needs a number to be confirmed. Reject the ones you don't want instead.");
    }
    if (sheetNumber.length > 60) return actionFail("That sheet number is too long to be a sheet number.");
    const title = one.title?.trim() ?? "";
    cleaned.push({ proposalId: one.proposalId, sheetNumber, title: title.length > 0 ? title : null });
  }

  const at = new Date();
  const confirmed = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.planSheetProposal.findMany({
        where: {
          id: { in: cleaned.map((one) => one.proposalId) },
          status: "PROPOSED",
          plan: { companyId: context.company.id },
        },
        select: { id: true },
      });
      const allowed = new Set(rows.map((row) => row.id));

      let count = 0;
      for (const one of cleaned) {
        if (!allowed.has(one.proposalId)) continue;
        // ONE UPDATE PER ROW, unlike `confirmIntakeRows` which groups by
        // destination — and the difference is the data, not the taste: intake rows
        // share a `(kind, jobId)` destination so dozens collapse into one
        // `updateMany`, whereas every sheet here has its own number and title.
        // There is nothing to group by.
        await tx.planSheetProposal.update({
          where: { id: one.proposalId },
          data: {
            acceptedSheetNumber: one.sheetNumber,
            acceptedTitle: one.title,
            status: "ACCEPTED",
            acceptedByUserId: context.id,
            acceptedAt: at,
          },
        });
        count += 1;
      }
      return count;
    },
    // The same window `confirmIntakeRows` takes, for the same reason: a bulk
    // confirm over a few hundred rows must not be killed by the default.
    { timeout: 20_000, maxWait: 10_000 },
  );

  if (confirmed === 0) {
    // Three states share this sentence: already settled, not this company's, or no
    // such row. All three mean "there was nothing there to confirm", and telling
    // them apart on screen would be three messages for one decision a person does
    // not have to make — the shape `retryPlanIngestPage` already uses.
    return actionFail("Those sheets were either already confirmed or are no longer there.");
  }

  // NO `revalidatePath`, and it is the same fix #538 needed. `revalidatePath` sets
  // `pathWasRevalidated` unconditionally, so the client re-renders FROM THE ROOT —
  // which remounts `TakeoffPlanViewer` and throws away the sheet an estimator was
  // looking at. The review component updates from what this returns.
  return actionOk;
}

/**
 * Reject one reading.
 *
 * THE ROW STAYS, with its status changed and its proposal untouched. `intake.prisma`
 * keeps a DISMISSED row for the reason that applies here too: the same plan set
 * ingested again must not propose the same wrong answer as though nobody had ever
 * looked at it. It is also the only record that somebody DID look — a deleted row
 * and a page nobody reached are indistinguishable.
 */
export async function rejectPlanSheet(proposalId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NOT_YOURS);

  const rejected = await prisma.planSheetProposal.updateMany({
    where: { id: proposalId, status: "PROPOSED", plan: { companyId: context.company.id } },
    data: { status: "REJECTED", acceptedByUserId: context.id, acceptedAt: new Date() },
  });

  if (rejected.count !== 1) {
    return actionFail("That sheet reading was either already settled or is no longer there.");
  }
  return actionOk;
}

/**
 * ── WHAT THE SET SAYS IT CONTAINS, AGAINST WHAT ARRIVED ──
 *
 * `sheetIndex.ts` knows what pages are HERE and spots a number used twice.
 * Nothing has ever checked the other direction: that the set's own printed
 * index lists a sheet nobody uploaded a page for. A bid priced off an
 * incomplete set is not a bid that comes in low — it is one that wins and then
 * meets a drawing nobody read.
 *
 * ── READ TIME, ASKED FOR, NOT STORED ──
 *
 * `sheetIndex.ts` says it in its own header: "review order is computed at read
 * time and must never become a stored rank", and `PlanIngestStage.SHEET_INDEX`
 * is deliberately null in `STAGE_WORK` for the same reason. This follows that,
 * for an extra one: a person pressing a button is the moment the answer is
 * wanted, and an ingest stage would have to re-run to be worth anything after
 * somebody corrected a sheet number by hand.
 *
 * It parses at most the first six pages — the index is on page 1 or 2 on every
 * real set measured — so it is a small read of a file already in the store.
 */
export type IndexCheck = ({ ok: true } & IndexCheckResult) | { ok: false; error: string };

export async function checkDrawingIndex(planId: string): Promise<IndexCheck> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return { ok: false, error: NOT_YOURS };

  const plan = await prisma.takeoffPlan.findFirst({
    where: { id: planId, companyId: context.company.id },
    select: { id: true },
  });
  if (!plan) return { ok: false, error: "That plan set is no longer on this job. Reload the page." };

  // THE ACCEPTED NUMBER WINS, exactly as `effectiveSheetNumber` reads it on
  // the screen: a person who corrected a misread title block has said what the
  // sheet is, and comparing against the machine's original guess would report
  // their own correction as a missing sheet.
  const sheets = await prisma.planSheetProposal.findMany({
    where: { planId: plan.id },
    select: { proposedSheetNumber: true, acceptedSheetNumber: true },
  });

  const bytes = await readPlanBytes(plan.id, context.company.id);
  if (!bytes.ok) return { ok: false, error: bytes.error };

  let pdf: Awaited<ReturnType<typeof openPlanPdf>> | null = null;
  try {
    pdf = await openPlanPdf(bytes.bytes);
    const pages = [];
    for (let n = 1; n <= Math.min(INDEX_PAGES_TO_SCAN, pdf.pageCount); n += 1) {
      pages.push(await pdf.pageText(n));
    }
    // THE DECISION IS PURE AND LIVES IN `drawingIndex.ts`. Two mutations of
    // it came back green against every screen test — this action is where a
    // person's correction gets ignored, and where "could not read" quietly
    // becomes "nothing missing", so neither judgement is made here.
    const result = indexCheck(readDrawingIndex(pages), sheets);
    return { ok: true, ...result };
  } catch {
    // The screen stays usable and the sheet list is still there, so this says
    // what failed and stops rather than taking the page down.
    return { ok: false, error: "That plan file couldn't be read just now. Try again, or check the index by eye." };
  } finally {
    await pdf?.close();
  }
}
