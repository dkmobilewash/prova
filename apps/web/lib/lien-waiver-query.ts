import { prisma } from "@prova/db";
import { calculateRetainageSummary } from "@/lib/retainage";
import { pendingChangeOrderExposure } from "@/lib/change-order";

/**
 * Everything the lien-waiver section on a job's billing tab needs, in one
 * read.
 *
 * The two candidate-exception figures are the reason this is a query
 * helper rather than three inline `findMany`s. `lib/lien-waiver.ts` is
 * pure and takes numbers; getting those numbers right is the part with
 * rules in it, and both of them ALREADY HAVE AN OWNER:
 *
 *   - retainage held is `calculateRetainageSummary().balance`, the same
 *     definition the retainage tab and the WIP schedule use. Recomputing
 *     it from `job.retainagePercent` here would drift from the invoices'
 *     own snapshots the first time somebody changed the rate;
 *   - pending change orders are `pendingChangeOrderExposure`, which is
 *     SUBMITTED only. DRAFT ones have not been asked for and APPROVED
 *     ones are already in the contract value — neither is an exception to
 *     anything.
 *
 * Duplicating either definition here is how the two halves of a number
 * start disagreeing, which is the shape `lib/retainage.ts`'s own header
 * warns about (issue #46 coming back as #97).
 */

export interface LienWaiverRow {
  id: string;
  condition: "CONDITIONAL" | "UNCONDITIONAL";
  stage: "PROGRESS" | "FINAL";
  throughDate: Date;
  amount: number;
  exceptedAmount: number;
  exceptionsNote: string | null;
  status: "PENDING" | "SIGNED";
  signedAt: Date | null;
  signerName: string | null;
  revokedAt: Date | null;
  invoiceId: string | null;
  invoiceNumber: number | null;
}

export interface WaiverInvoiceOption {
  id: string;
  number: number;
  amount: number;
  /** What has actually been received against it — the figure the
   * "unconditional with nothing paid" warning reads. */
  amountPaid: number;
}

export interface LienWaiverSection {
  waivers: LienWaiverRow[];
  invoices: WaiverInvoiceOption[];
  retainageBalance: number;
  pendingChangeOrderTotal: number;
}

export async function loadLienWaiverSection(jobId: string): Promise<LienWaiverSection> {
  const [waivers, invoices, releases, job, changeOrders, lineItems] = await Promise.all([
    prisma.lienWaiver.findMany({
      where: { jobId },
      orderBy: [{ throughDate: "desc" }, { createdAt: "desc" }],
      include: { invoice: { select: { number: true } } },
    }),
    prisma.invoice.findMany({
      where: { jobId },
      orderBy: { number: "desc" },
      select: {
        id: true,
        number: true,
        amount: true,
        retainageWithheld: true,
        payments: { select: { amount: true } },
      },
    }),
    prisma.retainageRelease.findMany({ where: { jobId }, select: { amount: true } }),
    prisma.job.findUnique({ where: { id: jobId }, select: { substantialCompletionDate: true } }),
    prisma.changeOrder.findMany({
      where: { jobId },
      select: {
        status: true,
        proposals: {
          select: {
            changeType: true,
            lineItemId: true,
            quantity: true,
            unitPrice: true,
            previousQuantity: true,
            previousUnitPrice: true,
            previousIsDeleted: true,
          },
        },
      },
    }),
    prisma.jobLineItem.findMany({
      where: { jobId },
      select: { id: true, quantity: true, unitPrice: true, isDeleted: true },
    }),
  ]);

  const retainage = calculateRetainageSummary({
    invoiceRetainageWithheld: invoices.map((invoice) =>
      invoice.retainageWithheld === null ? null : Number(invoice.retainageWithheld),
    ),
    releaseAmounts: releases.map((release) => Number(release.amount)),
    substantialCompletionDate: job?.substantialCompletionDate ?? null,
  });

  const targets = new Map(lineItems.map((item) => [item.id, item]));

  return {
    waivers: waivers.map((waiver) => ({
      id: waiver.id,
      condition: waiver.condition,
      stage: waiver.stage,
      throughDate: waiver.throughDate,
      amount: Number(waiver.amount),
      exceptedAmount: Number(waiver.exceptedAmount),
      exceptionsNote: waiver.exceptionsNote,
      status: waiver.status,
      signedAt: waiver.signedAt,
      signerName: waiver.signerName,
      revokedAt: waiver.revokedAt,
      invoiceId: waiver.invoiceId,
      invoiceNumber: waiver.invoice?.number ?? null,
    })),
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      amount: Number(invoice.amount),
      amountPaid: invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
    })),
    retainageBalance: retainage.balance,
    pendingChangeOrderTotal: Number(pendingChangeOrderExposure(changeOrders, targets)),
  };
}
