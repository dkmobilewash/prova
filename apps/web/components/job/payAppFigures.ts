import type { PayAppLineItemResult, PayAppSummaryResult } from "@/lib/pay-application";

/**
 * The Billing stage's summary of ONE pay application, read straight off the
 * certificate `assemblePayApplication` builds for it — the same G702/G703
 * the "Review" page prints. Nothing here re-derives money from invoices;
 * every figure is a field of that certificate or a difference of two of
 * them, so the summary and the document a GC receives cannot disagree.
 */
export type PayAppFigures = {
  contractSum: number;
  /** Completed and stored on earlier applications (G703 D + earlier F). */
  billedBefore: number;
  /** Completed and stored on THIS application. */
  thisPeriod: number;
  /** Not yet completed or stored — G703 column I summed. */
  left: number;
  retainageHeld: number;
  /** G702 line 8, current payment due. */
  youllBePaid: number;
};

export function payAppFigures(assembly: {
  lineItems: PayAppLineItemResult[];
  summary: PayAppSummaryResult;
}): PayAppFigures {
  const { summary } = assembly;
  const billedBefore = assembly.lineItems.reduce(
    (sum, row) => sum + row.previousBilled + row.previousMaterialsStored,
    0,
  );
  return {
    contractSum: summary.contractSumToDate,
    billedBefore,
    thisPeriod: summary.totalCompletedAndStoredToDate - billedBefore,
    left: summary.contractSumToDate - summary.totalCompletedAndStoredToDate,
    retainageHeld: summary.retainageToDate,
    youllBePaid: summary.currentPaymentDue,
  };
}

/** Bar segment widths in percent, each clamped to 0–100 so a negative
 * correction period or an over-billed line cannot draw outside the bar. */
export function payAppBar(f: PayAppFigures): { before: number; thisPeriod: number } {
  if (f.contractSum <= 0) return { before: 0, thisPeriod: 0 };
  const pct = (n: number) => Math.min(100, Math.max(0, (n / f.contractSum) * 100));
  const before = pct(f.billedBefore);
  return { before, thisPeriod: Math.min(100 - before, pct(f.thisPeriod)) };
}
