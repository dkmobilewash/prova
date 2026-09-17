import { describe, expect, it } from "vitest";
import { Prisma } from "@prova/db";
import {
  OVERHEAD_AND_PROFIT_NOT_SET,
  formatOverheadAndProfitAmount,
  formatOverheadAndProfitPercent,
  overheadAndProfitBlock,
  overheadAndProfitLineDescription,
  overheadAndProfitLineLabel,
  parseOverheadAndProfitPercent,
} from "./overhead-and-profit";

/**
 * The two claims this feature makes, and the one it must never make.
 *
 *   1. A rate that IS set moves the total by exactly the right amount.
 *   2. A rate that is NOT set reads as not set, and is EXCLUDED from the
 *      total rather than added as zero.
 *
 * The second is the one worth a test file. An unset rate and a 0% rate
 * produce the same total, so a bug that treats null as zero passes every
 * arithmetic assertion — the only thing that catches it is asserting on
 * what the line SAYS, and on the fact that `amount` is null rather than a
 * Decimal that happens to equal zero.
 */

const d = (value: string | number) => new Prisma.Decimal(value);

describe("a rate that has been set", () => {
  /* The worked example, spelled out so the arithmetic is checkable by hand
     rather than by rerunning the same expression the code runs:

       10 SF of soffit framing at $250.00      =  $2,500.00
       40 LF of track at $187.50               =  $7,500.00
                                      subtotal = $10,000.00
       overhead and profit at 15%              =  $1,500.00
                                         total = $11,500.00  */
  const block = overheadAndProfitBlock(d("10000.00"), d("15"));

  it("adds the rate to the subtotal as its own amount", () => {
    expect(block.amount?.toFixed(2)).toBe("1500.00");
  });

  it("moves the total by exactly that amount and no more", () => {
    expect(block.total.toFixed(2)).toBe("11500.00");
    expect(block.total.sub(block.subtotal).toFixed(2)).toBe("1500.00");
  });

  it("keeps total = subtotal x (1 + rate/100) exactly", () => {
    expect(block.total.toFixed(2)).toBe(
      block.subtotal.mul(d(1).add(d("15").div(100))).toFixed(2),
    );
  });

  it("says it is set, and names the rate on the line", () => {
    expect(block.isSet).toBe(true);
    expect(overheadAndProfitLineLabel(block.percent)).toBe("Overhead and profit (15%)");
    expect(formatOverheadAndProfitAmount(block)).toBe("$1,500.00");
  });

  it("rounds the amount to the cent, half up", () => {
    // 1,234.57 x 12.5% = 154.32125 -> 154.32; the third cent is not carried
    // into the total.
    const rounded = overheadAndProfitBlock(d("1234.57"), d("12.5"));
    expect(rounded.amount?.toFixed(2)).toBe("154.32");
    expect(rounded.total.toFixed(2)).toBe("1388.89");

    // 100.05 x 15% = 15.0075 -> 15.01 when half-up, 15.00 when truncated.
    const halfUp = overheadAndProfitBlock(d("100.10"), d("15"));
    expect(halfUp.amount?.toFixed(2)).toBe("15.02"); // 15.015 rounds up
  });

  it("carries the markup back on a credit change order", () => {
    const credit = overheadAndProfitBlock(d("-4000.00"), d("15"));
    expect(credit.amount?.toFixed(2)).toBe("-600.00");
    expect(credit.total.toFixed(2)).toBe("-4600.00");
  });

  it("accepts a plain numeric string, the shape Prisma hands back", () => {
    const fromStrings = overheadAndProfitBlock("10000.00", "15.00");
    expect(fromStrings.amount?.toFixed(2)).toBe("1500.00");
    expect(fromStrings.total.toFixed(2)).toBe("11500.00");
  });
});

describe("a rate of exactly zero, which somebody chose", () => {
  const block = overheadAndProfitBlock(d("10000.00"), d("0"));

  it("is SET, and its amount is zero rather than absent", () => {
    expect(block.isSet).toBe(true);
    expect(block.amount).not.toBeNull();
    expect(block.amount?.toFixed(2)).toBe("0.00");
  });

  it("prints a real zero, not the not-set wording", () => {
    expect(overheadAndProfitLineLabel(block.percent)).toBe("Overhead and profit (0%)");
    expect(formatOverheadAndProfitAmount(block)).toBe("$0.00");
    expect(formatOverheadAndProfitAmount(block)).not.toBe(OVERHEAD_AND_PROFIT_NOT_SET);
  });

  it("leaves the total equal to the subtotal", () => {
    expect(block.total.toFixed(2)).toBe("10000.00");
  });
});

