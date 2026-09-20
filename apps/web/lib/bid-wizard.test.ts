import { describe, expect, it } from "vitest";
import { bidWizardTotal, hasLeftWizard } from "./bid-wizard";

describe("hasLeftWizard", () => {
  it("is false while the job is still an estimate — the wizard's own steps stay live", () => {
    expect(hasLeftWizard("ESTIMATE")).toBe(false);
  });

  it("is true once the job is contracted — a refresh or old bookmark hands off instead of rendering a stale step", () => {
    expect(hasLeftWizard("CONTRACTED")).toBe(true);
  });

  it("is true for every other status too — this is a whitelist of one, not a blocklist", () => {
    expect(hasLeftWizard("COMPLETE")).toBe(true);
    expect(hasLeftWizard("CANCELLED")).toBe(true);
    expect(hasLeftWizard("")).toBe(true);
  });
});

describe("bidWizardTotal", () => {
  it("is zero for no line items", () => {
    expect(bidWizardTotal([])).toBe(0);
  });

  it("multiplies quantity by unit price and sums across lines", () => {
    const total = bidWizardTotal([
      { quantity: 10, unitPrice: 2.5 },
      { quantity: 4, unitPrice: 100 },
    ]);
    expect(total).toBe(10 * 2.5 + 4 * 100);
  });

  it("treats a null unit price as a $0, cost-only line rather than dropping it", () => {
    const total = bidWizardTotal([
      { quantity: 5, unitPrice: 20 },
      { quantity: 3, unitPrice: null },
    ]);
    expect(total).toBe(5 * 20);
  });
});
