import { describe as group, expect, it } from "vitest";
import { carriedIn, carriedLinePlan, carryDecision, type CarriedQuoteInput } from "./carried-quote";

/**
 * Which quote we carried, and what it would put on the estimate.
 *
 * The thing worth testing hardest is that this records the ESTIMATOR'S answer
 * and never invents one. `bid-levelling.ts` refuses to name a winner on purpose
 * — "the point of levelling is not who is cheapest, it is are they even bidding
 * the same thing" — and nothing here may quietly reintroduce that opinion.
 */

const quote = (over: Partial<CarriedQuoteInput> = {}): CarriedQuoteInput => ({
  id: "q1",
  vendorName: "Alpha Drywall",
  packageLabel: "Metal stud framing",
  amount: 48_000,
  declinedAt: null,
  carriedAt: null,
  ...over,
});

group("marking a quote carried", () => {
  it("accepts an answered quote", () => {
    expect(carryDecision(quote())).toEqual({ ok: true });
  });

  it("refuses a quote nobody has priced, and says how to fix it", () => {
    const decision = carryDecision(quote({ amount: null }));
    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.error).toContain("hasn't given a price yet");
    expect(!decision.ok && decision.error).toContain("Alpha Drywall");
  });

  it("refuses a sub who declined", () => {
    const decision = carryDecision(quote({ declinedAt: new Date("2026-10-01") }));
    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.error).toContain("declined");
  });

  it("names the vendor in every refusal", () => {
    // "No price yet" on a screen listing five subs is a sentence about nobody.
    for (const over of [{ amount: null }, { declinedAt: new Date("2026-10-01") }]) {
      const decision = carryDecision(quote(over));
      expect(!decision.ok && decision.error).toContain("Alpha Drywall");
    }
  });

  it("CARRIES A PRICE THAT IS NOT THE CHEAPEST, because that is the point", () => {
    // The estimator read the exclusions and decided. A module that only let
    // you carry the low bid would be the scoring `bid-levelling.ts` refuses,
    // smuggled in through a validation rule.
    expect(carryDecision(quote({ amount: 61_500 }))).toEqual({ ok: true });
  });
});

group("putting the carried price on the estimate", () => {
  it("plans a lump-sum line naming the package and the vendor", () => {
    const plan = carriedLinePlan(quote({ carriedAt: new Date("2026-10-04") }));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.unitCost).toBe(48_000);
    // A $48,000 line reading only "Subcontract" is one nobody can check against
    // the quote it came from six weeks later.
    expect(plan.description).toBe("Metal stud framing — Alpha Drywall");
  });

  it("REFUSES A QUOTE NOBODY MARKED CARRIED", () => {
    // The guard that stops this becoming "put any price on the estimate". The
    // decision is the estimator's and has to have been made.
    const plan = carriedLinePlan(quote({ carriedAt: null }));
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.error).toContain("Mark a quote as the one you carried first");
  });

  it("inherits the carry refusals rather than second-guessing them", () => {
    // A declined or unpriced quote cannot be carried, so it cannot reach a
    // line either — and the sentence stays the one the estimator can act on.
    const declined = carriedLinePlan(quote({ declinedAt: new Date("2026-10-01"), carriedAt: new Date() }));
    expect(declined.ok).toBe(false);
    expect(!declined.ok && declined.error).toContain("declined");
  });

  it("refuses a zero quote rather than writing a $0 cost line", () => {
    const plan = carriedLinePlan(quote({ amount: 0, carriedAt: new Date() }));
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.error).toContain("no cost to put on the estimate");
  });

  it("keeps the amount EXACTLY, with no rounding or conversion", () => {
    // A lump sum is what one sub said one package costs. Spreading it across
    // units would invent a breakdown they never gave.
    const plan = carriedLinePlan(quote({ amount: 48_250.75, carriedAt: new Date() }));
    expect(plan.ok && plan.unitCost).toBe(48_250.75);
  });
});

group("one carried quote per package", () => {
  it("finds the carried one", () => {
    const carried = carriedIn([
      { carriedAt: null },
      { carriedAt: new Date("2026-10-04") },
      { carriedAt: null },
    ]);
    expect(carried).not.toBeNull();
  });

  it("returns null when nobody has decided", () => {
    expect(carriedIn([{ carriedAt: null }, { carriedAt: null }])).toBeNull();
    expect(carriedIn([])).toBeNull();
  });

  it("takes the first rather than adjudicating between two", () => {
    // Two carried quotes on one package is a contradiction the write prevents,
    // not a question this reader should answer — picking "the cheapest" or
    // "the newest" would invent a rule nobody asked for.
    const first = { carriedAt: new Date("2026-10-01"), id: "a" };
    const second = { carriedAt: new Date("2026-10-04"), id: "b" };
    expect(carriedIn([first, second])?.id).toBe("a");
  });
});
