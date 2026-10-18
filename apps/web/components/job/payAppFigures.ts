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

/** The Billing summary's "Start pay app #N" links here. PayApplications.tsx
 * listens for it, opens its form and puts the cursor in it. It used to be a
 * plain `#pay-applications` jump that only scrolled to a CLOSED form, under
 * a button promising to start one. In this pure module so the server
 * summary and the client form read one string. */
export const NEW_PAY_APP_HASH = "#new-pay-application";

/** The summary's yellow button, said for where the pay app actually is
 * (InvoiceStatus). It read "Review & send to {GC}" on a PAID application,
 * which invites sending the GC a bill they have already paid. */
export function payAppPrimaryLabel(status: string, number: number, gcName: string): string {
  switch (status) {
    case "SUBMITTED":
      return `Review & send to ${gcName}`;
    case "PAID":
      return `View paid pay app #${number}`;
    case "DISPUTED":
      return "Review dispute";
    default: // APPROVED, PARTIALLY_PAID: with the GC, waiting on money.
      return `View pay app #${number}`;
  }
}

/** "October", or "October 2025" when the application is from another year
 * than the reader's today — a January screen should not show last
 * December's pay app as if it were this one. `asOf` is `viewerAsOf()`: the
 * reader's calendar day at UTC midnight. */
export function payAppMonth(issuedAt: Date, timeZone: string, asOf: Date): string {
  const year = Number(issuedAt.toLocaleDateString("en-US", { year: "numeric", timeZone }));
  return issuedAt.toLocaleDateString("en-US", {
    month: "long",
    ...(year === asOf.getUTCFullYear() ? {} : { year: "numeric" }),
    timeZone,
  });
}
