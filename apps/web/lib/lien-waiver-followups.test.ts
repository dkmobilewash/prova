import { describe, expect, it } from "vitest";
import { missingLowerTierWaivers, waiverOfferFor } from "./lien-waiver-followups";

const base = {
  invoiceId: "inv-3",
  number: 3,
  currentPaymentDue: 12_345.678,
  periodTo: new Date("2026-10-31T00:00:00.000Z"),
  hasWaiver: false,
};

describe("the waiver offer after a pay application", () => {
  it("offers a conditional progress waiver for the current payment due, through the period-to date", () => {
    const offer = waiverOfferFor(base);
    expect(offer).toEqual({
      invoiceId: "inv-3",
      invoiceNumber: 3,
      amount: 12_345.68,
      throughDate: "2026-10-31",
      label: "Issue the conditional progress waiver for application #3: $12,345.68 through 2026-10-31",
    });
  });

  it("leaves the through date for the person when the application predates the column", () => {
    const offer = waiverOfferFor({ ...base, periodTo: null });
    expect(offer?.throughDate).toBeNull();
    expect(offer?.label).not.toContain("through");
  });

  it("offers nothing when a waiver is already linked, or when nothing is owed", () => {
    expect(waiverOfferFor({ ...base, hasWaiver: true })).toBeNull();
    expect(waiverOfferFor({ ...base, currentPaymentDue: 0 })).toBeNull();
    expect(waiverOfferFor({ ...base, currentPaymentDue: -500 })).toBeNull();
  });

  it("never carries an excepted amount — that field is the person's", () => {
    expect(Object.keys(waiverOfferFor(base) ?? {})).not.toContain("exceptedAmount");
  });
});

describe("the lower-tier check before an application goes out", () => {
  const through = new Date("2026-09-30T00:00:00.000Z");
  const received = (partyName: string, periodEnd: string | null, status: "RECEIVED" | "PENDING" = "RECEIVED") => ({
    partyName,
    periodEnd: periodEnd ? new Date(`${periodEnd}T00:00:00.000Z`) : null,
    status,
  });

  it("names every party with no RECEIVED waiver running through the previous period", () => {
    const check = missingLowerTierWaivers({
      previousPeriodTo: through,
      parties: ["Foundation Supply", "ABC Insulation", "Acme Scaffold"],
      inbound: [
        received("Foundation Supply", "2026-09-30"),
        received("ABC Insulation", "2026-08-31"), // last month's — does not cover September
        received("Acme Scaffold", "2026-10-31", "PENDING"), // not received yet
      ],
    });
    expect(check.covered).toEqual(["Foundation Supply"]);
    expect(check.missing).toEqual(["ABC Insulation", "Acme Scaffold"]);
    expect(check.warning).toBe(
      "Before this goes to the GC: no lower-tier lien waiver received through 2026-09-30 from ABC Insulation, Acme Scaffold. " +
        "Collect them on the Compliance page, or send knowing the GC may hold payment for them.",
    );
  });

  it("matches party names loosely (case, spacing) and dedupes the party list", () => {
    const check = missingLowerTierWaivers({
      previousPeriodTo: through,
      parties: ["Foundation Supply", "foundation  supply", " Foundation Supply "],
      inbound: [received("FOUNDATION SUPPLY", "2026-10-15")],
    });
    expect(check.missing).toEqual([]);
    expect(check.covered).toEqual(["Foundation Supply"]);
    expect(check.warning).toBeNull();
  });

  it("treats a waiver with no period as covering nothing", () => {
    const check = missingLowerTierWaivers({ previousPeriodTo: through, parties: ["Foundation Supply"], inbound: [received("Foundation Supply", null)] });
    expect(check.missing).toEqual(["Foundation Supply"]);
  });

  it("has nothing to say on a first application or a job with no lower tier — and that is not an all-clear", () => {
    expect(missingLowerTierWaivers({ previousPeriodTo: null, parties: ["X"], inbound: [] }).warning).toBeNull();
    expect(missingLowerTierWaivers({ previousPeriodTo: through, parties: [], inbound: [] }).warning).toBeNull();
  });

  it("never reassures: no sentence here says covered, safe, clear or fine", () => {
    const check = missingLowerTierWaivers({ previousPeriodTo: through, parties: ["A"], inbound: [received("A", "2026-09-30")] });
    expect(check.warning).toBeNull();
    const text = JSON.stringify(missingLowerTierWaivers({ previousPeriodTo: through, parties: ["A", "B"], inbound: [received("A", "2026-09-30")] }));
    expect(text).not.toMatch(/safe|all clear|you are covered|fine to sign/i);
  });
});
