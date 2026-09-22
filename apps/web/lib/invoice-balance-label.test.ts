import { describe, expect, it } from "vitest";
import { invoiceBalanceLabel } from "./invoice-balance-label";
import { money } from "./money";
import { arBalanceFor } from "./cash-flow";

/**
 * The reproduction, on the two pages that computed `amount - paid` inline:
 * the job billing tab and — the one that matters most — the GC's portal.
 *
 * $100,000 invoiced, $10,000 retainage, $90,000 paid. The GC owes nothing
 * today. Both pages printed an amber `Balance $10,000.00`, uncaptioned, to
 * the sub AND to his GC, with the log-a-payment form open beneath it on
 * the sub's side.
 */
const label = (over: Partial<Parameters<typeof invoiceBalanceLabel>[0]> = {}) =>
  invoiceBalanceLabel({
    amount: 100_000,
    paidAmount: 90_000,
    retainageWithheld: 10_000,
    format: money,
    ...over,
  });

describe("invoiceBalanceLabel", () => {
  it("does not call a settled-net invoice a balance owing", () => {
    const result = label();
    expect(result.tone).toBe("retainage-only");
    expect(result.headline).toBe("$10,000.00 retainage");
    expect(result.caption).toContain("not due until substantial completion");
    // The word that made it read as a debt.
    expect(result.headline).not.toContain("Balance");
  });

  it("captions a genuine balance with the retainage netted out of it", () => {
    // $85,000 paid: the GC is $5,000 late, and $10,000 more is held back.
    // Both figures have to be on screen or the $15,000 gap is unexplained.
    const result = label({ paidAmount: 85_000 });
    expect(result.tone).toBe("owing");
    expect(result.headline).toBe("Balance $5,000.00");
    expect(result.caption).toContain("$10,000.00");
    expect(result.caption).toContain("not due until substantial completion");
  });

  it("says nothing about retainage on a contract that has no clause", () => {
    const result = label({ paidAmount: 40_000, retainageWithheld: null });
    expect(result.tone).toBe("owing");
    expect(result.headline).toBe("Balance $60,000.00");
    expect(result.caption).toBeNull();
  });

  it("calls a fully collected invoice paid in full, retainage and all", () => {
    const result = label({ paidAmount: 100_000 });
    expect(result.tone).toBe("settled");
    expect(result.headline).toBe("Paid in full");
    expect(result.caption).toContain("released and paid");
  });

  it("prints a net and a gross that differ by exactly the retainage, at every cent", () => {
    // The property a bookkeeper checks with a calculator, swept rather
    // than sampled: whatever this says is owed, plus whatever it says is
    // held back, must come to what is unpaid on the invoice.
    for (let cents = 100_000; cents <= 100_500; cents += 1) {
      const amount = cents / 100;
      const retainageWithheld = Math.round(amount * 10) / 100; // 10%, half-up
      const paidAmount = 100;
      const result = invoiceBalanceLabel({ amount, paidAmount, retainageWithheld, format: money });
      const shown = Number((result.headline.match(/\$([\d,]+\.\d{2})/) as string[])[1].replace(/,/g, ""));
      const unpaid = Math.round(amount * 100 - paidAmount * 100);
      expect(Math.round(shown * 100) + Math.round(retainageWithheld * 100)).toBe(unpaid);
    }
  });

  it("takes its figures from arBalanceFor rather than growing a third formula", () => {
    // HONEST ABOUT WHAT THIS BUYS, because the first version of this test
    // claimed more than it could show. A float subtraction of two
    // Decimal(12,2) values is wrong by about 1e-13, which `money()` rounds
    // away and the 0.005 threshold below absorbs — so no INPUT this app
    // can produce makes the two routes print different text, and a test
    // asserting otherwise passes for the wrong reason (mutation-checked:
    // swapping arBalanceFor for `amount - retainage - paid` leaves every
    // test in this file green).
    //
    // The reason to import it anyway is #409's actual finding: the cost of
    // a second formula is not that it is wrong today, it is that it drifts
    // from the first one. /cash-flow, the Today tile, the Ask tool and now
    // these two pages all answer "what does the GC owe" with ONE function.
    // What this test pins is that identity, which a refactor CAN break.
    const input = { amount: 1_000.35, paidAmount: 100.04, retainageWithheld: 100.04 };
    expect(invoiceBalanceLabel({ ...input, format: money }).headline).toBe(
      `Balance ${money(arBalanceFor(input))}`,
    );
  });

  it("does not report a rounding cent as an amount owing", () => {
    const result = label({ amount: 0.004, paidAmount: 0, retainageWithheld: null });
    expect(result.tone).toBe("settled");
  });
});
