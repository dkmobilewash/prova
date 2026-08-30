// Company-wide cash flow forecast: AR aging on outstanding invoice
// balances, retainage receivable, and a forward monthly projection
// combining both. Pure arithmetic, deliberately not an LLM call, same
// reasoning as wip.ts and retainage.ts.
//
// Never invents a target date. An invoice ages off its due date, or, if
// none was set, the GC's stated payment terms (Contact.paymentTermsDays)
// applied to the issue date, or the issue date itself if no terms were
// ever recorded either -- "due on receipt" is the only defensible default
// when nothing else is known, not a guess. Retainage is expected around a
// job's substantial completion date; a job with no such date lands in an
// explicit "no target date" bucket rather than being assigned one.

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export type ArAgingBucket = "CURRENT" | "DAYS_1_30" | "DAYS_31_60" | "DAYS_61_90" | "DAYS_90_PLUS";

export interface ArAgingInvoiceInput {
  invoiceId: string;
  jobId: string;
  jobName: string;
  contactName: string;
  amount: number;
  paidAmount: number;
  issuedAt: Date;
  dueAt: Date | null;
  /** Contact.paymentTermsDays -- the fallback used to derive an effective
   * due date when the invoice itself has none set. */
  paymentTermsDays: number | null;
}

export interface ArAgingInvoiceResult extends ArAgingInvoiceInput {
  balance: number;
  effectiveDueDate: Date;
  daysPastDue: number;
  bucket: ArAgingBucket;
}

function bucketForDaysPastDue(daysPastDue: number): ArAgingBucket {
  if (daysPastDue <= 0) return "CURRENT";
  if (daysPastDue <= 30) return "DAYS_1_30";
  if (daysPastDue <= 60) return "DAYS_31_60";
  if (daysPastDue <= 90) return "DAYS_61_90";
  return "DAYS_90_PLUS";
}

/** Null when the invoice is fully paid -- it isn't part of AR aging. */
export function calculateArAgingInvoice(input: ArAgingInvoiceInput, asOf: Date): ArAgingInvoiceResult | null {
  const balance = input.amount - input.paidAmount;
  if (balance <= 0) return null;

  const effectiveDueDate = input.dueAt ?? addDays(input.issuedAt, input.paymentTermsDays ?? 0);
  const daysPastDue = Math.floor((asOf.getTime() - effectiveDueDate.getTime()) / MS_PER_DAY);

  return {
    ...input,
    balance,
    effectiveDueDate,
    daysPastDue,
    bucket: bucketForDaysPastDue(daysPastDue),
  };
}

export interface ArAgingSummary {
  totalOutstanding: number;
  byBucket: Record<ArAgingBucket, number>;
}

export function summarizeArAging(invoices: ArAgingInvoiceResult[]): ArAgingSummary {
  const byBucket: Record<ArAgingBucket, number> = {
    CURRENT: 0,
    DAYS_1_30: 0,
    DAYS_31_60: 0,
    DAYS_61_90: 0,
    DAYS_90_PLUS: 0,
  };
  for (const invoice of invoices) {
    byBucket[invoice.bucket] += invoice.balance;
  }
  return {
    totalOutstanding: invoices.reduce((sum, inv) => sum + inv.balance, 0),
    byBucket,
  };
}

export interface RetainageReceivableInput {
  jobId: string;
  jobName: string;
  outstandingBalance: number;
  substantialCompletionDate: Date | null;
}

export interface CashFlowForecastMonth {
  /** "YYYY-MM", or "OVERDUE" for target dates already in the past. */
  key: string;
  label: string;
  arExpected: number;
  retainageExpected: number;
}

export interface CashFlowForecastResult {
  months: CashFlowForecastMonth[];
  /** Retainage with no substantial completion date to anchor a forecast --
   * real money owed, just with no basis for when. */
  retainageNoTargetDate: number;
  totalArOutstanding: number;
  totalRetainageOutstanding: number;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** Builds a forward monthly forecast covering `monthsAhead` calendar months
 * from `asOf`, plus an "OVERDUE" bucket for anything already past its
 * target date. Buckets beyond the window collapse into the last month
 * rather than extending the table indefinitely for a job scheduled years out. */
export function calculateCashFlowForecast(
  arInvoices: ArAgingInvoiceResult[],
  retainage: RetainageReceivableInput[],
  asOf: Date,
  monthsAhead: number,
): CashFlowForecastResult {
  const asOfMonthStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const windowEnd = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + monthsAhead - 1, 1));

  const months: CashFlowForecastMonth[] = [{ key: "OVERDUE", label: "Overdue", arExpected: 0, retainageExpected: 0 }];
  for (let i = 0; i < monthsAhead; i++) {
    const monthStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + i, 1));
    months.push({ key: monthKey(monthStart), label: monthLabel(monthStart), arExpected: 0, retainageExpected: 0 });
  }

  function targetMonth(date: Date): CashFlowForecastMonth {
    // Past due is past due, whatever month it falls in. Bucketing only on
    // "before this month started" filed an invoice due on the 28th, read
    // on the 30th, under the current month rather than Overdue — so this
    // page's own forecast disagreed with its own aging table, which is
    // exactly the kind of thing that makes someone stop trusting both.
    if (date < asOf || date < asOfMonthStart) return months[0];
    const clamped = date > windowEnd ? windowEnd : date;
    const key = monthKey(clamped);
    return months.find((m) => m.key === key) ?? months[months.length - 1];
  }

  for (const invoice of arInvoices) {
    targetMonth(invoice.effectiveDueDate).arExpected += invoice.balance;
  }

  let retainageNoTargetDate = 0;
  for (const job of retainage) {
    if (job.outstandingBalance <= 0) continue;
    if (!job.substantialCompletionDate) {
      retainageNoTargetDate += job.outstandingBalance;
      continue;
    }
    targetMonth(job.substantialCompletionDate).retainageExpected += job.outstandingBalance;
  }

  return {
    months,
    retainageNoTargetDate,
    totalArOutstanding: arInvoices.reduce((sum, inv) => sum + inv.balance, 0),
    totalRetainageOutstanding: retainage.reduce((sum, job) => sum + Math.max(job.outstandingBalance, 0), 0),
  };
}
