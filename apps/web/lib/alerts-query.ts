import { prisma } from "@prova/db";
import {
  apprenticeRatioAlerts,
  backchargeAlerts,
  certifiedPayrollAlerts,
  closeoutAlerts,
  contactFollowUpAlerts,
  das140Alerts,
  das142Alerts,
  delayNoticeAlerts,
  drawingRevisionAlerts,
  equipmentOutAlerts,
  lienDeadlineAlerts,
  materialDeliveryAlerts,
  partitionAlerts,
  renewalAlert,
  punchItemAlerts,
  rfiAlerts,
  submittalAlerts,
  visibleToPrincipal,
  retainageAlerts,
  wipAlerts,
  type Alert,
  type Acknowledgement,
  type PartitionedAlerts,
  intakeAlerts,
} from "@/lib/alerts";
import { renewalSourcesForCompany } from "@/lib/renewals";
import { renewalAlerts as rankRenewals } from "@/lib/compliance-expiry";
import { calculateRetainageSummary } from "@/lib/retainage";
import { calculateJobWip, calculateLineItemWip } from "@/lib/wip";
import { lineItemCostToDate, unassignedLaborCost } from "@/lib/labor-job-cost";
import { loadFringeSchedulesByCraft, TIME_ENTRY_COST_SELECT } from "@/lib/fringe-schedules-query";
import { loadEmployerBurdenRates } from "@/lib/employer-burden-query";
import { jobIsOverBudget } from "@/lib/company-financials";
import { certifiedPayrollWeekIsCovered, certifiedPayrollWeekStart } from "@/lib/certified-payroll-week";
import { can, type Principal } from "@/lib/permissions";
import { loadRatioReviews } from "@/lib/union-compliance-query";
import { intakeTraySummary } from "@/lib/intake/review";
import { firstRowBy, groupRowsBy, rowsFor } from "@/lib/group-rows";

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

/**
 * Every job with the facts the per-job alerts read — retainage, closeout,
 * certified payroll, WIP variance.
 *
 * This was ONE `job.findMany` with nine relations nested under it, which
 * Prisma resolves as ten queries run one after another: about a second of
 * every page render, since the bell count in the layout runs this, and the
 * longest wait in the whole layout (measured 2026-09-18). It is now the
 * job query and then every relation at once. Each child query is the SQL
 * Prisma was already sending — `WHERE "jobId" IN (...)`, with the same
 * ORDER BY on the two that take the newest row — so the rows, their order
 * and therefore every alert are unchanged. The shape handed back is the
 * shape the nested read returned, so nothing below this function changed.
 */
