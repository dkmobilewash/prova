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
      const scheduledValue = lineItem ? Number(lineItem.quantity) * Number(lineItem.unitPrice ?? 0) : 0;
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

      return {
        lineItemId,
        description: lineItem?.description ?? "(line item removed)",
        scheduledValue,
        previousBilled,
        thisPeriodBilled: Number(thisRow?.thisPeriodBilled ?? 0),
        previousMaterialsStored,
        materialsStoredValue: Number(thisRow?.materialsStoredValue ?? 0),
      };
    })
    // Drop untouched, zero-value rows for lines that were never billed and
    // aren't in this period's application -- an all-zero row for every SOV
    // line on every application would bury the ones that actually moved.
    .filter(
      (row) =>
        row.scheduledValue > 0 ||
        row.previousBilled > 0 ||
        row.thisPeriodBilled > 0 ||
        row.previousMaterialsStored > 0 ||
        row.materialsStoredValue > 0,
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
