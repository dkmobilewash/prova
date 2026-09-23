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
//
// RETAINAGE IS NOT RECEIVABLE, AND THIS FILE COUNTED IT AS BOTH — issue
// #288. `Invoice.amount` is GROSS and `Invoice.retainageWithheld` is the
// slice of it the GC is contractually entitled to hold back until
// substantial completion. The balance was `amount - paidAmount`, with no
// retainage term anywhere in the file, so a $100,000 invoice with $10,000
// retained and the GC paid to the penny of what was certified due left a
// $10,000 balance that aged 1-30, 31-60, 61-90 and 90+ as though they were
// late. They were not late. That money is not due yet.
//
// The same $10,000 is ALSO in the retainage receivable section of
// /cash-flow (`Invoice.retainageWithheld` summed per job, less releases),
// so the forecast's "AR expected + retainage expected" total counted those
// dollars twice. Both halves are one defect: the AR balance had no business
// containing retainage in the first place.
//
// WHAT THE FIX DOES NOT DO: it does not move money off the page. Retainage
// netted out of an aged balance is already reported in the retainage
// section, dated by substantial completion rather than by the invoice's due
// date. So the forecast's dollar total is unchanged where no invoice's net
// balance goes below zero — what changes is that each dollar is now in
// exactly one bucket, and in the one whose date says when it actually
// arrives.

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Whole cents. The AR balance is now a THREE-term subtraction of
 * Decimal(12,2) values round-tripped through JS numbers, and the boundary
 * (`<= 0` drops the invoice out of aging entirely) is exactly where float
 * dust decides whether a settled invoice quietly keeps ageing as overdue.
 * Same arithmetic and the same reason as `logPayment`'s ceiling in
 * lib/actions/billing.ts, so the two can never disagree about whether an
 * invoice is finished. */
