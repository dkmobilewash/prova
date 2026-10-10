import { describe, expect, it } from "vitest";
import {
  coverageWarning,
  daysBetween,
  deadlineCoverage,
  type CoveragePackage,
} from "./bid-deadline-coverage";

const quote = (vendorName: string, amount: number | null) =>
  ({ id: `q_${vendorName}`, vendorName, amount, dueBy: null, declinedAt: null }) as never;

const pkg = (
  packageLabel: string,
  counts: { priced?: number; outstanding?: number; declined?: number } = {},
): CoveragePackage => ({
  packageLabel,
  quotes: Array.from({ length: counts.priced ?? 0 }, (_, i) => quote(`priced${i}`, 1000 + i)),
  outstanding: Array.from({ length: counts.outstanding ?? 0 }, (_, i) => quote(`out${i}`, null)),
  declined: Array.from({ length: counts.declined ?? 0 }, (_, i) => quote(`no${i}`, null)),
});

const TODAY = "2026-10-09";

describe("daysBetween", () => {
  it("counts whole days forward and back", () => {
    expect(daysBetween(TODAY, "2026-10-12")).toBe(3);
    expect(daysBetween(TODAY, "2026-10-09")).toBe(0);
    expect(daysBetween(TODAY, "2026-10-07")).toBe(-2);
  });

  it("counts across a daylight-saving change", () => {
    // US DST ends 2026-11-01 and begins 2026-03-08.
    expect(daysBetween("2026-10-25", "2026-11-10")).toBe(16);
    expect(daysBetween("2026-03-01", "2026-03-15")).toBe(14);

    // AND A NOTE ON WHAT THIS DOES NOT PROVE. Replacing the UTC parse with a
    // local-time one is an EQUIVALENT mutation — measured in
    // `TZ=America/New_York`, across both changeovers and a whole year, the two
    // agree on every case, because `Math.round` absorbs an offset under twelve
    // hours. No test can tell them apart and none should pretend to.
    //
    // The UTC parse stays because it is exact rather than rescued by the
    // rounding, and a future `Math.floor` or an hours-level answer would make
    // the difference real. A forced timezone was tried here first and removed:
    // it looked like it was testing something and was not.
  });

  it("says null rather than guessing when there is no date", () => {
    expect(daysBetween(TODAY, null)).toBeNull();
    expect(daysBetween(TODAY, "not a date")).toBeNull();
  });

  it("takes the date out of a full timestamp", () => {
    expect(daysBetween(TODAY, "2026-10-12T17:30:00.000Z")).toBe(3);
  });
});

describe("deadlineCoverage", () => {
  it("FINDS THE PACKAGES WITH NO PRICE AT ALL", () => {
    // The hole: not a late task, a figure about to be guessed.
    const coverage = deadlineCoverage(
      [pkg("Drywall", { priced: 2 }), pkg("Glazing", { outstanding: 2 }), pkg("Doors", { priced: 1 })],
      "2026-10-12",
      TODAY,
    );
    expect(coverage.unpriced.map((one) => one.packageLabel)).toEqual(["Glazing"]);
    expect(coverage.daysToBid).toBe(3);
  });

  it("counts a package with ONLY declines as unpriced", () => {
    // Everybody said no. That is a package nobody has priced, and it is the
    // one most likely to be forgotten because its requests are all closed.
    const coverage = deadlineCoverage([pkg("Glazing", { declined: 3 })], "2026-10-12", TODAY);
    expect(coverage.unpriced.map((one) => one.packageLabel)).toEqual(["Glazing"]);
    expect(coverage.unpriced[0].declined).toBe(3);
    expect(coverage.stillOut).toBe(0);
  });

  it("counts what is still out across every package", () => {
    const coverage = deadlineCoverage(
      [pkg("Drywall", { priced: 1, outstanding: 2 }), pkg("Glazing", { outstanding: 3 })],
      "2026-10-12",
      TODAY,
    );
    expect(coverage.stillOut).toBe(5);
    expect(coverage.settled).toBe(0);
  });

  it("counts a package with nothing outstanding as settled", () => {
    const coverage = deadlineCoverage(
      [pkg("Drywall", { priced: 2 }), pkg("Doors", { priced: 1, outstanding: 1 })],
      "2026-10-12",
      TODAY,
    );
    expect(coverage.settled).toBe(1);
  });

  it("reports null days for an undated bid, never a number", () => {
    expect(deadlineCoverage([pkg("Glazing", { outstanding: 1 })], null, TODAY).daysToBid).toBeNull();
  });
});

describe("coverageWarning", () => {
  const warn = (packages: CoveragePackage[], due: string | null) =>
    coverageWarning(deadlineCoverage(packages, due, TODAY));

  it("SAYS NOTHING when every package has a price", () => {
    expect(warn([pkg("Drywall", { priced: 2 }), pkg("Doors", { priced: 1 })], "2026-10-12")).toBeNull();
    // Even with requests still out — an outstanding quote on a package that is
    // already priced is a better number arriving, not a hole.
    expect(warn([pkg("Drywall", { priced: 1, outstanding: 3 })], "2026-10-12")).toBeNull();
  });

  it("names the packages and how long is left", () => {
    const sentence = warn([pkg("Glazing", { outstanding: 2 }), pkg("Doors", { priced: 1 })], "2026-10-12");
    expect(sentence).toContain("Glazing");
    expect(sentence).toContain("in 3 days");
    expect(sentence).toContain("2 requests are still out");
  });

  it("says tomorrow and today the way somebody says them", () => {
    expect(warn([pkg("Glazing", { outstanding: 1 })], "2026-10-10")).toContain("due tomorrow");
    expect(warn([pkg("Glazing", { outstanding: 1 })], TODAY)).toContain("due today");
  });

  it("says the bid is already past rather than counting down from a negative", () => {
    const sentence = warn([pkg("Glazing", { outstanding: 1 })], "2026-10-07");
    expect(sentence).toContain("was due 2 days ago");
    expect(sentence).not.toContain("-2");
  });

  it("AN UNDATED BID STILL GETS THE WARNING, and says the date is missing", () => {
    // No date is not no hurry. The bid nobody dated is the one most likely to
    // be close, and a quiet screen over it is the failure this file exists for.
    const sentence = warn([pkg("Glazing", { outstanding: 1 })], null);
    expect(sentence).toContain("Glazing");
    expect(sentence).toContain("no due date");
    expect(sentence).not.toMatch(/due (today|tomorrow|in )/);
  });

  it("TELLS YOU WHEN NOBODY HAS EVEN BEEN ASKED, which reads as quiet otherwise", () => {
    // A package with no price and nothing outstanding is not waiting on
    // anybody. "3 requests are still out" would be the comforting version of
    // the same screen.
    const sentence = warn([pkg("Glazing", { declined: 2 })], "2026-10-12");
    expect(sentence).toContain("need somebody asked");
    // It may say "Nothing is still out" — what it must never do is claim
    // requests ARE pending, which is the comforting version of this screen.
    expect(sentence).not.toMatch(/\d+ requests? (is|are) still out/);
  });

  it("does not print twelve package names into one sentence", () => {
    const many = Array.from({ length: 12 }, (_, i) => pkg(`Package ${i}`, { outstanding: 1 }));
    const sentence = warn(many, "2026-10-12");
    expect(sentence).toContain("and 8 more");
    expect(sentence!.length).toBeLessThan(260);
  });

  it("gets the singular right for one package and one request", () => {
    const sentence = warn([pkg("Glazing", { outstanding: 1 })], "2026-10-12");
    expect(sentence).toContain("1 package has no price");
    expect(sentence).toContain("1 request is still out");
  });
});
