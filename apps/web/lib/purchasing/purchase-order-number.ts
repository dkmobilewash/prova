import type { Prisma } from "@prova/db";

/**
 * The next purchase order number for a job, from a counter row that only
 * ever increments. The same shape as `issueRfiNumber` and
 * `issueInvoiceNumber`, and written from them deliberately rather than
 * freshly — there is one correct way to do this in the repo and eleven
 * copies of it is better than two designs.
 *
 * WHY A COUNTER AND NOT `max(number) + 1`. Both of the usual reasons apply
 * here, and unlike on `Invoice` the first one is genuinely reachable:
 *
 *   REISSUE. A purchase order CAN be deleted in this app — an order typed
 *   against the wrong job, or with the wrong vendor, is a mistake made
 *   before anything is sent, and the delete exists so it can be taken back
 *   (see `deletePurchaseOrder`, which is owner-only and refuses once lines
 *   are on it). Derive the number from the surviving rows and deleting PO
 *   3 of 3 makes the next one 3 again — two different commitments to
 *   possibly two different vendors carrying one number, which is precisely
 *   the argument an accounts-payable clerk cannot settle. The counter is
 *   untouched by a delete, so 3 stays retired and the next one is 4.
 *
 *   THE RACE. Two people raising an order on the same job at the same
 *   moment read the same max, compute the same next number, and the second
 *   insert violates `@@unique([jobId, number])` — a thrown Server Action
 *   message, which production REDACTS, so the button appears to do nothing
 *   at all. That is #224 exactly.
 *
 * Taking the transaction client rather than reaching for `prisma` is the
 * whole point: the bump and the insert are one transaction, or this is
 * `max(n) + 1` again wearing a counter's clothes. `counterCensus.test.ts`
 * holds that line for every counter in the schema.
 *
 * Lives in a plain module rather than in `lib/actions/purchaseOrders.ts`
 * because that file is `"use server"`, where every export becomes a real
 * network endpoint — an internal numbering helper has no business being
 * one. Same reasoning as `lib/billing/invoice-number.ts`.
 */
export async function issuePurchaseOrderNumber(
  tx: Prisma.TransactionClient,
  jobId: string,
): Promise<number> {
  const counter = await tx.purchaseOrderCounter.upsert({
    where: { jobId },
    create: { jobId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return counter.lastNumber;
}
