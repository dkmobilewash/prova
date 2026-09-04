// Assembly of one AIA-style pay application (G702 summary + G703
// continuation sheet) out of a job's schedule of values and its invoices.
//
// Split out of app/(app)/jobs/[id]/pay-applications/[invoiceId]/page.tsx for
// the reason company-financials-query.ts, alerts-query.ts and
// bid-pipeline-query.ts were: every money figure on a document that leaves
// the company for a GC used to live inside an async server component, where
// nothing could execute it. The read and the arithmetic are separated here
// too -- `loadPayApplication` talks to Postgres, `assemblePayApplication` is
// pure and takes plain values, so the row-selection rules (which is the part
// that has been wrong) are testable with no database at all.

import { prisma } from "@prova/db";
import {
  calculatePayAppLineItem,
  calculatePayAppSummary,
  type PayAppLineItemResult,
  type PayAppSummaryResult,
} from "@/lib/pay-application";

/** A Prisma Decimal, or a plain number/string standing in for one in a
 * test. Everything below goes through Number(), which handles all three. */
export type DecimalLike = { toString(): string } | number | string | null;

export interface PayAppJobLineItem {
  id: string;
  description: string;
  quantity: DecimalLike;
  unitPrice: DecimalLike;
  isDeleted: boolean;
}

export interface PayAppInvoiceLineItemRow {
  lineItemId: string;
  thisPeriodBilled: DecimalLike;
  materialsStoredValue: DecimalLike;
}

export interface PayAppInvoiceRow {
  id: string;
  number: number;
  retainageWithheld: DecimalLike;
  lineItems: PayAppInvoiceLineItemRow[];
}

export interface PayAppAssemblyInput {
  invoiceId: string;
  /** The job's schedule of values, INCLUDING rows a change order removed --
   * `isDeleted` is read here rather than filtered out in the query, so a
   * removed line keeps its real description on the continuation sheet. Same
   * shape as the change-order target read on the job page. */
  lineItems: PayAppJobLineItem[];
  invoices: PayAppInvoiceRow[];
  retainagePercent: DecimalLike;
}

export interface PayAppAssembly {
  isPayApplication: boolean;
  lineItems: PayAppLineItemResult[];
  summary: PayAppSummaryResult;
}

/**
 * What a line still carries as scheduled value on this application.
 *
 * A live line is quantity x unitPrice, already change-order-aware, since an
 * approved change order mutates the JobLineItem directly (ARCHITECTURE.md).
 * A line a change order REMOVED is closed out at what it has earned to
 * date, which is what a deductive change order does in AIA practice: it
 * takes back the UNBILLED remainder, not work already performed and
 * certified. So a removed line that was never billed lands at $0 and drops
 * off the sheet through the zero-row filter below (#98: it used to appear
 * at its full value, claiming scope the GC had already deducted), and a
 * removed line that was already billed appears at exactly what it earned —
 * 100%, balance to finish $0.
 *
 * Zeroing a removed-but-billed line instead is the tempting one-liner and
 * it is wrong. `calculatePayAppSummary` derives balanceToFinish as
 * contractSumToDate - totalEarnedLessRetainage, an identity that assumes
 * every earned dollar sits inside the contract sum. Zeroing the line leaves
 * its earnings in the numerator and removes them from the denominator, so
 * balance-to-finish comes out understated by exactly the billed amount, and
 * the row prints a negative balance — money claimed against nothing — on a
 * document a GC reads. See pay-application-query.test.ts.
 *
 * The billed-to-date floor is for REMOVED lines only. A LIVE line with a
 * null unitPrice is a cost-only budget line (general conditions, overhead)
 * and genuinely has $0 of contract value; jobs.prisma says so explicitly.
 */
function scheduledValueFor(lineItem: PayAppJobLineItem | undefined, earnedToDate: number): number {
  if (lineItem && !lineItem.isDeleted) {
    return Number(lineItem.quantity) * Number(lineItem.unitPrice ?? 0);
  }
  return Math.max(0, earnedToDate);
}

/** A removed line keeps its real description — the placeholder is only for
 * a lineItemId with no row behind it at all, which the InvoiceLineItem FK
 * (Restrict, no onDelete) means cannot happen today. */
function describe(lineItem: PayAppJobLineItem | undefined): string {
  if (!lineItem) return "(line item removed)";
  return lineItem.isDeleted ? `${lineItem.description} (removed by change order)` : lineItem.description;
}

