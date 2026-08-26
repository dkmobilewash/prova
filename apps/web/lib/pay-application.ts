// AIA-style G702/G703 pay application math -- per-line continuation sheet
// figures and the job-level summary certificate. Pure arithmetic,
// deliberately not an LLM call, same reasoning as wip.ts and retainage.ts.
// Not a pixel-exact reproduction of the AIA G702/G703 forms -- the same
// scope decision as certified-payroll.ts: the real substance (scheduled
// value, billed to date, materials stored, retainage, balance to finish)
// without replicating the government/AIA form layout exactly.
//
// "Scheduled value" per line is the line's current contract value
// (quantity x unitPrice) -- already change-order-aware, since an approved
// change order mutates JobLineItem rows directly rather than living in a
// parallel table. See ARCHITECTURE.md.

export interface PayAppLineItemInput {
  lineItemId: string;
  description: string;
  scheduledValue: number;
  /** SUM(thisPeriodBilled) from every earlier invoice on this job for this
   * line item, chronologically before the invoice being viewed. */
  previousBilled: number;
  thisPeriodBilled: number;
  materialsStoredValue: number;
}

export interface PayAppLineItemResult extends PayAppLineItemInput {
  totalCompletedAndStoredToDate: number;
  /** Null when scheduledValue is 0 -- nothing to divide by. */
  percentOfScheduledValue: number | null;
  balanceToFinish: number;
}

export function calculatePayAppLineItem(input: PayAppLineItemInput): PayAppLineItemResult {
  const totalCompletedAndStoredToDate = input.previousBilled + input.thisPeriodBilled + input.materialsStoredValue;
  const percentOfScheduledValue =
    input.scheduledValue > 0 ? totalCompletedAndStoredToDate / input.scheduledValue : null;
  const balanceToFinish = input.scheduledValue - totalCompletedAndStoredToDate;

  return {
    ...input,
    totalCompletedAndStoredToDate,
    percentOfScheduledValue,
    balanceToFinish,
  };
}

export interface PayAppSummaryInput {
  lineItems: PayAppLineItemResult[];
  /** Job.retainagePercent, e.g. 10 for 10%. Null means no retainage. */
  retainagePercent: number | null;
  /** SUM(Invoice.retainageWithheld) across every earlier invoice on this
   * job, before the one being viewed. */
  previousRetainageWithheld: number;
  /** This invoice's own Invoice.retainageWithheld snapshot. */
  thisPeriodRetainageWithheld: number;
}

export interface PayAppSummaryResult {
  contractSumToDate: number;
  totalCompletedAndStoredToDate: number;
  retainageToDate: number;
  totalEarnedLessRetainage: number;
  previousCertificatesForPayment: number;
  currentPaymentDue: number;
  balanceToFinishIncludingRetainage: number;
}

export function calculatePayAppSummary(input: PayAppSummaryInput): PayAppSummaryResult {
  const contractSumToDate = input.lineItems.reduce((sum, item) => sum + item.scheduledValue, 0);
  const totalCompletedAndStoredToDate = input.lineItems.reduce(
    (sum, item) => sum + item.totalCompletedAndStoredToDate,
    0,
  );
  const retainageToDate = input.previousRetainageWithheld + input.thisPeriodRetainageWithheld;
  const totalEarnedLessRetainage = totalCompletedAndStoredToDate - retainageToDate;

  const previousTotalCompletedAndStored = input.lineItems.reduce(
    (sum, item) => sum + item.previousBilled,
    0,
  );
  const previousCertificatesForPayment = previousTotalCompletedAndStored - input.previousRetainageWithheld;

  const currentPaymentDue = totalEarnedLessRetainage - previousCertificatesForPayment;
  const balanceToFinishIncludingRetainage = contractSumToDate - totalEarnedLessRetainage;

  return {
    contractSumToDate,
    totalCompletedAndStoredToDate,
    retainageToDate,
    totalEarnedLessRetainage,
    previousCertificatesForPayment,
    currentPaymentDue,
    balanceToFinishIncludingRetainage,
  };
}
