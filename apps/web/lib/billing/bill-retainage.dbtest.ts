import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { removeBillingClickFixture, seedBillingClickFixture } from "@/scripts/billingClickFixture";

/** Billing retainage over the click fixture, whose figures are worked out by
 * hand: $4,700 held after application #2. The G702 is read back from the same
 * query the page uses. */
const context = { company: { id: "" } as Record<string, unknown>, companyId: "", id: "u", role: "OWNER", jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { billRetainage } = await import("@/lib/actions/billing");
const { pushInvoiceToQuickBooks } = await import("@/lib/actions/quickbooks");
const { loadPayApplication } = await import("@/lib/pay-application-query");
const { loadJobRetainage } = await import("./retainage-release");

let companyId = "", jobId = "";
const bill = (amount: string, periodTo = "2026-11-30") => {
  const form = new FormData();
  form.set("amount", amount);
  form.set("periodTo", periodTo);
  return billRetainage(jobId, form);
};
const newest = () => prisma.invoice.findFirstOrThrow({ where: { jobId }, orderBy: { number: "desc" } });

describe("billing retainage", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Retainage Co" } });
    companyId = company.id;
    context.company = company;
    context.companyId = companyId;
    jobId = (await seedBillingClickFixture(prisma, companyId)).jobId;
  });

  afterAll(async () => {
    await removeBillingClickFixture(prisma, companyId);
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("refuses more than is held, and a figure that is not one", async () => {
    expect(await bill("4700.01")).toMatchObject({ ok: false, error: expect.stringContaining("$4,700.00 is held") });
    expect(await bill("0")).toMatchObject({ ok: false });
    expect(await bill("lots")).toMatchObject({ ok: false });
  });

  it("bills part, and the G702 reads it as payment due with retainage reduced", async () => {
    expect(await bill("1700")).toEqual({ ok: true });
    const invoice = await newest();
    const view = await loadPayApplication(jobId, invoice.id, companyId);
    expect(view?.isPayApplication).toBe(true);
    expect(view?.summary).toMatchObject({
      contractSumToDate: 105000,
      totalCompletedAndStoredToDate: 47000,
      retainageToDate: 3000,
      totalEarnedLessRetainage: 44000,
      previousCertificatesForPayment: 42300,
      currentPaymentDue: 1700,
    });
    expect((await loadJobRetainage(prisma, jobId)).balanceCents).toBe(300000);
  });

  it("bills the rest, then refuses with nothing held", async () => {
    expect(await bill("3000")).toEqual({ ok: true });
    const view = await loadPayApplication(jobId, (await newest()).id, companyId);
    expect(view?.summary).toMatchObject({ retainageToDate: 0, currentPaymentDue: 3000 });
    expect(await bill("1")).toMatchObject({ ok: false, error: expect.stringContaining("No retainage is held") });
  });

  it("refuses without billing access, and will not push to QuickBooks", async () => {
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    expect(await bill("1")).toMatchObject({ ok: false, error: expect.stringContaining("job function") });
    context.role = "OWNER";
    context.jobFunction = null;
    expect(await pushInvoiceToQuickBooks((await newest()).id)).toMatchObject({ ok: false, error: expect.stringContaining("already in QuickBooks") });
  });
});
