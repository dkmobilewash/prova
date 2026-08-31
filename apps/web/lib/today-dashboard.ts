import { prisma } from "@prova/db";
import { calculateJobWip, calculateLineItemWip, type WipJobResult } from "./wip";
import { calculateRetainageSummary } from "./retainage";
import { calculatePaymentReliability, type PaymentReliability } from "./gc-reliability";
import { daysPastDueFor, effectiveDueDateFor } from "./cash-flow";
import { jobHealthSentence, jobIsOverBudget } from "./company-financials";

/**
 * Everything the "Today" screen puts in front of an owner on login.
 *
 * Every figure here already existed somewhere in the data model and
 * nothing surfaced it without being asked — an overdue invoice was
 * visible if you opened that job, a job trending over budget if you
 * opened that job's WIP. This asks all of those questions once, on load.
 *
 * Nothing is stored. Every number below is derived on read from Invoice,
 * Payment, CostEntry and JobLineItem, exactly as lib/wip.ts already does,
 * and exactly as ARCHITECTURE.md requires — no Job.isOverBudget column,
 * no cached overdue total.
 */

export type OverdueInvoice = {
  id: string;
  jobId: string;
  jobName: string;
  gcName: string;
  number: number;
  amount: number;
  paid: number;
  outstanding: number;
  dueOn: string | null;
  /** True when the date came from the GC's payment terms rather than the
   * invoice. Worth showing: "net 30 from issue" is an inference, and a
   * bookkeeper should be able to tell it from an agreed date. */
  dueIsDerived: boolean;
  daysOverdue: number;
};

export type JobHealthRow = {
  jobId: string;
  name: string;
  gcName: string;
  tone: "over" | "watch" | "fine" | "unknown";
  sentence: string;
  wip: WipJobResult;
};

export type CrewRow = {
  jobId: string;
  name: string;
  gcName: string;
  crew: string[];
};

export type GcReliabilityRow = {
  contactId: string;
  name: string;
  reliability: PaymentReliability;
};


