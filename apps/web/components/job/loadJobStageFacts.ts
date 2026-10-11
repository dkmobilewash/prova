import { prisma } from "@prova/db";
import { contractExecutionFor, contractIsExecuted } from "@/lib/contract-execution";

/**
 * The few facts the stage steps' status lines need beyond `loadJobSummary`:
 * is the contract executed, how many change orders were approved, and the
 * latest pay application. Counts and one row — no money is read here; the
 * header's figures stay `loadJobSummary`'s.
 *
 * "Executed" is `contractIsExecuted`, the same test that lets a job become
 * CONTRACTED, so the step and the status control cannot disagree.
 */
export async function loadJobStageFacts(companyId: string, jobId: string) {
  const where = { jobId, job: { companyId } };
  const [signed, executedDocs, approvedChangeOrders, waitingChangeOrders, invoiceCount, payApps] = await Promise.all([
    prisma.signatureRequest.findFirst({ where: { ...where, status: "SIGNED" }, select: { signerName: true, signedAt: true } }),
    prisma.contractDocument.findMany({
      where: { ...where, executedSignedDate: { not: null } },
      select: { versionNumber: true, executedSignedDate: true },
    }),
    prisma.changeOrder.count({ where: { ...where, status: "APPROVED" } }),
    // SUBMITTED = sent to the GC, waiting on a decision.
    prisma.changeOrder.count({ where: { ...where, status: "SUBMITTED" } }),
    prisma.invoice.count({ where }),
    // A pay application is an invoice WITH continuation-sheet rows
    // (pay-application-query.ts, `isPayApplicationInvoice`); a lump-sum
    // bill has none and is not one.
    prisma.invoice.findMany({
      where: { ...where, lineItems: { some: {} } },
      orderBy: { number: "desc" },
      take: 1,
      select: { number: true, dueAt: true, status: true },
    }),
  ]);
  const contractSigned = contractIsExecuted(contractExecutionFor(signed, executedDocs));
  return { contractSigned, approvedChangeOrders, waitingChangeOrders, invoiceCount, latestPayApp: payApps[0] ?? null };
}
