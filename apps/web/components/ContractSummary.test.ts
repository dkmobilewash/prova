import { describe, expect, it } from "vitest";
import { contractSummaryFooterCopy } from "./ContractSummary";

describe("contractSummaryFooterCopy — issue #106 finding 6", () => {
  it("claims CURRENT pricing when not frozen (every live render)", () => {
    const copy = contractSummaryFooterCopy(false);
    expect(copy).toMatch(/current/i);
    expect(copy).toMatch(/approved change orders?/i);
  });

  it("claims AS-SIGNED pricing when frozen (the esign SIGNED snapshot), and does not say 'current'", () => {
    const copy = contractSummaryFooterCopy(true);
    expect(copy).toMatch(/time of signing/i);
    expect(copy).not.toMatch(/current/i);
  });

  // The bug itself: both variants must never claim the SAME thing, or the
  // frozen snapshot page is back to contradicting its own banner.
  it("the two variants are not the same string", () => {
    expect(contractSummaryFooterCopy(true)).not.toBe(contractSummaryFooterCopy(false));
  });
});
