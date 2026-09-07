import { describe, expect, it } from "vitest";
import { assemblePayApplication, type PayAppAssemblyInput } from "./pay-application-query";

/**
 * #98 — the continuation sheet counted line items a change order removed.
 *
 * `approveChangeOrder` handles a REMOVE proposal with a SOFT delete
 * (lib/actions/changeOrders.ts: `data: { isDeleted: true }`), so the row
 * survives and `InvoiceLineItem.lineItemId` still resolves to it. This
 * module read the job's line items unfiltered and never looked at
 * `isDeleted`, so a removed line kept its full quantity x unitPrice on a
 * G702/G703 that goes to a general contractor and asks for money.
 *
 * What these tests prove: the assembly rules — which lines get a row, what
 * scheduled value each carries, and every figure in the summary
 * certificate — with no database and no rendering. That is the whole of the
 * defect, because the fix is in `assemblePayApplication`'s handling of the
 * `isDeleted` flag, NOT in the Prisma `where` (the read stays deliberately
 * unfiltered so a removed line keeps its real description). What they do
 * not prove is the printed sheet; that is the click-list.
 *
 * The removed line's scheduled value is its BILLED-TO-DATE amount, not
 * zero, and that is a deliberate decision rather than an accident of
 * implementation — see the comment on `scheduledValueFor`. A removed line
 * that was never billed therefore lands at $0 and drops off the sheet
 * entirely, which is the outcome #98 asks for; a removed line that was
 * already billed is closed out at what it earned, which keeps
 * `calculatePayAppSummary`'s balanceToFinish identity true. Setting it to
 * zero instead trades a $60,000 overstatement for a $10,000
 * understatement; test 3 below is what pins that.
 */

const RETAINAGE = "10";

/** Fixture A — L2 removed by a deductive change order, never billed. */
function fixtureNeverBilled(invoiceId: string): PayAppAssemblyInput {
  return {
    invoiceId,
    retainagePercent: RETAINAGE,
    lineItems: [
      {
        id: "L1",
        description: "Metal stud framing — Level 3",
        quantity: "1",
        unitPrice: "200000",
        isDeleted: false,
      },
      {
        id: "L2",
        description: "Spray fireproofing — parking deck",
        quantity: "1",
        unitPrice: "60000",
        isDeleted: true,
      },
    ],
    invoices: [
      {
        id: "inv1",
        number: 1,
        retainageWithheld: "5000",
        lineItems: [{ lineItemId: "L1", thisPeriodBilled: "50000", materialsStoredValue: "0" }],
      },
      {
        id: "inv2",
        number: 2,
        retainageWithheld: "3000",
        lineItems: [{ lineItemId: "L1", thisPeriodBilled: "30000", materialsStoredValue: "0" }],
      },
    ],
  };
}

/**
 * Fixture B — a SEPARATE job, on purpose. L3 was billed $10,000 on
 * application #1 and only then removed. Folding this into fixture A would
 * move invoice #1's retainage and break fixture A's summary assertions,
 * which is exactly the kind of shared-fixture contradiction that makes a
 * suite unable to go green on a correct fix.
 */
function fixtureBilledThenRemoved(invoiceId: string): PayAppAssemblyInput {
  return {
    invoiceId,
    retainagePercent: RETAINAGE,
    lineItems: [
      {
        id: "L1",
        description: "Metal stud framing — Level 3",
        quantity: "1",
        unitPrice: "200000",
        isDeleted: false,
      },
      {
        id: "L3",
        description: "Fire-rated ceiling assemblies",
        quantity: "1",
        unitPrice: "40000",
        isDeleted: true,
      },
    ],
    invoices: [
      {
        id: "inv1",
        number: 1,
        retainageWithheld: "6000",
        lineItems: [
          { lineItemId: "L1", thisPeriodBilled: "50000", materialsStoredValue: "0" },
          { lineItemId: "L3", thisPeriodBilled: "10000", materialsStoredValue: "0" },
        ],
      },
      {
        id: "inv2",
        number: 2,
        retainageWithheld: "3000",
        lineItems: [{ lineItemId: "L1", thisPeriodBilled: "30000", materialsStoredValue: "0" }],
      },
    ],
  };
}

function assemble(input: PayAppAssemblyInput) {
  const view = assemblePayApplication(input);
  if (!view) throw new Error("assemblePayApplication returned null for a fixture that has the invoice");
  return view;
}

