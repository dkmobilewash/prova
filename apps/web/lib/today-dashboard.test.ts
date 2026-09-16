// Issue #288, and this file exists because of the shape of the bug rather
// than the bug itself.
//
// /cash-flow and this dashboard have disagreed about which invoices are
// overdue TWICE, both times because one of them mirrored an invoice rule by
// hand instead of importing it. #288 nets retainage out of the AR balance,
// which is exactly that kind of rule — so the risk is not that this page
// keeps the old behaviour, it is that the two pages end up with different
// behaviours and both look fine on their own screen.
//
// There was no test file for this module at all before, which is why the
// receivables tile could carry `amount - paid` indefinitely without anyone
// noticing it was a second copy of a rule that lives in lib/cash-flow.ts.
//
// The prisma layer is faked, not seeded: this is about arithmetic over
// rows, and the rows are the fixture.

import { describe, expect, it, vi } from "vitest";

const RETAINAGE_HELD = 12_000;

/** $100,000 billed with $10,000 retained. The GC has paid the $90,000 an
 * AIA G702 certifies as currently due, well after the due date — so under
 * the old gross rule this invoice was both OVERDUE and SHORT-PAID, and
 * under the correct one it is neither. Every assertion below turns on that
 * one row. */
const INVOICES = [
  {
    id: "inv-1",
    number: 4,
    jobId: "job-1",
    amount: 100_000,
    retainageWithheld: 10_000,
    issuedAt: new Date("2026-05-01T00:00:00.000Z"),
    dueAt: new Date("2026-05-31T00:00:00.000Z"),
    job: {
      name: "Riverside Medical",
      contact: { id: "gc-1", name: "Acme GC", paymentTermsDays: 30 },
    },
    payments: [{ amount: 90_000, receivedAt: new Date("2026-05-20T00:00:00.000Z"), feeAmount: null }],
  },
];

const CONTACTS = [
  {
    id: "gc-1",
    name: "Acme GC",
    jobs: [
      {
        invoices: [
          {
            amount: 100_000,
            retainageWithheld: 10_000,
            issuedAt: new Date("2026-05-01T00:00:00.000Z"),
            dueAt: new Date("2026-05-31T00:00:00.000Z"),
            payments: [
              { amount: 90_000, receivedAt: new Date("2026-05-20T00:00:00.000Z"), feeAmount: null },
            ],
          },
        ],
      },
    ],
  },
];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    invoice: { findMany: async () => INVOICES },
    // No active jobs: job health and crews are not what this file is about,
    // and an empty list exercises them honestly rather than not at all.
    job: { findMany: async () => [] },
    contact: { findMany: async () => CONTACTS },
  },
}));

vi.mock("./retainage-query", () => ({ loadRetainageHeld: async () => RETAINAGE_HELD }));

async function load() {
  const { loadTodayDashboard } = await import("./today-dashboard");
  return loadTodayDashboard("company-1", new Date("2026-09-16T12:00:00.000Z"));
}

describe("the receivables tile, on an invoice paid to its net amount", () => {
  it("does not call it outstanding", async () => {
    // THE DEFECT: `outstanding: amount - paid` left $10,000 here, and the
    // filter below it (> 0.005) therefore kept the invoice in the tile.
    const dashboard = await load();
    expect(dashboard.receivables).toEqual([]);
  });

  it("does not call it overdue, three and a half months late", async () => {
    // The expensive half. Due 31 May, read on 16 September: the old rule
    // put $10,000 of contractually-withheld money in an overdue list an
    // owner acts on, and in a total a bonding company reads.
    const dashboard = await load();
    expect(dashboard.overdue).toEqual([]);
    expect(dashboard.overdueTotal).toBe(0);
  });

  it("still knows the invoice exists", async () => {
    // The empty-receivables list has two causes that read identically —
    // every invoice settled, or none ever raised — and this is what tells
    // them apart. A fix that made the invoice vanish from the count would
    // change which sentence the screen shows.
    const dashboard = await load();
    expect(dashboard.invoicesRaised).toBe(1);
  });
});

describe("the GC reliability column, on the same invoice", () => {
  it("has an on-time rate rather than a dash", async () => {
    // isSettled compared cash against GROSS, so a GC holding retainage —
    // all of them — had an empty settled set and both figures came back
    // null. The column rendered "—" and read as an unbuilt feature.
    const [acme] = (await load()).gcReliability;
    expect(acme.reliability.onTimeRate).toBe(1);
    expect(acme.reliability.averageDaysToPay).toBe(19);
    expect(acme.reliability.settledCount).toBe(1);
  });

  it("does not report the GC as having short-paid", async () => {
    const [acme] = (await load()).gcReliability;
    expect(acme.reliability.shortPaidCount).toBe(0);
  });

  it("still counts the retainage as outstanding, and names it", async () => {
    // Not written off. Held, legitimately — which is a different claim
    // from paid, and a different claim from late.
    const [acme] = (await load()).gcReliability;
    expect(acme.reliability.outstandingTotal).toBe(10_000);
    expect(acme.reliability.retainageExcluded).toBe(10_000);
  });
});

describe("the company-wide retainage figure", () => {
  it("still comes from loadRetainageHeld, not from the per-invoice column", async () => {
    // #97's guarantee, asserted behaviourally rather than by grep: this
    // page now reads Invoice.retainageWithheld per invoice for the two
    // things above, and the company total must be unmoved by that. The
    // fake loader returns a number no sum of these rows can produce.
    expect((await load()).retainageHeld).toBe(RETAINAGE_HELD);
  });
});
