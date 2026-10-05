import { prisma } from "@prova/db";
import { extractSheetTitleBlock, PLAN_SHEET_PROMPT_VERSION, type SheetTitleBlock } from "@prova/integrations";
import { aiGate } from "@/lib/ai/settings";
import { claimPlanSheet, markPlanSheetFailure } from "@/lib/ask/planSheetSpend";
import { recordAskUsage } from "@/lib/ask/usage";
import type { StageCtx, StageWork } from "./stages";

/**
 * `TITLE_BLOCK` — WHAT THE SHEET ON THIS PAGE IS, proposed for a person to accept.
 *
 * IT NEVER OPENS THE PDF. `PAGE_INVENTORY` already read every page's title-block
 * text into `PlanSheetText`, so this stage reads a ROW and calls the model. Three
 * things follow, and they are the reason the work is split this way rather than
 * done in one stage:
 *
 *   - a retry costs one model call and no parse, and no 15MB fetch;
 *   - the expensive stage fits a 5-second Server Action slice comfortably,
 *     because a model call is all it does;
 *   - the evidence a proposal was made from is on file, so `proposedReason` is a
 *     sentence somebody can check rather than a claim they have to take.
 *
 * A PAGE WITH NO TEXT LAYER IS SKIPPED, SPENDS NOTHING, AND SUCCEEDS. It is not
 * sent to the model — there is nothing to send — and no proposal row is written,
 * because a row proposing nothing is worse than no row: the review surface reads
 * `PlanSheetText.hasTextLayer` and asks for that sheet's number to be typed. A
 * refusal here would instead spend three attempts per scanned page and leave a
 * Retry button that can never succeed.
 */

export type TitleBlockDeps = {
  loadSheetText: (planId: string, pageNumber: number) => Promise<SheetTextRow | null>;
  /**
   * The per-company switch, WITH ITS FEATURE ALREADY BOUND.
   *
   * Not `typeof aiGate`, and the difference is the point. A dep the caller passes a
   * feature to is a dep that can be passed the WRONG feature — this stage would
   * compile perfectly while checking whether the Ask box was switched on. Binding
   * `PLAN_INGESTION` in the production wiring below makes that unrepresentable, and
   * it also puts a real `aiGate(…, "PLAN_INGESTION")` call in this file, which is
   * what `aiFeatureGateCensus.test.ts` reads. The first draft injected
   * `typeof aiGate` and the census refused it — correctly: a swappable gate is
   * exactly the hole it exists to close, and satisfying it with a decoy call
   * somewhere else in the file would have been worse than the hole.
   */
  gate: (companyId: string) => ReturnType<typeof aiGate>;
  claim: typeof claimPlanSheet;
  markFailure: typeof markPlanSheetFailure;
  extract: typeof extractSheetTitleBlock;
  saveProposal: (row: ProposalRow) => Promise<void>;
  recordUsage: typeof recordAskUsage;
};

export type SheetTextRow = {
  id: string;
  hasTextLayer: boolean;
  titleBlockText: string | null;
  wholePageFallback: boolean;
};

export type ProposalRow = {
  ingestJobId: string;
  planId: string;
  pageNumber: number;
  sheetTextId: string;
  model: string;
  read: SheetTitleBlock;
};

/**
 * The sentence for a page whose text has not been read yet.
 *
 * ACTIONABLE RATHER THAN DIAGNOSTIC, because it is rendered beside a Retry button
 * and a retry will not fix it: the two stages are separate runs, and this one was
 * started before the other finished. Retrying the page is exactly the wrong move,
 * so the sentence names the right one.
 */
const NOT_READ_YET =
  "This sheet's text hasn't been read yet, so there was nothing to identify it from. " +
  "Run the sheet-text pass over this set first, then read the title blocks.";

