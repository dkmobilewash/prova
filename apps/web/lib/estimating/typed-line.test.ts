import { describe, expect, it } from "vitest";
import { lineTotalCents, planTypedLine, unitOf, type TypedLineInput } from "./typed-line";

/**
 * The arithmetic behind `add_estimate_line`. Every figure on its card comes
 * from here: the person's quantity and price parsed strictly, the product in
 * whole cents, and each refusal as the sentence a person reads.
 */

const plan = (over: Partial<TypedLineInput>) =>
  planTypedLine({ description: "Cleanup", quantity: "40", unit: "hours", unitPrice: "$65", unitCost: undefined, baseCents: 7_835_000, ...over });

function ok(over: Partial<TypedLineInput>) {
  const result = plan(over);
  if (!result.ok) throw new Error(`expected a plan, got: ${result.reason}`);
  return result;
}

function refused(over: Partial<TypedLineInput>) {
  const result = plan(over);
  if (result.ok) throw new Error(`expected a refusal, got: ${result.cardLine}`);
  return result.reason;
}

describe("a line at the person's own price", () => {
  it("multiplies in code and writes the card line", () => {
    const result = ok({});
    expect(result.cardLine).toBe("Cleanup — 40 HR × $65.00 = $2,600.00");
    expect(result.totalCents).toBe(260_000);
    expect(result.quantity).toBe("40");
    expect(result.unit).toBe("HR");
    expect(result.unitPrice).toBe("65.00");
    expect(result.unitCost).toBeNull();
    expect(result.costLine).toBeNull();
    expect(result.rounded).toBe(false);
  });

  it("reads square feet and a cents price", () => {
    const result = ok({ description: "Patching", quantity: "200", unit: "SF", unitPrice: "4.50" });
    expect(result.cardLine).toBe("Patching — 200 SF × $4.50 = $900.00");
  });

  it("reads thousands commas and a decimal quantity the way the job page form does", () => {
    expect(ok({ quantity: "1,250", unit: "sq ft", unitPrice: "$3.25" }).cardLine).toBe("Cleanup — 1,250 SF × $3.25 = $4,062.50");
    expect(ok({ quantity: "12.5", unitPrice: "80" }).totalCents).toBe(100_000);
  });

  it("carries a cost when the person gave one, and shows its product too", () => {
    const result = ok({ unitCost: "$40" });
    expect(result.unitCost).toBe("40.00");
    expect(result.costCents).toBe(160_000);
    expect(result.costLine).toBe("40 HR × $40.00 = $1,600.00");
  });

  it("keeps a unit it does not recognise as the person typed it, and has none when none was said", () => {
    expect(ok({ unit: "sheets" }).cardLine).toBe("Cleanup — 40 sheets × $65.00 = $2,600.00");
    const bare = ok({ unit: undefined });
    expect(bare.unit).toBeNull();
    expect(bare.cardLine).toBe("Cleanup — 40 × $65.00 = $2,600.00");
    expect(unitOf("  Linear Feet ")).toBe("LF");
    expect(unitOf("x".repeat(40))).toHaveLength(12);
  });
});

describe("rounding — to the cent, half away from zero", () => {
  it("rounds the product of two two-place figures and flags it", () => {
    // 12.5 × $4.45 = $55.625
    const result = ok({ quantity: "12.5", unitPrice: "4.45" });
    expect(result.totalCents).toBe(5563);
    expect(result.rounded).toBe(true);
    expect(lineTotalCents(1250, 445)).toEqual({ cents: 5563, rounded: true });
    // 0.01 × $0.49 = $0.0049
    expect(lineTotalCents(1, 49)).toEqual({ cents: 0, rounded: true });
  });
});

describe("refusals, each a sentence rather than a card", () => {
  it("refuses a zero or negative quantity", () => {
    expect(refused({ quantity: "0" })).toMatch(/quantity has to be more than zero/);
    expect(refused({ quantity: "-5" })).toMatch(/quantity has to be more than zero/);
  });

  it("refuses a zero or negative price", () => {
    expect(refused({ unitPrice: "$0" })).toMatch(/unit price has to be more than zero/);
    expect(refused({ unitPrice: "-65" })).toMatch(/unit price has to be more than zero/);
  });

  it("refuses a price with more than two decimals rather than rounding the person's figure", () => {
    expect(refused({ unitPrice: "4.505" })).toMatch(/2 decimal places/);
  });

  it("refuses shorthand and words", () => {
    expect(refused({ unitPrice: "2.5k" })).toMatch(/isn't a number/);
    expect(refused({ unitPrice: "about 60" })).toMatch(/isn't a number/);
    expect(refused({ quantity: "forty" })).toMatch(/isn't a number/);
  });

  it("refuses a missing price at this layer too, though the command asks before it gets here", () => {
    expect(refused({ unitPrice: "" })).toMatch(/needs a number/);
  });

  it("refuses a nonsense cost the same way as a nonsense price", () => {
    expect(refused({ unitCost: "0" })).toMatch(/unit cost has to be more than zero/);
  });

  it("refuses a figure the column cannot hold", () => {
    expect(refused({ unitPrice: "10,000,000,000" })).toMatch(/too big/);
  });

  it("refuses an empty description", () => {
    expect(refused({ description: "   " })).toBe("The line needs a description.");
  });
});
