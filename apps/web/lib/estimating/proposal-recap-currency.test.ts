import { describe as group, expect, it } from "vitest";
import { proposalPriceState, proposalPriceWarning, type RecapState } from "./proposal-recap-currency";

/**
 * THE DOCUMENT THAT GOES TO A GC MUST NOT QUIETLY SHOW AN UN-MARKED-UP PRICE.
 *
 * The defect this pins, found by auditing the estimating workflow on
 * 2026-10-02: `/jobs/[id]/proposal` computes its total as `Σ (quantity ×
 * unitPrice)` and reads `JobBidRecap` nowhere, so a fully configured recap —
 * markup, escalation, tax, overhead, profit, bond, contingency — reaches the
 * customer-facing document only if somebody remembered to press "Apply to line
 * prices" first, with nothing on the page saying otherwise.
 */

const recap = (over: Partial<RecapState> = {}): RecapState => ({
  addedTotal: 24_000,
  appliedAt: new Date("2026-10-01T12:00:00Z"),
  appliedTotal: 184_320,
  ...over,
});

group("whether the proposal's prices reflect the recap", () => {
  it("THE DEFECT: rates that would add money and have never been applied", () => {
    const state = proposalPriceState(recap({ appliedAt: null, appliedTotal: null }), 160_320);
    expect(state.kind).toBe("NEVER_APPLIED");
    // The money is in the sentence, because "apply the recap" does not tell
    // somebody what it is worth to them.
    expect(proposalPriceWarning(state)).toContain("$24,000");
    expect(proposalPriceWarning(state)).toContain("Apply to line prices");
  });

  it("THE EASIER CASE TO MISS: applied, then a line changed", () => {
    // `appliedAt` is still set, so a check asking only "has it ever been
    // applied" would call this document current. It is part marked-up.
    const state = proposalPriceState(recap(), 171_500);
    expect(state.kind).toBe("STALE");
    const sentence = proposalPriceWarning(state);
    expect(sentence).toContain("$184,320");
    expect(sentence).toContain("$171,500");
    expect(sentence).toContain("part marked-up");
  });

  it("says nothing when the printed prices ARE what the recap produced", () => {
    const state = proposalPriceState(recap(), 184_320);
    expect(state.kind).toBe("CURRENT");
    expect(proposalPriceWarning(state)).toBeNull();
  });

  it("says nothing when there is no recap row at all", () => {
    expect(proposalPriceState(null, 90_000).kind).toBe("NO_RECAP");
    expect(proposalPriceWarning({ kind: "NO_RECAP" })).toBeNull();
  });

  it("says nothing when the rates are set to add nothing", () => {
    // `bid-recap.prisma`: every rate is nullable and null means "not applied",
    // not zero. A bid deliberately carrying no markup is a complete state, and
    // warning about it would train somebody to ignore the warning — the same
    // argument the recap panel's own muted note makes.
    expect(proposalPriceState(recap({ addedTotal: 0, appliedAt: null, appliedTotal: null }), 90_000).kind).toBe(
      "NO_RECAP",
    );
  });

  it("compares in CENTS, so a small edit is still caught", () => {
    // `spreadToLines` distributes largest-remainder-first and is exact to the
    // cent, so there is no slack to allow. A tolerance would hide exactly the
    // one-line edit this exists to find.
    expect(proposalPriceState(recap({ appliedTotal: 184_320 }), 184_320.01).kind).toBe("STALE");
    expect(proposalPriceState(recap({ appliedTotal: 184_320 }), 184_320).kind).toBe("CURRENT");
  });

  it("treats a half-written applied record as never applied", () => {
    // `appliedAt` set with no `appliedTotal` cannot be compared against
    // anything, and the safe reading of "I cannot tell" on a document going to
    // a customer is the one that asks a person to look.
    expect(proposalPriceState(recap({ appliedTotal: null }), 184_320).kind).toBe("NEVER_APPLIED");
  });

  it("every warning names the surface that fixes it", () => {
    // A sentence that says something is wrong and not where to fix it is a
    // sentence somebody reads twice and then ignores.
    for (const state of [
      proposalPriceState(recap({ appliedAt: null, appliedTotal: null }), 1),
      proposalPriceState(recap(), 1),
    ]) {
      expect(proposalPriceWarning(state)).toContain("estimate tab");
    }
  });
});
