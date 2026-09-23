import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Both money defects, proved through the real write paths against a real
 * Postgres — the half that a unit test and a static census cannot reach.
 *
 * WHY THIS FILE EXISTS AT ALL. `retainage-amount.test.ts` proves the
 * formula, and `retainage-single-source.test.ts` proves that both writers
 * call it. Neither executes a write. The gap between "this function is
 * correct and that file calls it" and "the cent stored in a
 * `Decimal(12, 2)` column on a document the GC receives is right" is
 * exactly where a money bug lives — the two expressions that were live
 * were each individually plausible, and what was wrong was what came out
 * the far end.
 *
 * So the load-bearing assertion here is a single one: **bill the same
 * $1,000.35 at 10% two different ways and read the same cent back out of
 * the database.** That is the defect stated as an experiment. It was
 * $100.04 one way and $100.03 the other.
 *
 * Named `.dbtest.ts`, so `pnpm test` does not collect it. CI runs it in the
 * `dbtest` job against a Postgres 16 service container; `vitest.db.setup.mts`
 * refuses to start against anything that is not local.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

const { createInvoice, submitPayApplication } = await import("@/lib/actions/billing");
const { loadPayApplication } = await import("@/lib/pay-application-query");

let jobId = "";
let lineItemId = "";

/** $1,000.35 at 10% is exactly $100.035 — a real half-cent, not float dust
 * — and half-up makes it $100.04. This is the reproduction amount. */
const AMOUNT = "1000.35";
const EXPECTED = "100.04";

function multiForm(rows: { lineItemId: string; thisPeriodBilled: string; materialsStoredValue: string }[]) {
  const fd = new FormData();
  for (const row of rows) {
    fd.append("lineItemId", row.lineItemId);
    fd.append("thisPeriodBilled", row.thisPeriodBilled);
    fd.append("materialsStoredValue", row.materialsStoredValue);
  }
  return fd;
}

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

// File-level, NOT inside the first describe. Vitest runs a describe's
// `afterAll` as soon as that block's tests finish, so fixtures scoped to
// the first block would be deleted before the second one ran — and the
// second block reads the invoices the first one wrote.
beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Retainage Write Test Co" } });
  context.company.id = company.id;
  const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Test GC" } });
  const job = await prisma.job.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      name: "Retainage Write Test Job",
      status: "CONTRACTED",
      // Decimal(5, 2). Postgres hands this back as "10.00", which is part
      // of what the formula has to take without changing its answer.
      retainagePercent: "10",
    },
  });
  jobId = job.id;
  // Scheduled value $2,000, comfortably above the amount billed, so
  // payAppEntryError's over-billing cap is not what is being tested here.
  const lineItem = await prisma.jobLineItem.create({
    data: { jobId, description: "Level 3 drywall", quantity: "1", unitPrice: "2000" },
  });
  lineItemId = lineItem.id;
});

afterAll(async () => {
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { jobId } } });
  await prisma.invoice.deleteMany({ where: { jobId } });
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  // InvoiceCounter is a RESTRICT child of Job keyed on jobId, so deleting
  // the invoices does not reach it and the job delete below fails without
  // this line. CLAUDE.md records that a new counter is three edits, and
  // this teardown is where the third one bites.
  await prisma.invoiceCounter.deleteMany({ where: { jobId } });
  await prisma.job.deleteMany({ where: { companyId: context.company.id } });
  await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
  await prisma.company.delete({ where: { id: context.company.id } });
  await prisma.$disconnect();
});

describe("the retainage snapshot, written both ways", () => {
  it("is $100.04 on a lump-sum invoice", async () => {
    await createInvoice(jobId, form({ amount: AMOUNT, description: "Lump-sum bill" }));

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { jobId, number: 1 } });
    expect(invoice.retainageWithheld?.toFixed(2)).toBe(EXPECTED);
    expect(invoice.amount.toFixed(2)).toBe("1000.35");
    // A lump-sum bill has no continuation-sheet rows. This is what made it
    // invisible to `previousBilled` and visible to `previousRetainage`.
    expect(await prisma.invoiceLineItem.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it("is $100.04 on a pay application for the identical amount", async () => {
    const result = await submitPayApplication(
      jobId,
      multiForm([{ lineItemId, thisPeriodBilled: AMOUNT, materialsStoredValue: "0" }]),
    );
    expect(result).toEqual({ ok: true });

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { jobId, number: 2 } });
    // THE ASSERTION THIS FILE EXISTS FOR. This read $100.03 before the fix,
    // against the $100.04 the lump-sum path wrote for the same bill on the
    // same job at the same rate.
    expect(invoice.retainageWithheld?.toFixed(2)).toBe(EXPECTED);
    expect(invoice.amount.toFixed(2)).toBe("1000.35");
  });

  it("stores the same cent whichever way the job was billed", async () => {
    // Stated as a comparison rather than as two constants, so it stays true
    // if somebody ever changes the reproduction amount above — and so it
    // fails for the right reason, which is disagreement, not a wrong value.
    const invoices = await prisma.invoice.findMany({ where: { jobId }, orderBy: { number: "asc" } });
    const snapshots = invoices.map((invoice) => invoice.retainageWithheld?.toFixed(2));
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toBe(snapshots[1]);
  });
});

describe("the G702 certificate after a lump-sum bill on the same job", () => {
  it("prints no negative previous certificate, and no borrowed retainage", async () => {
    // Reads back through the real query, so the row selection is exercised
    // against actual Prisma Decimals rather than test fixtures.
    const payApp = await prisma.invoice.findFirstOrThrow({ where: { jobId, number: 2 } });
    const view = await loadPayApplication(jobId, payApp.id, context.company.id);
    if (!view) throw new Error("loadPayApplication returned null for a job it should find");

    expect(view.isPayApplication).toBe(true);

    // Invoice #1 was a lump-sum bill. It is not a previous certificate on
    // this contract, so it is on neither side of the certificate. Before
    // the fix this printed -100.04 and a retainage to date of 200.08.
    expect(view.summary.previousCertificatesForPayment).toBe(0);
    expect(view.summary.retainageToDate).toBeCloseTo(100.04, 2);
    expect(view.summary.totalCompletedAndStoredToDate).toBeCloseTo(1000.35, 2);
    expect(view.summary.totalEarnedLessRetainage).toBeCloseTo(900.31, 2);

    // The money actually asked for, which was RIGHT throughout — the term
    // cancels algebraically. Pinned so a future change to the lines above
    // cannot quietly move it.
    expect(view.summary.currentPaymentDue).toBeCloseTo(900.31, 2);

    // $2,000 scheduled less $900.31 certified. Before the fix: 1099.69 - a
    // further 100.04, understating the work left by the lump sum's
    // retainage.
    expect(view.summary.contractSumToDate).toBeCloseTo(2000, 2);
    expect(view.summary.balanceToFinishIncludingRetainage).toBeCloseTo(1099.69, 2);
  });
});