describe("a line item a change order removed", () => {
  it("gets no row at all when it was never billed", () => {
    const view = assemble(fixtureNeverBilled("inv2"));

    // Today this is ["L1", "L2"] — a $60,000 row for scope the GC deducted.
    expect(view.lineItems.map((row) => row.lineItemId)).toEqual(["L1"]);
  });

  it("is not counted in the contract sum or the balance to finish", () => {
    const { summary } = assemble(fixtureNeverBilled("inv2"));

    // Matches the job record, which filters isDeleted (jobs/[id]/page.tsx).
    expect(summary.contractSumToDate).toBe(200000); // today: 260000
    expect(summary.balanceToFinishIncludingRetainage).toBe(128000); // today: 188000

    // The two figures that were already right have to STAY right — this is
    // what catches a "fix" that zeroes the wrong side of the ratio.
    expect(summary.totalCompletedAndStoredToDate).toBe(80000);
    expect(summary.currentPaymentDue).toBe(27000);
    expect(summary.retainageToDate).toBe(8000);
    expect(summary.previousCertificatesForPayment).toBe(45000);
  });

  it("keeps its row, its real description and its earned value once it has been billed", () => {
    const view = assemble(fixtureBilledThenRemoved("inv2"));
    const row = view.lineItems.find((r) => r.lineItemId === "L3");

    expect(row).toBeDefined();
    // It must not vanish — it has billing history on a sent document — and
    // it must not degrade to the "(line item removed)" placeholder, which
    // is not a thing to print on a sheet a GC reads.
    expect(row!.description).toContain("Fire-rated ceiling assemblies");
    expect(row!.description).toContain("removed by change order");

    // Closed out at what it earned: the deductive CO takes the UNBILLED
    // remainder, which is what a deductive CO does in AIA practice.
    expect(row!.scheduledValue).toBe(10000); // today: 40000
    expect(row!.previousBilled).toBe(10000);
    expect(row!.totalCompletedAndStoredToDate).toBe(10000);
    expect(row!.balanceToFinish).toBe(0); // today: 30000
    expect(row!.percentOfScheduledValue).toBe(1); // today: 0.25
  });

  it("leaves the summary's balance-to-finish identity true once it has been billed", () => {
    const { summary } = assemble(fixtureBilledThenRemoved("inv2"));

    expect(summary.contractSumToDate).toBe(210000); // today: 240000
    expect(summary.totalCompletedAndStoredToDate).toBe(90000);
    expect(summary.retainageToDate).toBe(9000);
    expect(summary.totalEarnedLessRetainage).toBe(81000);
    expect(summary.currentPaymentDue).toBe(27000);

    // $120,000 of live scope left to build, plus $9,000 of retainage still
    // to be released. Today's answer is 159000 (the removed line's whole
    // $40,000 counted as remaining scope). Giving a removed-but-billed line
    // a scheduled value of 0 instead of its earned value answers 119000,
    // understating the balance by exactly the $10,000 already billed
    // against it — a different wrong number, so this assertion is the one
    // that distinguishes the two candidate fixes.
    expect(summary.balanceToFinishIncludingRetainage).toBe(129000);
  });

  it("restates a pay application issued BEFORE the removal without inventing a negative balance", () => {
    // Scheduled value is derived live, never snapshotted, so reprinting an
    // earlier application shows the removal too. That is this codebase's
    // model (an EDIT change order already restates earlier sheets the same
    // way) and it is in the click-list — but it must not produce a row
    // claiming money against nothing.
    const view = assemble(fixtureBilledThenRemoved("inv1"));
    const row = view.lineItems.find((r) => r.lineItemId === "L3");

    expect(row!.scheduledValue).toBe(10000);
    expect(row!.thisPeriodBilled).toBe(10000);
    expect(row!.balanceToFinish).toBe(0);
    expect(view.summary.contractSumToDate).toBe(210000); // today: 240000
    expect(view.summary.currentPaymentDue).toBe(54000);
    expect(view.summary.balanceToFinishIncludingRetainage).toBe(156000); // today: 186000
  });
});

describe("lines that are not removed", () => {
  it("still carries a live cost-only line at $0 rather than at what was billed", () => {
    // unitPrice is nullable and a cost-only line (general conditions,
    // overhead) legitimately has no client-facing price — jobs.prisma says
    // contract totals treat that as $0 revenue. The billed-to-date floor is
    // for REMOVED lines only; applying it here would quietly invent
    // contract value for a line that never had any.
    const view = assemble({
      invoiceId: "inv1",
      retainagePercent: null,
      lineItems: [
        { id: "L1", description: "General conditions", quantity: "1", unitPrice: null, isDeleted: false },
      ],
      invoices: [
        {
          id: "inv1",
          number: 1,
          retainageWithheld: null,
          lineItems: [{ lineItemId: "L1", thisPeriodBilled: "5000", materialsStoredValue: "0" }],
        },
      ],
    });

    const row = view.lineItems[0];
    expect(row.scheduledValue).toBe(0);
    expect(row.percentOfScheduledValue).toBeNull();
    expect(row.description).toBe("General conditions");
  });
});
