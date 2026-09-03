import { prisma } from "@prova/db";
import {
  apprenticeRatioAlerts,
  backchargeAlerts,
  certifiedPayrollAlerts,
  closeoutAlerts,
  contactFollowUpAlerts,
  partitionAlerts,
  renewalAlert,
  visibleToPrincipal,
  retainageAlerts,
  wipAlerts,
  type Alert,
  type Acknowledgement,
  type PartitionedAlerts,
} from "@/lib/alerts";
import { renewalSourcesForCompany } from "@/lib/renewals";
import { renewalAlerts as rankRenewals } from "@/lib/compliance-expiry";
import { calculateRetainageSummary } from "@/lib/retainage";
import { calculateJobWip, calculateLineItemWip } from "@/lib/wip";
import { jobIsOverBudget } from "@/lib/company-financials";
import { weekStart } from "@/components/fieldReportWeeks";
import { can, type Principal } from "@/lib/permissions";
import { loadRatioReviews } from "@/lib/union-compliance-query";

/**
 * Every alert one company currently has, assembled from the rows that
 * already carry the facts.
 *
 * This module fetches and normalises; lib/alerts.ts decides. Same split as
 * renewals.ts (fetch) and compliance-expiry.ts (rank), and for the same
 * reason: the deciding half is where the bugs live and it has to be
 * testable without a database.
 *
 * Nothing here writes. An alert is never stored — the only row this
 * feature owns is AlertAcknowledgement, which records a person deciding
 * they have seen one. See notifications.prisma.
 */

