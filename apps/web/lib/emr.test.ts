import { describe, expect, it } from "vitest";
import { emrRateProblem, emrStanding, policyYearEnd, type EmrRecord } from "./emr";

/**
 * Which mod rate is current — derived from the dates, never stored.
 *
 * The one question about a recorded EMR that is this app's to answer. Every
 * case here is a way the answer could be confidently wrong on a GC's
 * prequalification form: a rate typed in early for next year reported as
 * this year's, an old rate reported as current without saying it is old,
 * or "nothing on file" rendered as a number.
 */

const rate = (id: string, effectiveDate: string, value = "0.90"): EmrRecord => ({
  id,
  effectiveDate,
  rate: value,
  source: "NCCI",
  sourceUrl: null,
  note: null,
});

const TODAY = "2026-09-17";

describe("emrStanding", () => {
  it("has no current rate, nothing upcoming and no history when nothing is recorded", () => {
    const standing = emrStanding([], TODAY);
    expect(standing.current).toBeNull();
    expect(standing.upcoming).toEqual([]);
    expect(standing.history).toEqual([]);
    expect(standing.currentIsPastItsPolicyYear).toBe(false);
  });

  it("picks the latest effective date that has started, whatever order the rows arrive in", () => {
    const standing = emrStanding(
      [rate("2024", "2024-01-01", "1.05"), rate("2026", "2026-01-01", "0.87"), rate("2025", "2025-01-01", "0.94")],
      TODAY,
    );
    expect(standing.current?.id).toBe("2026");
    expect(standing.current?.rate).toBe("0.87");
    expect(standing.history.map((r) => r.id)).toEqual(["2026", "2025", "2024"]);
  });

  it("does NOT make a future-dated rate current — next year's mod is upcoming until its date", () => {
    const standing = emrStanding([rate("2026", "2026-01-01", "0.87"), rate("2027", "2027-01-01", "0.79")], TODAY);
    expect(standing.current?.id).toBe("2026");
    expect(standing.upcoming.map((r) => r.id)).toEqual(["2027"]);
  });

  it("has no current rate when every recorded rate is in the future", () => {
    const standing = emrStanding([rate("2027", "2027-01-01")], TODAY);
    expect(standing.current).toBeNull();
    expect(standing.upcoming.map((r) => r.id)).toEqual(["2027"]);
    expect(standing.currentIsPastItsPolicyYear).toBe(false);
  });

  it("treats a rate effective TODAY as current — the policy year starts that morning", () => {
    const standing = emrStanding([rate("old", "2025-09-17"), rate("today", TODAY)], TODAY);
    expect(standing.current?.id).toBe("today");
    expect(standing.upcoming).toEqual([]);
  });

  it("orders several upcoming rates soonest first", () => {
    const standing = emrStanding([rate("b", "2028-01-01"), rate("a", "2027-01-01")], TODAY);
    expect(standing.upcoming.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("flags a current rate whose policy year has already ended", () => {
    expect(emrStanding([rate("old", "2025-06-01")], TODAY).currentIsPastItsPolicyYear).toBe(true);
    // Ends exactly today: the new year's rate should already be in force.
    expect(emrStanding([rate("edge", "2025-09-17")], TODAY).currentIsPastItsPolicyYear).toBe(true);
    expect(emrStanding([rate("in", "2025-09-18")], TODAY).currentIsPastItsPolicyYear).toBe(false);
  });
});

describe("policyYearEnd", () => {
  it("is twelve months on", () => {
    expect(policyYearEnd("2026-01-01")).toBe("2027-01-01");
  });

  it("clamps 29 February to the last day of February", () => {
    expect(policyYearEnd("2024-02-29")).toBe("2025-02-28");
  });
});

describe("emrRateProblem", () => {
  it("accepts an ordinary rate, with up to three places", () => {
    expect(emrRateProblem("0.87")).toBeNull();
    expect(emrRateProblem("1.125")).toBeNull();
    expect(emrRateProblem(".9")).toBeNull();
    expect(emrRateProblem("1")).toBeNull();
  });

  it("refuses nothing, zero and negatives", () => {
    expect(emrRateProblem("")).toMatch(/required/);
    expect(emrRateProblem("0")).toMatch(/above zero/);
    expect(emrRateProblem("-0.5")).not.toBeNull();
  });

  it("refuses a percentage typed where a decimal belongs, and says how to fix it", () => {
    expect(emrRateProblem("87")).toMatch(/87%, that is 0\.87/);
    expect(emrRateProblem("10")).not.toBeNull();
    expect(emrRateProblem("9.999")).toBeNull();
  });

  it("refuses more precision than the column holds rather than rounding it silently", () => {
    expect(emrRateProblem("0.8745")).toMatch(/three places/);
    expect(emrRateProblem("0,87")).not.toBeNull();
  });
});