export function titleBlockWork(ctx: StageCtx, deps: TitleBlockDeps = realDeps): StageWork {
  return async (task) => {
    const text = await deps.loadSheetText(ctx.planId, task.pageNumber);
    if (!text) return { ok: false, error: NOT_READ_YET };

    // Nothing to read, nothing to charge, nothing gone wrong. See the header.
    if (!text.hasTextLayer || !text.titleBlockText) return { ok: true };

    // THE GATE FIRST, BEFORE THE LEDGER. A company that has switched plan reading
    // off must not have a sheet claimed against its allowance on the way to being
    // told no — the order `readBidQuoteDocument` uses, and the reason its refusal
    // costs nothing.
    const pass = await deps.gate(ctx.companyId);
    if (!pass.ok) return { ok: false, error: pass.error };

    const claimed = await deps.claim(ctx.companyId, pass.settings.planSheetsPerMonth);
    if (!claimed.ok) return { ok: false, error: claimed.error };

    let read: SheetTitleBlock;
    try {
      read = await deps.extract({
        titleBlockText: text.titleBlockText,
        pageNumber: task.pageNumber,
        wholePageFallback: text.wholePageFallback,
        model: pass.model,
        onUsage: (usage) =>
          deps.recordUsage({
            companyId: ctx.companyId,
            // WHOEVER STARTED THE RUN, not whoever's slice happened to do this
            // page — and null on the cron, which has no person at all. This is
            // the first caller for which `userId`'s "a model call is not
            // guaranteed to have a person behind it" is the live case rather than
            // a nullable column's courtesy: a set left ingesting overnight is
            // finished by a cron tick, and attributing those sheets to the last
            // person with the tab open would be worse than attributing them to
            // nobody.
            userId: ctx.startedByUserId,
            feature: "plan-ingestion",
            model: pass.model,
            // `proposal`, not `answered`: the row this produces is a suggestion a
            // person accepts or rejects, which is what that outcome already means
            // for `AskProposal`. Nothing is filed by the machine.
            outcome: "proposal",
            jobId: ctx.jobId,
            promptVersion: PLAN_SHEET_PROMPT_VERSION,
            usage,
          }),
      });
    } catch (err) {
      // MARKED, NEVER RELEASED — the rule every metered caller here follows, and
      // the reason `failedPlanSheets` exists: the provider bills a call that
      // produced nothing usable, releasing would let the cap be defeated by
      // inducing failures, and the figure is what lets an owner ask for a credit.
      await deps.markFailure(claimed.claim);
      // The thrown text is NOT passed through. A stage's error is rendered on
      // screen, and an SDK error can carry a request URL or a key fragment — the
      // reason `runner.ts` discards a thrown message and substitutes its own.
      console.error("[plan-ingest] a title-block read failed", {
        planId: ctx.planId,
        pageNumber: task.pageNumber,
        err,
      });
      return {
        ok: false,
        error:
          "This sheet couldn't be identified just now, and the attempt still used one of your monthly sheets. " +
          "Retry it, and tell C Stream if it keeps failing.",
      };
    }

    await deps.saveProposal({
      ingestJobId: ctx.ingestJobId,
      planId: ctx.planId,
      pageNumber: task.pageNumber,
      sheetTextId: text.id,
      model: pass.model,
      read,
    });

    return { ok: true };
  };
}

/** The real ports. Kept at the bottom so the stage above reads as logic. */
const realDeps: TitleBlockDeps = {
  loadSheetText: (planId, pageNumber) =>
    prisma.planSheetText.findUnique({
      where: { planId_pageNumber: { planId, pageNumber } },
      select: { id: true, hasTextLayer: true, titleBlockText: true, wholePageFallback: true },
    }),

  // The feature is bound HERE, once, so no call site can choose it — see the
  // `gate` member's comment.
  gate: (companyId) => aiGate(companyId, "PLAN_INGESTION"),
  claim: claimPlanSheet,
  markFailure: markPlanSheetFailure,
  extract: extractSheetTitleBlock,
  recordUsage: recordAskUsage,

  saveProposal: async (row) => {
    // UPSERT ON (ingestJobId, pageNumber), which is a retry landing on the same
    // run rather than a second opinion: within one run a page has one proposal. A
    // NEW run inserts its own row, which is what keeps an accepted proposal from
    // being overwritten — see `PlanSheetProposal`'s header.
    const proposal = {
      sheetTextId: row.sheetTextId,
      proposedSheetNumber: row.read.sheetNumber,
      proposedTitle: row.read.title,
      proposedDiscipline: row.read.discipline,
      proposedPageType: row.read.pageType,
      proposedScale: row.read.scale,
      titleBlockRevisionText: row.read.revision,
      titleBlockIssueDateText: row.read.issueDate,
      proposedReason: row.read.reason,
      proposedConfidence: row.read.confidence,
      model: row.model,
      promptVersion: PLAN_SHEET_PROMPT_VERSION,
    };
    await prisma.planSheetProposal.upsert({
      where: { ingestJobId_pageNumber: { ingestJobId: row.ingestJobId, pageNumber: row.pageNumber } },
      create: { ingestJobId: row.ingestJobId, planId: row.planId, pageNumber: row.pageNumber, ...proposal },
      update: proposal,
    });
  },
};
