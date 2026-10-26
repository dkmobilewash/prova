"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { NOT_ESTIMATE_STAGE } from "@/lib/estimating/draft-lines";
import { loadPastPriceSuggestions, parsePastPriceArg, writesFor } from "@/lib/bid/guide/pastPrice";
import { actionFail, type ActionResultWith } from "./shared";

/**
 * "You priced this wall on Civic Center Annex in September. Use that?" — the
 * one click. The guide's `usePastPrice` action id (lib/bid/guide/types.ts).
 *
 *     usePastPrice(jobId, arg)
 *
 * `arg` IS THE GUIDE'S `actionArg` AND NOTHING ELSE: the suggestion's
 * `actionArg`, `<kind>:<id>:<token>` — `wt:<WallType id>:<8 hex>` for a wall
 * type, `ce:<LineItemCatalogEntry id>:<8 hex>` for a price-book item that is
 * not part of a wall type. The id says WHICH wall type; the token is the
 * fingerprint of the exact figures and lines the person was shown. No dollar
 * amount, no line id and no job id from the client is believed: the server
 * re-derives the suggestion from the database, and writes only if it matches
 * the token.
 *
 * WHAT IT WRITES. The unit cost (`budgetedUnitCost`, and the forecast beside it
 * while it still follows) onto each UNPRICED line of that wall type, and the
 * unit price too UNLESS the bid recap has been applied — after that the unit
 * prices are a spread of the marked-up bid and only cost moves, the same rule
 * as `price-refresh.ts`. The result says when the price was held back.
 *
 * WHAT IT NEVER TOUCHES. A line that already carries a price or a cost (the
 * write is conditional on both being null at the moment of the write, so a
 * price typed between the preview and the click is never overwritten), the
 * quantity, and anything stored-derived: totals are recomputed from the lines
 * on every read, nothing is cached here.
 *
 * REFUSES, in a readable sentence: no estimating capability; a job that is not
 * this company's; a contracted job (a price change after signing is a change
 * order); a suggestion that no longer matches.
 */

const NO_ESTIMATING =
  "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";
const NO_JOB = "That job isn't on your account any more.";
const BAD_ARG = "That price suggestion isn't one this page can apply. Reload the job and try again.";
const STALE =
  "That suggestion has changed since you saw it — the lines were priced, or the past job's price moved. Reload the job to see the current one.";

/** Thrown inside the transaction to roll it back; never leaves this file. */
class Stale extends Error {}

export async function usePastPrice(
  jobId: string,
  arg: string,
): Promise<ActionResultWith<{ updated: number; fromJobName: string; priceHeldForRecap: boolean }>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING);
  const companyId = context.company.id;

  const parsed = parsePastPriceArg(arg);
  if (!parsed || typeof jobId !== "string" || jobId.length === 0) return actionFail(BAD_ARG);

  const job = await prisma.job.findFirst({ where: { id: jobId, companyId }, select: { id: true, status: true } });
  if (!job) return actionFail(NO_JOB);
  if (job.status !== "ESTIMATE") return actionFail(NOT_ESTIMATE_STAGE);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-derived inside the transaction from the rows, never from the client.
      const suggestions = await loadPastPriceSuggestions(tx, companyId, jobId);
      const suggestion = suggestions.find((s) => s.actionArg === arg.trim());
      if (!suggestion || !suggestion.actionArg.startsWith(`${parsed.groupKey}:`)) throw new Stale();

      const writes = writesFor(suggestion);
      for (const write of writes) {
        const { count } = await tx.jobLineItem.updateMany({
          // Unpriced at the moment of the write, on this job, live. A line
          // priced or removed since the read matches nothing and rolls the
          // whole thing back rather than half-applying.
          where: { id: write.lineId, jobId, isDeleted: false, unitPrice: null, budgetedUnitCost: null },
          data: write.data,
        });
        if (count !== 1) throw new Stale();
      }
      return {
        updated: writes.length,
        fromJobName: suggestion.fromJobName,
        priceHeldForRecap: suggestion.priceHeldForRecap,
      };
    });

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/jobs/${jobId}/estimate`);
    revalidatePath(`/bids/${jobId}`);
    revalidatePath("/bids");
    return { ok: true, value: result };
  } catch (error) {
    if (error instanceof Stale) return actionFail(STALE);
    throw error;
  }
}
