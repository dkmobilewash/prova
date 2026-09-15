import type { Prisma } from "@prova/db";

/**
 * The next ContractDocument version number for a job, from a counter row
 * that only ever increments — the same shape as `issueInvoiceNumber`
 * beside it.
 *
 * WHAT THIS REPLACED. `versionNumber` was `MAX(versionNumber) + 1` off the
 * surviving rows for the job, read outside any transaction — issue #106
 * finding 5. Delete version 2 and upload again and the new upload is ALSO
 * "Version 2", so two different legal documents share a version label on a
 * document a GC may treat as the version of record. Two concurrent uploads
 * could additionally read the same max and collide on
 * `@@unique([jobId, versionNumber])`.
 *
 * WHY IT LIVES HERE RATHER THAN IN A CALLER, and this is the whole of
 * issue #280. It was a private function inside `lib/actions/billing.ts`,
 * so `recordExecutedSubcontract` in `lib/actions/jobs.ts` — the OTHER
 * writer of this table — could not reach it and kept its own
 * `MAX(versionNumber) + 1`. One table, two writers, two numbering schemes,
 * and the counter only knew about one of them.
 *
 * That is not a tidiness problem, it is a permanent outage per job. The
 * MAX path never bumps the counter, so the counter falls behind the rows;
 * the counter path then issues a number that already exists and violates
 * the unique constraint. Because the bump and the insert are ONE
 * transaction, the failure rolls the bump back too, so the next attempt
 * reads the same stale number and fails identically — for ever. On a fresh
 * job it takes a single click: record the executed subcontract first (the
 * ordinary case — the GC sends it signed) and every later amendment upload
 * on that job is dead.
 *
 * A "use server" file may only export async Server Actions, so exporting
 * this from `lib/actions/billing.ts` would publish an internal counter
 * bump as an endpoint any signed-in caller could post to. A plain module
 * is the only place both actions can import it from — the same reasoning
 * `./invoice-number.ts` records, and the reason that one already lives
 * here.
 *
 * Taking the transaction client rather than reaching for `prisma` is the
 * point: the bump and the insert have to be one transaction, or this is
 * the old bug wearing a counter.
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
