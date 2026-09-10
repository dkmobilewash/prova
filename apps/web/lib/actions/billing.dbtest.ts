import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Two of #102's six findings, against a real Postgres:
 *
 *   - logPayment's overpayment guard, which has to agree with
 *     calculateArAgingInvoice's own amount - SUM(payments.amount) math or
 *     the two can drift apart from each other;
 *   - submitPayApplication's duplicate-submission guard, which reads the
 *     job's most recent Invoice and its InvoiceLineItem rows back.
 *
 * Named `.dbtest.ts` so the normal suite does not collect it — CI has no
 * database. Run it against a SCRATCH one, exactly as backcharges.dbtest.ts
 * documents:
 *
 *   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
 *     pnpm --filter @prova/web exec vitest run --config vitest.db.config.ts
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

const revalidated: string[] = [];
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

const { createInvoice, logPayment, submitPayApplication } = await import("./billing");

let jobId = "";
let invoiceId = "";
let lineItemId = "";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

describe("logPayment against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Billing Test Co" } });
    context.company.id = company.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Test GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Billing Test Job", status: "CONTRACTED" },
    });
    jobId = job.id;
    const invoice = await prisma.invoice.create({
      data: { jobId, number: 1, amount: "20000.00" },
    });
    invoiceId = invoice.id;
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { invoiceId } });
    await prisma.invoice.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { companyId: context.company.id } });
    await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.delete({ where: { id: context.company.id } });
    await prisma.$disconnect();
  });

  it("logs a partial payment", async () => {
    expect(await logPayment(jobId, invoiceId, form({ amount: "15000" }))).toEqual({ ok: true });
    expect(revalidated).toContain(`/jobs/${jobId}`);
    const sum = await prisma.payment.aggregate({ where: { invoiceId }, _sum: { amount: true } });
    expect(Number(sum._sum.amount)).toBe(15000);
  });

  it("refuses a payment that would push total paid past the invoice total", async () => {
    // $15,000 already paid on a $20,000 invoice. A $10,000 payment here —
    // a double-click resubmitting an already-recorded payment is exactly
    // this shape — would bring the total to $25,000, past the invoice, and
    // calculateArAgingInvoice (balance <= 0 => null) would drop it from
    // A/R aging entirely while it should still show as paid in full at
    // most, never as owing a negative amount. Verified against the exact
    // arithmetic the guard uses, not just the message text.
    const result = await logPayment(jobId, invoiceId, form({ amount: "10000" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("$25,000.00");
      expect(result.error).toContain("$20,000.00");
    }

    const sum = await prisma.payment.aggregate({ where: { invoiceId }, _sum: { amount: true } });
    expect(Number(sum._sum.amount)).toBe(15000);
  });

  it("allows a payment that exactly clears the remaining balance", async () => {
    // The other side of the same boundary: a genuine final payment that
    // brings the balance to exactly $0 is the ordinary happy path (paying
    // off the last of an invoice) and must not be refused — the guard only
    // blocks going PAST the total, never reaching it exactly.
    expect(await logPayment(jobId, invoiceId, form({ amount: "5000" }))).toEqual({ ok: true });
    const sum = await prisma.payment.aggregate({ where: { invoiceId }, _sum: { amount: true } });
    expect(Number(sum._sum.amount)).toBe(20000);

    // The exact bug #102 described: calculateArAgingInvoice must now treat
    // this invoice as fully paid (null, not a negative balance) — which is
    // correct here because it really IS paid in full, unlike the doubled-
    // payment case the guard above prevents from ever reaching this state
    // while $10,000 is still actually owed.
    const { calculateArAgingInvoice } = await import("@/lib/cash-flow");
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const aging = calculateArAgingInvoice(
      {
        invoiceId: invoice.id,
        jobId,
        jobName: "Billing Test Job",
        contactName: "Test GC",
        amount: Number(invoice.amount),
        paidAmount: 20000,
        issuedAt: invoice.issuedAt,
        dueAt: invoice.dueAt,
        paymentTermsDays: null,
      },
      new Date(),
    );
    expect(aging).toBeNull();
  });

  it("refuses any further payment once already paid in full", async () => {
    const result = await logPayment(jobId, invoiceId, form({ amount: "1" }));
    expect(result).toEqual({
      ok: false,
      error: "This invoice is already paid in full — there is nothing left to log a payment against.",
    });
  });
});