export async function loadTodayDashboard(companyId: string, now: Date) {
  const [invoices, activeJobs, contacts] = await Promise.all([
    prisma.invoice.findMany({
      where: { job: { companyId } },
      select: {
        id: true,
        number: true,
        amount: true,
        dueAt: true,
        issuedAt: true,
        jobId: true,
        job: {
          select: {
            name: true,
            // The GC's stated terms. An invoice with no explicit due date
            // is still due — net-30 from issue — and treating it as
            // "no due date" is what made this page disagree with
            // /cash-flow about which invoices were overdue.
            contact: { select: { id: true, name: true, paymentTermsDays: true } },
          },
        },
        payments: { select: { amount: true, receivedAt: true } },
      },
      orderBy: { issuedAt: "desc" },
    }),
    prisma.job.findMany({
      where: { companyId, status: { in: ["CONTRACTED", "IN_PROGRESS"] } },
      select: {
        id: true,
        name: true,
        status: true,
        substantialCompletionDate: true,
        contact: { select: { name: true } },
        assignments: { select: { user: { select: { name: true, email: true } } } },
        lineItems: {
          where: { isDeleted: false },
          select: {
            quantity: true,
            unitPrice: true,
            budgetedUnitCost: true,
            currentEstimatedUnitCost: true,
            estimatedCostToComplete: true,
            costEntries: { select: { amount: true } },
          },
        },
        invoices: { select: { amount: true, retainageWithheld: true } },
        retainageReleases: { select: { amount: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.contact.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        jobs: {
          select: {
            invoices: {
              select: {
                amount: true,
                issuedAt: true,
                dueAt: true,
                payments: { select: { amount: true, receivedAt: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  /* -------------------------------------------------- receivables ---- */

  const withOutstanding = invoices
    .map((invoice) => {
      const amount = Number(invoice.amount);
      const paid = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      return { invoice, amount, paid, outstanding: amount - paid };
    })
    // A rounding cent should not appear as an unpaid invoice.
    .filter((row) => row.outstanding > 0.005);

  const receivables: OverdueInvoice[] = withOutstanding.map((row) => {
    // Same rule as calculateArAgingInvoice in lib/cash-flow.ts: an
    // explicit due date if there is one, otherwise the GC's payment terms
    // from the issue date. Browser testing caught these two pages
    // disagreeing about which invoices were overdue — this page said one,
    // /cash-flow said three — because this one read only the stored date
    // and called the rest "no due date". Both now derive it the same way,
    // and there is one rule rather than two.
    // The SAME function the AR aging table uses. Mirroring the rule by
    // hand is what let these two pages disagree twice — the copy missed
    // that a GC with no stated terms is treated as due on issue rather
    // than as having no due date at all.
    const effectiveDue = effectiveDueDateFor({
      dueAt: row.invoice.dueAt,
      issuedAt: row.invoice.issuedAt,
      paymentTermsDays: row.invoice.job.contact.paymentTermsDays,
    });
    return {
      id: row.invoice.id,
      jobId: row.invoice.jobId,
      jobName: row.invoice.job.name,
      gcName: row.invoice.job.contact.name,
      number: row.invoice.number,
      amount: row.amount,
      paid: row.paid,
      outstanding: row.outstanding,
      dueOn: effectiveDue.toISOString().slice(0, 10),
      // Derived rather than stored, so the row says "due in 4 days" where
      // it used to say "no due date" for an invoice that was already late.
      dueIsDerived: row.invoice.dueAt === null,
      daysOverdue: Math.max(0, daysPastDueFor(effectiveDue, now)),
    };
  });

  const overdue = receivables
    .filter((row) => row.daysOverdue > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  /* --------------------------------------------------- job health ---- */

  const jobRows = activeJobs.map((job) => {
    const lineItems = job.lineItems.map((line) =>
      calculateLineItemWip({
        quantity: Number(line.quantity),
        unitPrice: line.unitPrice === null ? null : Number(line.unitPrice),
        budgetedUnitCost: line.budgetedUnitCost === null ? null : Number(line.budgetedUnitCost),
        currentEstimatedUnitCost:
          line.currentEstimatedUnitCost === null ? null : Number(line.currentEstimatedUnitCost),
        estimatedCostToComplete:
          line.estimatedCostToComplete === null ? null : Number(line.estimatedCostToComplete),
        actualCostToDate: line.costEntries.reduce((sum, cost) => sum + Number(cost.amount), 0),
      }),
    );
    const billed = job.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
    const wip = calculateJobWip(lineItems, billed);

    // What share of this job's contract value sits on lines that actually
    // carry a cost estimate. A job budgeted on one line out of seven is
    // not a job forecast to finish under budget; it is a job nobody has
    // finished estimating.
    const estimatedValue = lineItems
      .filter((line) => line.estimatedCostAtCompletion !== null)
      .reduce((sum, line) => sum + line.contractValue, 0);
    const estimatedCoverage =
      wip.contractValue > 0 ? estimatedValue / wip.contractValue : 0;

    const health = jobHealthSentence({ name: job.name, wip, estimatedCoverage });

    return {
      job,
      wip,
      row: {
        jobId: job.id,
        name: job.name,
        gcName: job.contact.name,
        tone: health.tone,
        sentence: health.sentence,
        wip,
      } satisfies JobHealthRow,
    };
  });

  // Worst first: a dashboard that lists healthy jobs above troubled ones
  // buries the reason to look at it.
  const TONE_ORDER = { over: 0, watch: 1, unknown: 2, fine: 3 } as const;
  const jobHealth: JobHealthRow[] = jobRows
    .map((entry) => entry.row)
    .sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.name.localeCompare(b.name));

  const jobsOverBudget = jobRows.filter((entry) => jobIsOverBudget(entry.wip) === true).length;

  /* ---------------------------------------------------- retainage ---- */

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const retainageReleasingThisMonth = jobRows.reduce((sum, entry) => {
    const completion = entry.job.substantialCompletionDate;
    if (!completion) return sum;
    if (completion < monthStart || completion >= nextMonthStart) return sum;
    const summary = calculateRetainageSummary({
      invoiceRetainageWithheld: entry.job.invoices.map((invoice) =>
        invoice.retainageWithheld === null ? null : Number(invoice.retainageWithheld),
      ),
      releaseAmounts: entry.job.retainageReleases.map((release) => Number(release.amount)),
      substantialCompletionDate: completion,
    });
    return sum + summary.balance;
  }, 0);

  /* -------------------------------------------------------- crews ---- */

  const crews: CrewRow[] = activeJobs
    .filter((job) => job.status === "IN_PROGRESS")
    .map((job) => ({
      jobId: job.id,
      name: job.name,
      gcName: job.contact.name,
      crew: job.assignments.map((a) => a.user.name ?? a.user.email),
    }));

  /* ----------------------------------------------- GC reliability ---- */

  const gcReliability: GcReliabilityRow[] = contacts
    .map((contact) => {
      const contactInvoices = contact.jobs.flatMap((job) =>
        job.invoices.map((invoice) => {
          const payments = invoice.payments;
          const lastPaymentAt = payments.reduce<Date | null>(
            (latest, payment) =>
              latest === null || payment.receivedAt > latest ? payment.receivedAt : latest,
            null,
          );
          return {
            amount: Number(invoice.amount),
            issuedAt: invoice.issuedAt,
            dueAt: invoice.dueAt,
            paidAmount: payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
            lastPaymentAt,
          };
        }),
      );
      return {
        contactId: contact.id,
        name: contact.name,
        reliability: calculatePaymentReliability(contactInvoices),
      };
    })
    // A GC with no invoices has no reliability to report, and a row saying
    // so is noise on a screen meant to be scanned.
    .filter((row) => row.reliability.invoiceCount > 0)
    .sort((a, b) => (a.reliability.onTimeRate ?? 1) - (b.reliability.onTimeRate ?? 1));

  return {
    receivables: receivables.sort((a, b) => b.daysOverdue - a.daysOverdue),
    overdue,
    overdueTotal: overdue.reduce((sum, row) => sum + row.outstanding, 0),
    jobHealth,
    jobsOverBudget,
    retainageReleasingThisMonth,
    crews,
    gcReliability,
  };
}

export type TodayDashboard = Awaited<ReturnType<typeof loadTodayDashboard>>;
