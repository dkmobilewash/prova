import type { Prisma } from "@prova/db";

/**
 * The next ContractDocument version number for a job, from a counter row
 * that only ever increments — same shape as `issueInvoiceNumber` beside it.
 *
 * WHAT THIS REPLACED. `versionNumber` was `MAX(versionNumber) + 1` off the
 * surviving rows for the job, read outside any transaction — issue #106
 * finding 5. Delete version 2 and upload again and the new upload is ALSO
 * "Version 2", so two different legal documents end up sharing a version
 * label on a document a GC may treat as the version of record. Unlike
 * invoices, that reissue is REACHABLE here: `deleteContractDocument` is a
 * real action an owner can run.
 *
 * WHY IT LIVES HERE RATHER THAN IN lib/actions/billing.ts — issue #279,
 * and this is the whole point of the fix. It was module-private in that
 * file, which is `"use server"` and may therefore only export async Server
 * Actions, so the second writer of this table COULD NOT import it however
 * much it wanted to. It did the only thing left and computed its own
 * number, and the two disagreed. A plain module is the only place both
 * `uploadContractDocument` and `recordExecutedSubcontract` can import one
 * implementation from, and one implementation is the fix: a second copy
 * recreates the divergence it is meant to end.
 *
 * Taking the transaction client rather than reaching for `prisma` is
 * load-bearing — the bump and the insert have to be one transaction, or
 * this is the old bug wearing a counter.
 */
export async function issueContractDocumentVersion(
  tx: Prisma.TransactionClient,
  jobId: string,
): Promise<number> {
  const counter = await tx.contractDocumentVersionCounter.upsert({
    where: { jobId },
    create: { jobId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return counter.lastNumber;
}
