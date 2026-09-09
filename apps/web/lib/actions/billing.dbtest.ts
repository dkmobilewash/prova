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

const { logPayment, submitPayApplication } = await import("./billing");

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
