import type { Prisma } from "@prova/db";

/**
 * The next WH-347 payroll number for a job, from a counter row that only
 * ever increments — same shape as issueInvoiceNumber, for the same reason:
 * CLAUDE.md's sequence-number rule. The form's "Payroll No." is sequential
 * per project, and the DOL reads the sequence to see that no week of an
 * active contract is missing from the run. A number derived from surviving
 * rows would renumber the run the day anything was ever removed.
 *
 * Takes the TRANSACTION client so the bump and the Wh347PayrollNumber
 * insert are one transaction — two people clicking "Issue" for two
 * different weeks at once each get their own number, and two clicks for
 * the SAME week are settled by @@unique([jobId, weekStart]), with the
 * caller re-reading the winner rather than surfacing the collision.
 *
 * Lives here rather than in the "use server" action file because that may
 * only export async Server Actions, and counterCensus.test.ts names this
 * helper as the one source of Wh347PayrollNumber numbers.
 */
export async function issueWh347PayrollNumber(
  tx: Prisma.TransactionClient,
  jobId: string,
): Promise<number> {
  const counter = await tx.wh347PayrollCounter.upsert({
    where: { jobId },
    create: { jobId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return counter.lastNumber;
}
