import { prisma } from "@prova/db";
import type { ActionResultWith } from "@/lib/actions/shared";
import { issueInvoiceNumber } from "./invoice-number";
import { retainageWithheldFor } from "./retainage-amount";

/**
 * The body of "bill the client", lifted out of the Server Action so two
 * callers can share it: `createInvoice` (the job page's form) and the Ask
 * command `draft_invoice` (which needs the number and the id back, and a
 * refusal as a sentence rather than a throw — production redacts thrown
 * Server Action messages, and a card cannot show a sentence that never
 * arrives).
 *
 * Same arrangement as lib/estimating/create-job.ts: a plain object in, a
 * plain result out. No FormData, no `requireCompanyContext`, no
 * `revalidatePath`. The caller supplies the company it already verified
 * and does its own revalidation, so this can also run from a database
 * test. The job is asserted in-company HERE rather than inherited, because
 * this is the boundary a card's server-held payload crosses.
 *
 * `retainageWithheld` is snapshotted from the job's current rate at this
 * moment and never recomputed — see Invoice.retainageWithheld in
 * billing.prisma.
 *
 * The formula used to live in this file, and saying so is the point: the
 * pay-application path in lib/actions/billing.ts had its own copy of it,
 * spelled differently, and the two rounded $1,000.35 at 10% to different
 * cents. It now lives in ./retainage-amount.ts, which is the only place in
 * the app that multiplies an amount by a retainage rate.
 */
export type CreateInvoiceInput = {
  /** Already validated as a decimal string ("12500.00"). */
  amount: string;
  description?: string | null;
  dueAt?: Date | null;
};

export type CreateInvoiceResult = {
  invoiceId: string;
  number: number;
  retainageWithheld: string | null;
};

export const NOT_INVOICEABLE = "Contract this job before invoicing it";

export async function createInvoiceRecord(
  companyId: string,
  jobId: string,
  input: CreateInvoiceInput,
): Promise<ActionResultWith<CreateInvoiceResult>> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId },
    select: { id: true, status: true, retainagePercent: true },
  });
  if (!job) return { ok: false, error: "Job not found" };
  if (job.status === "ESTIMATE") return { ok: false, error: NOT_INVOICEABLE };

  // The Decimal goes in as a Decimal. It used to be pushed through
  // `Number()` first, which is a lossy step sitting directly in front of
  // the one operation that has to be exact.
  const retainageWithheld = retainageWithheldFor(input.amount, job.retainagePercent);

  const invoice = await prisma.$transaction(async (tx) =>
    tx.invoice.create({
      data: {
        jobId,
        number: await issueInvoiceNumber(tx, jobId),
        description: input.description?.trim() || null,
        amount: input.amount,
        dueAt: input.dueAt ?? null,
        retainageWithheld,
      },
      select: { id: true, number: true },
    }),
  );

  return { ok: true, value: { invoiceId: invoice.id, number: invoice.number, retainageWithheld } };
}