describe("submitPayApplication against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Pay App Test Co" } });
    context.company.id = company.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Test GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Pay App Test Job", status: "CONTRACTED" },
    });
    jobId = job.id;
    const lineItem = await prisma.jobLineItem.create({
      data: { jobId, description: "Level 3 drywall", quantity: "1", unitPrice: "50000" },
    });
    lineItemId = lineItem.id;
  });

  afterAll(async () => {
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { jobId } } });
    await prisma.invoice.deleteMany({ where: { jobId } });
    await prisma.jobLineItem.deleteMany({ where: { jobId } });
    // InvoiceCounter holds a RESTRICT foreign key to Job, and
    // submitPayApplication now writes one — so the job delete below fails
    // without this. Found by the counter breaking this teardown, which is
    // the same way #136's ON DELETE RESTRICT surfaced in three afterAlls.
    await prisma.invoiceCounter.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { companyId: context.company.id } });
    await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.delete({ where: { id: context.company.id } });
    await prisma.$disconnect();
  });

  // formData.getAll needs repeated keys, which FormData.set can't express
  // via the plain form() helper above — build this one directly.
  function multiForm(values: { lineItemId: string; thisPeriodBilled: string; materialsStoredValue: string }[]) {
    const fd = new FormData();
    for (const row of values) {
      fd.append("lineItemId", row.lineItemId);
      fd.append("thisPeriodBilled", row.thisPeriodBilled);
      fd.append("materialsStoredValue", row.materialsStoredValue);
    }
    return fd;
  }

  it("submits a pay application", async () => {
    const result = await submitPayApplication(
      jobId,
      multiForm([{ lineItemId, thisPeriodBilled: "10000", materialsStoredValue: "0" }]),
    );
    expect(result).toEqual({ ok: true });
    expect(await prisma.invoice.count({ where: { jobId } })).toBe(1);
  });

  it("refuses an identical resubmission moments later — the #102 double-bill case", async () => {
    const result = await submitPayApplication(
      jobId,
      multiForm([{ lineItemId, thisPeriodBilled: "10000", materialsStoredValue: "0" }]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invoice #1");
    }
    // Still one invoice, not two, and no second retainage figure was ever
    // computed for a period that was only billed once.
    expect(await prisma.invoice.count({ where: { jobId } })).toBe(1);
  });

  it("allows a genuinely different pay application for the next period", async () => {
    const result = await submitPayApplication(
      jobId,
      multiForm([{ lineItemId, thisPeriodBilled: "15000", materialsStoredValue: "0" }]),
    );
    expect(result).toEqual({ ok: true });
    expect(await prisma.invoice.count({ where: { jobId } })).toBe(2);
  });

  it("allows the same breakdown again once the guard's window has passed", async () => {
    // Age the most recent invoice by moving issuedAt into the past —
    // Invoice, unlike TimeEntry, has no restriction against being updated
    // (updateInvoiceStatus already does), so this is an ordinary update.
    const last = await prisma.invoice.findFirstOrThrow({ where: { jobId }, orderBy: { number: "desc" } });
    await prisma.invoice.update({ where: { id: last.id }, data: { issuedAt: new Date(Date.now() - 60_000) } });

    const result = await submitPayApplication(
      jobId,
      multiForm([{ lineItemId, thisPeriodBilled: "15000", materialsStoredValue: "0" }]),
    );
    expect(result).toEqual({ ok: true });
    expect(await prisma.invoice.count({ where: { jobId } })).toBe(3);
  });
});


