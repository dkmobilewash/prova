import { money } from "@/lib/money";

/**
 * What one invoice's money line says, and whether it may be green.
 *
 * WHY THIS IS A MODULE AND NOT A TERNARY. It was a ternary — twice, in two
 * files — and it read `balance <= 0 ? "Paid in full" : …`. That is correct
 * for every invoice this product could create until a pay application was
 * allowed to net negative, and then it is exactly backwards: a −$5,000.00
 * credit has a negative balance, so both pages announced it as PAID IN FULL,
 * in green, on the row whose amount was the credit. One of those pages is
 * the GC portal.
 *
 * `balance <= 0` conflates two different facts. "Nothing is outstanding"
 * and "this document is not a bill at all" both land below zero and mean
 * opposite things to the person reading the row.
 *
 * A CREDIT IS DECIDED BY THE AMOUNT, NOT THE BALANCE, and that ordering is
 * load-bearing: a credit with no payment against it has balance = amount,
 * so a balance-first reading would file it under "settled" before the
 * amount was ever consulted.
 *
 * `settled` is deliberately separate from `label`. The caller needs to know
 * whether to reach for the green, and inferring that from the words would
 * mean matching on a string.
 */

/** Decimal(12,2) round-tripped through JS numbers, same half-cent tolerance
 * the pay-application guards use: a balance of −0.000000001 is a paid
 * invoice, not an overpayment. */
const CENT_TOLERANCE = 0.005;

export interface InvoiceBalanceState {
  label: string;
  /** True only for an invoice that was a bill and is now fully paid — the
   * one case that may render as good news. */
  settled: boolean;
  /** `amount - paid`, carried so the caller has one source for the money
   * line AND for whether to offer "Log a payment". Two expressions for that
   * is how the row and the form come to disagree about the same invoice. */
  outstanding: number;
}

export function invoiceBalanceState(amount: number, paid: number): InvoiceBalanceState {
  const outstanding = amount - paid;

  if (amount < -CENT_TOLERANCE) {
    return { label: `Credit — ${money(-amount)} owed back`, settled: false, outstanding };
  }

  if (outstanding > CENT_TOLERANCE) {
    return { label: `Balance ${money(outstanding)}`, settled: false, outstanding };
  }
  if (outstanding < -CENT_TOLERANCE) {
    // Money received beyond what was billed. Not an error and not "paid in
    // full" either — somebody has to decide whether it is applied elsewhere
    // or returned, and that decision starts with seeing it.
    return { label: `Overpaid by ${money(-outstanding)}`, settled: false, outstanding };
  }
  return { label: "Paid in full", settled: true, outstanding };
}
