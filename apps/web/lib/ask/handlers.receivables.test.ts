import { describe, expect, it, vi } from "vitest";

/**
 * receivables: what each GC still owes, and how late.
 *
 * Written with #288 and not before, which is the point worth recording:
 * this tool's arithmetic had no test at all. `tools.test.ts` names it in a
 * registry list, which proves it is REGISTERED and says nothing about what
 * it returns — so `outstanding: amount - paid` could count contractually
 * withheld retainage as money a GC owes today, and did, with a green suite.
 *
 * This is the tool a model answers "who owes me money" from. An overstated
 * figure here is not a rendering bug; it is a wrong sentence spoken with
 * confidence to the person deciding whether to chase a GC.
 */

const INVOICES = [
  {
    // $100,000 billed, $10,000 retained, the GC paid the $90,000 certified
    // due — six weeks after the due date. Nothing is owed and nothing is
    // late. Under the old rule this was $10,000 at 47 days overdue.
    number: 4,
    amount: 100_000,
    retainageWithheld: 10_000,
    issuedAt: new Date("2026-05-01T00:00:00.000Z"),
    dueAt: new Date("2026-05-31T00:00:00.000Z"),
    job: { name: "Riverside Medical", contact: { name: "Acme GC", paymentTermsDays: 30 } },
    payments: [{ amount: 90_000 }],
  },
  {
    // Genuinely short: $40,000 due after $5,000 retained, $10,000 paid.
    number: 5,
    amount: 45_000,
    retainageWithheld: 5_000,
    issuedAt: new Date("2026-07-01T00:00:00.000Z"),
    dueAt: new Date("2026-07-31T00:00:00.000Z"),
    job: { name: "Maple Street", contact: { name: "Turner", paymentTermsDays: 30 } },
    payments: [{ amount: 10_000 }],
  },
];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: { invoice: { findMany: async () => INVOICES } },
}));

type Row = { invoice: number; outstanding: number; retainageWithheld: number; daysOverdue: number };

async function ask() {
  const { runTool } = await import("./handlers");
  return runTool({ companyId: "company-1", principal: { role: "OWNER", jobFunction: null } }, "receivables", {});
}

describe("receivables", () => {
  it("does not report retainage as money the GC owes now", async () => {
    const rows = (await ask()).data as Row[];
    // The settled-to-net invoice is gone entirely: `outstanding` is zero,
    // so it falls out on the same > 0.005 filter a fully paid one does.
    expect(rows.map((r) => r.invoice)).toEqual([5]);
  });

  it("reports the genuine shortfall net of retainage, and names what it took out", async () => {
    const [row] = (await ask()).data as Row[];
    expect(row.outstanding).toBe(30_000);
    // Carried separately so a model can explain why outstanding is not
    // amount - paid, rather than appearing to have mis-subtracted.
    expect(row.retainageWithheld).toBe(5_000);
    expect(row.daysOverdue).toBeGreaterThan(0);
  });

  it("counts only the invoices that are really outstanding", async () => {
    // The summary is what the dashboard tile and the model both quote. It
    // said two outstanding invoices, one of them 47 days overdue, about a
    // GC who had paid everything they had been certified to pay.
    expect((await ask()).summary).toMatchObject({
      outstandingInvoiceCount: 1,
      overdueInvoiceCount: 1,
    });
  });
});
