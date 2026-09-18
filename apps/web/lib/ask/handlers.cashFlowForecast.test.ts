import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * cash_flow_forecast: when money already invoiced is expected to arrive.
 *
 * The figure worth guarding is the one the page invented a line for:
 * retainage with NO substantial completion date. It is real money owed
 * with no basis for when, and assigning it a month would be a forecast
 * nobody made. It has to come back as its own total.
 *
 * Also pinned: that the overdue bucket and the aging table agree. /cash-flow
 * contradicted itself twice on exactly this — once filing a two-day-old
 * invoice under the current month, once calling a due-today invoice overdue
 * while the aging table called it current — which is why `isOverdue` is one
 * predicate shared by both. Going through `calculateArAgingInvoice` here
 * rather than re-deriving a due date is what keeps the box on the same side
 * of that line.
 *
 * FOUR NUMBERS IN THIS FILE CHANGED WITH #288, and the fixture below is why
 * they were worth changing: it already carried `retainageWithheld` on both
 * invoices, because the retainage half of the forecast reads it. The AR
 * half did not, so the $2,000 and $1,500 were counted once as retainage
 * receivable and again inside the AR balance — and this file asserted the
 * doubled figures as correct. `arOutstanding` was 14,000 with
 * `retainageOutstanding` 3,500 beside it, a forecast total of 17,500 on
 * 14,000 of actually-outstanding money. The new AR figure, 10,500, plus
 * the unchanged 3,500, is exactly the 14,000 the old AR column claimed on
 * its own. That arithmetic is now asserted directly in
 * lib/cash-flow.test.ts rather than left for a reader to notice.
 */

const JOBS = [
  {
    id: "job-1",
    name: "Riverside Medical",
    // No completion date: its retainage cannot be scheduled.
    substantialCompletionDate: null,
    contact: { name: "Acme GC", paymentTermsDays: 30 },
    invoices: [
      {
        id: "inv-1",
        amount: 10_000,
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
        // Long past due: belongs in the overdue bucket, not a month.
        dueAt: new Date("2026-02-01T00:00:00.000Z"),
        retainageWithheld: 2_000,
        payments: [{ amount: 1_000 }],
      },
    ],
    retainageReleases: [],
  },
  {
    id: "job-2",
    name: "Maple Street",
    substantialCompletionDate: new Date("2026-07-15T00:00:00.000Z"),
    contact: { name: "Turner", paymentTermsDays: 30 },
    invoices: [{ id: "inv-2", amount: 5_000, issuedAt: new Date("2026-06-01T00:00:00.000Z"), dueAt: new Date("2026-07-20T00:00:00.000Z"), retainageWithheld: 1_500, payments: [] }],
    retainageReleases: [],
  },
];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: { job: { findMany: async () => JOBS } },
}));

// The handler reads `new Date()` — it is a forecast, so "now" is the
// question. Frozen here rather than written relative to the real clock:
// a fixture dated by hand goes stale silently, and the first symptom is a
// not-yet-due invoice quietly becoming overdue months after anyone looked.
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
});
afterAll(() => vi.useRealTimers());

async function ask() {
  const { runTool } = await import("./handlers");
  return runTool({ companyId: "company-1", principal: { role: "OWNER", jobFunction: null } }, "cash_flow_forecast", {});
}

describe("cash_flow_forecast", () => {
  it("reports retainage with no completion date as its own total, never as a month", async () => {
    const data = (await ask()).data as { months: { key: string; retainageExpected: number }[]; retainageWithNoCompletionDate: number };

    // Riverside's $2,000 has no date to anchor it.
    expect(data.retainageWithNoCompletionDate).toBe(2_000);
    // And it is in no bucket at all — including the overdue one, which is
    // where an "it must go somewhere" fix would quietly put it.
    const scheduled = data.months.reduce((sum, month) => sum + month.retainageExpected, 0);
    expect(scheduled).toBe(1_500);
  });

  it("puts a long-overdue invoice in the overdue bucket rather than a calendar month", async () => {
    const data = (await ask()).data as { months: { key: string; arExpected: number }[] };
    expect(data.months[0].key).toBe("OVERDUE");
    // 10,000 invoiced, less 2,000 retained (not due until completion, and
    // reported as retainage above), less 1,000 paid. Maple's, due 20 July,
    // is NOT here — it is five weeks away, and a forecast that files it
    // under "overdue" is the contradiction /cash-flow shipped twice.
    expect(data.months[0].arExpected).toBe(7_000);
    const july = data.months.find((month) => month.key === "2026-07")!;
    // 5,000 invoiced less 1,500 retained, nothing paid.
    expect(july.arExpected).toBe(3_500);
  });

  it("carries the totals the model would otherwise have to add up", async () => {
    const result = await ask();
    expect(result.summary).toMatchObject({
      // 7,000 + 3,500, both net of retainage. Was 14,000 — which is what
      // these two lines now sum to, because the 3,500 below was inside it.
      arOutstanding: 10_500,
      // 2,000 unanchored + 1,500 scheduled.
      retainageOutstanding: 3_500,
      overdueNow: 7_000,
    });

    // The model is handed both figures and will add them. Asserted here so
    // that sum is a true total rather than a double count — 14,000 of
    // outstanding money, once.
    const summary = result.summary as { arOutstanding: number; retainageOutstanding: number };
    expect(summary.arOutstanding + summary.retainageOutstanding).toBe(14_000);
  });

  it("splits receivables into the same aging buckets the page shows", async () => {
    const data = (await ask()).data as { agingByBucket: Record<string, number> };
    // One predicate, shared with the aging table: the overdue invoice lands
    // in a past-due bucket and the not-yet-due one in CURRENT.
    expect(data.agingByBucket.DAYS_90_PLUS).toBe(7_000);
    expect(data.agingByBucket.CURRENT).toBe(3_500);
  });
});
