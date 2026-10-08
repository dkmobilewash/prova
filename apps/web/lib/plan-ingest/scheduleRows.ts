import { prisma } from "@prova/db";
import {
  extractScheduleRows,
  SCHEDULE_ROWS_PROMPT_VERSION,
  type ScheduleRowsRead,
} from "@prova/integrations";
import { aiGate } from "@/lib/ai/settings";
import { claimPlanSheet, markPlanSheetFailure } from "@/lib/ask/planSheetSpend";
import { recordAskUsage } from "@/lib/ask/usage";
import { openPlanPdf } from "./planPdf";
import { readPlanBytes } from "./planBytes";
import { gridText, looksLikeTable, tableRowsFromPage } from "./scheduleTable";
import type { StageCtx, StageWork } from "./stages";

/**
 * `SCHEDULE_ROWS` — WHAT THE TABLE ON THIS SHEET SAYS, proposed for a person to
 * accept.
 *
 * ── IT RUNS ON A HANDFUL OF PAGES, AND THAT IS WHY IT CAN EXIST ──
 *
 * A drawing set is three hundred sheets and perhaps four of them are schedules.
 * Reading every page would be three hundred model calls to find four tables, and
 * nobody would switch it on. So this stage SKIPS any page whose newest title-block
 * proposal does not say `SCHEDULE` — spending nothing and succeeding, the same
 * shape `TITLE_BLOCK` uses for a page with no text layer. The page type that makes
 * that possible landed one PR earlier; without it this feature is unaffordable
 * rather than merely unbuilt.
 *
 * ── IT OPENS THE PDF, WHICH `TITLE_BLOCK` DELIBERATELY DOES NOT ──
 *
 * That stage reads a stored `PlanSheetText` row precisely so a retry costs one
 * model call and no 15MB fetch, and the reason is volume: three hundred pages.
 * Here the same trade comes out the other way. `PlanSheetText` holds the
 * TITLE-BLOCK REGION's words, not the table's, so the text this needs is not
 * stored anywhere — and storing every page's full text to serve four of them
 * would be the expensive half of that trade with none of the benefit. Opening the
 * file for four pages is cheap, and saying so here is better than a reader
 * discovering the inconsistency and assuming it was an oversight.
 *
 * ── THE SPLIT INSIDE THE STAGE IS THE PART THAT MATTERS ──
 *
 * `scheduleTable.ts` rebuilds the grid from text coordinates in CODE — which
 * strings share a baseline, where one cell ends. That is arithmetic, and
 * ARCHITECTURE.md's rule is that arithmetic stays deterministic. The model is then
 * asked the one question code cannot answer: which column is the mark, which rows
 * are headers, what is this a schedule OF.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──
 *
 * It does not link a row to anything. A door mark matched to a measurement, or a
 * schedule row turned into a line item, is a real row in a real table and a
 * decision of its own — by WHAT a person types, never by inference, for the same
 * reason `carriedQuoteLapsed` matches a description or a cost to the cent rather
 * than guessing. The rows land as a proposal and stop there.
 */

export type ScheduleRowsDeps = {
  /** The newest title-block proposal for this page, or null when none exists. */
  loadPageType: (planId: string, pageNumber: number) => Promise<{ pageType: string | null; title: string | null } | null>;
  /** Takes the company too, because `readPlanBytes` scopes the plan to it —
   *  a plan id alone would read another tenant's file. */
  loadBytes: (planId: string, companyId: string) => Promise<Buffer>;
  /** The per-company switch with its feature ALREADY BOUND — not `typeof aiGate`.
   *  A dep the caller passes a feature to is one that can be passed the wrong
   *  feature, and this stage would compile while checking whether the Ask box was
   *  on. `aiFeatureGateCensus.test.ts` reads the real call in the wiring below. */
  gate: (companyId: string) => ReturnType<typeof aiGate>;
  claim: typeof claimPlanSheet;
  markFailure: typeof markPlanSheetFailure;
  extract: typeof extractScheduleRows;
  saveProposal: (row: ScheduleProposalRow) => Promise<void>;
  recordUsage: typeof recordAskUsage;
};

export type ScheduleProposalRow = {
  ingestJobId: string;
  planId: string;
  pageNumber: number;
  model: string;
  gridRowCount: number;
  read: ScheduleRowsRead;
};

/**
 * The sentence for a page whose title block has not been read yet.
 *
 * ACTIONABLE RATHER THAN DIAGNOSTIC, because it is rendered beside a Retry button
 * and a retry cannot fix it: this stage needs the page type, which the title-block
 * stage produces, and the two are separate runs. Retrying the page is the wrong
 * move, so the sentence names the right one.
 */
const NO_PAGE_TYPE =
  "This sheet hasn't been identified yet, so there's no way to tell whether it carries a schedule. " +
  "Read the title blocks over this set first, then read the schedules.";