async function loadAlertJobs(companyId: string) {
  const jobs = await prisma.job.findMany({
    where: { companyId },
    select: { id: true, name: true, substantialCompletionDate: true },
  });
  // A nested read with no parents sends no child queries; neither does this.
  if (jobs.length === 0) return [];
  const jobId = { in: jobs.map((job) => job.id) };

  const [
    invoices,
    retainageReleases,
    closeoutSubmissions,
    prevailingWageDeterminations,
    timeEntries,
    complianceDocuments,
    lineItems,
  ] = await Promise.all([
    prisma.invoice.findMany({
      where: { jobId },
      select: { jobId: true, amount: true, retainageWithheld: true },
    }),
    prisma.retainageRelease.findMany({ where: { jobId }, select: { jobId: true, amount: true } }),

    // The newest attempt per job: every attempt newest-first, first one per
    // job kept below — exactly how Prisma resolved the nested `take: 1`.
    prisma.closeoutSubmission.findMany({
      where: { jobId },
      orderBy: { attempt: "desc" },
      select: { jobId: true, status: true, submittedOn: true, respondedOn: true },
    }),

    // Only jobs carrying a wage determination can raise a certified
    // payroll alert — see certifiedPayrollAlerts. One row per job is
    // enough: this is a "does one exist" question.
    prisma.prevailingWageDetermination.findMany({
      where: { jobId },
      orderBy: { createdAt: "desc" },
      // The jurisdiction's own filing window and frequency, where they
      // have been recorded. Without a window the alert falls back to
      // its generic horizon and says so; without a frequency it
      // assumes WEEKLY, both jobs certifiedPayrollAlerts already does.
      select: {
        jobId: true,
        id: true,
        ruleSet: { select: { filingDueDays: true, filingFrequency: true } },
      },
    }),
    // TIME_ENTRY_COST_SELECT already carries `date`, which is the only
    // column certifiedPayrollAlerts wanted; the rest is burdened job
    // cost (issue #287), read through the same helper /jobs/[id] uses.
    prisma.timeEntry.findMany({
      where: { jobId },
      select: { ...TIME_ENTRY_COST_SELECT, jobId: true },
    }),
    prisma.complianceDocument.findMany({
      where: { jobId, type: "CERTIFIED_PAYROLL" },
      select: { jobId: true, periodStart: true, periodEnd: true },
    }),
    prisma.jobLineItem.findMany({
      where: { jobId, isDeleted: false },
      select: {
        jobId: true,
        id: true,
        quantity: true,
        unitPrice: true,
        budgetedUnitCost: true,
        currentEstimatedUnitCost: true,
        estimatedCostToComplete: true,
        costEntries: { select: { amount: true } },
      },
    }),
  ]);

  const byJob = <T extends { jobId: string | null }>(rows: T[]) => groupRowsBy(rows, (row) => row.jobId);
  const invoicesByJob = byJob(invoices);
  const releasesByJob = byJob(retainageReleases);
  const latestCloseout = firstRowBy(closeoutSubmissions, (row) => row.jobId);
  const latestDetermination = firstRowBy(prevailingWageDeterminations, (row) => row.jobId);
  const timeEntriesByJob = byJob(timeEntries);
  const documentsByJob = byJob(complianceDocuments);
  const lineItemsByJob = byJob(lineItems);

  return jobs.map((job) => {
    const closeout = latestCloseout.get(job.id);
    const determination = latestDetermination.get(job.id);
    return {
      ...job,
      invoices: rowsFor(invoicesByJob, job.id),
      retainageReleases: rowsFor(releasesByJob, job.id),
      closeoutSubmissions: closeout ? [closeout] : [],
      prevailingWageDeterminations: determination ? [determination] : [],
      timeEntries: rowsFor(timeEntriesByJob, job.id),
      complianceDocuments: rowsFor(documentsByJob, job.id),
      lineItems: rowsFor(lineItemsByJob, job.id),
    };
  });
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

  const [
    renewalSources,
    backcharges,
    jobs,
    acknowledgements,
    ratioReviews,
    followUps,
    intakeTray,
    rfis,
    submittals,
    drawingSets,
    fringeSchedulesByCraft,
    employerBurdenRates,
    lienDeadlines,
    materialOrders,
    punchItems,
    equipmentOut,
    unnotifiedDelays,
    das140Notices,
    das142Requests,
  ] = await Promise.all([
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

    loadAlertJobs(companyId),

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

    // The document tray, for the "what should I do with this folder"
    // suggestions. Only the PROPOSED rows — a filed document is not
    // something anybody has to be told about, and a dismissed one is a
    // person having already answered.
    prisma.documentIntake.findMany({
      where: { companyId, status: "PROPOSED" },
      select: {
        proposedKind: true,
        proposedConfidence: true,
        status: true,
        jobHint: true,
        jobId: true,
      },
    }),

    // Correspondence, all three kinds. Each one is narrowed here only where
    // the database can do it without deciding anything: `status: "SENT"` is
    // rfiLabels.isOpen's population expressed as a where-clause, and
    // rfiAlerts still applies `isOpen` itself so that definition stays in
    // one place — the same belt-and-braces lib/moneyRail.ts uses for
    // `isLive`. Submittals and drawing sets cannot be narrowed at all: what
    // makes them worth chasing is a property of the LATEST revision, and
    // submittalState / unreceivedRevisions are what decide it.
    prisma.rfi.findMany({
      where: { companyId, status: "SENT" },
      select: {
        id: true,
        number: true,
        subject: true,
        status: true,
        sentOn: true,
        dueBy: true,
        job: { select: { name: true } },
      },
    }),

    prisma.submittal.findMany({
      where: { companyId },
      select: {
        id: true,
        number: true,
        title: true,
        job: { select: { name: true } },
        revisions: {
          select: {
            revisionNumber: true,
            sentOn: true,
            dueBack: true,
            returnedOn: true,
            outcome: true,
            responseNotes: true,
            responseUrl: true,
            responseFileName: true,
          },
        },
      },
    }),

    prisma.drawingSet.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        job: { select: { name: true } },
        revisions: {
          select: {
            id: true,
            label: true,
            issuedOn: true,
            receivedOn: true,
            description: true,
            fileUrl: true,
            fileName: true,
          },
        },
      },
    }),
    loadFringeSchedulesByCraft(companyId),
    loadEmployerBurdenRates(companyId),

    // Lien deadlines not yet served. Scoped by company in the WHERE like
    // every read here; `servedOn: null` is only a narrowing —
    // lienDeadlineAlerts applies lienDeadlineState itself, so what counts
    // as served is still decided in one place.
    prisma.lienDeadline.findMany({
      where: { companyId, servedOn: null },
      select: {
        id: true,
        kind: true,
        otherLabel: true,
        recipient: true,
        dueOn: true,
        servedOn: true,
        job: { select: { name: true } },
      },
    }),

    /* THE FIELD FOUR. Each is narrowed in the DATABASE only by facts that
       need no judgement — an order with no completing delivery, an OPEN
       punch item, an assignment with no return, a delay with no notice —
       and every date comparison still happens in lib/alerts.ts, so
       "overdue" means one thing across the whole app. */
    prisma.materialOrder.findMany({
      where: { companyId, deliveries: { none: { completesOrder: true } } },
      select: {
        id: true,
        number: true,
        description: true,
        orderedOn: true,
        promisedFor: true,
        job: { select: { name: true } },
        vendor: { select: { name: true } },
      },
    }),

    prisma.punchListItem.findMany({
      where: { companyId, status: "OPEN" },
      select: {
        id: true,
        description: true,
        area: true,
        dueOn: true,
        createdAt: true,
        job: { select: { name: true } },
      },
    }),

    prisma.equipmentAssignment.findMany({
      where: { companyId, returnedOn: null },
      select: {
        id: true,
        sentOutOn: true,
        equipment: { select: { name: true } },
        job: { select: { name: true, status: true } },
      },
    }),

    /* `gcNotifiedAt: null` is the whole population — a delay the GC was
       never told about. The grace window is applied in the builder, not
       here, so the number lives beside the sentence that explains it. */
    prisma.delayEvent.findMany({
      where: { companyId, gcNotifiedAt: null },
      select: {
        id: true,
        jobId: true,
        date: true,
        description: true,
        hoursLost: true,
        job: { select: { name: true } },
      },
    }),

    /* The two apprenticeship forms, company-wide.
     *
       Scoped through the job rather than a `companyId` column, because
       neither model has one — `das-forms.prisma` hangs both off `Job`, so
       the job IS the tenancy boundary and `job: { companyId }` is the only
       correct filter. Getting that wrong here would leak another company's
       committee names into this company's bell.

       NOT filtered by status or sent-ness in the query. An unsent notice
       whose deadline is still a fortnight away is a row the builder is
       meant to see and stay quiet about, and pre-filtering here would move
       that decision out of the module where the reason for it is written
       down. A company has tens of these, not thousands.

       `firstWorkerOnSiteOn` is NOT queried: it is the earliest time entry
       on the job, and `loadAlertJobs` has already loaded every time entry
       with its date for the certified-payroll and job-cost alerts. Reading
       it from those rows rather than firing `loadFirstWorkerDay` per job is
       the difference between one query and one per job, and it cannot
       disagree with the payroll because it IS the payroll. */
    prisma.das140Notice.findMany({
      where: { job: { companyId } },
      select: {
        id: true,
        jobId: true,
        craftName: true,
        contractExecutedOn: true,
        sentOn: true,
        job: { select: { name: true } },
        committee: { select: { name: true } },
      },
    }),

    prisma.das142Request.findMany({
      where: { job: { companyId } },
      select: {
        id: true,
        jobId: true,
        craftName: true,
        apprenticesRequested: true,
        neededFrom: true,
        requestedOn: true,
        outcome: true,
        job: { select: { name: true } },
        committee: { select: { name: true } },
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
      // Issue #109 finding 5: ANY submission counts here, regardless of
      // status -- `latest` already reads the newest attempt of any status,
      // so "there is at least one row" is just "it is not null".
      hasCloseoutSubmission: latest !== null,
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

      // #104 finding 7: this used to group by fieldReportWeeks' MONDAY-start
      // week -- the right convention for a field report, wrong one here.
      // This alert exists to chase the ACTUAL certified-payroll filing,
      // and that document's own week (lib/certified-payroll-week.ts,
      // certifiedPayrollWeekStart) runs SUNDAY-to-Saturday and always has,
      // by deliberate choice recorded in that file's own header -- printed
      // on the sheet, encoded in its `?weekStart=` links. An alert grouped
      // Monday-to-Sunday describes a different seven days from the sheet
      // it is nagging about, so "week of Mon 8/24" on the alert and
      // "Aug 23 - Aug 29" on the certified-payroll page could both be
      // about the same hours and never look like it. Matching the alert
      // to the FILING's own week, rather than moving the filing to match
      // the alert, is the direction that touches nothing already filed.
      const weeksWorked = new Set(
        job.timeEntries.map((entry) => isoDate(certifiedPayrollWeekStart(entry.date)) as string),
      );

      for (const start of weeksWorked) {
        const end = addDays(start, 6);
        // Covered when a filed report's period contains the whole week.
        // A report whose period only clips the week is not evidence the
        // week was filed, and treating it as such would hide a real gap.
        //
        // The containment moved into lib/certified-payroll-week.ts on
        // 2026-09-26, unchanged, so that `certified_payroll` in the Ask box
        // answers "is a document on record for this week" from the same
        // predicate this alert is raised from. It was one tool in that box
        // refusing what this one reports.
        const isCovered = certifiedPayrollWeekIsCovered(covered, start, end);
        if (!isCovered) {
          payrollSources.push({
            jobId: job.id,
            jobName: job.name,
            weekStart: start,
            weekEnd: end,
            filingDueDays: job.prevailingWageDeterminations[0]?.ruleSet?.filingDueDays ?? null,
            filingFrequency: job.prevailingWageDeterminations[0]?.ruleSet?.filingFrequency ?? null,
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
          ...lineItemCostToDate(
            item.id,
            item.costEntries,
            job.timeEntries,
            fringeSchedulesByCraft,
            employerBurdenRates,
          ),
        }),
      );
      const billedToDate = job.invoices.reduce((sum, i) => sum + Number(i.amount), 0);
      const wip = calculateJobWip(
        lineItems,
        billedToDate,
        unassignedLaborCost(job.timeEntries, fringeSchedulesByCraft, employerBurdenRates),
      );

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
  alerts.push(...intakeAlerts(intakeTraySummary(intakeTray, jobs.map((job) => job.name))));
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

  alerts.push(
    ...rfiAlerts(
      rfis.map((rfi) => ({
        id: rfi.id,
        number: rfi.number,
        subject: rfi.subject,
        jobName: rfi.job.name,
        status: rfi.status as string,
        sentOn: isoDate(rfi.sentOn),
        dueBy: isoDate(rfi.dueBy),
      })),
      todayIso,
    ),
  );

  alerts.push(
    ...submittalAlerts(
      submittals.map((submittal) => ({
        submittalId: submittal.id,
        number: submittal.number,
        title: submittal.title,
        jobName: submittal.job.name,
        revisions: submittal.revisions.map((rev) => ({
          revisionNumber: rev.revisionNumber,
          // sentOn is required on SubmittalRevision, so this cast is the
          // shape of the column rather than an assumption about the data.
          sentOn: isoDate(rev.sentOn) as string,
          dueBack: isoDate(rev.dueBack),
          returnedOn: isoDate(rev.returnedOn),
          outcome: rev.outcome,
          responseNotes: rev.responseNotes,
          responseUrl: rev.responseUrl,
          responseFileName: rev.responseFileName,
        })),
      })),
      todayIso,
    ),
  );

  alerts.push(
    ...drawingRevisionAlerts(
      drawingSets.map((set) => ({
        setId: set.id,
        setName: set.name,
        jobName: set.job.name,
        revisions: set.revisions.map((rev) => ({
          id: rev.id,
          label: rev.label,
          // issuedOn is required on DrawingRevision; receivedOn is the
          // nullable one, and its absence is the whole alert.
          issuedOn: isoDate(rev.issuedOn) as string,
          receivedOn: isoDate(rev.receivedOn),
          description: rev.description,
          fileUrl: rev.fileUrl,
          fileName: rev.fileName,
        })),
      })),
      todayIso,
    ),
  );

  alerts.push(
    ...lienDeadlineAlerts(
      lienDeadlines.map((row) => ({
        id: row.id,
        kind: row.kind as string,
        otherLabel: row.otherLabel,
        jobName: row.job.name,
        recipient: row.recipient,
        // dueOn is required on LienDeadline; servedOn is the nullable one.
        dueOn: isoDate(row.dueOn) as string,
        servedOn: isoDate(row.servedOn),
      })),
      todayIso,
    ),
  );

  const acks: Acknowledgement[] = acknowledgements.map((a) => ({
    alertKey: a.alertKey,
    snoozedUntil: isoDate(a.snoozedUntil),
    acknowledgedSeverity: a.acknowledgedSeverity,
  }));

  alerts.push(
    ...materialDeliveryAlerts(
      materialOrders.map((order) => ({
        id: order.id,
        number: order.number,
        description: order.description,
        jobName: order.job.name,
        vendorName: order.vendor.name,
        promisedFor: isoDate(order.promisedFor),
        orderedOn: isoDate(order.orderedOn) ?? todayIso,
        // The query already excluded orders with a completing delivery, so
        // anything here is incomplete. Stated rather than recomputed, so
        // the two cannot drift apart.
        isComplete: false,
      })),
      todayIso,
    ),
  );

  alerts.push(
    ...punchItemAlerts(
      punchItems.map((item) => ({
        id: item.id,
        description: item.description,
        jobName: item.job.name,
        area: item.area,
        dueOn: isoDate(item.dueOn),
        raisedOn: isoDate(item.createdAt) ?? todayIso,
      })),
      todayIso,
    ),
  );

  alerts.push(
    ...equipmentOutAlerts(
      equipmentOut.map((row) => ({
        id: row.id,
        equipmentName: row.equipment.name,
        jobName: row.job.name,
        jobIsFinished: row.job.status === "COMPLETE",
        sentOutOn: isoDate(row.sentOutOn) ?? todayIso,
      })),
      todayIso,
    ),
  );

  alerts.push(
    ...delayNoticeAlerts(
      unnotifiedDelays.map((delay) => ({
        id: delay.id,
        jobId: delay.jobId,
        jobName: delay.job.name,
        date: isoDate(delay.date) ?? todayIso,
        description: delay.description,
        // Decimal -> number at the edge, like every other money-shaped
        // value crossing out of Prisma in this file.
        hoursLost: delay.hoursLost != null ? Number(delay.hoursLost) : null,
      })),
      todayIso,
    ),
  );

  /* The first day anybody logged an hour, per job — the second bound on the
     DAS 140 deadline, and the earlier of the two is the one that governs.

     Built from `jobs`, which already carries every time entry with its
     date. `loadFirstWorkerDay` in das-query.ts answers the same question
     with its own query and is what the job screens use; calling it here
     would be one round trip per job for a value already in memory. The
     DERIVATION is identical — the minimum entry date — and that is the part
     that must not differ from the payroll, which it cannot, since both read
     the same rows. */
  const firstWorkerDayByJob = new Map<string, string | null>();
  for (const job of jobs) {
    let earliest: string | null = null;
    for (const entry of job.timeEntries) {
      const day = isoDate(entry.date);
      if (day !== null && (earliest === null || day < earliest)) earliest = day;
    }
    firstWorkerDayByJob.set(job.id, earliest);
  }

  alerts.push(
    ...das140Alerts(
      das140Notices.map((notice) => ({
        id: notice.id,
        jobId: notice.jobId,
        jobName: notice.job.name,
        committeeName: notice.committee.name,
        craftName: notice.craftName,
        // `contractExecutedOn` is non-null in the schema, so the fallback is
        // unreachable rather than a guess being smuggled in — it exists
        // because `isoDate` is the one date converter in this file and it is
        // nullable for the columns that are.
        contractExecutedOn: isoDate(notice.contractExecutedOn) ?? todayIso,
        sentOn: isoDate(notice.sentOn),
        firstWorkerOnSiteOn: firstWorkerDayByJob.get(notice.jobId) ?? null,
      })),
      todayIso,
    ),
  );

  alerts.push(
    ...das142Alerts(
      das142Requests.map((request) => ({
        id: request.id,
        jobId: request.jobId,
        jobName: request.job.name,
        committeeName: request.committee.name,
        craftName: request.craftName,
        apprenticesRequested: request.apprenticesRequested,
        neededFrom: isoDate(request.neededFrom) ?? todayIso,
        requestedOn: isoDate(request.requestedOn),
        outcome: request.outcome,
      })),
      todayIso,
    ),
  );

  /* LAST, AND THAT IS THE WHOLE POINT — after every push, not in the middle
     of them.

     `visibleToPrincipal` returns a NEW array. Computed earlier in the
     function it is a SNAPSHOT, and every alert pushed after it is silently
     dropped: built correctly, capability-checked correctly, and never
     returned. That is what was happening on main. The four field kinds —
     late delivery, aging punch item, equipment still out, a delay the GC was
     never told — were assembled below the snapshot and thrown away, so the
     bell and the alerts page had never once shown one. Nothing failed.
     Nothing could: the builders were called, their unit tests passed on
     their own inputs, and the only broken thing was the ORDER of two
     statements.

     `alertAssemblyOrder.test.ts` now fails the build if any push lands
     after this line. */
  const permitted = visibleToPrincipal(alerts, (capability) => can(principal, capability));

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