export function assemblePayApplication(input: PayAppAssemblyInput): PayAppAssembly | null {
  const invoice = input.invoices.find((inv) => inv.id === input.invoiceId);
  if (!invoice) {
    return null;
  }

  const isPayApplication = invoice.lineItems.length > 0;
  const earlierInvoices = input.invoices.filter((inv) => inv.number < invoice.number);

  // Every line item this application should show a row for: everything
  // currently on the SOV, plus anything billed on an earlier or later
  // invoice for this job even if it was since removed by a change order --
  // a removed line's final balance still belongs on the record.
  const lineItemIds = new Set<string>(input.lineItems.map((item) => item.id));
  for (const inv of input.invoices) {
    for (const row of inv.lineItems) {
      lineItemIds.add(row.lineItemId);
    }
  }

  const lineItemById = new Map(input.lineItems.map((item) => [item.id, item]));

  const lineItemResults: PayAppLineItemResult[] = [...lineItemIds]
    .map((lineItemId) => {
      const lineItem = lineItemById.get(lineItemId);
      const previousBilled = earlierInvoices.reduce(
        (sum, inv) => sum + Number(inv.lineItems.find((r) => r.lineItemId === lineItemId)?.thisPeriodBilled ?? 0),
        0,
      );
      // materialsStoredValue is a per-period delta, not a running balance --
      // summed across every earlier invoice the same way previousBilled is,
      // or a line's stored materials from an earlier application vanish
      // from the total the moment a later application doesn't re-enter them.
      const previousMaterialsStored = earlierInvoices.reduce(
        (sum, inv) =>
          sum + Number(inv.lineItems.find((r) => r.lineItemId === lineItemId)?.materialsStoredValue ?? 0),
        0,
      );
      const thisRow = invoice.lineItems.find((r) => r.lineItemId === lineItemId);
      const thisPeriodBilled = Number(thisRow?.thisPeriodBilled ?? 0);
      const materialsStoredValue = Number(thisRow?.materialsStoredValue ?? 0);
      const earnedToDate =
        previousBilled + thisPeriodBilled + previousMaterialsStored + materialsStoredValue;

      return {
        lineItemId,
        description: describe(lineItem),
        scheduledValue: scheduledValueFor(lineItem, earnedToDate),
        previousBilled,
        thisPeriodBilled,
        previousMaterialsStored,
        materialsStoredValue,
      };
    })
    // Drop untouched, zero-value rows for lines that were never billed and
    // aren't in this period's application -- an all-zero row for every SOV
    // line on every application would bury the ones that actually moved.
    //
    // `!== 0`, not `> 0`: a negative materialsStoredValue is the documented
    // way to move value out of stored once material is installed, so a row
    // whose only remaining content is that negative residual is real. Under
    // `> 0` such a row vanished from the sheet AND, because the summary
    // sums these same rows, from every total on the certificate above it.
    .filter(
      (row) =>
        row.scheduledValue !== 0 ||
        row.previousBilled !== 0 ||
        row.thisPeriodBilled !== 0 ||
        row.previousMaterialsStored !== 0 ||
        row.materialsStoredValue !== 0,
    )
    .map(calculatePayAppLineItem);

  const summary = calculatePayAppSummary({
    lineItems: lineItemResults,
    retainagePercent: input.retainagePercent != null ? Number(input.retainagePercent) : null,
    previousRetainageWithheld: earlierInvoices.reduce((sum, inv) => sum + Number(inv.retainageWithheld ?? 0), 0),
    thisPeriodRetainageWithheld: Number(invoice.retainageWithheld ?? 0),
  });

  return { isPayApplication, lineItems: lineItemResults, summary };
}

/** Reads the job and hands the assembly plain values. Returns null wherever
 * the page should 404 -- a job in another company, or an invoice that isn't
 * on this job. Tenant scoping stays here; the caller supplies companyId. */
export async function loadPayApplication(jobId: string, invoiceId: string, companyId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      contact: true,
      // Deliberately UNFILTERED, unlike the job page's read: a line a change
      // order removed still has to appear here under its real description if
      // it was ever billed. `assemblePayApplication` reads `isDeleted` to
      // decide what scheduled value it still carries.
      lineItems: { orderBy: { createdAt: "asc" } },
      invoices: {
        orderBy: { number: "asc" },
        include: { lineItems: true },
      },
    },
  });
  if (!job || job.companyId !== companyId) {
    return null;
  }

  const invoice = job.invoices.find((inv) => inv.id === invoiceId);
  if (!invoice) {
    return null;
  }

  const assembly = assemblePayApplication({
    invoiceId,
    lineItems: job.lineItems,
    invoices: job.invoices,
    retainagePercent: job.retainagePercent,
  });
  if (!assembly) {
    return null;
  }

  return { job, invoice, ...assembly };
}
