import type { Prisma } from "@prova/db";

/**
 * The next EstimateVersion number for a job, from a counter row that only
 * ever increments — the same shape as `issueInvoiceNumber` and
 * `issueContractDocumentVersion` in lib/billing.
 *
 * WHAT THIS REPLACED — issue #289, and this was the LAST sequence in the
 * product still breaking CLAUDE.md's counter rule. `saveEstimateVersion`
 * read the highest surviving version outside any transaction and added
 * one, then created the row in a separate statement.
 *
 * THE REACHABLE COST WAS THE RACE, not the reissue the rule usually warns
 * about. Two people saving a checkpoint on one job at once — an estimator
 * and whoever is checking the numbers with them, or just two tabs — both
 * read the same max, computed the same number, and the second violated
 * `@@unique([jobId, versionNumber])`. `saveEstimateVersion` returns void
 * and does not catch, so that throw reached the person as a redacted
 * production digest with their checkpoint gone. Measured against a real
 * Postgres 16 before the fix: 49 of 50 rounds at two concurrent saves,
 * 50 of 50 at three. The single-tab double-click was already handled by
 * SubmitButton (#19); two tabs, two devices and two people were not.
 *
 * Reissue-after-delete was NOT reachable and is recorded as such rather
 * than left to be re-argued: nothing in the product deletes an
 * EstimateVersion — the only `deleteMany` calls are teardown in
 * clean-scratch-data.mjs and seed-demo.mjs. The counter removes the race,
 * and it means a delete path added later cannot quietly reintroduce the
 * other half.
 *
 * Lives here rather than in lib/actions/estimating.ts because that file is
 * "use server", which may only export async Server Actions — exporting an
 * internal counter bump from it would publish it as an endpoint any
 * signed-in caller could post to. `lib/billing/invoice-number.ts` and
 * `lib/billing/contract-document-version.ts` are here for the same reason,
 * and #280 is what happens when an issuer stays private inside an action
 * file: a second writer of the same table never finds it and keeps its own
 * arithmetic. There is one writer today; the module is still the right home.
 *
 * Taking the transaction client rather than reaching for `prisma` is the
 * point: the bump and the insert have to be one transaction, or this is
 * the old bug wearing a counter.
 */
export async function issueEstimateVersionNumber(
  tx: Prisma.TransactionClient,
  jobId: string,
): Promise<number> {
  const counter = await tx.estimateVersionCounter.upsert({
    where: { jobId },
    create: { jobId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return counter.lastNumber;
}
