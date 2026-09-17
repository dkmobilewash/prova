// What a submitted pay application actually writes.
//
// Extracted from `submitPayApplication` for one reason: the row that
// carries the G702 PERIOD TO date is the row a GC's accounting department
// reads, and until this module existed nothing could execute the code that
// builds it. The action still does the reads, the refusals and the
// transaction; this is only the shape of the insert, so a test can hold
// the written row in its hand without a database.
//
// The thing being guarded is narrow and specific: `periodTo` is the date a
// person TYPED, and `issuedAt` — `@default(now())`, the moment of the
// click — must never be what lands there. That is why this builder does
// not set `issuedAt` at all and takes no value that could become it.

import type { Prisma } from "@prova/db";

export interface PayAppInvoiceDataInput {
  jobId: string;
  /** Issued by `issueInvoiceNumber` inside the same transaction as the
   * insert — a counter row, never max(n)+1. */
  number: number;
  description: string | null;
  /** Decimal(12,2) as a fixed string, already summed from the rows. */
  amount: string;
  dueAt: Date | null;
  /** The entered period ending date, at UTC midnight. Required: a pay
   * application without one is the defect this column exists to fix. */
  periodTo: Date;
  retainageWithheld: string | null;
  rows: { lineItemId: string; thisPeriodBilled: number; materialsStoredValue: number }[];
}

export function payApplicationInvoiceData(
  input: PayAppInvoiceDataInput,
): Prisma.InvoiceUncheckedCreateInput {
  return {
    jobId: input.jobId,
    number: input.number,
    description: input.description,
    amount: input.amount,
    dueAt: input.dueAt,
    periodTo: input.periodTo,
    retainageWithheld: input.retainageWithheld,
    lineItems: {
      create: input.rows.map((row) => ({
        lineItemId: row.lineItemId,
        thisPeriodBilled: row.thisPeriodBilled.toFixed(2),
        materialsStoredValue: row.materialsStoredValue.toFixed(2),
      })),
    },
  };
}