describe("invoice numbers come from a counter, against a real database", () => {
  const ctx = { companyId: "", jobId: "" };

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Invoice Counter Test Co" } });
    ctx.companyId = company.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Counter GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Counter Job", status: "CONTRACTED" },
    });
    ctx.jobId = job.id;
    context.company.id = company.id;
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { jobId: ctx.jobId } });
    await prisma.invoiceCounter.deleteMany({ where: { jobId: ctx.jobId } });
    await prisma.job.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.contact.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.company.delete({ where: { id: ctx.companyId } });
  });

  it("issues 1 then 2, and records the counter alongside", async () => {
    context.company.id = ctx.companyId;
    await createInvoice(ctx.jobId, form({ amount: "1000" }));
    await createInvoice(ctx.jobId, form({ amount: "2000" }));

    const numbers = (
      await prisma.invoice.findMany({ where: { jobId: ctx.jobId }, orderBy: { number: "asc" } })
    ).map((i) => i.number);
    expect(numbers).toEqual([1, 2]);

    const counter = await prisma.invoiceCounter.findUnique({ where: { jobId: ctx.jobId } });
    expect(counter?.lastNumber).toBe(2);
  });

  it("does NOT reissue a number after the row it belonged to is removed", async () => {
    // The property the counter exists for. There is no deleteInvoice in
    // the app — an invoice is an evidence record — so this deletes
    // directly, which is the only way it could happen at all. Under
    // max(number) + 1 the next invoice here would be 2 a second time, on a
    // document a GC has already been sent.
    await prisma.invoice.delete({ where: { jobId_number: { jobId: ctx.jobId, number: 2 } } });
    await createInvoice(ctx.jobId, form({ amount: "3000" }));

    const numbers = (
      await prisma.invoice.findMany({ where: { jobId: ctx.jobId }, orderBy: { number: "asc" } })
    ).map((i) => i.number);
    expect(numbers).toEqual([1, 3]);
  });

  it("cannot issue the same number twice when two submits race", async () => {
    // The reachable half of the defect, and the reason this is a fix
    // rather than a tidy-up. Under max(number) + 1 both reads returned the
    // same max and the second create violated @@unique([jobId, number]) —
    // a thrown Server Action message, which production redacts, on a
    // GC-facing document. Run concurrently rather than in sequence,
    // because sequential calls could never have exhibited it.
    await Promise.all([
      createInvoice(ctx.jobId, form({ amount: "10" })),
      createInvoice(ctx.jobId, form({ amount: "20" })),
      createInvoice(ctx.jobId, form({ amount: "30" })),
    ]);

    const numbers = (
      await prisma.invoice.findMany({ where: { jobId: ctx.jobId }, orderBy: { number: "asc" } })
    ).map((i) => i.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual([1, 3, 4, 5, 6]);
  });
});

describe("InvoiceCounter is a cleanup-script hazard — #227, proved against a real database", () => {
  // #224 added InvoiceCounter and did NOT register it in the three cleanup
  // scripts, so a job that had ever been invoiced could no longer be
  // deleted: the counter is keyed on jobId and outlives the invoices, and
  // its foreign key to Job is ON DELETE RESTRICT. #227 registered it.
  //
  // WHY THIS TEST EXISTS SEPARATELY FROM THAT FIX. The static check that
  // should have caught it — scratch-cleanup-order.test.ts — was blind to
  // the constraint, because #224's migration wraps its ALTER TABLE after
  // the constraint name and the pattern demanded single spaces. #227 made
  // that regex whitespace-tolerant, and it now parses 182 of 182 declared
  // foreign keys. But that is a check on the SQL TEXT. This one is the
  // by-result half: it asks the database.
  //
  // The equivalent for ContractDocumentVersionCounter shipped with #228
  // (contract-documents.dbtest.ts). This is the one it was modelled on and
  // the one that was still missing.
  const ctx = { companyId: "", jobId: "" };

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Invoice Counter Hazard Co" } });
    ctx.companyId = company.id;
    context.company.id = company.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Hazard GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Hazard Job", status: "CONTRACTED" },
    });
    ctx.jobId = job.id;
    await createInvoice(ctx.jobId, form({ amount: "500" }));
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { jobId: ctx.jobId } });
    await prisma.invoiceCounter.deleteMany({ where: { jobId: ctx.jobId } });
    await prisma.job.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.contact.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.company.delete({ where: { id: ctx.companyId } });
  });

  it("is keyed on jobId and outlives its Invoice rows, so deleting the invoices alone does NOT free the job", async () => {
    await prisma.invoice.deleteMany({ where: { jobId: ctx.jobId } });
    expect(await prisma.invoice.count({ where: { jobId: ctx.jobId } })).toBe(0);
    // The counter is still there, and RESTRICT means it alone blocks the
    // delete — a cleanup script that removes every evidence row and not
    // this one dies partway through, on real data.
    expect(await prisma.invoiceCounter.count({ where: { jobId: ctx.jobId } })).toBe(1);

    // NAMED, not merely thrown. `rejects.toThrow()` alone would pass if the
    // job were blocked by any other child — this job has a Contact and could
    // grow more relations tomorrow — so the assertion would go green while
    // saying nothing about InvoiceCounter, which is the failure mode this
    // whole file exists to catch. Prisma puts the constraint in `meta`.
    const blocked = await prisma.job
      .delete({ where: { id: ctx.jobId } })
      .then(() => null)
      .catch((error: unknown) => error as { meta?: { constraint?: string } });
    expect(blocked).not.toBeNull();
    expect(blocked?.meta?.constraint).toBe("InvoiceCounter_jobId_fkey");
  });

  it("deleting the counter too is what actually frees the job — the fix in scratch-scope.mjs / clean-scratch-data.mjs / seed-demo.mjs", async () => {
    await prisma.invoiceCounter.deleteMany({ where: { jobId: ctx.jobId } });
    await expect(prisma.job.delete({ where: { id: ctx.jobId } })).resolves.toBeTruthy();
  });
});

