import { describe, expect, it } from "vitest";
import {
  concededAmount,
  daysToRespond,
  isResponseOverdue,
  isUnresolved,
  summarizeBackcharges,
} from "./backcharges";

const claim = (status: string, claimedAmount: number, resolvedAmount: number | null = null) => ({
  status,
  claimedAmount,
  resolvedAmount,
});

describe("concededAmount", () => {
  it("concedes the whole claim when we accept it", () => {
    expect(concededAmount(claim("ACCEPTED", 4200))).toBe(4200);
  });

  it("concedes nothing on a withdrawal", () => {
    expect(concededAmount(claim("WITHDRAWN", 4200))).toBe(0);
  });

  it("concedes the settled figure, not the claim", () => {
    expect(concededAmount(claim("SETTLED", 4200, 1500))).toBe(1500);
  });

  it("is unknown while the backcharge is still in play", () => {
    // Not zero. A live claim of $4,200 that nobody has answered has cost us
    // nothing YET, and reading that as "cost us nothing" is exactly how a
    // number stops being worth quoting.
    expect(concededAmount(claim("RECEIVED", 4200))).toBeNull();
    expect(concededAmount(claim("DISPUTED", 4200))).toBeNull();
  });

  it("is unknown, not zero and not the claim, for a settlement with no figure", () => {
    expect(concededAmount(claim("SETTLED", 4200, null))).toBeNull();
  });
});

describe("isUnresolved", () => {
  it("counts both states where the money is still in play", () => {
    expect(isUnresolved("RECEIVED")).toBe(true);
    expect(isUnresolved("DISPUTED")).toBe(true);
    expect(isUnresolved("ACCEPTED")).toBe(false);
    expect(isUnresolved("SETTLED")).toBe(false);
    expect(isUnresolved("WITHDRAWN")).toBe(false);
  });
});

describe("summarizeBackcharges", () => {
  it("separates money at risk from money already conceded", () => {
    const summary = summarizeBackcharges([
      claim("RECEIVED", 3000),
      claim("DISPUTED", 12000),
      claim("SETTLED", 8000, 2500),
      claim("ACCEPTED", 900),
      claim("WITHDRAWN", 6000),
    ]);

    expect(summary.openClaimed).toBe(15000);
    expect(summary.disputedClaimed).toBe(12000);
    expect(summary.openCount).toBe(2);

    // 2,500 settled + 900 accepted + 0 withdrawn.
    expect(summary.concededTotal).toBe(3400);
    // 5,500 argued off the settlement + 6,000 withdrawn entirely. The
    // accepted one saved nothing.
    expect(summary.avoidedTotal).toBe(11500);
    expect(summary.resolvedCount).toBe(3);
    expect(summary.unknownConcededCount).toBe(0);
  });

  it("never lets a live claim leak into the conceded total", () => {
    const summary = summarizeBackcharges([claim("RECEIVED", 50000)]);
    expect(summary.concededTotal).toBe(0);
    expect(summary.avoidedTotal).toBe(0);
    expect(summary.openClaimed).toBe(50000);
  });

  it("counts a settlement with no figure instead of guessing one", () => {
    const summary = summarizeBackcharges([claim("SETTLED", 4200, null)]);
    expect(summary.unknownConcededCount).toBe(1);
    expect(summary.resolvedCount).toBe(1);
    // Neither 4,200 nor a silent 0 reaching the total.
    expect(summary.concededTotal).toBe(0);
    expect(summary.avoidedTotal).toBe(0);
  });

  it("does not let a settlement above the claim invent savings", () => {
    // Shouldn't happen — the action rejects it — but a negative "avoided"
    // would read as the GC owing us money for arguing, which is nonsense.
    const summary = summarizeBackcharges([claim("SETTLED", 1000, 1400)]);
    expect(summary.avoidedTotal).toBe(0);
    expect(summary.concededTotal).toBe(1400);
  });

  it("is zero across the board with nothing to sum", () => {
    expect(summarizeBackcharges([])).toEqual({
      openClaimed: 0,
      disputedClaimed: 0,
      concededTotal: 0,
      avoidedTotal: 0,
      openCount: 0,
      resolvedCount: 0,
      unknownConcededCount: 0,
    });
  });
});

describe("isResponseOverdue", () => {
  const today = "2026-09-01";

  it("is overdue once the objection deadline has passed unanswered", () => {
    expect(isResponseOverdue({ status: "RECEIVED", respondByDate: "2026-08-25" }, today)).toBe(true);
  });

  it("is not overdue on the deadline itself", () => {
    expect(isResponseOverdue({ status: "RECEIVED", respondByDate: today }, today)).toBe(false);
  });

  it("stops being overdue once we have responded, however late", () => {
    // The record of a late objection is still the record of an objection.
    // Leaving it flagged red forever hides the ones nobody has answered.
    for (const status of ["DISPUTED", "ACCEPTED", "SETTLED", "WITHDRAWN"]) {
      expect(isResponseOverdue({ status, respondByDate: "2026-08-25" }, today)).toBe(false);
    }
  });

  it("is never overdue when no deadline was recorded", () => {
    // Not recorded is not the same as no deadline existing.
    expect(isResponseOverdue({ status: "RECEIVED", respondByDate: null }, today)).toBe(false);
  });
});

describe("daysToRespond", () => {
  const today = "2026-09-01";

  it("counts the days left", () => {
    expect(daysToRespond({ status: "RECEIVED", respondByDate: "2026-09-08" }, today)).toBe(7);
  });

  it("goes negative once the deadline is behind us", () => {
    expect(daysToRespond({ status: "RECEIVED", respondByDate: "2026-08-30" }, today)).toBe(-2);
  });

  it("has nothing to say once we have responded or when no deadline is known", () => {
    expect(daysToRespond({ status: "DISPUTED", respondByDate: "2026-09-08" }, today)).toBeNull();
    expect(daysToRespond({ status: "RECEIVED", respondByDate: null }, today)).toBeNull();
  });
});