function cents(value: number): number {
  return Math.round(value * 100);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export type ArAgingBucket = "CURRENT" | "DAYS_1_30" | "DAYS_31_60" | "DAYS_61_90" | "DAYS_90_PLUS";

export interface ArAgingInvoiceInput {
  invoiceId: string;
  jobId: string;
  jobName: string;
  contactName: string;
  /** Invoice.amount -- GROSS, retainage included. */
  amount: number;
  paidAmount: number;
  /** Invoice.retainageWithheld -- the slice of `amount` the GC holds back
   * until substantial completion, snapshotted on the invoice at creation.
   * Null when the job has no retainage rate, which is NOT the same claim as
   * zero and is why this is nullable: null means "no retainage terms",
   * 0 means "retainage terms that withheld nothing this period". Both
   * subtract nothing; keeping them distinct is what lets a caller say so. */
  retainageWithheld: number | null;
  issuedAt: Date;
  dueAt: Date | null;
  /** Contact.paymentTermsDays -- the fallback used to derive an effective
   * due date when the invoice itself has none set. */
  paymentTermsDays: number | null;
}

export interface ArAgingInvoiceResult extends ArAgingInvoiceInput {
  /** What the GC owes on this invoice NOW: gross, less retainage withheld,
   * less what has been paid. This is the figure that ages. */
  balance: number;
  /** `amount - paidAmount`, the old (and wrong) AR balance. Kept because
   * "what is still unbilled-to-cash on this invoice" is a real question —
   * it is just not the same question as "what is overdue". Nothing ages off
   * it. */
  grossBalance: number;
  /** How much of this invoice's retainage was taken out of `balance`.
   * Reported rather than absorbed: the house rule is to say what share of
   * the money a figure covers, and an aging table silently 10% lighter
   * than the invoices behind it is the kind of number that gets bid. */
  retainageExcluded: number;
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

/**
 * The date an invoice is actually due.
 *
 * EXPORTED because two pages implementing this rule separately is what
 * made the dashboard and the AR aging table disagree about which invoices
 * were overdue — twice. The first attempt copied the rule's shape and
 * missed that a GC with no stated terms is treated as due on issue, not
 * as having no due date. There is one implementation now.
 */
export function effectiveDueDateFor(input: {
  dueAt: Date | null;
  issuedAt: Date;
  paymentTermsDays: number | null;
}): Date {
  return input.dueAt ?? addDays(input.issuedAt, input.paymentTermsDays ?? 0);
}

/**
 * Whole days past due. Whole days, not instants — an invoice due today is
 * due today, all day. Comparing timestamps made the forecast call a
 * midnight-dated invoice overdue by lunchtime while the aging table on the
 * same page still called it current.
 *
 * `asOf` MUST BE A CALENDAR DAY AT UTC MIDNIGHT, not the current instant.
 * Both callers passed a raw `new Date()` and both were wrong the same way:
 * `dueDate` is a stored UTC midnight, so an instant later the same day
 * floors to 0 in the morning and to 1 after the UTC day rolls over. West
 * of UTC that is every evening — at 17:01 in Los Angeles an invoice due
 * today read "1d overdue", moved into the 1-30 bucket, flipped the
 * forecast row to Overdue, and put its whole balance on the dashboard's
 * Overdue invoices tile. Flooring the instant here would not fix it: that
 * is still the SERVER's day, which is already tomorrow. Use
 * `viewerAsOf()` (lib/viewerToday.ts) — the reader's calendar day, at UTC
 * midnight, so this subtraction is exact integer days.
 */
export function daysPastDueFor(dueDate: Date, asOf: Date): number {
  return Math.floor((asOf.getTime() - dueDate.getTime()) / MS_PER_DAY);
}

/** Overdue is the one predicate, used by the aging table, the forecast and
 * the dashboard alike. */
export function isOverdue(dueDate: Date, asOf: Date): boolean {
  return daysPastDueFor(dueDate, asOf) > 0;
}

/**
 * What the GC owes on this invoice right now.
 *
 * EXPORTED for the same reason `effectiveDueDateFor` is: this rule is read
 * by /cash-flow, the Today dashboard's receivables tile and two Ask tools,
 * and two of those surfaces disagreeing about which invoices are overdue is
 * a mistake this repo has already made twice with the due-date rule.
 *
 * NOT the same question as `logPayment`'s ceiling, which is deliberately
 * `amount - paidAmount` (gross) and stays that way: a GC is entitled to pay
 * retainage early, and an invoice ledger has to accept the cash that
 * arrives. "How much can still be logged against this invoice" is gross;
 * "how much is the GC late on" is net. See the note on logPayment.
 */
export function arBalanceFor(input: {
  amount: number;
  paidAmount: number;
  retainageWithheld: number | null;
}): number {
  return (cents(input.amount) - cents(input.retainageWithheld ?? 0) - cents(input.paidAmount)) / 100;
}

/** Null when nothing is currently due -- a fully paid invoice, and now also
 * one settled to its net-of-retainage amount, is not part of AR aging. */
export function calculateArAgingInvoice(input: ArAgingInvoiceInput, asOf: Date): ArAgingInvoiceResult | null {
  const balance = arBalanceFor(input);
  if (balance <= 0) return null;

  const effectiveDueDate = effectiveDueDateFor(input);
  const daysPastDue = daysPastDueFor(effectiveDueDate, asOf);

  return {
    ...input,
    balance,
    grossBalance: (cents(input.amount) - cents(input.paidAmount)) / 100,
    retainageExcluded: input.retainageWithheld ?? 0,
    effectiveDueDate,
    daysPastDue,
    bucket: bucketForDaysPastDue(daysPastDue),
  };
}

export interface ArAgingSummary {
  totalOutstanding: number;
  byBucket: Record<ArAgingBucket, number>;
  /** Retainage taken out of the aged balances above, across the invoices
   * that are still in the table. It is not missing money — it is reported
   * in the retainage receivable section, dated by substantial completion —
   * but a reader comparing this table against the invoices it came from
   * will otherwise find it short by exactly this much and have no way to
   * learn why. Same reasoning as `costCoverage` in lib/wip.ts. */
  retainageExcluded: number;
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
    retainageExcluded: invoices.reduce((sum, inv) => sum + inv.retainageExcluded, 0),
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
  /** Sum of the aged balances, NET of retainage -- see
   * `calculateArAgingInvoice`. Disjoint from `totalRetainageOutstanding` by
   * construction now: no dollar of retainage is in both, so
   * `arExpected + retainageExpected` is a real total rather than a
   * double-count. */
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
 * rather than extending the table indefinitely for a job scheduled years out.
 *
 * `asOf` is the reader's calendar day at UTC midnight — see
 * `daysPastDueFor`. It decides both the OVERDUE cut and which month the
 * window starts in, so on the last evening of a month the server's own
 * clock would also start the table in the wrong month. */
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
    // Past due is past due, whatever month it falls in — but "past due"
    // has to mean the same thing here as in the aging table above, or this
    // page contradicts itself. It did, twice: first by filing a two-day-old
    // invoice under the current month, then by calling a due-TODAY invoice
    // overdue while the aging table called it current. One predicate now.
    if (isOverdue(date, asOf) || date < asOfMonthStart) return months[0];
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
