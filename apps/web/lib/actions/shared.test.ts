import { describe, expect, it } from "vitest";
import { joinWithConjunction } from "./shared";

/**
 * #218: deleteContact's refusal joined non-zero counts with `.join(", ")`
 * (no "and" at all) while deleteSalesLead's joined with `.join(" and ")`
 * (right for exactly two items — the only length it was ever fed — but
 * "a and b and c" for three, since a bare " and " join never gets an
 * Oxford comma at any length past two). This is the one join both now use.
 *
 * Mutation-tested by hand: reverting the 3+ branch to
 * `parts.join(", and ")` — the comma-only shape deleteContact used to
 * have — turns the three- and four-item cases below red, since neither
 * produces an "and" before the last item and the four-item case in
 * particular stops reading as a natural-language list at all.
 */
describe("joinWithConjunction", () => {
  it("returns a single item unchanged — no conjunction, nothing to join", () => {
    expect(joinWithConjunction(["1 job"])).toBe("1 job");
  });

  it("joins two items with a bare 'and' — no comma before it", () => {
    expect(joinWithConjunction(["1 job", "3 bid invitations"])).toBe("1 job and 3 bid invitations");
  });

  it("joins three items with an Oxford comma before the final 'and'", () => {
    expect(joinWithConjunction(["1 job", "3 bid invitations", "1 person"])).toBe(
      "1 job, 3 bid invitations, and 1 person",
    );
  });

  it("joins four items the same way — commas throughout, 'and' only before the last", () => {
    expect(
      joinWithConjunction(["1 job", "4 bid invitations", "4 logged interactions", "1 person"]),
    ).toBe("1 job, 4 bid invitations, 4 logged interactions, and 1 person");
  });

  it("returns an empty string for no items — the caller never has zero non-zero counts to name, but the function shouldn't throw either", () => {
    expect(joinWithConjunction([])).toBe("");
  });
});
