import { arBalanceFor } from "./cash-flow";

/**
 * What one invoice's balance line says, and what colour it is.
 *
 * ONE FUNCTION FOR TWO PAGES, and the second of them is the GC's. The
 * job billing tab and `/portal/[token]/jobs/[jobId]` each computed
 * `Number(invoice.amount) - paid` inline and painted anything positive
 * amber with the word "Balance" beside it. On an invoice settled to its
 * net-of-retainage amount that is an amber figure the sub does not owe
 * and the GC has already paid — shown to both of them, with nothing
 * naming the retainage, and on the sub's side with the log-a-payment form
 * sitting open underneath it.
 *
 * "Balance" therefore means here what it means on /cash-flow and on the
 * Today receivables tile: `arBalanceFor`, net of retainage, because
 * retainage is not due until substantial completion. Three AR surfaces
 * quietly meaning two different things is the failure this repo has
 * already had twice over the due-date rule.
 *
 * WHAT IS NOT CHANGED: `logPayment`'s ceiling stays GROSS
 * (`amount - paidAmount`), deliberately — a GC is entitled to pay
 * retainage early and the ledger has to accept the cash that arrives. See
 * the note on `arBalanceFor`. This module decides what a line SAYS; it
 * decides nothing about what may be recorded.
 *
 * ── THE FOLD: #431 AND #434 WERE ONE DECISION WRITTEN TWICE ─────────
 *
 * #434 (`cyrus/catalog-owner-credit-payapp`) arrived with its own module,
 * `lib/billing/invoice-balance.ts`, owning the same line on the same two
 * pages. Each got the other's case wrong, verified by execution: this
 * module called a NEGATIVE-amount credit and an OVERPAYMENT "Paid in full",
 * in green, on the GC portal; #434's computed a gross `amount - paid` and
 * painted a settled-net invoice as an uncaptioned amber balance. They were
 * folded into this file, in this order, and the order is the design:
 *
 *   1. CREDIT, decided by the AMOUNT before any balance is read. A credit
 *      with no payment against it has a balance equal to its (negative)
 *      amount, so a balance-first reading files it under settled — or,
 *      with a payment recorded against it, under overpaid, which is the
 *      wrong sentence about the wrong document. #434's reasoning.
 *   2. OVERPAID, when the GROSS unpaid amount (retainage included) is
 *      below zero: cash received beyond everything billed. Not an error and
 *      not paid in full — somebody has to decide whether it is applied
 *      elsewhere or returned, and that starts with seeing it.
 *   3. This module's own settled / retainage-only / owing split, with the
 *      retainage caption on each.
 *
 * Neither credit nor overpaid is "settled", so neither can be green, and
 * the billing tab offers the log-a-payment form only on `owing` and
 * `retainage-only` — a GC does not pay a credit, and more cash is the
 * wrong answer to an overpayment.
 *
 * NO FLOAT SUBTRACTION HAPPENS HERE. Both figures come out of
 * `arBalanceFor`, which works in integer cents — the gross one by asking
 * it the same question with the retainage removed, rather than by adding
 * a second formula that can round differently from the first. CLAUDE.md,
 * and #409's two-wrong-formulas finding.
 */
export type InvoiceBalanceLabel = {
  tone: "credit" | "overpaid" | "settled" | "owing" | "retainage-only";
  /** The sentence that replaces the old `Balance $x` / `Paid in full`. */
  headline: string;
  /** Null when there is nothing to explain — i.e. no retainage clause. */
  caption: string | null;
};

/** The colour, shared so the sub's page and the GC's cannot drift apart
 * on what amber means. `retainage-only` is deliberately neither: it is
 * not money anyone is late on, and it is not "paid in full" either. */
export const balanceToneClass: Record<InvoiceBalanceLabel["tone"], string> = {
  settled: "text-green-400",
  owing: "text-amber-400",
  "retainage-only": "text-ink-body",
  // Amber like `owing`: both want somebody to act, and neither may borrow
  // the green that `settled` alone is allowed.
  credit: "text-amber-400",
  overpaid: "text-amber-400",
};

export function invoiceBalanceLabel(input: {
  amount: number;
  paidAmount: number;
  retainageWithheld: number | null;
  /** How the caller formats money; `lib/money.ts` in both pages. Passed in
   * so this module stays free of presentation and the test can read plain
   * numbers out of the strings it builds. */
  format: (value: number) => string;
}): InvoiceBalanceLabel {
  const { amount, paidAmount, retainageWithheld, format } = input;

  // 1. Credit — off the amount, before any balance exists to mislead.
  if (amount < -0.005) {
    return {
      tone: "credit",
      headline: `Credit — ${format(-amount)} owed back`,
      caption: null,
    };
  }

  const net = arBalanceFor({ amount, paidAmount, retainageWithheld });
  const gross = arBalanceFor({ amount, paidAmount, retainageWithheld: null });

  // A rounding cent is not a debt. Same threshold the receivables tile
  // filters on.
  const owing = net > 0.005;
  const anythingLeft = gross > 0.005;

  const heldBack = retainageWithheld === null ? null : format(retainageWithheld);

  // 2. Overpaid — more cash than everything billed, retainage included.
  if (gross < -0.005) {
    return {
      tone: "overpaid",
      headline: `Overpaid by ${format(-gross)}`,
      caption: null,
    };
  }

  if (!anythingLeft) {
    return {
      tone: "settled",
      headline: "Paid in full",
      caption:
        heldBack === null
          ? null
          : `Including ${heldBack} retainage, which has been released and paid.`,
    };
  }

  if (!owing) {
    // The settled-net invoice. Everything currently due has been paid and
    // what is left is retainage. This used to be an amber "Balance".
    return {
      tone: "retainage-only",
      headline: `${format(gross)} retainage`,
      caption:
        "Paid in full apart from retainage, which is not due until substantial completion.",
    };
  }

  return {
    tone: "owing",
    headline: `Balance ${format(net)}`,
    caption:
      heldBack === null
        ? null
        : `Net of ${heldBack} retainage, which is not due until substantial completion.`,
  };
}
