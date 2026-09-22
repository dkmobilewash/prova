/**
 * What a contractor types, and what this app does with it.
 *
 * THE FIRST TEST IS THE BUG, verbatim. On 2026-09-21 a quantity of `2,800`
 * on step 2 of the new-job wizard — the second screen of creating a first
 * job — did not add the line and rendered "An error occurred in the Server
 * Components render. The specific message is omitted in production builds…"
 * `Number("2,800")` is `NaN`, the parser threw a plain `Error`, and
 * production redacted it.
 *
 * MUTATION-TESTED, every group, by breaking the fix and watching these go
 * red. Recorded here so the next person does not have to guess which line
 * is load-bearing:
 *
 *   - drop the grouped-comma branch (back to a bare `Number(value)` gate)
 *       -> "the bug, verbatim" and the whole "what a person writes" group
 *          go red, 9 failures;
 *   - strip ALL commas instead of only well-formed groups
 *       -> "refuses 12,50 rather than silently reading it as 1250" goes
 *          red, and reads 1250 — the hundredfold money error;
 *   - remove the NOT_TYPED_BY_A_PERSON list
 *       -> the hex/infinity/exponent group goes red, 5 failures, and
 *          `0x10` comes back as the literal string "0x10" bound for a
 *          Postgres numeric column;
 *   - return `trimmed` instead of the normalised value
 *       -> "normalises what it returns" goes red;
 *   - drop the `min`/`max` checks -> the percent group goes red, 4.
 */

import { describe, expect, it } from "vitest";
import { isBlank, labelFromKey, parseNumericInput, PERCENT_BOUNDS } from "./numeric-input";

/** The value, or the refusal — so a failing expectation prints the sentence
 * a person would have read rather than `undefined`. */
function read(raw: unknown, options?: Parameters<typeof parseNumericInput>[1]): string {
  const parsed = parseNumericInput(raw, options);
  return parsed.ok ? parsed.value : `REFUSED: ${parsed.error}`;
}

describe("the bug, verbatim", () => {
  it("accepts 2,800 — the quantity that took down step 2 of the new-job wizard", () => {
    expect(read("2,800", { label: "Quantity" })).toBe("2800");
  });

  it("accepts 12,500 — the invoice Amount that took down the billing tab", () => {
    expect(read("12,500", { label: "Amount" })).toBe("12500");
  });

  it("accepts $12,500.00 — what the payroll importer has always taken, now on the invoice form too", () => {
    expect(read("$12,500.00", { label: "Amount" })).toBe("12500");
  });
});

describe("what a person writes", () => {
  const accepted: Array<[string, string]> = [
    ["2800", "2800"],
    ["2,800", "2800"],
    ["1,234,567.89", "1234567.89"],
    ["$2,800", "2800"],
    ["$ 2,800", "2800"],
    ["USD 2,800", "2800"],
    ["us$2800", "2800"],
    ["  2800  ", "2800"],
    // A spreadsheet paste: non-breaking and narrow no-break spaces.
    ["12 500", "12500"],
    ["12 500.25", "12500.25"],
    ["10%", "10"],
    ["+7", "7"],
    [".5", "0.5"],
    ["5.", "5"],
    ["007", "7"],
    ["-5", "-5"],
    ["0", "0"],
    ["0.00", "0"],
  ];
  for (const [typed, value] of accepted) {
    it(`reads ${JSON.stringify(typed)} as ${value}`, () => {
      expect(read(typed)).toBe(value);
    });
  }
});

describe("what it refuses, and says why", () => {
  it("refuses 12,50 rather than silently reading it as 1250", () => {
    const parsed = parseNumericInput("12,50", { label: "Amount" });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.error).toContain("three digits after it");
    // The hundredfold error this prevents, stated as an assertion so a
    // future "just strip the commas" cannot pass quietly.
    expect(read("12,50")).not.toBe("1250");
  });

  it("refuses 1,2345 — grouping has to be groups of three", () => {
    expect(read("1,2345")).toContain("REFUSED");
  });

  it("refuses a comma after the decimal point", () => {
    expect(read("12.5,0")).toContain("REFUSED");
  });

  it("refuses brackets and suggests the minus sign instead", () => {
    const parsed = parseNumericInput("(500)", { label: "Amount" });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.error).toContain("-500");
  });

  it("names the field it is refusing", () => {
    const parsed = parseNumericInput("abc", { label: "Unit price" });
    expect(parsed.ok ? "" : parsed.error).toMatch(/^Unit price/);
  });

  it("says a blank field needs a number, rather than calling it not-a-number", () => {
    const parsed = parseNumericInput("", { label: "Quantity" });
    expect(parsed.ok ? "" : parsed.error).toBe("Quantity needs a number.");
  });

  it("shortens a long paste rather than reading 300 characters back", () => {
    const parsed = parseNumericInput("x".repeat(300), { label: "Amount" });
    expect(parsed.ok ? "" : parsed.error.length).toBeLessThan(200);
  });
});

/**
 * These all PASSED the old `Number.isNaN(Number(value))` gate and were then
 * returned as the RAW STRING for Prisma to put in a `@db.Decimal` column.
 * `Number("0x10")` is 16, so the literal text `0x10` went to Postgres;
 * `1e999` went as `Infinity`. Nobody types these, which is exactly why
 * nobody noticed they were getting through.
 */
