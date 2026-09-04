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
  /** SUM(materialsStoredValue) from every earlier invoice on this job for
   * this line item. materialsStoredValue is a per-period delta -- what got
   * newly stored (or, entered negative, what got released into billed work)
   * that period -- not a running balance, so the running "materials stored
   * to date" figure has to be summed here the same way previousBilled is.
   * Dropping this was the exact bug a materials-stored line disappeared
   * into on its second pay application: the total looked right for one
   * period and silently lost the earlier stored value on the next. */
  previousMaterialsStored: number;
  materialsStoredValue: number;
}

export interface PayAppLineItemResult extends PayAppLineItemInput {
  /** previousMaterialsStored + materialsStoredValue -- the running stored
   * balance as of this invoice, not just what was entered this period. */
  materialsStoredToDate: number;
  totalCompletedAndStoredToDate: number;
  /** Null when scheduledValue is 0 -- nothing to divide by. */
  percentOfScheduledValue: number | null;
  balanceToFinish: number;
}

export function calculatePayAppLineItem(input: PayAppLineItemInput): PayAppLineItemResult {
  const materialsStoredToDate = input.previousMaterialsStored + input.materialsStoredValue;
  const totalCompletedAndStoredToDate = input.previousBilled + input.thisPeriodBilled + materialsStoredToDate;
  const percentOfScheduledValue =
    input.scheduledValue > 0 ? totalCompletedAndStoredToDate / input.scheduledValue : null;
  const balanceToFinish = input.scheduledValue - totalCompletedAndStoredToDate;

  return {
    ...input,
    materialsStoredToDate,
    totalCompletedAndStoredToDate,
    percentOfScheduledValue,
    balanceToFinish,
  };
}

/** Decimal(12,2) round-tripped through JS numbers: tolerate half a cent so
 * a legitimate exactly-100% entry is not refused by floating-point dust. */
const CENT_TOLERANCE = 0.005;

const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Write-time refusal for one submitted continuation-sheet row. Returns the
 * message to show the person entering it, or null if the entry is fine.
 *
 * Lives here, beside the arithmetic it is derived from, so the refusal and
 * the displayed figures can never disagree. It is deliberately NOT thrown
 * from `calculatePayAppLineItem`: rows already in the database include ones
 * already sent to a GC, and the report page has to keep rendering them
 * whatever they say. The only caller is `submitPayApplication`, which
 * refuses the whole application rather than accepting it in part — a
 * partially-applied pay app is a worse artifact than a rejected one.
 *
 * WHAT THIS DOES NOT DO, because a cap is not a double-bill detector: it
 * catches an entry that drives a line past its scheduled value, which is
 * #95's reproduction, and it catches releasing stored material that was
 * never stored. It cannot catch the same double-count BELOW 100% — store
 * $40k on a $100k line, then bill $50k of installed work without the
 * offsetting negative, and the line reads $90,000 with no refusal
 * anywhere. Nothing in the data distinguishes that from legitimately
 * billing $50k of other work. The defence against that one is the running
 * stored-to-date figure shown beside the input, so the person entering it
 * can see what is sitting there.
 */
export function payAppEntryError(input: PayAppLineItemInput): string | null {
  if (input.thisPeriodBilled < 0) {
    return (
      `${input.description}: this period's billed amount cannot be negative. ` +
      `To move value out of stored materials once they are installed, enter the negative ` +
      `under new materials stored and the same amount as a positive here.`
    );
  }

  const { materialsStoredToDate, totalCompletedAndStoredToDate } = calculatePayAppLineItem(input);

  if (materialsStoredToDate < -CENT_TOLERANCE) {
    return (
      `${input.description}: releasing ${usd(-input.materialsStoredValue)} of stored materials would leave ` +
      `${usd(materialsStoredToDate)} stored to date — more than has ever been stored on this line ` +
      `(${usd(input.previousMaterialsStored)}).`
    );
  }

  // scheduledValue > 0 is load-bearing. unitPrice is nullable and a
  // cost-only or GC-furnished line legitimately has no contract value, the
  // same "nothing to divide by" case that already makes
  // percentOfScheduledValue null. Without this condition every unpriced
  // line becomes unbillable.
  if (input.scheduledValue > 0 && totalCompletedAndStoredToDate > input.scheduledValue + CENT_TOLERANCE) {
    return (
      `${input.description}: completed and stored to date would be ${usd(totalCompletedAndStoredToDate)} ` +
      `against a scheduled value of ${usd(input.scheduledValue)}. If the stored materials on this line ` +
      `have now been installed, enter the same amount as a NEGATIVE under new materials stored. If the ` +
      `extra work is real, it needs an approved change order raising this line first.`
    );
  }

  return null;
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
    (sum, item) => sum + item.previousBilled + item.previousMaterialsStored,
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
