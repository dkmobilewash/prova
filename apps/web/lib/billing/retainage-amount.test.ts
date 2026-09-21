import { describe, expect, it } from "vitest";
import { Prisma } from "@prova/db";
import { retainageWithheldFor } from "./retainage-amount";

/**
 * The two-formulas defect, pinned.
 *
 * What was live: `lib/billing/create-invoice.ts` computed the snapshot as
 * `(Number(amount) * (pct / 100)).toFixed(2)` and `lib/actions/billing.ts`
 * computed it as `((amount * Number(pct)) / 100).toFixed(2)`. Both float.
 * The reproduction is the first test below — $1,000.35 at 10% is $100.04
 * one way and $100.03 the other, and the column is snapshotted at creation
 * and never recomputed, so whichever cent lands is permanent on a document
 * the GC already has.
 *
 * These tests do not compare the two old expressions against each other,
 * which would only prove they now agree — two paths can agree on a wrong
 * answer, and one of the surviving candidates WAS wrong more often than the
 * one it replaced. They compare against exact decimal arithmetic computed
 * independently, so agreement is a consequence of both being right rather
 * than the thing being asserted.
 *
 * THE ORACLE IS A DIFFERENT IMPLEMENTATION, not the same one twice. The
 * module under test does exact integer arithmetic on `bigint` and imports
 * nothing; the oracle below is real decimal.js, which a TEST may import
 * from `@prova/db` because a test file sits on no mocked import path (the
 * module itself cannot — see its header for the 119 files that mock that
 * module). Two unrelated implementations agreeing across the sweeps below
 * is a stronger statement than either alone, and it is the reason this is
 * not "hand-rolled cent math tested against itself".
 */

const D = (value: string) => new Prisma.Decimal(value);

/**
 * The oracle: the same arithmetic spelled out step by step, with no
 * shortcut through the module under test. Deliberately not imported from
 * it — a property test whose oracle is its subject proves nothing.
 */
function exactHalfUp(amount: string, percent: string): string {
  const product = D(amount).times(D(percent));
  const raw = product.dividedBy(100);
  // toFixed's own rounding is what the subject uses, so round by hand here:
  // scale to cents, split off the fractional part, and push a half away
  // from zero.
  const scaled = raw.times(100);
  const floor = scaled.floor();
  const fraction = scaled.minus(floor);
  const cents = fraction.greaterThanOrEqualTo(new Prisma.Decimal("0.5")) ? floor.plus(1) : floor;
  return cents.dividedBy(100).toFixed(2);
}

describe("the reproduction", () => {
  it("is $100.04 on $1,000.35 at 10%, whichever path bills it", () => {
    // The lump-sum expression gave 100.04 here and the pay-application
    // expression gave 100.03. 100.035 is a real half-cent, and half-up
    // takes it to 100.04.
    expect(retainageWithheldFor("1000.35", 10)).toBe("100.04");
    expect(exactHalfUp("1000.35", "10")).toBe("100.04");
  });

  it("does not depend on how the caller happens to spell its inputs", () => {
    // create-invoice.ts had a decimal string and a number; billing.ts had a
    // float and a Prisma Decimal straight off the job row. Same answer.
    const fromStrings = retainageWithheldFor("1000.35", "10");
    const fromNumbers = retainageWithheldFor(1000.35, 10);
    const fromDecimals = retainageWithheldFor(D("1000.35"), D("10"));
    expect(fromStrings).toBe("100.04");
    expect(fromNumbers).toBe("100.04");
    expect(fromDecimals).toBe("100.04");
  });
});

describe("no retainage clause", () => {
  it("is null rather than zero, because the column distinguishes them", () => {
    // Null means "these contract terms have no retainage"; 0.00 would mean
    // "a rate applies and it withheld nothing this period".
    expect(retainageWithheldFor("1000.35", null)).toBeNull();
    expect(retainageWithheldFor("1000.35", undefined)).toBeNull();
    // A rate of zero is a rate. It is not the same as having none.
    expect(retainageWithheldFor("1000.35", 0)).toBe("0.00");
  });
});

describe("the rounding rule is half-up, and it is exercised", () => {
  // Every one of these is an exact half-cent in decimal — not float dust —
  // so a switch to half-even (banker's rounding) fails this block rather
  // than passing it silently. Half-even would send .025 to .02 and .035 to
  // .04; half-up sends both up.
  const halves: Array<[string, string, string]> = [
    ["1000.35", "10", "100.04"], // .035 -> .04 (half-even agrees)
    ["1000.25", "10", "100.03"], // .025 -> .03 (half-even would say .02)
    ["0.05", "10", "0.01"], // .005 -> .01 (half-even would say .00)
    ["0.15", "10", "0.02"], // .015 -> .02 (half-even agrees)
    // 7.5025 is NOT a half-cent, and this row is here because it caught a
    // wrong expectation of mine on the first run — 7.51 by eye, 7.50 by
    // arithmetic. A third of a cent rounds down like anything else.
    ["150.05", "5", "7.50"],
  ];

  for (const [amount, percent, expected] of halves) {
    it(`${amount} at ${percent}% is ${expected}`, () => {
      expect(retainageWithheldFor(amount, percent)).toBe(expected);
      expect(exactHalfUp(amount, percent)).toBe(expected);
    });
  }

  it("keeps at least three genuine half-cents in that table", () => {
    // The size assertion this repo's census scars ask for, in miniature: a
    // table of "rounding cases" whose cases stopped being half-cents would
    // keep passing while proving nothing about rounding. Count them against
    // the decimal arithmetic rather than trusting the comments above.
    const genuineHalves = halves.filter(([amount, percent]) => {
      const scaled = D(amount).times(D(percent)).dividedBy(100).times(100);
      return scaled.minus(scaled.floor()).equals(new Prisma.Decimal("0.5"));
    });
    expect(genuineHalves.length).toBeGreaterThanOrEqual(3);
  });
});

