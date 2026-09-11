import { prisma } from "@prova/db";
import type { ActionResultWith } from "@/lib/actions/shared";
import { issueInvoiceNumber } from "./invoice-number";

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
 * billing.prisma. The formula is the action's own, moved, not restated.
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

export function retainageWithheldFor(amount: string, retainagePercent: number | null): string | null {
  return retainagePercent != null ? (Number(amount) * (retainagePercent / 100)).toFixed(2) : null;
}

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

  const retainageWithheld = retainageWithheldFor(
    input.amount,
    job.retainagePercent == null ? null : Number(job.retainagePercent),
  );

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