describe("forms JS accepts and a contractor never types", () => {
  const refused = ["0x10", "0b11", "0o17", "Infinity", "-Infinity", "1e5", "1.5e3", "1e999"];
  for (const typed of refused) {
    it(`refuses ${typed}`, () => {
      expect(read(typed)).toContain("REFUSED");
    });
  }

  /**
   * Refusing these is the canonical-form check's doing, and it would keep
   * refusing them with `NOT_TYPED_BY_A_PERSON` deleted — which is exactly
   * why the group above cannot be the only test of it. Found by mutation:
   * removing the list left all eight of those green. What the list adds is
   * a message somebody can act on, so the message is what is asserted.
   */
  it("says WHICH odd form it spotted, rather than a flat 'not a number'", () => {
    const named: Array<[string, string]> = [
      ["0x10", "hex"],
      ["0b11", "binary"],
      ["0o17", "octal"],
      ["Infinity", "infinity"],
      ["1.5e3", "scientific notation"],
    ];
    for (const [typed, says] of named) {
      const parsed = parseNumericInput(typed, { label: "Quantity" });
      expect(parsed.ok).toBe(false);
      expect(parsed.ok ? "" : parsed.error, `${typed} should be named as ${says}`).toContain(says);
    }
  });

  it("said yes to every one of them before this change", () => {
    // The old gate, spelled out, so the regression is visible rather than
    // asserted: each of these is a value it let through.
    const oldGate = (v: string) => !(!v || Number.isNaN(Number(v)));
    expect(refused.filter(oldGate)).toEqual(refused);
  });

  it("refuses a number too large to be finite even when it is all digits", () => {
    expect(read("9".repeat(400))).toContain("REFUSED");
  });
});

describe("normalises what it returns", () => {
  it("hands back a plain decimal string, never a float round-trip", () => {
    // 12500.00 through Number() and back is "12500", which is the same
    // figure — but 0.1 + 0.2 is not, and money columns are Decimal for
    // that reason. The point is that only decoration is removed.
    expect(read("$1,234.50")).toBe("1234.5");
    expect(read("0.30")).toBe("0.3");
    expect(read("100.00")).toBe("100");
  });

  it("keeps every significant digit of a long figure", () => {
    expect(read("12,345,678.91")).toBe("12345678.91");
  });
});

describe("bounds", () => {
  it("refuses a negative where negatives make no sense", () => {
    const parsed = parseNumericInput("-5", { label: "Quantity", min: 0 });
    expect(parsed.ok ? "" : parsed.error).toBe("Quantity can't be negative.");
  });

  it("refuses a fraction where a whole number is meant", () => {
    const parsed = parseNumericInput("2.5", { label: "Days away", integer: true });
    expect(parsed.ok ? "" : parsed.error).toBe("Days away has to be a whole number.");
  });

  it("names both ends of a range", () => {
    const parsed = parseNumericInput("300", { label: "Retainage", ...PERCENT_BOUNDS });
    expect(parsed.ok ? "" : parsed.error).toBe("Retainage has to be between 0% and 100%.");
  });

  it("refuses a third decimal place on a money field, rather than letting Postgres round it away", () => {
    const parsed = parseNumericInput("1.005", { label: "Amount", maxDecimals: 2 });
    expect(parsed.ok ? "" : parsed.error).toContain("2 decimal places");
  });
});

/**
 * The retainage half of this change. `0.10` is INSIDE 0-100 and always will
 * be — 0.1% is a strange rate, not an impossible one — so the parser cannot
 * be the thing that catches it. These pin down what bounds DO fix, so the
 * next reader does not mistake them for the whole answer; the rest is
 * `components/PercentField.tsx`, which puts a `%` that does not vanish next
 * to what the rate comes to in money.
 */
describe("percent", () => {
  it("takes 10 and 10% as the same ten percent", () => {
    expect(read("10", { ...PERCENT_BOUNDS })).toBe("10");
    expect(read("10%", { ...PERCENT_BOUNDS })).toBe("10");
  });

  it("refuses 110% and refuses a negative rate", () => {
    expect(read("110", { label: "Retainage", ...PERCENT_BOUNDS })).toContain("REFUSED");
    expect(read("-1", { label: "Retainage", ...PERCENT_BOUNDS })).toContain("REFUSED");
  });

  it("STILL ACCEPTS 0.10, which is why the input carries a visible % and a money preview", () => {
    expect(read("0.10", { label: "Retainage", ...PERCENT_BOUNDS })).toBe("0.1");
  });
});

describe("blankness", () => {
  it("treats whitespace, a missing key and a non-string as blank", () => {
    expect(isBlank("")).toBe(true);
    expect(isBlank("   ")).toBe(true);
    expect(isBlank(" ")).toBe(true);
    expect(isBlank(null)).toBe(true);
    expect(isBlank(new File([], "x"))).toBe(true);
    expect(isBlank("0")).toBe(false);
  });
});

describe("labelFromKey", () => {
  it("turns a form key into something that reads like a screen", () => {
    expect(labelFromKey("unitPrice")).toBe("Unit price");
    expect(labelFromKey("quantity")).toBe("Quantity");
    expect(labelFromKey("daysAway")).toBe("Days away");
    expect(labelFromKey("defaultRetainagePercent")).toBe("Default retainage percent");
    expect(labelFromKey("")).toBe("That value");
  });
});