describe("property: every amount and every rate agrees with exact decimal", () => {
  /**
   * The sweep the two float expressions could not survive. Measured
   * against this oracle over 1.9M amounts at 10%, the lump-sum expression
   * was wrong 37,893 times and the pay-application expression 91,200.
   *
   * Ranges are chosen to cross the places floats actually break: cents
   * either side of a half, amounts whose tenths are unrepresentable in
   * binary, and rates that are not whole numbers (2.5% and 7.25% are real
   * retainage terms, and `Job.retainagePercent` is a Decimal column, not an
   * integer).
   */
  const rates = ["0", "1", "2.5", "5", "7.25", "10", "12.5", "15", "20", "33.33", "100"];

  it("agrees on every cent from $999.00 to $1,100.00 at eleven rates", () => {
    let compared = 0;
    for (let cents = 99_900; cents <= 110_000; cents++) {
      const amount = (cents / 100).toFixed(2);
      for (const rate of rates) {
        expect(retainageWithheldFor(amount, rate)).toBe(exactHalfUp(amount, rate));
        compared++;
      }
    }
    // A sweep whose loop bounds drift into nothing passes vacuously. Say
    // how many comparisons were supposed to happen.
    expect(compared).toBe(10_101 * rates.length);
  });

  it("agrees on large invoices, where a float's gap between values is widest", () => {
    let compared = 0;
    for (let cents = 999_999_00; cents <= 999_999_99; cents++) {
      const amount = (cents / 100).toFixed(2);
      for (const rate of rates) {
        expect(retainageWithheldFor(amount, rate)).toBe(exactHalfUp(amount, rate));
        compared++;
      }
    }
    expect(compared).toBe(100 * rates.length);
  });

  it("agrees across the whole Decimal(12,2) range at the common rates", () => {
    // Decimal(12, 2) tops out at 9,999,999,999.99. These are spot values
    // rather than a sweep: the sweeps above cover density, this covers
    // magnitude.
    const amounts = [
      "0.00", "0.01", "0.05", "0.99", "1.00", "9.99", "99.95", "100.00",
      "1000.35", "12345.67", "99999.99", "250000.05", "1234567.89",
      "9999999999.99",
    ];
    let compared = 0;
    for (const amount of amounts) {
      for (const rate of rates) {
        expect(retainageWithheldFor(amount, rate)).toBe(exactHalfUp(amount, rate));
        compared++;
      }
    }
    expect(compared).toBe(amounts.length * rates.length);
  });
});

describe("the result is a value the Decimal(12,2) column can take", () => {
  it("always has exactly two decimal places", () => {
    for (const amount of ["0.00", "1", "1000.35", "9999999999.99"]) {
      for (const rate of ["0", "10", "33.33"]) {
        expect(retainageWithheldFor(amount, rate)).toMatch(/^-?\d+\.\d{2}$/);
      }
    }
  });

  it("never comes back in exponential notation", () => {
    // `Number.toFixed` and `Decimal.toFixed` both avoid it, but a
    // reimplementation reaching for `toString()` would not — and Postgres
    // rejects "1e-7" for a numeric column at the far end of a long day.
    expect(retainageWithheldFor("0.01", "0.0001")).not.toMatch(/e/i);
  });
});

describe("inputs the parser has to survive", () => {
  it("takes a Postgres numeric's trailing zeros without changing the answer", () => {
    // Decimal(5, 2) comes back as "10.00", not "10". Decimal(12, 2) comes
    // back as "1000.35". Both are what the write path actually receives.
    expect(retainageWithheldFor("1000.35", "10.00")).toBe("100.04");
    expect(retainageWithheldFor("1000.3500", "10.000")).toBe("100.04");
  });

  it("takes a number that JS stringifies in exponential notation", () => {
    // `(1e-7).toString()` is "1e-7", and a parser that reads digits
    // left-to-right without handling the exponent would read it as 1.
    expect(retainageWithheldFor(1e-7, "100")).toBe("0.00");
    expect(retainageWithheldFor(1.5e3, "10")).toBe("150.00");
  });

  it("rounds a negative amount away from zero, the same as a positive one", () => {
    // No flow in this product bills a negative amount. This is here because
    // half-up on negatives is the one place a rounding rule silently
    // becomes half-down, and the assertion is cheaper than the surprise.
    expect(retainageWithheldFor("-1000.35", "10")).toBe("-100.04");
    expect(retainageWithheldFor("-1000.25", "10")).toBe("-100.03");
  });

  it("refuses something that is not a number at all, loudly", () => {
    // A bug, not a person's mistake — every caller validates first. CLAUDE.md:
    // `throw` is for genuine bugs, a returned ActionResult is for refusals.
    expect(() => retainageWithheldFor("ten thousand", "10")).toThrow(/not a decimal number/);
    expect(() => retainageWithheldFor("1,000.35", "10")).toThrow(/not a decimal number/);
  });
});
