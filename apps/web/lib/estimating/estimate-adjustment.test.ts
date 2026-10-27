import { describe, expect, it } from "vitest";
import { centsOf, percentOfCents, percentText, planEstimateAdjustment, type AdjustmentInput } from "./estimate-adjustment";

/**
 * The arithmetic behind `adjust_estimate`. Every figure on its card comes
 * from here, so every figure is pinned here: the percentage, the base, the
 * rounding, the sign, and each refusal as the sentence a person reads.
 */

const BID = 7_835_000; // $78,350.00

const plan = (over: Partial<AdjustmentInput>) =>
  planEstimateAdjustment({ kind: undefined, value: "", label: "Night work", off: false, baseCents: BID, ...over });

function ok(over: Partial<AdjustmentInput>) {
  const result = plan(over);
  if (!result.ok) throw new Error(`expected a plan, got: ${result.reason}`);
  return result;
}

function refused(over: Partial<AdjustmentInput>) {
  const result = plan(over);
  if (result.ok) throw new Error(`expected a refusal, got: ${result.cardLine}`);
  return result;
}

describe("a percentage of the bid", () => {
  it("is computed on the base in whole cents and says so on the card", () => {
    const result = ok({ kind: "percent", value: "10%" });
    expect(result.amountCents).toBe(783_500);
    expect(result.unitPrice).toBe("7835.00");
    expect(result.percentHundredths).toBe(1000);
    expect(result.rounded).toBe(false);
    expect(result.cardLine).toBe("Night work — 10% of $78,350.00 = $7,835.00");
    expect(result.description).toBe("Night work — 10% of $78,350.00 (the bid before this line)");
  });

  it("reads the percentage the way a person writes it", () => {
    for (const value of ["10", "10%", "10 %", "10 percent", "+10%"]) {
      expect(ok({ kind: "percent", value }).amountCents, value).toBe(783_500);
    }
    expect(ok({ kind: "percent", value: "2.5%" }).cardLine).toBe("Night work — 2.5% of $78,350.00 = $1,958.75");
  });

  it("infers the kind from a % the person typed when the model gave none", () => {
    expect(ok({ value: "5%", label: "Contingency" }).cardLine).toBe("Contingency — 5% of $78,350.00 = $3,917.50");
  });

  it("allows exactly 100%, and refuses anything more", () => {
    expect(ok({ kind: "percent", value: "100%" }).amountCents).toBe(BID);
    expect(refused({ kind: "percent", value: "101%" }).reason).toMatch(/100% or less/);
  });

  it("refuses 0%", () => {
    expect(refused({ kind: "percent", value: "0%" }).reason).toMatch(/adds nothing/);
  });

  it("refuses a percentage of an estimate with no priced line", () => {
    const result = refused({ kind: "percent", value: "10%", baseCents: 0 });
    expect(result.reason).toMatch(/no priced line/);
    expect(result.question).toBeUndefined();
  });

  it("refuses more than two decimal places rather than rounding the person's figure", () => {
    expect(refused({ kind: "percent", value: "3.333%" }).reason).toMatch(/2 decimal places/);
  });

  it("refuses a percentage that rounds to nothing", () => {
    expect(refused({ kind: "percent", value: "0.01%", baseCents: 40 }).reason).toMatch(/rounds to \$0\.00/);
  });
});

describe("rounding — to the cent, half away from zero, the same both directions", () => {
  it("rounds a fraction of a cent to the nearest cent and flags it", () => {
    // 5% of $1,234.57 = $61.7285
    const result = ok({ kind: "percent", value: "5%", baseCents: 123_457 });
    expect(result.amountCents).toBe(6173);
    expect(result.rounded).toBe(true);
  });

  it("rounds an exact half cent up on a charge and down by the same cent on a discount", () => {
    // 1% of $1,234.50 = $12.345
    expect(percentOfCents(123_450, 100)).toEqual({ cents: 1235, rounded: true });
    expect(ok({ kind: "percent", value: "1%", baseCents: 123_450 }).amountCents).toBe(1235);
    expect(ok({ kind: "percent", value: "1%", baseCents: 123_450, off: true }).amountCents).toBe(-1235);
  });

  it("rounds just under half a cent down", () => {
    // 1% of $1,234.49 = $12.3449
    expect(percentOfCents(123_449, 100)).toEqual({ cents: 1234, rounded: true });
  });

  it("keeps every digit on a large bid", () => {
    // 7.25% of $123,456,789.01 = $8,950,617.20... exactly 895061720.3975 cents
    expect(percentOfCents(12_345_678_901, 725)).toEqual({ cents: 895_061_720, rounded: true });
  });

  it("turns a dollar total into whole cents and writes a percentage back as typed", () => {
    expect(centsOf(78_350)).toBe(BID);
    expect(centsOf(0.1 + 0.2)).toBe(30);
    expect(percentText(1000)).toBe("10%");
    expect(percentText(250)).toBe("2.5%");
    expect(percentText(333)).toBe("3.33%");
    expect(percentText(5)).toBe("0.05%");
  });
});

