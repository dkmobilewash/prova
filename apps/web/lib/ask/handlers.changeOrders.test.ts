import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prova/db";

/** Decimal, not number. `changeOrderValueDelta` does Decimal arithmetic on
 * these columns because they are Decimal in the database, and a fixture of
 * plain numbers would pass a handler that had quietly stopped using it. The
 * mock below hands back the REAL Prisma namespace, so this is the same
 * Decimal the app runs on. */
const dec = (value: number) => new Prisma.Decimal(value);

/**
 * change_order_status, and the figure that would otherwise be a floor
 * pretending to be a total.
 *
 * A proposal's value is derived from the line item it TARGETS, and an EDIT
 * or REMOVE routinely targets a row an earlier approved change order has
 * already soft-deleted. Such a proposal can never be booked —
 * `approveChangeOrder` refuses it — so `proposalValueDelta` prices it at
 * ZERO. That is correct and it is also dangerous: the change order's value
 * silently shrinks, and nothing in the number says a row was dropped
 * (#105 finding 5).
 *
 * The fixture therefore has one REMOVE against a deleted line, and the
 * assertions pin BOTH halves: the value is zero, and the row says how many
 * proposals it could not book. A handler that reported only the value would
 * pass on the first and fail on the second.
 */

const LINE_LIVE = { id: "line-1", description: "Framing", quantity: dec(100), unitPrice: dec(10), isDeleted: false };
const LINE_GONE = { id: "line-2", description: "Ceilings", quantity: dec(40), unitPrice: dec(25), isDeleted: true };

const JOBS = [
  {
    id: "job-1",
    name: "Riverside Medical",
    contact: { name: "Acme GC" },
    lineItems: [LINE_LIVE, LINE_GONE],
    changeOrders: [
      {
        number: 1,
        title: "Extra soffit",
        status: "SUBMITTED",
        submittedOn: new Date("2026-06-01T00:00:00.000Z"),
        decidedOn: null,
        // ADD of 10 @ 100 = +1,000.
        proposals: [
          {
            changeType: "ADD",
            lineItemId: null,
            quantity: dec(10),
            unitPrice: dec(100),
            previousQuantity: null,
            previousUnitPrice: null,
            previousIsDeleted: null,
          },
        ],
      },
      {
        number: 2,
        title: "Drop the ceilings",
        status: "DRAFT",
        submittedOn: null,
        decidedOn: null,
        // REMOVE of a line an earlier change order already deleted.
        proposals: [
          {
            changeType: "REMOVE",
            lineItemId: "line-2",
            quantity: null,
            unitPrice: null,
            previousQuantity: null,
            previousUnitPrice: null,
            previousIsDeleted: null,
          },
        ],
      },
      {
        number: 3,
        title: "Approved already",
        status: "APPROVED",
        submittedOn: new Date("2026-05-01T00:00:00.000Z"),
        decidedOn: new Date("2026-05-10T00:00:00.000Z"),
        proposals: [],
      },
    ],
  },
];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    job: { findMany: async () => JOBS, findFirst: async () => ({ id: "job-1" }) },
  },
}));

vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-06-15" }));

async function ask(input: Record<string, string> = {}) {
  const { runTool } = await import("./handlers");
  return runTool(
    { companyId: "company-1", principal: { role: "OWNER", jobFunction: null } },
    "change_order_status",
    input,
  );
}

describe("change_order_status", () => {
  it("prices a proposal against deleted scope at zero AND says it could not be booked", async () => {
    const rows = (await ask()).data as Array<Record<string, unknown>>;
    const co2 = rows.find((row) => row.changeOrder === "CO #2")!;

    // Zero, not −1,000: removing scope that is already gone changes
    // nothing, and approveChangeOrder would refuse it.
    expect(co2.value).toBe(0);
    // The half that stops that zero being a lie by omission. Without this
    // the row reads as a change order worth nothing rather than as one
    // whose only proposal is dead.
    expect(co2.proposalsThatCannotBeBooked).toBe(1);

    // The control: a bookable ADD on the same job is priced normally, so
    // the zero above is about this proposal and not about the fixture.
    expect(rows.find((row) => row.changeOrder === "CO #1")!.value).toBe(1000);
    expect(rows.find((row) => row.changeOrder === "CO #1")!.proposalsThatCannotBeBooked).toBe(0);
  });

  it("counts days since it went to the GC, and only for a submitted one", async () => {
    const rows = (await ask()).data as Array<Record<string, unknown>>;
    // 1 June to 15 June. Elapsed, NOT overdue: nothing records an agreed
    // response time for a change order.
    expect(rows.find((row) => row.changeOrder === "CO #1")!.daysAwaitingDecision).toBe(14);
    expect(rows.find((row) => row.changeOrder === "CO #2")!.daysAwaitingDecision).toBeNull();
    expect(rows.find((row) => row.changeOrder === "CO #3")!.daysAwaitingDecision).toBeNull();
  });

  it("treats PENDING as drafted-or-submitted, not as one status", async () => {
    const pending = (await ask({ status: "PENDING" })).data as Array<Record<string, unknown>>;
    expect(pending.map((row) => row.changeOrder).sort()).toEqual(["CO #1", "CO #2"]);

    const submitted = (await ask({ status: "SUBMITTED" })).data as Array<Record<string, unknown>>;
    expect(submitted.map((row) => row.changeOrder)).toEqual(["CO #1"]);

    // And no filter is everything, including the decided one.
    const all = (await ask()).data as Array<Record<string, unknown>>;
    expect(all).toHaveLength(3);
  });

  it("reports exposure as the SUBMITTED value only — a draft is not something the GC is sitting on", async () => {
    const result = await ask();
    expect(result.summary).toMatchObject({
      changeOrderCount: 3,
      pendingCount: 2,
      awaitingGcCount: 1,
      // CO #1 only. CO #2 is a draft we have not sent — and is worth zero
      // anyway — so nothing of it is money the GC is holding a decision on.
      valueAwaitingGcDecision: 1000,
    });
  });

  it("says nothing is in that status rather than returning an empty list ambiguously", async () => {
    const rejected = await ask({ status: "REJECTED" });
    expect(rejected.data).toEqual([]);
    expect(rejected.unavailable).toBe("No change order is rejected.");
  });
});