function isoDate(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export async function loadAlerts(
  companyId: string,
  userId: string,
  todayIso: string,
  /** Whose list this is. An alert is a summary of the thing it points at,
   * so it needs the same permission that thing does — see
   * ALERT_CAPABILITY. Omitted means unrestricted, which is what an owner
   * and an unset member both get anyway. */
  principal: Principal = { role: "OWNER", jobFunction: null },
): Promise<PartitionedAlerts> {
  // The apprentice ratio for the month the date falls in. Ratios are
  // enforced per day, so this is a rolling look at the current month
  // rather than a window of our own choosing.
  const currentMonth = todayIso.slice(0, 7);

  const [renewalSources, backcharges, jobs, acknowledgements, ratioReviews, followUps] = await Promise.all([
    renewalSourcesForCompany(companyId),

    prisma.backcharge.findMany({
      where: { companyId, status: "RECEIVED", respondByDate: { not: null } },
      select: {
        id: true,
        number: true,
        status: true,
        claimedAmount: true,
        respondByDate: true,
        job: { select: { name: true } },
      },
    }),

    prisma.job.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        substantialCompletionDate: true,

        invoices: { select: { amount: true, retainageWithheld: true } },
        retainageReleases: { select: { amount: true } },

        closeoutSubmissions: {
          orderBy: { attempt: "desc" },
          take: 1,
          select: { status: true, submittedOn: true, respondedOn: true },
        },

        // Only jobs carrying a wage determination can raise a certified
        // payroll alert — see certifiedPayrollAlerts. Taking one row is
        // enough: this is a "does one exist" question.
        prevailingWageDeterminations: {
          take: 1,
          orderBy: { createdAt: "desc" },
          // The jurisdiction's own filing window, where it has been
          // recorded. Without it the alert falls back to its generic
          // horizon and says so.
          select: { id: true, ruleSet: { select: { filingDueDays: true } } },
        },
        timeEntries: { select: { date: true } },
        complianceDocuments: {
          where: { type: "CERTIFIED_PAYROLL" },
          select: { periodStart: true, periodEnd: true },
        },

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
      },
    }),

    prisma.alertAcknowledgement.findMany({
      where: { userId },
      // acknowledgedSeverity is part of the match, not decoration: an
      // acknowledgement only covers a situation no worse than the one it
      // was made about. Omit it here and partitionAlerts silently reads
      // every row as ACK_SEVERITY_WHEN_UNRECORDED. See issue #110.
      select: { alertKey: true, snoozedUntil: true, acknowledgedSeverity: true },
    }),

    loadRatioReviews(companyId, currentMonth),

    prisma.contactInteraction.findMany({
      where: { companyId, followUpOn: { not: null } },
      select: {
        id: true,
        followUpOn: true,
        contactId: true,
        contact: { select: { name: true } },
        followUpAssignedToUser: { select: { name: true, email: true } },
      },
    }),
  ]);

  const alerts: Alert[] = [];

  for (const renewal of rankRenewals(renewalSources, todayIso)) {
    alerts.push(renewalAlert(renewal));
  }

  alerts.push(
    ...backchargeAlerts(
      backcharges.map((bc) => ({
        id: bc.id,
        number: bc.number,
        jobName: bc.job.name,
        status: bc.status as string,
        claimedAmount: Number(bc.claimedAmount),
        respondByDate: isoDate(bc.respondByDate),
      })),
      todayIso,
    ),
  );

  const retainageSources = [];
  const closeoutSources = [];
  const payrollSources = [];
  const wipSources = [];

  for (const job of jobs) {
    const balance = calculateRetainageSummary({
      invoiceRetainageWithheld: job.invoices.map((i) =>
        i.retainageWithheld != null ? Number(i.retainageWithheld) : null,
      ),
      releaseAmounts: job.retainageReleases.map((r) => Number(r.amount)),
      substantialCompletionDate: job.substantialCompletionDate,
    }).balance;

    const latest = job.closeoutSubmissions[0] ?? null;

    retainageSources.push({
      jobId: job.id,
      jobName: job.name,
      balance,
      closeoutAcceptedOn:
        latest?.status === "ACCEPTED" ? isoDate(latest.respondedOn) : null,
      substantialCompletionDate: isoDate(job.substantialCompletionDate),
    });

    // Both unfinished states, not just SUBMITTED. CloseoutSubmissionStatus
    // has three values and this line read only one of them, so a package
    // the GC REJECTED raised nothing at all — the chase disappeared at the
    // moment the ball came back to us and the retainage stopped moving
    // (issue #111 item 3). ACCEPTED is still dropped here on purpose: it
    // is not a chase, and retainageAlerts above is what an accepted
    // package feeds.
    if (latest && (latest.status === "SUBMITTED" || latest.status === "REJECTED")) {
      closeoutSources.push({
        jobId: job.id,
        jobName: job.name,
        submittedOn: isoDate(latest.submittedOn) as string,
        retainageBalance: balance,
        status: latest.status,
        respondedOn: isoDate(latest.respondedOn),
      });
    }

    // Certified payroll, gated on a wage determination existing. A job
    // where nobody recorded one raises nothing: we do not know it is
    // prevailing-wage work, and guessing would train people to ignore the
    // list.
    if (job.prevailingWageDeterminations.length > 0) {
      const covered = job.complianceDocuments
        .filter((d) => d.periodStart && d.periodEnd)
        .map((d) => ({ start: isoDate(d.periodStart) as string, end: isoDate(d.periodEnd) as string }));

      const weeksWorked = new Set(
        job.timeEntries.map((entry) => weekStart(isoDate(entry.date) as string)),
      );

      for (const start of weeksWorked) {
        const end = addDays(start, 6);
        // Covered when a filed report's period contains the whole week.
        // A report whose period only clips the week is not evidence the
        // week was filed, and treating it as such would hide a real gap.
        const isCovered = covered.some((c) => c.start <= start && c.end >= end);
        if (!isCovered) {
          payrollSources.push({
            jobId: job.id,
            jobName: job.name,
            weekStart: start,
            weekEnd: end,
            filingDueDays: job.prevailingWageDeterminations[0]?.ruleSet?.filingDueDays ?? null,
          });
        }
      }
    }

    // WIP variance, through the same lib/wip.ts the job page renders from
    // — not a second forecast written here.
    if (job.lineItems.length > 0) {
      const lineItems = job.lineItems.map((item) =>
        calculateLineItemWip({
          quantity: Number(item.quantity),
          unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
          budgetedUnitCost: item.budgetedUnitCost != null ? Number(item.budgetedUnitCost) : null,
          currentEstimatedUnitCost:
            item.currentEstimatedUnitCost != null ? Number(item.currentEstimatedUnitCost) : null,
          estimatedCostToComplete:
            item.estimatedCostToComplete != null ? Number(item.estimatedCostToComplete) : null,
          actualCostToDate: item.costEntries.reduce((sum, e) => sum + Number(e.amount), 0),
        }),
      );
      const billedToDate = job.invoices.reduce((sum, i) => sum + Number(i.amount), 0);
      const wip = calculateJobWip(lineItems, billedToDate);

      // jobIsOverBudget already encodes when this question has an answer
      // at all — it returns null for a job with no forecast and for one
      // with no contract value, because calling either "over" or "under"
      // would be reporting on the absence of data. Reusing it rather than
      // re-deriving the threshold here keeps the alert and the dashboard's
      // Job health card from ever disagreeing about the same job.
      if (jobIsOverBudget(wip) === true) {
        wipSources.push({
          jobId: job.id,
          jobName: job.name,
          overrun: wip.estimatedCostAtCompletion - wip.contractValue,
        });
      }
    }
  }

  alerts.push(...retainageAlerts(retainageSources, todayIso));
  alerts.push(...closeoutAlerts(closeoutSources, todayIso));
  alerts.push(...certifiedPayrollAlerts(payrollSources, todayIso));
  alerts.push(
    ...apprenticeRatioAlerts(
      ratioReviews.map((review) => ({
        jobId: review.jobId,
        jobName: review.jobName,
        unionLocalLabel: review.unionLocalLabel,
        offendingDates: review.summary.offendingDates,
        worstExcessHours: review.summary.worstExcessHours,
      })),
    ),
  );
  alerts.push(...wipAlerts(wipSources));
  alerts.push(
    ...contactFollowUpAlerts(
      followUps.map((f) => ({
        interactionId: f.id,
        contactId: f.contactId,
        contactName: f.contact.name,
        followUpOn: isoDate(f.followUpOn) as string,
        assignedToName: f.followUpAssignedToUser?.name ?? f.followUpAssignedToUser?.email ?? null,
      })),
      todayIso,
    ),
  );

  const permitted = visibleToPrincipal(alerts, (capability) => can(principal, capability));

  const acks: Acknowledgement[] = acknowledgements.map((a) => ({
    alertKey: a.alertKey,
    snoozedUntil: isoDate(a.snoozedUntil),
    acknowledgedSeverity: a.acknowledgedSeverity,
  }));

  return partitionAlerts(permitted, acks, todayIso);
}

/** Just the count, for the bell in the top bar. Runs the same assembly —
 * there is no cheaper correct answer, because every one of these figures
 * is derived and none of them is stored to be counted. */
export async function countVisibleAlerts(
  companyId: string,
  userId: string,
  todayIso: string,
  principal?: Principal,
): Promise<number> {
  const { visible } = await loadAlerts(companyId, userId, todayIso, principal);
  return visible.length;
}