describe("a rate nobody has set", () => {
  const block = overheadAndProfitBlock(d("10000.00"), null);

  it("has NO amount — not an amount of zero", () => {
    expect(block.isSet).toBe(false);
    expect(block.percent).toBeNull();
    expect(block.amount).toBeNull();
  });

  it("is excluded from the total rather than added as zero", () => {
    // Same number as the 0% case above, and a different claim. What
    // distinguishes them is the two assertions either side of this one, not
    // this one.
    expect(block.total.toFixed(2)).toBe("10000.00");
    expect(block.total.equals(block.subtotal)).toBe(true);
  });

  it("reads as NOT SET everywhere it prints", () => {
    expect(formatOverheadAndProfitPercent(null)).toBe("Not set");
    expect(formatOverheadAndProfitAmount(block)).toBe("Not set");
    // Never a dollar sign, on any surface, for a rate nobody recorded.
    expect(formatOverheadAndProfitAmount(block)).not.toContain("$");
    // And the label does not invent a rate to put in brackets.
    expect(overheadAndProfitLineLabel(null)).toBe("Overhead and profit");
  });

  it("treats undefined the same as null — a field that was never selected", () => {
    const undef = overheadAndProfitBlock(d("10000.00"), undefined);
    expect(undef.isSet).toBe(false);
    expect(undef.amount).toBeNull();
    expect(formatOverheadAndProfitAmount(undef)).toBe("Not set");
  });
});

describe("the two cases are distinguishable from the block alone", () => {
  /* The regression this whole file exists for. Both totals are $10,000.00.
     Anything downstream that renders the block must be able to tell them
     apart WITHOUT re-reading the database, or it will print $0.00 for a
     company that has simply never been asked. */
  const unset = overheadAndProfitBlock(d("10000.00"), null);
  const zero = overheadAndProfitBlock(d("10000.00"), d("0"));

  it("agree on the total and disagree on everything else", () => {
    expect(unset.total.toFixed(2)).toBe(zero.total.toFixed(2));

    expect(unset.isSet).not.toBe(zero.isSet);
    expect(unset.amount).toBeNull();
    expect(zero.amount).not.toBeNull();
    expect(formatOverheadAndProfitAmount(unset)).not.toBe(formatOverheadAndProfitAmount(zero));
    expect(overheadAndProfitLineLabel(unset.percent)).not.toBe(
      overheadAndProfitLineLabel(zero.percent),
    );
  });
});

describe("formatting a stored rate", () => {
  it("drops the trailing zeros Decimal(5,2) stores", () => {
    expect(formatOverheadAndProfitPercent(d("15.00"))).toBe("15%");
    expect(formatOverheadAndProfitPercent(d("12.50"))).toBe("12.5%");
    expect(formatOverheadAndProfitPercent(d("7.25"))).toBe("7.25%");
    expect(formatOverheadAndProfitPercent(d("0.00"))).toBe("0%");
  });

  it("names the change order on the line item an approval creates", () => {
    expect(overheadAndProfitLineDescription(3, d("15.00"))).toBe(
      "Overhead and profit (15%) — CO #3",
    );
  });
});

describe("reading a rate off a form", () => {
  it("treats blank as not set rather than as zero", () => {
    expect(parseOverheadAndProfitPercent("")).toEqual({ ok: true, value: null });
    expect(parseOverheadAndProfitPercent("   ")).toEqual({ ok: true, value: null });
  });

  it("keeps an explicit zero as an explicit zero", () => {
    expect(parseOverheadAndProfitPercent("0")).toEqual({ ok: true, value: "0" });
  });

  it("accepts a rate typed with its percent sign", () => {
    expect(parseOverheadAndProfitPercent("15%")).toEqual({ ok: true, value: "15" });
    expect(parseOverheadAndProfitPercent(" 12.5 ")).toEqual({ ok: true, value: "12.5" });
  });

  it("refuses what is not a number, and says what blank means", () => {
    const result = parseOverheadAndProfitPercent("fifteen");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/not set/);
  });

  it("refuses a negative rate", () => {
    const result = parseOverheadAndProfitPercent("-5");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/cannot be negative/);
  });

  it("refuses a rate above 100, which is a mistyped decimal", () => {
    const result = parseOverheadAndProfitPercent("1500");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/15 for 15%/);
  });

  it("refuses a bare percent sign rather than reading it as zero", () => {
    expect(parseOverheadAndProfitPercent("%").ok).toBe(false);
  });
});
