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
 * ── TWO CASES THIS DOES NOT HANDLE, AND #434 DOES ───────────────────
 *
 * OPEN COLLISION, written here rather than only in a PR body because a PR
 * body is not where the next person reads. **#434
 * (`cyrus/catalog-owner-credit-payapp`) adds `lib/billing/invoice-balance.ts`,
 * which owns the same two lines on the same two pages as this module.**
 * Neither is complete alone, and each gets the other's case wrong —
 * verified by execution, not by reading:
 *
 *   - THIS module answers "Paid in full", in green, for a NEGATIVE-amount
 *     credit (`amount: -5000, paid: 0`) and for an OVERPAYMENT
 *     (`amount: 1000, paid: 1200`). Both are #434's headline defect, and
 *     one of the two pages is the GC portal.
 *   - #434's module computes a gross `amount - paid`, so a settled-net
 *     invoice is an uncaptioned amber "Balance $10,000.00" — the defect
 *     this module exists to fix.
 *
 * **Whichever merges second must FOLD, not replace.** The combined order
 * is: credit (decided by the AMOUNT, before any balance is read — #434's
 * ordering is load-bearing and its reasoning should be read at the source),
 * then overpayment, then this module's settled / retainage-only / owing
 * split, with the retainage caption surviving on all three of the latter.
 * Resolving this by keeping one file and deleting the other re-opens
 * whichever defect that file does not cover.
 *
 * NO FLOAT SUBTRACTION HAPPENS HERE. Both figures come out of
 * `arBalanceFor`, which works in integer cents — the gross one by asking
 * it the same question with the retainage removed, rather than by adding
 * a second formula that can round differently from the first. CLAUDE.md,
 * and #409's two-wrong-formulas finding.
 */
export type InvoiceBalanceLabel = {
  tone: "settled" | "owing" | "retainage-only";
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
  const net = arBalanceFor({ amount, paidAmount, retainageWithheld });
  const gross = arBalanceFor({ amount, paidAmount, retainageWithheld: null });

  // A rounding cent is not a debt. Same threshold the receivables tile
  // filters on.
  const owing = net > 0.005;
  const anythingLeft = gross > 0.005;

  const heldBack = retainageWithheld === null ? null : format(retainageWithheld);

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