describe("a discount", () => {
  it("is negative only when the person said off, and reads as off on the card", () => {
    const result = ok({ kind: "percent", value: "3%", label: "GC discount", off: true });
    expect(result.amountCents).toBe(-235_050);
    expect(result.unitPrice).toBe("-2350.50");
    expect(result.cardLine).toBe("GC discount — 3% off $78,350.00 = -$2,350.50");
    expect(result.description).toBe("GC discount — 3% off $78,350.00 (the bid before this line)");
  });

  it("takes a minus sign the person typed on a discount instruction, without doubling it", () => {
    expect(ok({ kind: "percent", value: "-3%", off: true }).amountCents).toBe(-235_050);
    expect(ok({ kind: "amount", value: "-$500", off: true }).amountCents).toBe(-50_000);
  });

  it("refuses a minus figure with no discount instruction", () => {
    const result = refused({ kind: "percent", value: "-3%" });
    expect(result.reason).toBe('A minus figure takes money off the bid. If that is what you mean, say "take 3% off" so it is entered as a discount.');
  });

  it("refuses 100% off or more", () => {
    expect(refused({ kind: "percent", value: "100%", off: true }).reason).toMatch(/under 100%/);
    expect(refused({ kind: "percent", value: "150%", off: true }).reason).toMatch(/under 100%/);
    expect(ok({ kind: "percent", value: "99.99%", off: true }).amountCents).toBe(-7_834_217);
  });

  it("refuses a dollar discount as large as the whole bid", () => {
    expect(refused({ kind: "amount", value: "$78,350", off: true }).reason).toMatch(/nothing or less/);
    expect(ok({ kind: "amount", value: "$78,349.99", off: true }).amountCents).toBe(-7_834_999);
  });
});

describe("a dollar amount", () => {
  it("is the person's figure, as a lump sum, with the label as the description", () => {
    const result = ok({ kind: "amount", value: "$2,500", label: "Mobilization" });
    expect(result.amountCents).toBe(250_000);
    expect(result.unitPrice).toBe("2500.00");
    expect(result.percentHundredths).toBeNull();
    expect(result.cardLine).toBe("Mobilization — $2,500.00");
    expect(result.description).toBe("Mobilization");
  });

  it("does not need a priced estimate", () => {
    expect(ok({ kind: "amount", value: "2500", label: "Mobilization", baseCents: 0 }).amountCents).toBe(250_000);
  });

  it("refuses $0 and a figure with a fraction of a cent", () => {
    expect(refused({ kind: "amount", value: "$0" }).reason).toMatch(/adds nothing/);
    expect(refused({ kind: "amount", value: "$12.345" }).reason).toMatch(/2 decimal places/);
  });

  it("refuses shorthand rather than guessing at it", () => {
    expect(refused({ kind: "amount", value: "2.5k" }).ok).toBe(false);
  });
});

describe("the kind is a question when the typing and the model disagree, or when neither says", () => {
  it("asks when a % arrives as an amount", () => {
    const result = refused({ kind: "amount", value: "10%" });
    expect(result.question).toBe(true);
    expect(result.reason).toMatch(/reads as a percentage/);
  });

  it("asks when a $ arrives as a percent", () => {
    const result = refused({ kind: "percent", value: "$2,500" });
    expect(result.question).toBe(true);
    expect(result.reason).toMatch(/reads as a dollar figure/);
  });

  it("asks when a bare number arrives with no kind", () => {
    const result = refused({ value: "10" });
    expect(result.question).toBe(true);
    expect(result.reason).toBe('Is "10" a percentage of the bid or a dollar figure?');
  });
});

it("clips a long label to the person's first eighty characters", () => {
  const result = ok({ kind: "amount", value: "$100", label: `  ${"x".repeat(200)}  ` });
  expect(result.description).toBe("x".repeat(80));
});
