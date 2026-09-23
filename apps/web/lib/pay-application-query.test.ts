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

/** Fixture A — L2 removed by a deductive change order, never billed. */
function fixtureNeverBilled(invoiceId: string): PayAppAssemblyInput {
  return {
    invoiceId,
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

/**
 * The lump-sum invoice that put a NEGATIVE figure on a G702.
 *
 * A job can be billed two ways: `submitPayApplication` writes an invoice
 * WITH line items against the schedule of values, `createInvoice` writes a
 * lump-sum bill with none. Both can carry a retainage snapshot, and both
 * used to count as an "earlier invoice" here — but only one of them has
 * line items for `previousBilled` to be summed from. So a lump-sum bill put
 * its retainage on one side of the certificate and nothing on the other.
 *
 * Reproduced before anything was changed, on the numbers below: line 7 of
 * the form, LESS PREVIOUS CERTIFICATES FOR PAYMENT, printed -$1,000.00.
 *
 * WHAT WAS AND WAS NOT WRONG, because the difference decides how alarmed to
 * be. `currentPaymentDue` cancels the term algebraically —
 * (TCSD - thisRet - prevRet) - (prevTCSD - prevRet) — so the AMOUNT ASKED
 * FOR was right the whole time. What was wrong is every line a GC
 * reconciles against their own ledger: retainage to date, total earned less
 * retainage, previous certificates, and balance to finish. A negative on
 * line 7 is what gets the application handed back.
 */
describe("a lump-sum invoice on the same job as a pay application", () => {
  /** $100,000 of framing. Invoice #1 is a lump-sum bill for $10,000 at 10%;
   * invoice #2 is a real pay application for $50,000 at 10%. */
  function lumpSumThenPayApp(invoiceId: string): PayAppAssemblyInput {
    return {
      invoiceId,
      lineItems: [
        { id: "L1", description: "Metal stud framing", quantity: "1", unitPrice: "100000", isDeleted: false },
      ],
      invoices: [
        { id: "inv1", number: 1, retainageWithheld: "1000", lineItems: [] },
        {
          id: "inv2",
          number: 2,
          retainageWithheld: "5000",
          lineItems: [{ lineItemId: "L1", thisPeriodBilled: "50000", materialsStoredValue: "0" }],
        },
      ],
    };
  }

  it("does not print a negative 'less previous certificates for payment'", () => {
    const { summary } = assemble(lumpSumThenPayApp("inv2"));

    // Today: -1000. There is no previous certificate on this contract —
    // invoice #1 was never certified against the schedule of values.
    expect(summary.previousCertificatesForPayment).toBe(0);
  });

  it("does not inflate retainage to date with retainage from outside the SOV", () => {
    const { summary } = assemble(lumpSumThenPayApp("inv2"));

    expect(summary.retainageToDate).toBe(5000); // today: 6000
    expect(summary.totalEarnedLessRetainage).toBe(45000); // today: 44000
    expect(summary.balanceToFinishIncludingRetainage).toBe(55000); // today: 56000
  });

  it("asks the GC for the same money it always did", () => {
    // This is the assertion that keeps the fix honest. The amount requested
    // was never wrong, so a "fix" that moves it has broken something else.
    expect(assemble(lumpSumThenPayApp("inv2")).summary.currentPaymentDue).toBe(45000);
    expect(assemble(lumpSumThenPayApp("inv2")).summary.totalCompletedAndStoredToDate).toBe(50000);
    expect(assemble(lumpSumThenPayApp("inv2")).summary.contractSumToDate).toBe(100000);
  });

  it("is still recognised as a lump-sum bill when it is the one being viewed", () => {
    const view = assemble(lumpSumThenPayApp("inv1"));

    // The page prints no certificate for one of these — it says in words
    // that there is no per-line breakdown. That flag must not change.
    expect(view.isPayApplication).toBe(false);
    // And its own snapshot must not land in a retainage total over line
    // items it contributed nothing to. Today: 1000.
    expect(view.summary.retainageToDate).toBe(0);
  });

  it("skips a lump-sum bill sandwiched between two pay applications", () => {
    const input: PayAppAssemblyInput = {
      invoiceId: "inv3",
      lineItems: [
        { id: "L1", description: "Metal stud framing", quantity: "1", unitPrice: "100000", isDeleted: false },
      ],
      invoices: [
        {
          id: "inv1",
          number: 1,
          retainageWithheld: "3000",
          lineItems: [{ lineItemId: "L1", thisPeriodBilled: "30000", materialsStoredValue: "0" }],
        },
        { id: "inv2", number: 2, retainageWithheld: "1000", lineItems: [] },
        {
          id: "inv3",
          number: 3,
          retainageWithheld: "2000",
          lineItems: [{ lineItemId: "L1", thisPeriodBilled: "20000", materialsStoredValue: "0" }],
        },
      ],
    };
    const { summary } = assemble(input);

    // $30,000 certified previously, less the $3,000 retained on it.
    expect(summary.previousCertificatesForPayment).toBe(27000); // today: 26000
    expect(summary.retainageToDate).toBe(5000); // today: 6000
    expect(summary.currentPaymentDue).toBe(18000); // unchanged, as above
  });

  it("leaves a job billed only by pay applications exactly as it was", () => {
    // The control. Every invoice here has line items, so the new predicate
    // excludes nothing and these are the same figures the suite above
    // already pins.
    const { summary } = assemble(fixtureNeverBilled("inv2"));

    expect(summary.previousCertificatesForPayment).toBe(45000);
    expect(summary.retainageToDate).toBe(8000);
    expect(summary.currentPaymentDue).toBe(27000);
  });
});
