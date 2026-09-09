import type { Prisma } from "@prova/db";

/**
 * The next invoice number for a job, from a counter row that only ever
 * increments — the eighth of these, and the same shape as issueRfiNumber.
 *
 * WHAT THIS REPLACED, and why it takes a `tx`. It was `max(number) + 1`
 * off the surviving invoices, read outside any transaction, with both
 * call sites computing it and then calling `create` separately. CLAUDE.md's
 * sequence-number rule forbids exactly that, and this was the last
 * sequence in the product that was still breaking it.
 *
 * THE REACHABLE COST WAS THE RACE, not the reissue the rule usually warns
 * about. Two submits on one job read the same max, computed the same next
 * number, and the second violated @@unique([jobId, number]) — a thrown
 * Server Action message, which production REDACTS, on a document a GC is
 * waiting for. Reissue-after-deletion was never reachable here: there is
 * no deleteInvoice in this app, by design, because an invoice is an
 * evidence record that closes rather than deletes.
 *
 * Taking the transaction client rather than reaching for `prisma` is the
 * whole point — the bump and the insert have to be one transaction, or
 * this is the old bug wearing a counter.
 *
 * Lives here rather than in lib/actions/billing.ts because that file is
 * "use server", which may only export async Server Actions; the lifted
 * invoice core in ./create-invoice.ts needs this too, and a plain module
 * is the only place both can import it from.
 */
export async function issueInvoiceNumber(tx: Prisma.TransactionClient, jobId: string): Promise<number> {
  const counter = await tx.invoiceCounter.upsert({
    where: { jobId },
    create: { jobId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return counter.lastNumber;
}