export function scheduleRowsWork(ctx: StageCtx, deps: ScheduleRowsDeps = realDeps): StageWork {
  return async (task) => {
    const sheet = await deps.loadPageType(ctx.planId, task.pageNumber);
    if (!sheet) return { ok: false, error: NO_PAGE_TYPE };

    // NOT A SCHEDULE: nothing to read, nothing to charge, nothing gone wrong.
    // The whole affordability of this stage is this line.
    if (sheet.pageType !== "SCHEDULE") return { ok: true };

    const bytes = await deps.loadBytes(ctx.planId, ctx.companyId);
    const pdf = await openPlanPdf(bytes);
    let grid: string;
    let gridRowCount: number;
    try {
      const page = await pdf.pageText(task.pageNumber);
      const rows = tableRowsFromPage(page);
      gridRowCount = rows.length;
      // A PAGE TYPED `SCHEDULE` THAT HOLDS NO TABLE still succeeds and spends
      // nothing. A cover sheet whose index lists "SCHEDULES" is typed that way
      // honestly, and sending a page of prose to a model to be told it holds no
      // schedule costs exactly what sending a real one costs.
      if (!looksLikeTable(rows)) return { ok: true };
      grid = gridText(rows);
    } finally {
      // pdfjs holds per-document state; a stage that opens one per invocation
      // must let each go.
      await pdf.close();
    }

    // THE GATE BEFORE THE LEDGER, so a company that has switched this off is not
    // charged a sheet on its way to being told no.
    const pass = await deps.gate(ctx.companyId);
    if (!pass.ok) return { ok: false, error: pass.error };
    const claimed = await deps.claim(ctx.companyId, pass.settings.planSheetsPerMonth);
    if (!claimed.ok) return { ok: false, error: claimed.error };

    let read: ScheduleRowsRead;
    try {
      read = await deps.extract({
        grid,
        pageNumber: task.pageNumber,
        sheetTitle: sheet.title,
        model: pass.model,
        onUsage: (usage) =>
          deps.recordUsage({
            companyId: ctx.companyId,
            // Whoever started the RUN, and null on the cron — a set left
            // ingesting overnight is finished by a tick with no person behind it,
            // and attributing those reads to the last person with the tab open
            // would be worse than attributing them to nobody.
            userId: ctx.startedByUserId,
            feature: "schedule-read",
            model: pass.model,
            // `proposal`: the rows are a suggestion somebody accepts or rejects.
            // Nothing is filed by the machine.
            outcome: "proposal",
            jobId: ctx.jobId,
            promptVersion: SCHEDULE_ROWS_PROMPT_VERSION,
            usage,
          }),
      });
    } catch {
      // MARKED, NEVER RELEASED. The provider bills a call that produced nothing
      // usable; releasing would let the cap be defeated by inducing failures,
      // and the figure is what lets an owner ask for a credit.
      await deps.markFailure(claimed.claim);
      // The thrown text is NOT passed through: a stage's error is rendered on
      // screen and an SDK error can carry a request URL or a key fragment.
      return { ok: false, error: "The schedule reader could not read this sheet. Try it again." };
    }

    await deps.saveProposal({
      ingestJobId: ctx.ingestJobId,
      planId: ctx.planId,
      pageNumber: task.pageNumber,
      model: pass.model,
      gridRowCount,
      read,
    });
    return { ok: true };
  };
}

const realDeps: ScheduleRowsDeps = {
  loadPageType: async (planId, pageNumber) => {
    const proposal = await prisma.planSheetProposal.findFirst({
      where: { planId, pageNumber },
      // NEWEST, because a re-run writes its own row rather than overwriting —
      // the same ordering `sheetIndexQuery` uses to decide which proposal is
      // the live one.
      orderBy: { createdAt: "desc" },
      select: { proposedPageType: true, acceptedTitle: true, proposedTitle: true },
    });
    if (!proposal) return null;
    return {
      pageType: proposal.proposedPageType,
      // The ACCEPTED title where somebody has given one, because a person who
      // corrected it is a better source than the reading.
      title: proposal.acceptedTitle ?? proposal.proposedTitle,
    };
  },
  loadBytes: async (planId, companyId) => {
    // `readPlanBytes` returns a RESULT rather than throwing, so the refusal
    // it carries (a missing file, a blob that is not ours) reaches the screen
    // as a sentence instead of a redacted digest.
    const bytes = await readPlanBytes(planId, companyId);
    if (!bytes.ok) throw new Error(bytes.error);
    return bytes.bytes;
  },
  gate: (companyId) => aiGate(companyId, "SCHEDULE_READ"),
  claim: claimPlanSheet,
  markFailure: markPlanSheetFailure,
  extract: extractScheduleRows,
  recordUsage: recordAskUsage,

  saveProposal: async (row) => {
    // UPSERT ON (ingestJobId, pageNumber): a retry landing on the same run
    // replaces its own answer rather than adding a second opinion. A NEW run
    // inserts its own row, which is what keeps an accepted reading from being
    // overwritten.
    const proposal = {
      kind: row.read.kind,
      title: row.read.title,
      rows: row.read.rows,
      reason: row.read.reason,
      confidence: row.read.confidence,
      gridRowCount: row.gridRowCount,
      readRowCount: row.read.rows.length,
      model: row.model,
      promptVersion: SCHEDULE_ROWS_PROMPT_VERSION,
    };
    await prisma.planScheduleProposal.upsert({
      where: { ingestJobId_pageNumber: { ingestJobId: row.ingestJobId, pageNumber: row.pageNumber } },
      create: { ingestJobId: row.ingestJobId, planId: row.planId, pageNumber: row.pageNumber, ...proposal },
      update: proposal,
    });
  },
};
