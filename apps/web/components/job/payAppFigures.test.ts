import { describe, expect, it } from "vitest";
import { assemblePayApplication } from "@/lib/pay-application-query";
import { payAppBar, payAppFigures } from "@/components/job/payAppFigures";

// Two lines, $100,000 contract; app #1 bills $30,000, app #2 bills $20,000
// plus $5,000 stored, 10% retainage snapshotted on each.
const input = {
  lineItems: [
    { id: "a", description: "Framing", quantity: 1, unitPrice: 60000, isDeleted: false },
    { id: "b", description: "Board", quantity: 1, unitPrice: 40000, isDeleted: false },
  ],
  invoices: [
    { id: "i1", number: 1, retainageWithheld: 3000, lineItems: [{ lineItemId: "a", thisPeriodBilled: 30000, materialsStoredValue: 0 }] },
    {
      id: "i2",
      number: 2,
      retainageWithheld: 2500,
      lineItems: [
        { lineItemId: "a", thisPeriodBilled: 20000, materialsStoredValue: 0 },
        { lineItemId: "b", thisPeriodBilled: 0, materialsStoredValue: 5000 },
      ],
    },
  ],
};

describe("payAppFigures", () => {
  it("reads the summary off the same certificate the Review page prints", () => {
    const assembly = assemblePayApplication({ ...input, invoiceId: "i2" })!;
    const f = payAppFigures(assembly);
    expect(f).toEqual({
      contractSum: 100000,
      billedBefore: 30000,
      thisPeriod: 25000,
      left: 45000,
      retainageHeld: 5500,
      youllBePaid: assembly.summary.currentPaymentDue,
    });
    // G702 line 8: 55,000 earned − 5,500 retainage − (30,000 − 3,000) certified before.
    expect(f.youllBePaid).toBe(22500);
    // The three parts of the bar are the whole contract.
    expect(f.billedBefore + f.thisPeriod + f.left).toBe(f.contractSum);
  });

  it("the first application has nothing billed before", () => {
    const f = payAppFigures(assemblePayApplication({ ...input, invoiceId: "i1" })!);
    expect(f.billedBefore).toBe(0);
    expect(f.thisPeriod).toBe(30000);
  });

  it("keeps the bar inside its track", () => {
    expect(payAppBar({ contractSum: 100, billedBefore: 30, thisPeriod: 25, left: 45, retainageHeld: 0, youllBePaid: 0 })).toEqual({ before: 30, thisPeriod: 25 });
    expect(payAppBar({ contractSum: 100, billedBefore: 90, thisPeriod: 40, left: -30, retainageHeld: 0, youllBePaid: 0 })).toEqual({ before: 90, thisPeriod: 10 });
    expect(payAppBar({ contractSum: 0, billedBefore: 0, thisPeriod: 0, left: 0, retainageHeld: 0, youllBePaid: 0 })).toEqual({ before: 0, thisPeriod: 0 });
  });
});
