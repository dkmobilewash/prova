import { describe, expect, it } from "vitest";
import { waiverOfferFor } from "@/lib/lien-waiver-followups";
import { closeoutStatus, isFinalBilling, isRetainageReleaseApplication, type CloseoutInput } from "./closeout-billing";

describe("a retainage release application, read off its rows", () => {
  const zero = { thisPeriodBilled: 0, materialsStoredValue: 0 };
  it("is no work, no material, and retainage given back", () => {
    expect(isRetainageReleaseApplication({ retainageWithheld: -4700, lines: [zero, zero] })).toBe(true);
  });
  it.each([
    ["withholding retainage", { retainageWithheld: 470, lines: [zero] }],
    ["billing work", { retainageWithheld: -100, lines: [{ thisPeriodBilled: 500, materialsStoredValue: 0 }] }],
    ["moving material", { retainageWithheld: -100, lines: [{ thisPeriodBilled: 0, materialsStoredValue: -500 }] }],
    ["a lump-sum invoice", { retainageWithheld: -100, lines: [] }],
    ["no retainage", { retainageWithheld: null, lines: [zero] }],
  ])("is not one when %s", (_, invoice) => expect(isRetainageReleaseApplication(invoice)).toBe(false));
});

describe("final billing", () => {
  it("is the contract billed in full with nothing held", () => {
    expect(isFinalBilling({ contractSumToDate: 105000, totalCompletedAndStoredToDate: 105000, retainageToDate: 0 })).toBe(true);
  });
  it.each([
    ["retainage still held", { contractSumToDate: 105000, totalCompletedAndStoredToDate: 105000, retainageToDate: 4700 }],
    ["work left to bill", { contractSumToDate: 105000, totalCompletedAndStoredToDate: 104999, retainageToDate: 0 }],
    ["no contract", { contractSumToDate: 0, totalCompletedAndStoredToDate: 0, retainageToDate: 0 }],
  ])("is not with %s", (_, summary) => expect(isFinalBilling(summary)).toBe(false));
});

describe("the waiver offered", () => {
  const app = { invoiceId: "i", number: 5, currentPaymentDue: 4700, periodTo: new Date("2026-11-30T00:00:00Z"), hasWaiver: false };
  it("is a conditional final at final billing, a progress one otherwise, figures the same", () => {
    expect(waiverOfferFor({ ...app, final: true })).toMatchObject({ stage: "FINAL", amount: 4700, throughDate: "2026-11-30", label: expect.stringContaining("conditional final waiver") });
    expect(waiverOfferFor(app)).toMatchObject({ stage: "PROGRESS", label: expect.stringContaining("conditional progress waiver") });
  });
  it("never carries exceptions", () => {
    expect(Object.keys(waiverOfferFor({ ...app, final: true })!)).not.toContain("excepted");
  });
});

describe("the closeout list", () => {
  const base: CloseoutInput = {
    latest: { number: 4, contractSumToDate: 105000, totalCompletedAndStoredToDate: 105000 },
    retainage: { withheld: 10500, balance: 0 },
    releaseApplication: { number: 5, unpaid: 0 },
    finalWaivers: [{ condition: "CONDITIONAL" }, { condition: "UNCONDITIONAL" }],
    lowerTierMissing: [],
  };
  const done = (input: CloseoutInput) => closeoutStatus(input).map((item) => item.done);

  it("marks each item from the records", () => {
    expect(done(base)).toEqual([true, true, true, true, true]);
  });

  it("says what is still open, with the figure", () => {
    const items = closeoutStatus({ ...base, retainage: { withheld: 10500, balance: 4700 }, releaseApplication: null, finalWaivers: [], lowerTierMissing: ["ABC Supply"] });
    expect(items.map((item) => item.done)).toEqual([true, false, false, false, false]);
    expect(items[1].detail).toBe("$4,700.00 still held.");
    expect(items[4].detail).toContain("ABC Supply");
  });

  it("counts a conditional final waiver as not yet the unconditional one", () => {
    expect(closeoutStatus({ ...base, finalWaivers: [{ condition: "CONDITIONAL" }] })[3]).toMatchObject({ done: false, detail: expect.stringContaining("No unconditional one yet") });
  });

  it("does not claim what it cannot see", () => {
    const items = closeoutStatus({ ...base, lowerTierMissing: null, latest: null });
    expect(items[0]).toMatchObject({ done: false, detail: "No pay application yet." });
    expect(items[4]).toMatchObject({ done: false });
    expect(items.map((item) => item.detail).join(" ")).not.toMatch(/safe|closed out|nothing owed|covered|guarantee/i);
  });

  it("does not mark retainage billed on a job that never withheld any", () => {
    expect(closeoutStatus({ ...base, retainage: { withheld: 0, balance: 0 }, releaseApplication: null })[1]).toMatchObject({ done: false, detail: "No retainage withheld on this job's invoices." });
  });
});
