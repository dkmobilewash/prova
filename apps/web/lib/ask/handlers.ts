import { prisma, type BidInvitationStatus } from "@prova/db";
import {
  calculateJobWip,
  calculateLineItemWip,
  formatCoveragePercent,
  formatPercentComplete,
} from "@/lib/wip";
import { lineItemCostToDate, unassignedLaborCost } from "@/lib/labor-job-cost";
import { loadFringeSchedulesByCraft, TIME_ENTRY_COST_SELECT } from "@/lib/fringe-schedules-query";
import {
  jobCostVariance,
  jobEarnedRevenue,
  jobOverUnderBilling,
} from "@/lib/company-financials";
import { renewalAlerts, renewalCoverage, renewalCoverageMessage, renewalTiming } from "@/lib/compliance-expiry";
import { renewalSourcesForCompany } from "@/lib/renewals";
import { serverToday } from "@/lib/serverToday";
import { daysBetween } from "./dates";
import {
  arBalanceFor,
  calculateArAgingInvoice,
  calculateCashFlowForecast,
  daysPastDueFor,
  effectiveDueDateFor,
  summarizeArAging,
  type RetainageReceivableInput,
} from "@/lib/cash-flow";
import { calculateRetainageSummary } from "@/lib/retainage";
import { loadRetainageHeld } from "@/lib/retainage-query";
import { changeOrderValueDelta, countUnbookable, PENDING_CHANGE_ORDER_STATUSES } from "@/lib/change-order";
import { calculateTimeEntryLaborCost, findEffectiveFringeRateSchedule } from "@/lib/labor-cost";
import { loadRatioReviews, loadRemittance } from "@/lib/union-compliance-query";
import { ratioLabel } from "@/lib/apprentice-ratio";
import { loadCloseoutJobs } from "@/lib/closeout-query";
import { loadApprenticeships } from "@/lib/apprenticeship-query";
import { blockerLabel, stageLabel } from "@/components/closeoutPackageLabels";
import { classificationLabel, isRecordable, outcomeLabel } from "@/components/safetyLabels";
import {
  currentRevision,
  daysToReachUs,
  setState,
  stateLabel,
  unreceivedRevisions,
} from "@/components/drawingLabels";
import { orderState, stateLabel as orderStateLabel, daysLate } from "@/components/materialOrderLabels";
import { currentAssignment } from "@/components/equipmentDeployment";
import { can, type Principal } from "@/lib/permissions";
import { refusalFor } from "./access";
import { certifiedPayrollWeekStart } from "@/lib/certified-payroll-week";
import { timeEntryWorkerId, timeEntryWorkerName } from "@/lib/worker-name";
import {
  loadPlannedDaysMissingHours,
  loadUpcomingSchedule,
  scheduledWorkerName,
} from "@/lib/crew-schedule-query";
import { loadLienDeadlines } from "@/lib/lien-deadlines-query";
import { lienKindLabel, summarizeLienDeadlines } from "@/lib/lien-deadlines";
import { matchesJobName, TOOLS, type ToolName, type ToolResult } from "./tools";

/**
 * What each tool actually reads.
 *
 * Every handler takes `companyId` as its FIRST argument, supplied by the
 * caller from the signed-in session. It is deliberately not part of any
 * input the model can influence — see the note at the top of tools.ts.
 *
 * Every figure is computed by the same library the corresponding page
 * uses, so an answer here and the screen it came from cannot disagree.
 * That is not politeness; two surfaces computing the same number
 * separately is the specific bug this codebase has shipped twice.
 *
 * All read-only.
 */

type Input = { jobName?: string; status?: string; year?: string; withinDays?: string; month?: string };

const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

/**
 * Distinguishes "no job by that name" from "checked, nothing to report" —
 * the pattern `jobMargin` already used by querying `Job` directly, and the
 * one every other job-filtered handler skipped until issue #103.
 *
 * Those handlers filter their OWN rows (RFIs, punch items, drawing sets,
 * material orders) by job name after the fact. A typo that matches no real
 * job produces the exact same empty array as a real job with nothing open
 * on it, so "what RFIs are open on Rivrside?" (typo for "Riverside") and
 * "what RFIs are open on Riverside?" when Riverside has none got the
 * identical, job-silent sentence — read as company-wide good news rather
 * than "there is no job by that name" (finding 3).
 *
 * Returns null when there is nothing to flag: no filter was given, or the
 * filter matches at least one real job in the company. Returns the
 * `unavailable` message to use verbatim otherwise.
 */
async function jobNameMismatch(companyId: string, jobName: string | undefined): Promise<string | null> {
  const name = jobName?.trim();
  if (!name) return null;
  const match = await prisma.job.findFirst({
    where: { companyId, name: { contains: name, mode: "insensitive" } },
    select: { id: true },
  });
  return match ? null : `No job matches "${name}".`;
}

/** Dispatch as a record rather than a switch, so a test can assert that
 * every declared tool has a handler AND that every handler is declared.
 * A switch only proves the first direction, and the second is the one
 * that has bitten: this codebase has twice shipped a server action that
 * was written, exported, and reachable from nowhere. */
export const HANDLERS: Record<
  ToolName,
  (companyId: string, input: Input) => Promise<ToolResult>
> = {
  crew_assignments: (companyId) => crewAssignments(companyId),
  crew_schedule: crewSchedule,
  open_punch_list: openPunchList,
  compliance_status: (companyId) => complianceStatus(companyId),
  drawing_currency: drawingCurrency,
  job_margin: jobMargin,
  bid_status: bidStatus,
  open_rfis: openRfis,
  material_deliveries: materialDeliveries,
  equipment_location: (companyId) => equipmentLocation(companyId),
  receivables: (companyId) => receivables(companyId),
  cash_flow_forecast: (companyId) => cashFlowForecast(companyId),
  retainage_held: retainageHeld,
  change_order_status: changeOrderStatus,
  job_labor_cost: jobLaborCost,
  safety_record: safetyRecord,
  open_submittals: openSubmittals,
  certification_expiry: certificationExpiry,
  apprentice_ratio: apprenticeRatio,
  closeout_status: closeoutStatus,
  fringe_remittance: fringeRemittance,
  backcharge_exposure: backchargeExposure,
  apprenticeship_standing: apprenticeshipStanding,
  daily_field_reports: dailyFieldReports,
  wage_determinations: wageDeterminations,
  job_photos: jobPhotos,
  vendor_pricing: vendorPricing,
  gc_relationship: gcRelationship,
  pay_application_status: payApplicationStatus,
  warranty_obligations: warrantyObligations,
  outbound_messages: outboundMessages,
  certified_payroll: certifiedPayroll,
  tm_tickets: tmTickets,
  unbilled_change_orders: unbilledChangeOrders,
  schedule_status: scheduleStatus,
  estimate_detail: estimateDetail,
  document_intake: (companyId) => documentIntake(companyId),
  team_roster: (companyId) => teamRoster(companyId),
  dispatch_slips: dispatchSlips,
  lien_deadlines: lienDeadlines,
};

/**
 * Add whole months to a date without rolling into the next one.
 *
 * `setUTCMonth(getUTCMonth() + n)` overflows: 2026-08-31 plus six months
 * targets 2027-02-31, which JavaScript normalises to 2027-03-03. A warranty
 * would then read "in force" for two days after it ended — and, for a
 * callback arriving on those days, report the company as liable when it is
 * not. Substantial-completion dates land on month ends often enough for
 * that to be reachable rather than theoretical. Found reviewing #303.
 *
 * Clamps to the last day of the target month instead, which is how every
 * other term in this trade is read: a six-month warranty from 31 August
 * ends on 28 February, not 3 March.
 */
export function addMonthsClamped(startIso: string, months: number): string {
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  // Day 0 of the FOLLOWING month is the last day of the target month.
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(start.getUTCDate(), lastDayOfTarget);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/** A month the person named, or this one. Same principle as the expiry
 * window: the model sends a string, and one this cannot read falls back to
 * the current month rather than to nothing. An empty ratio review reads as
 * "you were in ratio", which is the wrong answer to give about a month
 * nobody actually checked. */
export function ratioMonth(raw: string | undefined, today: string): string {
  const wanted = raw?.trim();
  if (wanted && /^\d{4}-(0[1-9]|1[0-2])$/.test(wanted)) return wanted;
  return today.slice(0, 7);
}

/** How far ahead "expiring soon" reaches when nobody said. Sixty days is the
 * renewal window the compliance page already uses, so the assistant and the
 * screen cannot disagree about what "soon" means. */
const DEFAULT_EXPIRY_WINDOW_DAYS = 60;

/** The model sends a string; this is the only place that decides what a bad
 * one means. An unparseable or negative window falls back to the default
 * rather than returning nothing — a silent empty list would read as "you
 * have no expiring cards", which is the one wrong answer this tool must
 * never give. */
export function expiryWindowDays(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_EXPIRY_WINDOW_DAYS;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_EXPIRY_WINDOW_DAYS;
  return Math.floor(parsed);
}

/** A certification's name as a person says it. `kind` is an enum for
 * filtering; OTHER carries the real name in `otherLabel`, and an OTHER with
 * no label says so rather than rendering the word "Other" as if it were the
 * name of a card. */
export function certificationLabel(kind: string, otherLabel: string | null): string {
  if (kind === "OTHER") return otherLabel?.trim() || "Unnamed certification";
  return kind.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Who is asking: the company, and the person's role and job function.
 * Handlers still take only the company id — what changed is that the
 * gate now stands in front of them. */
export type ToolActor = { companyId: string; principal: Principal };

export async function runTool(
  actor: ToolActor,
  name: ToolName,
  input: Input,
): Promise<ToolResult> {
  const handler = HANDLERS[name];
  if (!handler) {
    // Reachable only if the model invents a tool name. Better a stated
    // refusal than a thrown error the UI has to guess at.
    return {
      data: null,
      citations: [],
      unavailable: `There is no tool called ${name}.`,
    };
  }

  // Re-checked here even though `toolsFor()` already filtered the list the
  // model was offered. The list is advisory; this is the boundary — and a
  // FIELD-function member used to be answered with the margin figures the
  // dashboard beside this box withholds from them.
  const definition = TOOLS.find((tool) => tool.name === name);
  if (definition?.capability && !can(actor.principal, definition.capability)) {
    return { data: null, citations: [], unavailable: refusalFor(definition.capability) };
  }

  return handler(actor.companyId, input);
}

async function crewAssignments(companyId: string): Promise<ToolResult> {
  const jobs = await prisma.job.findMany({
    where: { companyId, status: "IN_PROGRESS" },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      contact: { select: { name: true, phone: true } },
      assignments: { select: { user: { select: { name: true, email: true } } } },
    },
    orderBy: { name: "asc" },
  });

  const today = serverToday();

  return {
    data: jobs.map((job) => {
      const start = iso(job.startDate);
      const end = iso(job.endDate);
      return {
        job: job.name,
        gc: job.contact.name,
        gcPhone: job.contact.phone,
        startDate: start,
        endDate: end,
        // JobAssignment carries no dates — it is a roster of who belongs to
        // this job, not a record of who is on site on any given day. The
        // field name says so, so the model cannot quietly upgrade it into
        // attendance.
        assignedCrew: job.assignments.map((a) => a.user.name ?? a.user.email),
        assignedCrewSize: job.assignments.length,
        todayIsInScheduledWindow:
          (start === null || start <= today) && (end === null || end >= today),
        asOf: today,
      };
    }),
    citations: [{ label: "Schedule", href: "/schedule" }],
    unavailable:
      jobs.length === 0 ? "No jobs are in progress, so nobody is assigned anywhere." : undefined,
  };
}

async function openPunchList(companyId: string, input: Input): Promise<ToolResult> {
  const jobMismatch = await jobNameMismatch(companyId, input.jobName);
  if (jobMismatch) {
    return { data: [], citations: [{ label: "Punch lists", href: "/punch-lists" }], unavailable: jobMismatch };
  }

  const items = await prisma.punchListItem.findMany({
    where: { companyId, isDone: false },
    select: {
      description: true,
      createdAt: true,
      job: { select: { name: true } },
      raisedBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const filtered = items.filter((item) => matchesJobName(item.job.name, input.jobName));

  return {
    data: filtered.map((item) => ({
      job: item.job.name,
      item: item.description,
      raisedBy: item.raisedBy?.name ?? item.raisedBy?.email ?? null,
      raisedOn: iso(item.createdAt),
    })),
    citations: [{ label: "Punch lists", href: "/punch-lists" }],
    unavailable:
      filtered.length === 0
        ? input.jobName
          ? "Nothing is open on the punch list for that job."
          : "Nothing is open on the punch list."
        : undefined,
  };
}

async function complianceStatus(companyId: string): Promise<ToolResult> {
  // The same ranking the dashboard and /compliance show, so the answer and
  // the screen cannot drift apart.
  const sources = await renewalSourcesForCompany(companyId);
  const alerts = renewalAlerts(sources, serverToday());

  // `renewalCoverage`/`renewalCoverageMessage` are the same functions
  // RenewalAlerts.tsx uses. Before this, an empty `alerts` array — which a
  // company that has never filed anything produces just as surely as one
  // whose filings are all current — got the single sentence "every
  // certificate, licence, policy and bond on file is current." "Is my GL
  // still good?" from a company with zero compliance rows was answered as
  // reassurance rather than as "there is nothing on file to check" (issue
  // #103, finding 2).
  const coverage = renewalCoverage(alerts, sources.length);

  return {
    data: alerts.map((alert) => ({
      what: alert.title,
      whose: alert.detail,
      state: alert.urgency,
      timing: renewalTiming(alert),
      expiresOn: alert.date,
      conflict: alert.disagreement,
    })),
    citations: [{ label: "Compliance", href: "/compliance" }],
    unavailable: renewalCoverageMessage(coverage, sources.length) ?? undefined,
  };
}

async function drawingCurrency(companyId: string, input: Input): Promise<ToolResult> {
  const jobMismatch = await jobNameMismatch(companyId, input.jobName);
  if (jobMismatch) {
    return { data: [], citations: [{ label: "Drawings", href: "/drawings" }], unavailable: jobMismatch };
  }

  const sets = await prisma.drawingSet.findMany({
    where: { companyId },
    select: {
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
    orderBy: { name: "asc" },
  });

  const today = serverToday();
  const filtered = sets.filter((set) => matchesJobName(set.job.name, input.jobName));

  return {
    data: filtered.map((set) => {
      const revisions = set.revisions.map((revision) => ({
        ...revision,
        issuedOn: revision.issuedOn.toISOString().slice(0, 10),
        receivedOn: iso(revision.receivedOn),
      }));
      const current = currentRevision(revisions);
      const state = setState(revisions);
      return {
        set: set.name,
        job: set.job.name,
        // Current means most recently ISSUED, not most recently received —
        // a revision supersedes the one before it whether or not it has
        // reached the trailer, which is exactly why an unreceived issue is
        // dangerous rather than pending.
        buildFrom: current?.label ?? null,
        currentIssuedOn: current?.issuedOn ?? null,
        // How old the current revision is — the exact number the tool's own
        // description already promised ("how old each is") and never
        // returned, which meant the model had to subtract the date from
        // today itself to answer "am I building off the latest sheet" with
        // any age attached — the one thing it must never do (issue #103,
        // finding 5). `daysToReachUs` is the same helper /drawings renders
        // through DrawingSetRow: days to reach us once received, days
        // waited so far while it hasn't.
        currentRevisionAgeInDays: current ? daysToReachUs(current, today) : null,
        state: stateLabel(state),
        issuedButNotReceived: unreceivedRevisions(revisions).map((r) => ({
          label: r.label,
          issuedOn: r.issuedOn,
          daysWaiting: daysToReachUs(r, today),
        })),
        asOf: today,
      };
    }),
    citations: [{ label: "Drawings", href: "/drawings" }],
    unavailable:
      filtered.length === 0
        ? input.jobName
          ? "No drawing sets are recorded for that job."
          : "No drawing sets are recorded."
        : undefined,
  };
}

async function jobMargin(companyId: string, input: Input): Promise<ToolResult> {
  const [jobs, fringeSchedulesByCraft] = await Promise.all([
    prisma.job.findMany({
    where: { companyId, status: { in: ["CONTRACTED", "IN_PROGRESS"] } },
    select: {
      id: true,
      name: true,
      contact: { select: { name: true } },
      lineItems: {
        where: { isDeleted: false },
        select: {
          id: true,
          description: true,
          quantity: true,
          unitPrice: true,
          budgetedUnitCost: true,
          currentEstimatedUnitCost: true,
          estimatedCostToComplete: true,
          costEntries: { select: { amount: true } },
        },
      },
      invoices: { select: { amount: true } },
      // Hours are job cost (issue #287). Without them this tool answered
      // "what is our margin" from materials alone, in prose, with the
      // model forbidden from questioning the figure it was handed.
      timeEntries: { select: TIME_ENTRY_COST_SELECT },
    },
    }),
    loadFringeSchedulesByCraft(companyId),
  ]);

  const filtered = jobs.filter((job) => matchesJobName(job.name, input.jobName));

  return {
    data: filtered.map((job) => {
      const lines = job.lineItems.map((line) =>
        calculateLineItemWip({
          quantity: Number(line.quantity),
          unitPrice: line.unitPrice === null ? null : Number(line.unitPrice),
          budgetedUnitCost: line.budgetedUnitCost === null ? null : Number(line.budgetedUnitCost),
          currentEstimatedUnitCost:
            line.currentEstimatedUnitCost === null ? null : Number(line.currentEstimatedUnitCost),
          estimatedCostToComplete:
            line.estimatedCostToComplete === null ? null : Number(line.estimatedCostToComplete),
          ...lineItemCostToDate(line.id, line.costEntries, job.timeEntries, fringeSchedulesByCraft),
        }),
      );
      const billed = job.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
      const wip = calculateJobWip(
        lines,
        billed,
        unassignedLaborCost(job.timeEntries, fringeSchedulesByCraft),
      );

      return {
        job: job.name,
        gc: job.contact.name,
        contractValue: wip.contractValue,
        costToDate: wip.actualCostToDate,
        forecastCostAtCompletion: wip.estimatedCostAtCompletion,
        // formatPercentComplete/formatCoveragePercent (lib/wip.ts) are the
        // exact functions /jobs/[id] renders these three ratios through.
        // This tool used to hand over the raw 0..1 fraction: told never to
        // do arithmetic, the model either said "0.4% complete" (the
        // fraction itself, read as a percentage) or multiplied it anyway —
        // a margin figure wrong by 100x either way (issue #103, finding 1).
        percentComplete: formatPercentComplete(wip.percentComplete),
        // Null rather than a flattered number: earnedRevenue is summed with
        // `?? 0` while contract value counts in full, so on a half-estimated
        // job the model would otherwise be handed "overbilled $80,000" as a
        // fact and asked to judge it.
        earnedRevenue: jobEarnedRevenue(wip),
        billedToDate: wip.billedToDate,
        overUnderBilling: jobOverUnderBilling(wip),
        forecastVarianceAgainstContract: jobCostVariance(wip),
        // Without these a job budgeted on one line out of seven reads as
        // wildly profitable, because unbudgeted lines forecast zero cost
        // while their contract value still counts. Two ratios, because a
        // line estimated at zero cost is covered on the cost side and not on
        // the revenue side.
        shareOfValueWithACostEstimate: formatCoveragePercent(wip.estimatedCoverage),
        shareOfValueWithAnEarnedRevenueFigure: formatCoveragePercent(wip.earnedCoverage),
      };
    }),
    citations: [{ label: "Today", href: "/dashboard" }],
    unavailable: filtered.length === 0 ? "No active job matches that name." : undefined,
  };
}

// Not yet decided. "Which bids are outstanding" means these two statuses,
// never WON/LOST/DECLINED. Literal strings rather than the runtime
// `BidInvitationStatus` object — a type-only import so this module has no
// runtime dependency on the generated Prisma enum, only on its values
// spelled the same way `packages/db/prisma/schema/estimating.prisma`
// declares them.
const ALL_BID_STATUSES = ["INVITED", "SUBMITTED", "WON", "LOST", "DECLINED"] as const;
const OUTSTANDING_BID_STATUSES: BidInvitationStatus[] = ["INVITED", "SUBMITTED"];

function isOutstandingBid(status: BidInvitationStatus): boolean {
  return (OUTSTANDING_BID_STATUSES as string[]).includes(status);
}

/**
 * Two real defects lived here (issue #103, finding 4). There was no status
 * filter, so "which bids are outstanding" had no way to ask for only
 * INVITED/SUBMITTED bids. And with no filter, `forModel`'s generic 40-row
 * cap (answer.ts) truncated whatever came back from `dueDate: asc` — the
 * OLDEST 40 due dates — which for any company with real bidding history is
 * mostly bids long since WON or LOST. A company with 41 lifetime
 * invitations and one still open got the 40 decided ones and none of the
 * one that mattered.
 *
 * Fixed two ways, not one, because either alone leaves a gap: an explicit
 * `status` input so the model can ask for exactly OUTSTANDING when the
 * question calls for it, AND — since the model will not always think to
 * pass it — outstanding bids sort first by default so they are the last
 * thing truncation would drop, not the first. `summary` carries the exact
 * counts regardless of how many rows survive the cap.
 */
async function bidStatus(companyId: string, input: Input): Promise<ToolResult> {
  const requested = input.status?.trim().toUpperCase();
  const statusFilter: BidInvitationStatus[] | undefined =
    requested === "OUTSTANDING"
      ? OUTSTANDING_BID_STATUSES
      : requested && (ALL_BID_STATUSES as readonly string[]).includes(requested)
        ? [requested as BidInvitationStatus]
        : undefined;

  const bids = await prisma.bidInvitation.findMany({
    where: statusFilter ? { companyId, status: { in: statusFilter } } : { companyId },
    select: {
      projectName: true,
      status: true,
      dueDate: true,
      tradeScope: true,
      notes: true,
      contact: { select: { name: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  // Only re-sort when nothing narrowed the set already — a status filter
  // has already put the person exactly where they asked to be.
  const ordered = statusFilter
    ? bids
    : [...bids].sort((a, b) => {
        const rank = (bid: (typeof bids)[number]) => (isOutstandingBid(bid.status) ? 0 : 1);
        const byRank = rank(a) - rank(b);
        if (byRank !== 0) return byRank;
        if (a.dueDate === null || b.dueDate === null) return 0;
        return a.dueDate.getTime() - b.dueDate.getTime();
      });

  return {
    data: ordered.map((bid) => ({
      project: bid.projectName,
      gc: bid.contact.name,
      status: bid.status,
      dueDate: iso(bid.dueDate),
      trade: bid.tradeScope,
      notes: bid.notes,
    })),
    // Computed over every matching row, never the truncated list `forModel`
    // may hand the model — the same reasoning receivables' summary states.
    summary: {
      totalBidCount: bids.length,
      outstandingBidCount: bids.filter((b) => isOutstandingBid(b.status)).length,
    },
    citations: [{ label: "Bids", href: "/bids" }],
    unavailable:
      bids.length === 0
        ? requested === "OUTSTANDING"
          ? "No bid invitations are outstanding."
          : statusFilter
            ? "No bid invitations match that status."
            : "No bid invitations are recorded."
        : undefined,
  };
}

async function openRfis(companyId: string, input: Input): Promise<ToolResult> {
  const jobMismatch = await jobNameMismatch(companyId, input.jobName);
  if (jobMismatch) {
    return { data: [], citations: [{ label: "RFIs", href: "/rfis" }], unavailable: jobMismatch };
  }

  const rfis = await prisma.rfi.findMany({
    where: { companyId, status: "SENT" },
    select: {
      number: true,
      subject: true,
      sentOn: true,
      dueBy: true,
      job: { select: { name: true, contact: { select: { name: true } } } },
    },
    orderBy: { sentOn: "asc" },
  });

  const now = new Date();
  const filtered = rfis.filter((rfi) => matchesJobName(rfi.job.name, input.jobName));

  return {
    data: filtered.map((rfi) => ({
      number: rfi.number,
      subject: rfi.subject,
      job: rfi.job.name,
      gc: rfi.job.contact.name,
      sentOn: iso(rfi.sentOn),
      // How long it has been open. Not a prediction — nothing here knows
      // when an answer will arrive.
      daysOutstanding: rfi.sentOn
        ? Math.max(0, Math.floor((now.getTime() - rfi.sentOn.getTime()) / 86_400_000))
        : null,
      // The response date the contract calls for. Derived, never stored:
      // an overdue flag written down at creation is wrong by the next day.
      responseDueBy: iso(rfi.dueBy),
      answerIsOverdue: rfi.dueBy === null ? null : daysPastDueFor(rfi.dueBy, now) > 0,
      daysPastResponseDate:
        rfi.dueBy === null ? null : Math.max(0, daysPastDueFor(rfi.dueBy, now)),
    })),
    citations: [{ label: "RFIs", href: "/rfis" }],
    unavailable:
      filtered.length === 0 ? "No RFIs are sent and awaiting an answer." : undefined,
  };
}

/**
 * Same two defects as bid_status, same shape (issue #103, finding 4): no
 * way to ask for only what has not fully arrived, and a default order
 * (`promisedFor: asc`) that puts the OLDEST — usually long since delivered
 * — orders first in line for `forModel`'s 40-row cap. There is no stored
 * order status to filter on in the database (state is derived from
 * deliveries on every render, never stored — see materialOrderLabels.ts),
 * so the status filter and the reordering both happen here, in memory,
 * after the deliveries are loaded.
 */
async function materialDeliveries(companyId: string, input: Input): Promise<ToolResult> {
  const jobMismatch = await jobNameMismatch(companyId, input.jobName);
  if (jobMismatch) {
    return {
      data: [],
      citations: [{ label: "Material orders", href: "/material-orders" }],
      unavailable: jobMismatch,
    };
  }

  const orders = await prisma.materialOrder.findMany({
    where: { companyId },
    select: {
      number: true,
      description: true,
      promisedFor: true,
      job: { select: { name: true } },
      vendor: { select: { name: true, phone: true } },
      deliveries: {
        select: { id: true, deliveredOn: true, completesOrder: true, notes: true },
      },
    },
    orderBy: { promisedFor: "asc" },
  });

  const today = serverToday();
  const withState = orders
    .filter((order) => matchesJobName(order.job.name, input.jobName))
    .map((order) => {
      const deliveries = order.deliveries.map((delivery) => ({
        ...delivery,
        deliveredOn: delivery.deliveredOn.toISOString().slice(0, 10),
      }));
      const promised = iso(order.promisedFor);
      return { order, deliveries, promised, state: orderState(deliveries) };
    });

  const wantsOutstandingOnly = input.status?.trim().toUpperCase() === "OUTSTANDING";
  const matching = wantsOutstandingOnly
    ? withState.filter((row) => row.state !== "COMPLETE")
    : withState;

  // Only re-sort the unfiltered view — asking specifically for OUTSTANDING
  // already puts the person exactly where they asked to be.
  const ordered = wantsOutstandingOnly
    ? matching
    : [...matching].sort((a, b) => {
        const rank = (row: (typeof matching)[number]) => (row.state === "COMPLETE" ? 1 : 0);
        const byRank = rank(a) - rank(b);
        if (byRank !== 0) return byRank;
        if (a.promised === null || b.promised === null) return 0;
        return a.promised < b.promised ? -1 : a.promised > b.promised ? 1 : 0;
      });

  return {
    data: ordered.map(({ order, deliveries, promised, state }) => ({
      order: order.number,
      what: order.description,
      job: order.job.name,
      vendor: order.vendor.name,
      vendorPhone: order.vendor.phone,
      promisedFor: promised,
      state: orderStateLabel(state),
      daysLate: daysLate(deliveries, promised, today),
    })),
    // Over every matching row, never the truncated list `forModel` may hand
    // the model.
    summary: {
      totalOrderCount: withState.length,
      outstandingOrderCount: withState.filter((row) => row.state !== "COMPLETE").length,
    },
    citations: [{ label: "Material orders", href: "/material-orders" }],
    unavailable:
      withState.length === 0
        ? input.jobName
          ? "No material orders are recorded for that job."
          : "No material orders are recorded."
        : wantsOutstandingOnly && matching.length === 0
          ? "No material orders are outstanding."
          : undefined,
  };
}

/** Where each piece of equipment is, derived exactly as `/equipment` and
 * `/deployment` derive it: `currentAssignment` over the stay history.
 *
 * This handler used to read `Equipment.assignedJobId` instead. Nothing has
 * written that column since the assignment history landed, so it froze at
 * whatever was true the day it stopped being maintained — and because the
 * page and Ask were reading two different things, Ask would have gone on
 * naming a job the equipment page had already stopped showing, forever,
 * with nothing anywhere to indicate a disagreement. Two surfaces computing
 * the same fact separately is the bug; the fix is the shared derivation,
 * not a second copy of it here. */
async function equipmentLocation(companyId: string): Promise<ToolResult> {
  const equipment = await prisma.equipment.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      assetTag: true,
      assignments: {
        select: {
          id: true,
          jobId: true,
          sentOutOn: true,
          returnedOn: true,
          job: { select: { name: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return {
    data: equipment.map((item) => {
      const open = currentAssignment(
        item.assignments.map((a) => ({
          id: a.id,
          equipmentId: item.id,
          equipmentName: item.name,
          jobId: a.jobId,
          jobName: a.job.name,
          sentOutOn: a.sentOutOn.toISOString().slice(0, 10),
          returnedOn: iso(a.returnedOn),
          notes: null,
        })),
      );

      return {
        equipment: item.name,
        assetTag: item.assetTag,
        // An assignment, not a position. Saying "on the Riverside job" when
        // the data means "sent out to the Riverside job and not brought
        // back" is the kind of small overstatement that gets someone
        // driving to the wrong site.
        assignedToJob: open?.jobName ?? null,
        // The day it went out, so "since when" is answerable without a
        // second question. Entered, not stamped.
        sentOutOn: open?.sentOutOn ?? null,
        // In the yard is a real answer, not missing data: no open stay.
        available: open === null,
      };
    }),
    citations: [{ label: "Equipment", href: "/equipment" }],
    unavailable: equipment.length === 0 ? "No equipment is recorded." : undefined,
  };
}

async function receivables(companyId: string): Promise<ToolResult> {
  const invoices = await prisma.invoice.findMany({
    where: { job: { companyId } },
    select: {
      number: true,
      amount: true,
      dueAt: true,
      issuedAt: true,
      // Read, not a dead over-select: the outstanding figure below is net
      // of it. See issue #288 and lib/cash-flow.ts.
      retainageWithheld: true,
      job: {
        select: { name: true, contact: { select: { name: true, paymentTermsDays: true } } },
      },
      payments: { select: { amount: true } },
    },
  });

  const now = new Date();
  const outstanding = invoices
    .map((invoice) => {
      const amount = Number(invoice.amount);
      const retainageWithheld = invoice.retainageWithheld != null ? Number(invoice.retainageWithheld) : null;
      const paid = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      // The one shared due-date rule — see lib/cash-flow.ts. Two surfaces
      // deriving this separately is how the dashboard and the aging table
      // disagreed about which invoices were overdue, twice.
      const due = effectiveDueDateFor({
        dueAt: invoice.dueAt,
        issuedAt: invoice.issuedAt,
        paymentTermsDays: invoice.job.contact.paymentTermsDays,
      });
      return {
        invoice: invoice.number,
        job: invoice.job.name,
        gc: invoice.job.contact.name,
        amount,
        paid,
        // Named separately so the model can say WHY outstanding is short
        // of amount - paid, instead of appearing to have got the
        // subtraction wrong.
        retainageWithheld: retainageWithheld ?? 0,
        // The one AR rule, shared with /cash-flow: net of retainage, which
        // is not due until substantial completion. `retainage_held` and
        // `cash_flow_forecast` report that money; this tool must not
        // report it a second time as something the GC owes now.
        outstanding: arBalanceFor({ amount, paidAmount: paid, retainageWithheld }),
        dueOn: due.toISOString().slice(0, 10),
        dueFromTerms: invoice.dueAt === null,
        daysOverdue: Math.max(0, daysPastDueFor(due, now)),
      };
    })
    .filter((row) => row.outstanding > 0.005)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  return {
    data: outstanding,
    // The same split the dashboard tile shows. Computed here so the answer
    // and the tile cannot disagree — which they did, once, in two runs of
    // the same question.
    summary: {
      outstandingInvoiceCount: outstanding.length,
      overdueInvoiceCount: outstanding.filter((row) => row.daysOverdue > 0).length,
      notYetDueInvoiceCount: outstanding.filter((row) => row.daysOverdue === 0).length,
    },
    citations: [
      { label: "Cash flow", href: "/cash-flow" },
      { label: "Today", href: "/dashboard" },
    ],
    unavailable:
      outstanding.length === 0 ? "Every invoice raised has been paid in full." : undefined,
  };
}

// ---------------------------------------------------------------------
// Roadmap item 4: the six questions the box could not answer. Five here;
// the company-wide WIP roll-up is deliberately absent — see the note on
// job_margin in tools.ts and the PR body. job_margin already returns
// per-job over/under billing, and the ROLL-UP of it belongs to
// lib/wip-schedule.ts on #254. A second summation of the same figure is
// the "two surfaces computing the same number separately" bug this file's
// own header names.
// ---------------------------------------------------------------------

/**
 * When the money already invoiced is expected to arrive.
 *
 * Every figure comes from the same three calls /cash-flow makes, in the
 * same order, over the same rows: calculateArAgingInvoice per invoice,
 * calculateRetainageSummary per job, then calculateCashFlowForecast over
 * both. Re-deriving a due date here rather than going through
 * `calculateArAgingInvoice` is exactly how the dashboard and the aging
 * table came to disagree about which invoices were overdue, twice.
 */
async function cashFlowForecast(companyId: string): Promise<ToolResult> {
  const jobs = await prisma.job.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      substantialCompletionDate: true,
      contact: { select: { name: true, paymentTermsDays: true } },
      invoices: {
        select: {
          id: true,
          amount: true,
          issuedAt: true,
          dueAt: true,
          retainageWithheld: true,
          payments: { select: { amount: true } },
        },
      },
      retainageReleases: { select: { amount: true } },
    },
  });

  const asOf = new Date();
  const arInvoices = jobs
    .flatMap((job) =>
      job.invoices.map((invoice) =>
        calculateArAgingInvoice(
          {
            invoiceId: invoice.id,
            jobId: job.id,
            jobName: job.name,
            contactName: job.contact.name,
            amount: Number(invoice.amount),
            paidAmount: invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0),
            // Netted out of the aged balance exactly as /cash-flow does it
            // — issue #288. This column was already selected here and read
            // only by the retainage half below, so the AR half was ageing
            // the same dollars a second time.
            retainageWithheld: invoice.retainageWithheld != null ? Number(invoice.retainageWithheld) : null,
            issuedAt: invoice.issuedAt,
            dueAt: invoice.dueAt,
            paymentTermsDays: job.contact.paymentTermsDays,
          },
          asOf,
        ),
      ),
    )
    .filter((row) => row != null);

  const retainageByJob: RetainageReceivableInput[] = jobs.map((job) => {
    const summary = calculateRetainageSummary({
      invoiceRetainageWithheld: job.invoices.map((inv) =>
        inv.retainageWithheld != null ? Number(inv.retainageWithheld) : null,
      ),
      releaseAmounts: job.retainageReleases.map((r) => Number(r.amount)),
      substantialCompletionDate: job.substantialCompletionDate,
    });
    return {
      jobId: job.id,
      jobName: job.name,
      outstandingBalance: summary.balance,
      substantialCompletionDate: summary.substantialCompletionDate,
    };
  });

  // Six months, the same window the page renders. Not a parameter: a model
  // choosing the horizon would make two runs of the same question return
  // different totals for the last bucket, which collapses everything
  // beyond the window into itself.
  const forecast = calculateCashFlowForecast(arInvoices, retainageByJob, asOf, 6);
  const aging = summarizeArAging(arInvoices);

  return {
    data: {
      months: forecast.months,
      agingByBucket: aging.byBucket,
      // Named, not silently dropped into a month. Real money owed with no
      // basis for when — the page shows it as its own line for the same
      // reason.
      retainageWithNoCompletionDate: forecast.retainageNoTargetDate,
    },
    summary: {
      arOutstanding: forecast.totalArOutstanding,
      retainageOutstanding: forecast.totalRetainageOutstanding,
      overdueNow: forecast.months[0]?.arExpected ?? 0,
    },
    citations: [{ label: "Cash flow", href: "/cash-flow" }],
    unavailable:
      forecast.totalArOutstanding === 0 && forecast.totalRetainageOutstanding === 0
        ? "Nothing is outstanding: every invoice is paid and no retainage is held."
        : undefined,
  };
}

/**
 * Retainage withheld across the company and not yet released.
 *
 * TWO reads on purpose, and the pairing is the point. The company total is
 * `loadRetainageHeld` — the single source #97 exists to enforce, which
 * counts EVERY job because retainage is collected at closeout and a
 * status filter drops exactly the completed jobs whose money is owed. The
 * rows are built per job the way /cash-flow builds its table, because a
 * scalar cannot carry job names.
 *
 * The two agree by construction: `calculateRetainageSummary` returns
 * `withheld − released` with no per-job clamp, so a sum of differences is
 * the difference of sums. `companyTotal` is reported from the loader
 * rather than from summing these rows, so that if a per-job floor is ever
 * introduced the two disagree visibly instead of one quietly becoming the
 * other.
 */
async function retainageHeld(companyId: string, input: Input): Promise<ToolResult> {
  const mismatch = await jobNameMismatch(companyId, input.jobName);
  if (mismatch) return { data: [], citations: [{ label: "Cash flow", href: "/cash-flow" }], unavailable: mismatch };

  const [jobs, companyTotal] = await Promise.all([
    prisma.job.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        status: true,
        substantialCompletionDate: true,
        contact: { select: { name: true } },
        invoices: { select: { retainageWithheld: true } },
        retainageReleases: { select: { amount: true } },
      },
    }),
    loadRetainageHeld(companyId),
  ]);

  const rows = jobs
    .filter((job) => matchesJobName(job.name, input.jobName))
    .map((job) => {
      const summary = calculateRetainageSummary({
        invoiceRetainageWithheld: job.invoices.map((inv) =>
          inv.retainageWithheld != null ? Number(inv.retainageWithheld) : null,
        ),
        releaseAmounts: job.retainageReleases.map((r) => Number(r.amount)),
        substantialCompletionDate: job.substantialCompletionDate,
      });
      return {
        job: job.name,
        gc: job.contact.name,
        jobStatus: job.status,
        withheldToDate: summary.totalWithheld,
        releasedToDate: summary.totalReleased,
        stillHeld: summary.balance,
        // Whether there is anything to collect against. A balance with no
        // completion date is owed with no date to chase it on, which is
        // the distinction /cash-flow draws and the reason it is here.
        substantialCompletionDate: iso(summary.substantialCompletionDate),
      };
    })
    .filter((row) => Math.abs(row.stillHeld) > 0.005)
    .sort((a, b) => b.stillHeld - a.stillHeld);

  return {
    data: rows,
    summary: {
      // From the loader, never from the rows above — see the note above.
      companyWideStillHeld: companyTotal,
      jobsHoldingRetainage: rows.length,
      jobsWithNoCompletionDate: rows.filter((row) => row.substantialCompletionDate === null).length,
    },
    citations: [
      { label: "Cash flow", href: "/cash-flow" },
      { label: "Today", href: "/dashboard" },
    ],
    unavailable:
      rows.length === 0
        ? input.jobName
          ? "No retainage is held on that job."
          : "No retainage is being held: nothing has been withheld, or all of it has been released."
        : undefined,
  };
}

/** DRAFT and SUBMITTED, the two the GC has not decided — the app's own
 * constant rather than a second list, so "pending" here and on the job
 * page can never come to mean different things. */
const PENDING_CHANGE_ORDERS: readonly string[] = PENDING_CHANGE_ORDER_STATUSES;

/** No filter means every change order; PENDING means the two undecided
 * ones; anything else is that exact status. Written out rather than as a
 * nested ternary — the compressed form typechecked and was unreadable,
 * which is how the wrong branch survives a review. */
function changeOrderMatches(status: string, wanted: string | undefined): boolean {
  if (!wanted) return true;
  if (wanted === "PENDING") return PENDING_CHANGE_ORDERS.includes(status);
  return status === wanted;
}

/**
 * Change orders by job and status, with what each is worth.
 *
 * `changeOrderValueDelta` is the job page's own function, and the target
 * map is built from the same UNFILTERED line-item read that page uses.
 *
 * Being exact about why, because the obvious reason is wrong: filtering
 * `isDeleted: false` would NOT change a single figure here today. A
 * proposal whose target is missing and one whose target is soft-deleted are
 * both unbookable, and `proposalValueDelta` returns zero for either. The
 * read is unfiltered because that is the shape `changeOrderValueDelta`
 * documents for `targets` and because the distinction is real to
 * `proposalIsBookable` — a map narrowed to live rows would make this handler
 * agree with the page by luck rather than by construction, and would start
 * disagreeing the moment a deleted target stops meaning the same as an
 * absent one.
 *
 * What DOES have to be said out loud is the count: a value that silently
 * drops unbookable proposals is a floor presented as a total (#105 finding
 * 5), which is why every row carries proposalsThatCannotBeBooked.
 */
async function changeOrderStatus(companyId: string, input: Input): Promise<ToolResult> {
  const mismatch = await jobNameMismatch(companyId, input.jobName);
  if (mismatch) return { data: [], citations: [], unavailable: mismatch };

  const jobs = await prisma.job.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      contact: { select: { name: true } },
      // Unfiltered: see above. Soft-deleted rows are load-bearing here.
      lineItems: { select: { id: true, description: true, quantity: true, unitPrice: true, isDeleted: true } },
      changeOrders: {
        orderBy: { number: "asc" },
        select: {
          number: true,
          title: true,
          status: true,
          submittedOn: true,
          decidedOn: true,
          proposals: {
            select: {
              changeType: true,
              lineItemId: true,
              quantity: true,
              unitPrice: true,
              previousQuantity: true,
              previousUnitPrice: true,
              previousIsDeleted: true,
            },
          },
        },
      },
    },
  });

  const today = serverToday();
  const wanted = input.status?.toUpperCase();
  const rows = jobs
    .filter((job) => matchesJobName(job.name, input.jobName))
    .flatMap((job) => {
      const targets = new Map(job.lineItems.map((item) => [item.id, item]));
      return job.changeOrders
        .filter((co) => changeOrderMatches(co.status, wanted))
        .map((co) => {
          const unbookable = countUnbookable(co.proposals, targets);
          return {
            job: job.name,
            gc: job.contact.name,
            changeOrder: `CO #${co.number}`,
            title: co.title,
            status: co.status,
            value: Number(changeOrderValueDelta(co.proposals, targets)),
            submittedOn: iso(co.submittedOn),
            decidedOn: iso(co.decidedOn),
            // Days since it went to the GC. NOT "days late": nothing
            // records an agreed response time for a change order, unlike an
            // RFI's contractual response date, so this is elapsed time and
            // the description says so. `daysBetween` rather than
            // `daysPastDueFor`: the arithmetic is identical and the second
            // name would plant "overdue" in the one tool that must not
            // imply it.
            daysAwaitingDecision:
              co.status === "SUBMITTED" && co.submittedOn
                ? Math.max(0, daysBetween(iso(co.submittedOn)!, today))
                : null,
            // Reported rather than folded away: a pending proposal against
            // scope an earlier approved change order deleted can never be
            // booked, so a value that silently included it would read as a
            // total when it is a floor (#105 finding 5).
            proposalsThatCannotBeBooked: unbookable,
          };
        });
    })
    .sort((a, b) => (b.daysAwaitingDecision ?? -1) - (a.daysAwaitingDecision ?? -1));

  const submitted = rows.filter((row) => row.status === "SUBMITTED");
  return {
    data: rows,
    summary: {
      changeOrderCount: rows.length,
      pendingCount: rows.filter((row) => PENDING_CHANGE_ORDERS.includes(row.status)).length,
      awaitingGcCount: submitted.length,
      // Exposure, never revenue: this is precisely the money that is not
      // yet ours to count, and the description says so too.
      valueAwaitingGcDecision: submitted.reduce((sum, row) => sum + row.value, 0),
    },
    citations: [{ label: "Jobs", href: "/jobs" }],
    unavailable:
      rows.length === 0
        ? wanted && wanted !== "PENDING"
          ? `No change order is ${wanted.toLowerCase()}.`
          : "No change orders have been raised."
        : undefined,
  };
}

/**
 * Burdened labor cost booked to a job, priced the way /jobs/[id] prices it.
 *
 * THE COVERAGE FIGURE IS NOT OPTIONAL. `calculateTimeEntryLaborCost`
 * returns null when an entry has no craft tag or no rate schedule covers
 * its date — it never guesses a rate — so on a half-configured company the
 * total is real and partial at once. Reporting the money without the share
 * of hours it was drawn from is the same failure job_margin's two coverage
 * ratios exist to prevent: a number that reads as the answer while most of
 * the work is missing from it.
 */
async function jobLaborCost(companyId: string, input: Input): Promise<ToolResult> {
  const mismatch = await jobNameMismatch(companyId, input.jobName);
  if (mismatch) return { data: [], citations: [], unavailable: mismatch };

  const jobs = await prisma.job.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      contact: { select: { name: true } },
      timeEntries: {
        select: {
          hours: true,
          payType: true,
          date: true,
          craftClassificationId: true,
        },
      },
    },
  });

  const crafts = await prisma.craftClassification.findMany({
    where: { companyId },
    select: {
      id: true,
      fringeRateSchedules: {
        select: {
          baseWage: true,
          pensionRate: true,
          vacationRate: true,
          healthWelfareRate: true,
          trainingRate: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
      },
    },
  });
  const schedulesByCraft = new Map(
    crafts.map((craft) => [
      craft.id,
      craft.fringeRateSchedules.map((s) => ({
        baseWage: Number(s.baseWage),
        pensionRate: s.pensionRate != null ? Number(s.pensionRate) : null,
        vacationRate: s.vacationRate != null ? Number(s.vacationRate) : null,
        healthWelfareRate: s.healthWelfareRate != null ? Number(s.healthWelfareRate) : null,
        trainingRate: s.trainingRate != null ? Number(s.trainingRate) : null,
        effectiveFrom: s.effectiveFrom,
        effectiveTo: s.effectiveTo,
      })),
    ]),
  );

  const rows = jobs
    .filter((job) => matchesJobName(job.name, input.jobName))
    .filter((job) => job.timeEntries.length > 0)
    .map((job) => {
      let cost = 0;
      let hours = 0;
      let pricedHours = 0;
      for (const entry of job.timeEntries) {
        const entryHours = Number(entry.hours);
        hours += entryHours;
        const schedule = entry.craftClassificationId
          ? findEffectiveFringeRateSchedule(schedulesByCraft.get(entry.craftClassificationId) ?? [], entry.date)
          : null;
        const entryCost = calculateTimeEntryLaborCost(
          { hours: entryHours, payType: entry.payType, date: entry.date },
          schedule,
        );
        if (entryCost !== null) {
          cost += entryCost;
          pricedHours += entryHours;
        }
      }
      return {
        job: job.name,
        gc: job.contact.name,
        hoursLogged: hours,
        hoursPriced: pricedHours,
        // Null, not zero, when nothing could be priced: "we cannot price
        // these hours" and "these hours cost nothing" are different
        // answers and only one of them is true.
        burdenedLaborCost: pricedHours > 0 ? cost : null,
        // A fraction would be read as a percentage or multiplied — the
        // 100x mistake issue #103 caught on percentComplete. Formatted here.
        shareOfHoursPriced: hours > 0 ? `${Math.round((pricedHours / hours) * 100)}%` : "0%",
      };
    })
    .sort((a, b) => (b.burdenedLaborCost ?? 0) - (a.burdenedLaborCost ?? 0));

  const unpriced = rows.reduce((sum, row) => sum + (row.hoursLogged - row.hoursPriced), 0);
  return {
    data: rows,
    summary: {
      jobsWithHours: rows.length,
      hoursLogged: rows.reduce((sum, row) => sum + row.hoursLogged, 0),
      hoursNotPriced: unpriced,
      burdenedLaborCost: rows.reduce((sum, row) => sum + (row.burdenedLaborCost ?? 0), 0),
    },
    citations: [{ label: "Jobs", href: "/jobs" }],
    unavailable:
      rows.length === 0
        ? input.jobName
          ? "No hours have been logged on that job."
          : "No hours have been logged on any job."
        : undefined,
  };
}

/**
 * One year of the OSHA case log, plus the toolbox talks held.
 *
 * `isRecordable` is the log's own derivation — from the outcome, never
 * stored — so this and /safety cannot disagree about which cases are on
 * the 300. The year is the person's word for it resolved here, not by the
 * model: an unqualified question means the current year, which is what the
 * page defaults to.
 */
async function safetyRecord(companyId: string, input: Input): Promise<ToolResult> {
  const today = serverToday();
  const thisYear = Number(today.slice(0, 4));
  const asked = Number((input.year ?? "").trim());
  const year = Number.isInteger(asked) && asked > 1970 && asked <= thisYear + 1 ? asked : thisYear;

  const [incidents, talks] = await Promise.all([
    prisma.safetyIncident.findMany({
      where: { companyId, caseYear: year },
      orderBy: { caseNumber: "desc" },
      select: {
        caseNumber: true,
        caseYear: true,
        occurredAt: true,
        employeeName: true,
        classification: true,
        outcome: true,
        daysAway: true,
        daysRestricted: true,
        job: { select: { name: true } },
      },
    }),
    prisma.toolboxTalk.findMany({
      where: { companyId, heldOn: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
      orderBy: { heldOn: "desc" },
      select: { topic: true, heldOn: true, job: { select: { name: true } } },
    }),
  ]);

  const cases = incidents.map((incident) => ({
    case: `${incident.caseYear}-${incident.caseNumber}`,
    occurredOn: iso(incident.occurredAt),
    person: incident.employeeName,
    job: incident.job?.name ?? null,
    classification: classificationLabel(incident.classification),
    outcome: outcomeLabel(incident.outcome),
    recordable: isRecordable(incident.outcome),
    daysAway: incident.daysAway,
    daysRestricted: incident.daysRestricted,
  }));

  return {
    data: {
      year,
      cases,
      // Topic and date only. The attendee roster is free text and the
      // signature sheet is a photo, so naming who was there would be a
      // claim this data cannot support — see KNOWN_GAPS.
      toolboxTalks: talks.map((talk) => ({
        topic: talk.topic,
        heldOn: iso(talk.heldOn),
        job: talk.job?.name ?? null,
      })),
    },
    summary: {
      cases: cases.length,
      recordableCases: cases.filter((row) => row.recordable).length,
      casesWithDaysAway: cases.filter((row) => row.outcome === outcomeLabel("DAYS_AWAY")).length,
      daysAwayTotal: cases.reduce((sum, row) => sum + (row.daysAway ?? 0), 0),
      daysRestrictedTotal: cases.reduce((sum, row) => sum + (row.daysRestricted ?? 0), 0),
      toolboxTalks: talks.length,
    },
    citations: [{ label: "Safety", href: "/safety" }],
    unavailable:
      cases.length === 0 && talks.length === 0
        ? `Nothing is recorded for ${year}: no cases and no toolbox talks.`
        : undefined,
  };
}

/**
 * Submittals the GC or architect is sitting on.
 *
 * "Open" is derived from the LATEST revision, never stored — the same rule
 * the rest of this schema follows. That matters here rather than being
 * pedantic: a submittal rejected at revision 1 and re-sent as revision 2 is
 * open again, and reading the first revision would report it as closed on
 * the day it most needs chasing.
 *
 * A submittal with NO revisions has never been sent. It is a draft, not
 * something anyone is waiting on, and it is left out — counting it would
 * put the sub's own unfinished paperwork on a list titled "what the GC
 * owes us".
 */
async function openSubmittals(companyId: string, input: Input): Promise<ToolResult> {
  const citations = [{ label: "Submittals", href: "/submittals" }];
  const jobMismatch = await jobNameMismatch(companyId, input.jobName);
  if (jobMismatch) return { data: [], citations, unavailable: jobMismatch };

  const submittals = await prisma.submittal.findMany({
    where: { companyId },
    select: {
      number: true,
      title: true,
      specSection: true,
      job: { select: { name: true } },
      revisions: {
        orderBy: { revisionNumber: "desc" },
        take: 1,
        select: { revisionNumber: true, sentOn: true, dueBack: true, returnedOn: true },
      },
    },
    orderBy: { number: "asc" },
  });

  const today = serverToday();
  const onJob = submittals.filter((submittal) => matchesJobName(submittal.job.name, input.jobName));
  const open = onJob
    .flatMap((submittal) => {
      const latest = submittal.revisions[0];
      if (!latest || latest.returnedOn !== null) return [];
      const sentOn = iso(latest.sentOn);
      const dueBack = iso(latest.dueBack);
      return [
        {
          job: submittal.job.name,
          submittal: `#${submittal.number} ${submittal.title}`,
          specSection: submittal.specSection,
          revision: latest.revisionNumber,
          sentOn,
          daysOutstanding: sentOn ? daysBetween(sentOn, today) : null,
          dueBack,
          // Stated rather than left for the model to work out from two
          // dates, because "is it late" is the question and arithmetic is
          // the one thing the prompt forbids it to do.
          pastDue: dueBack === null ? null : daysBetween(dueBack, today) > 0,
        },
      ];
    })
    .sort((a, b) => (b.daysOutstanding ?? 0) - (a.daysOutstanding ?? 0));

  return {
    data: open,
    citations,
    unavailable:
      // THREE answers, not two. The company-wide empty register was split
      // out first; reviewing #303 found the same defect one level down —
      // a job that has never had a submittal raised was told every
      // submittal sent on it had come back, which reads as confirmation
      // that the job's log is clean and current.
      submittals.length === 0
        ? "No submittal has been raised at all. Nothing has been sent, so nothing is outstanding."
        : onJob.length === 0
          ? "No submittal has been raised on that job at all. Nothing has been sent, so nothing is outstanding."
          : open.length === 0
            ? input.jobName
              ? "Nothing is out with the GC on that job — every submittal sent has come back."
              : "Nothing is out with the GC. Every submittal sent has come back."
            : undefined,
  };
}

/**
 * Cards that have lapsed or are about to.
 *
 * Sorted worst first, and the sort is the product: a foreman asking this is
 * asking who cannot start on Monday, not for an inventory.
 *
 * A certification with NO expiry date is reported as undated and listed
 * last — never dropped, and never counted as current. An unknown date is
 * not a good one, and silently omitting it is how somebody gets turned away
 * at a gate holding a card this app said was fine.
 */
async function certificationExpiry(companyId: string, input: Input): Promise<ToolResult> {
  const citations = [{ label: "Certifications", href: "/certifications" }];
  const withinDays = expiryWindowDays(input.withinDays);
  const today = serverToday();

  const certifications = await prisma.workerCertification.findMany({
    where: { companyId },
    select: {
      kind: true,
      otherLabel: true,
      issuer: true,
      expiresOn: true,
      holder: { select: { name: true, email: true } },
    },
  });

  const rows = certifications
    .map((certification) => {
      const expiresOn = iso(certification.expiresOn);
      return {
        holder: certification.holder?.name ?? certification.holder?.email ?? null,
        certification: certificationLabel(certification.kind, certification.otherLabel),
        issuer: certification.issuer,
        expiresOn,
        daysUntilExpiry: expiresOn === null ? null : daysBetween(today, expiresOn),
        state: expiresOn === null ? ("undated" as const) : daysBetween(today, expiresOn) < 0 ? ("expired" as const) : ("expiring" as const),
      };
    })
    .filter((row) => row.expiresOn === null || (row.daysUntilExpiry ?? 0) <= withinDays)
    .sort((a, b) => {
      // Undated last: it is a gap in the records, not an emergency, and it
      // must not outrank a card that actually lapsed yesterday.
      if (a.daysUntilExpiry === null) return b.daysUntilExpiry === null ? 0 : 1;
      if (b.daysUntilExpiry === null) return -1;
      return a.daysUntilExpiry - b.daysUntilExpiry;
    });

  return {
    data: { withinDays, rows },
    citations,
    unavailable:
      // TWO different answers, and conflating them is how a reassuring
      // sentence gets said about an empty register. "Every one on file has
      // a date" is TRUE of no certifications at all, and for a union sub
      // "nobody has any cards recorded" is the bigger finding by far —
      // found by asking the live box on a database with none.
      certifications.length === 0
        ? "No certification is recorded for anyone. That is a gap in the records rather than a clean bill — nothing has been filed to expire."
        : rows.length === 0
          ? `No certification is expired or expiring within ${withinDays} days, and every one on file has a date.`
          : undefined,
  };
}


/**
 * Whether each job stayed inside its apprentice ratio, per union local.
 *
 * Every figure comes from `loadRatioReviews`, which is what
 * /union-compliance renders — so the assistant and the page cannot report
 * a different number of days over.
 *
 * Two things are stated here rather than left for the model to work out,
 * because both are the question rather than colour:
 *
 *   - `inRatio` is a verdict, and it is FALSE when any day is incomplete.
 *     A month with unclassified hours is not a compliant month; it is a
 *     month nobody can certify. Reporting it as compliant is the specific
 *     way this tool could do harm, since the answer would be quoted into a
 *     certified payroll conversation.
 *   - `rule` is the label the page shows ("1 apprentice per 3 journeymen"),
 *     not the two raw numbers, so the model cannot render the ratio upside
 *     down.
 */
async function apprenticeRatio(companyId: string, input: Input): Promise<ToolResult> {
  const citations = [{ label: "Union compliance", href: "/union-compliance" }];
  const month = ratioMonth(input.month, serverToday());
  const reviews = await loadRatioReviews(companyId, month);

  const rows = reviews.map((review) => ({
    job: review.jobName,
    unionLocal: review.unionLocalLabel,
    // Null when no rule is on file for that local: the hours were reviewed
    // against nothing, and saying "in ratio" would be a verdict from a rule
    // that does not exist.
    rule: review.rule ? ratioLabel(review.rule) : null,
    daysChecked: review.summary.daysChecked,
    daysOver: review.summary.daysOver,
    daysIncomplete: review.summary.daysIncomplete,
    worstExcessHours: review.summary.worstExcessHours,
    offendingDates: review.summary.offendingDates,
    inRatio:
      review.rule === null
        ? null
        : review.summary.daysOver === 0 && review.summary.daysIncomplete === 0,
  }));

  return {
    data: { month, rows },
    summary: {
      jobsReviewed: rows.length,
      jobsOverRatio: rows.filter((row) => row.daysOver > 0).length,
      jobsWithUnclassifiedHours: rows.filter((row) => row.daysIncomplete > 0).length,
    },
    citations,
    unavailable:
      rows.length === 0
        ? `No hours were logged against a union local in ${month}, so there is nothing to check the ratio against.`
        : undefined,
  };
}

/**
 * What is standing between each job and the last of its money.
 *
 * `blockers` arrives already ordered most-binding-first from
 * `closeoutReadiness`, and that order is preserved: a caller reading only
 * the first one gets the thing to do next rather than an arbitrary item.
 *
 * `retainageAtStake` rides alongside and is never presented as a blocker.
 * It is not something to fix — it is what the blockers are costing, which
 * is the sentence that makes somebody act on the list.
 */
async function closeoutStatus(companyId: string, input: Input): Promise<ToolResult> {
  const citations = [{ label: "Closeout", href: "/closeout" }];
  const jobMismatch = await jobNameMismatch(companyId, input.jobName);
  if (jobMismatch) return { data: [], citations, unavailable: jobMismatch };

  const jobs = await loadCloseoutJobs(companyId, serverToday());
  const rows = jobs
    .filter((job) => matchesJobName(job.name, input.jobName))
    .map((job) => ({
      job: job.name,
      gc: job.clientName,
      // The page's own words for both, so the answer and the screen cannot
      // describe the same job differently. "no closeout checklist yet, so
      // nothing has been asserted" is a sentence worth preserving exactly:
      // it is not the same claim as "nothing is wrong".
      stage: stageLabel(job.readiness.stage),
      blockers: job.readiness.blockers.map(blockerLabel),
      openPunchItems: job.openPunchItems,
      retainageAtStake: job.readiness.retainageAtStake,
      daysWithGc: job.readiness.daysWithGc,
    }));

  return {
    data: rows,
    summary: {
      jobs: rows.length,
      jobsBlocked: rows.filter((row) => row.blockers.length > 0).length,
    },
    citations,
    unavailable:
      rows.length === 0
        ? input.jobName
          ? "That job has nothing recorded on the closeout side yet."
          : "No job has anything recorded on the closeout side yet."
        : undefined,
  };
}


/**
 * What is owed to each local's trust funds for a month.
 *
 * Every figure comes from `loadRemittance`, which is what
 * /union-compliance/remittance renders — the fringe schedule in force on
 * each DAY worked, not the one in force today, which is the whole reason
 * that module exists rather than a multiplication here.
 *
 * `uncomputedHours` is lifted to the top of the result rather than left in
 * the detail, and the names come with it. An hour nobody could price is a
 * HOLE in the remittance: no craft tag, or no schedule effective on that
 * date. Valuing it at zero produces a total that looks like an answer and
 * underpays a fund, which is the one mistake here that costs a member
 * their benefits rather than costing the company a correction.
 */
async function fringeRemittance(companyId: string, input: Input): Promise<ToolResult> {
  const citations = [{ label: "Remittance", href: "/union-compliance/remittance" }];
  const month = ratioMonth(input.month, serverToday());
  const report = await loadRemittance(companyId, month);

  return {
    data: {
      month,
      filed: report.filed,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      locals: report.locals.map((local) => ({
        unionLocal: local.unionLocalLabel,
        hours: local.hours,
        pension: local.components.pension,
        vacation: local.components.vacation,
        healthWelfare: local.components.healthWelfare,
        training: local.components.training,
        total: local.total,
        uncomputedHours: local.uncomputedHours,
      })),
      // Named at the top level so an answer cannot be written without
      // meeting it.
      unpriced: {
        hours: report.uncomputedHours,
        people: report.uncomputedNames,
      },
    },
    summary: {
      totalHours: report.totalHours,
      total: report.total,
      unpricedHours: report.uncomputedHours,
      locals: report.locals.length,
    },
    citations,
    unavailable:
      report.locals.length === 0 && report.uncomputedHours === 0
        ? `No union hours were logged in ${month}, so there is nothing to remit.`
        : undefined,
  };
}

/**
 * What the GC is taking off the next cheque, and what we have not answered.
 *
 * The date to object by is the point of this one. A backcharge sits in an
 * email thread until it is simply deducted, and the window to dispute it is
 * contractual — so `pastRespondBy` is STATED, the same way open_submittals
 * states pastDue, rather than left as two dates for the model to subtract.
 *
 * `claimedAmount` is what the GC ASSERTS. It is never an agreed figure, and
 * the field name says so on the way through so an answer cannot quietly
 * present it as settled.
 */
async function backchargeExposure(companyId: string, input: Input): Promise<ToolResult> {
  const citations = [{ label: "Backcharges", href: "/backcharges" }];
  const jobMismatch = await jobNameMismatch(companyId, input.jobName);
  if (jobMismatch) return { data: [], citations, unavailable: jobMismatch };

  const backcharges = await prisma.backcharge.findMany({
    where: { companyId },
    select: {
      number: true,
      description: true,
      claimedAmount: true,
      status: true,
      issuedOn: true,
      respondByDate: true,
      job: { select: { name: true } },
    },
    orderBy: { issuedOn: "desc" },
  });

  const today = serverToday();
  const rows = backcharges
    .filter((backcharge) => matchesJobName(backcharge.job.name, input.jobName))
    .map((backcharge) => {
      const respondBy = iso(backcharge.respondByDate);
      return {
        job: backcharge.job.name,
        backcharge: `#${backcharge.number} ${backcharge.description}`,
        claimedAmount: Number(backcharge.claimedAmount),
        status: backcharge.status,
        issuedOn: iso(backcharge.issuedOn),
        respondBy,
        // Null, not false, when no date was recorded — false would claim
        // there is still time, which nobody knows.
        pastRespondBy: respondBy === null ? null : daysBetween(respondBy, today) > 0,
      };
    });

  // Still ours to answer. SETTLED, ACCEPTED and WITHDRAWN are closed, and
  // an answered backcharge is not exposure even while the money moves.
  const open = rows.filter((row) => row.status === "RECEIVED" || row.status === "DISPUTED");

  return {
    data: rows,
    summary: {
      backcharges: rows.length,
      openBackcharges: open.length,
      openClaimedTotal: open.reduce((sum, row) => sum + row.claimedAmount, 0),
      // Over the OPEN ones only. A settled backcharge whose window lapsed
      // months ago is not a thing anyone can still act on, and counting it
      // inflates the one number here meant to make somebody move today.
      pastRespondBy: open.filter((row) => row.pastRespondBy === true).length,
    },
    citations,
    unavailable:
      rows.length === 0
        ? input.jobName
          ? "No backcharge has been issued against that job."
          : "No backcharge has been issued against this company."
        : undefined,
  };
}


/**
 * Where every apprentice stands against their programme.
 *
 * From `loadApprenticeships`, which /union-compliance renders.
 *
 * The value here is in what it REFUSES to flatten. `RequirementStanding`
 * distinguishes three states a summary would collapse into "not met", and
 * they call for different actions by different people:
 *
 *   SHORT — hours are recorded and they are under. Chase the hours.
 *   NOT_RECORDED — there is a requirement and nobody logged anything.
 *     Chase the paperwork, not the apprentice.
 *   NO_REQUIREMENT_RECORDED — the programme has no figure on file, so
 *     there is nothing to measure against and saying "short" would be
 *     inventing a standard.
 *
 * `CONTRADICTORY` is passed through for the same reason: an enrollment
 * carrying both a completion and a cancellation date is a data-entry error
 * on a compliance record, and resolving it by precedence hides it.
 */
async function apprenticeshipStanding(companyId: string): Promise<ToolResult> {
  const citations = [{ label: "Union compliance", href: "/union-compliance" }];
  const standings = await loadApprenticeships(companyId, serverToday());

  const rows = standings.map((standing) => ({
    apprentice: standing.apprenticeName,
    sponsor: standing.sponsorName,
    programNumber: standing.programNumber,
    craft: standing.craftName,
    unionLocal: standing.localName,
    state: standing.state,
    period: standing.period,
    ojtHoursThisPeriod: standing.ojtHoursThisPeriod,
    requiredOjtHoursPerPeriod: standing.requiredOjtHoursPerPeriod,
    ojtStanding: standing.ojt,
    ojtShortfall: standing.ojtShortfall,
  }));

  return {
    data: rows,
    summary: {
      apprentices: rows.length,
      active: rows.filter((row) => row.state === "ACTIVE").length,
      short: rows.filter((row) => row.ojtStanding === "SHORT").length,
      // Counted apart from `short` on purpose: nobody is behind on these,
      // the records are. Folding them together sends somebody to talk to an
      // apprentice about hours when the problem is a blank field.
      hoursNotRecorded: rows.filter((row) => row.ojtStanding === "NOT_RECORDED").length,
      noRequirementOnFile: rows.filter((row) => row.ojtStanding === "NO_REQUIREMENT_RECORDED").length,
      contradictory: rows.filter((row) => row.state === "CONTRADICTORY").length,
    },
    citations,
    unavailable: rows.length === 0 ? "Nobody is enrolled in an apprenticeship programme here." : undefined,
  };
}

/**
 * What was written up on site, most recent first.
 *
 * A delay recorded on the day is the contemporaneous record a delay claim
 * is later built on, so reports carrying one are flagged and counted — that
 * is the question this gets asked for, months later, by somebody assembling
 * a claim.
 *
 * The `unavailable` sentence is careful: a job with no reports is a job
 * nobody wrote up, which is NOT the same as a job where nothing happened,
 * and an answer that implies the second is worse than no answer.
 */
async function dailyFieldReports(companyId: string, input: Input): Promise<ToolResult> {
  const citations = [{ label: "Field reports", href: "/field-reports" }];
  const jobMismatch = await jobNameMismatch(companyId, input.jobName);
  if (jobMismatch) return { data: [], citations, unavailable: jobMismatch };

  const reports = await prisma.dailyFieldReport.findMany({
    // The job filter is in the WHERE, not applied after the take. With
    // `take: 40` company-wide and the filter afterwards, a job whose
    // reports fall outside the 40 most recent across every job came back
    // empty — and the empty state then says "nobody wrote one up", a
    // confident, specific, false claim about the paperwork a delay claim
    // is built from. Found reviewing #303. `contains` + insensitive is
    // exactly what matchesJobName does, so nothing else changes.
    where: {
      companyId,
      ...(input.jobName?.trim()
        ? { job: { name: { contains: input.jobName.trim(), mode: "insensitive" as const } } }
        : {}),
    },
    select: {
      reportDate: true,
      workPerformed: true,
      crewPresent: true,
      weather: true,
      delays: true,
      job: { select: { name: true } },
      filedBy: { select: { name: true, email: true } },
    },
    orderBy: { reportDate: "desc" },
    take: 40,
  });

  const rows = reports
    .map((report) => ({
      job: report.job.name,
      date: iso(report.reportDate),
      workPerformed: report.workPerformed,
      crewPresent: report.crewPresent,
      weather: report.weather,
      delay: report.delays,
      hasDelay: Boolean(report.delays?.trim()),
      filedBy: report.filedBy?.name ?? report.filedBy?.email ?? null,
    }));

  return {
    data: rows,
    summary: {
      reports: rows.length,
      reportsWithADelay: rows.filter((row) => row.hasDelay).length,
    },
    citations,
    unavailable:
      rows.length === 0
        ? input.jobName
          ? "No field report has been filed on that job. That means nobody wrote one up, not that nothing happened."
          : "No field report has been filed. That means nobody wrote one up, not that nothing happened."
        : undefined,
  };
}

/**
 * Which jobs have a prevailing-wage determination on file, and whether the
 * document is actually there.
 *
 * A row with NEITHER a file nor a source link is a determination in name
 * only: it cannot be produced in an audit, and it is the shape most likely
 * to be mistaken for coverage. Flagged rather than counted as filed.
 *
 * What this deliberately does NOT do is say a determination is MISSING.
 * Nothing in the schema records whether a job is public works, so "this job
 * has no determination" is not evidence of a gap — it may simply be private
 * work. Claiming otherwise would put a compliance alarm on a job that never
 * needed one.
 */
async function wageDeterminations(companyId: string, input: Input): Promise<ToolResult> {
  const citations = [{ label: "Prevailing wage", href: "/prevailing-wage" }];
  const jobMismatch = await jobNameMismatch(companyId, input.jobName);
  if (jobMismatch) return { data: [], citations, unavailable: jobMismatch };

  const determinations = await prisma.prevailingWageDetermination.findMany({
    where: { job: { companyId } },
    select: {
      jurisdiction: true,
      fileName: true,
      fileUrl: true,
      sourceUrl: true,
      note: true,
      createdAt: true,
      job: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = determinations
    .filter((determination) => matchesJobName(determination.job.name, input.jobName))
    .map((determination) => ({
      job: determination.job.name,
      jurisdiction: determination.jurisdiction,
      fileName: determination.fileName,
      hasDocument: Boolean(determination.fileUrl),
      hasSourceLink: Boolean(determination.sourceUrl),
      // The one that matters. Neither attached nor linked is a row that
      // proves nothing.
      producibleInAnAudit: Boolean(determination.fileUrl) || Boolean(determination.sourceUrl),
      filedOn: iso(determination.createdAt),
    }));

  return {
    data: rows,
    summary: {
      determinations: rows.length,
      withoutDocumentOrLink: rows.filter((row) => !row.producibleInAnAudit).length,
      jobsCovered: new Set(rows.map((row) => row.job)).size,
    },
    citations,
    unavailable:
      rows.length === 0
        ? input.jobName
          ? "No wage determination has been filed against that job. Whether one is required is not recorded anywhere here."
          : "No wage determination has been filed against any job. Whether any of them are public works is not recorded anywhere here."
        : undefined,
  };
}


/**
 * What has been photographed on each job.
 *
 * The date reported is `capturedAt` — when the photo was TAKEN — not
 * `createdAt`, when somebody got round to uploading it. A dispute turns on
 * the first and never the second, and they can be weeks apart when a
 * foreman clears his phone at the end of a month.
 *
 * A count is not proof of coverage, which the tool description says out
 * loud. Nothing here can know whether the thing somebody needs a picture OF
 * was photographed — only how many exist.
 */
async function jobPhotos(companyId: string, input: Input): Promise<ToolResult> {
  const citations = [{ label: "Site photos", href: "/photos" }];
  const jobMismatch = await jobNameMismatch(companyId, input.jobName);
  if (jobMismatch) return { data: [], citations, unavailable: jobMismatch };

  const media = await prisma.jobMedia.findMany({
    where: { companyId },
    select: {
      capturedAt: true,
      caption: true,
      sharedWithClientAt: true,
      job: { select: { name: true } },
    },
  });

  const byJob = new Map<string, { captures: number; captioned: number; shared: number; latest: string | null }>();
  for (const item of media) {
    if (!matchesJobName(item.job.name, input.jobName)) continue;
    const row = byJob.get(item.job.name) ?? { captures: 0, captioned: 0, shared: 0, latest: null };
    row.captures += 1;
    if (item.caption?.trim()) row.captioned += 1;
    if (item.sharedWithClientAt) row.shared += 1;
    const taken = iso(item.capturedAt);
    if (taken && (row.latest === null || taken > row.latest)) row.latest = taken;
    byJob.set(item.job.name, row);
  }

  const rows = [...byJob.entries()]
    .map(([job, row]) => ({ job, ...row, latestCapturedOn: row.latest }))
    .sort((a, b) => (b.latestCapturedOn ?? "").localeCompare(a.latestCapturedOn ?? ""));

  return {
    data: rows.map(({ latest: _latest, ...row }) => row),
    summary: {
      jobsWithPhotos: rows.length,
      captures: rows.reduce((sum, row) => sum + row.captures, 0),
      sharedWithTheGc: rows.reduce((sum, row) => sum + row.shared, 0),
    },
    citations,
    unavailable:
      rows.length === 0
        ? input.jobName
          ? "No photo has been captured on that job."
          : "No photo has been captured on any job."
        : undefined,
  };
}

/**
 * What vendors have quoted, and whether it is still good.
 *
 * The validity date is the point. An expired quote carried into a bid is
 * how a job gets mis-priced, so `expired` is STATED rather than left as two
 * dates for the model to compare — the same rule open_submittals and
 * backcharge_exposure follow.
 *
 * A quote with NO validity date is `null`, not `false`. "Not expired" would
 * be a claim that the price still stands, and nobody recorded anything that
 * says so.
 */
async function vendorPricing(companyId: string): Promise<ToolResult> {
  const citations = [{ label: "Vendor pricing", href: "/vendors/pricing" }];
  const quotes = await prisma.vendorPriceQuote.findMany({
    where: { companyId },
    select: {
      description: true,
      unit: true,
      unitPrice: true,
      quotedOn: true,
      validUntil: true,
      vendor: { select: { name: true } },
    },
    orderBy: { quotedOn: "desc" },
  });

  const today = serverToday();
  const rows = quotes.map((quote) => {
    const validUntil = iso(quote.validUntil);
    return {
      material: quote.description,
      vendor: quote.vendor?.name ?? null,
      unit: quote.unit,
      unitPrice: Number(quote.unitPrice),
      quotedOn: iso(quote.quotedOn),
      validUntil,
      expired: validUntil === null ? null : daysBetween(validUntil, today) > 0,
    };
  });

  return {
    data: rows,
    summary: {
      quotes: rows.length,
      expired: rows.filter((row) => row.expired === true).length,
      // Counted apart from expired: an undated quote is a records gap, not
      // a stale price, and the fix is to ask the vendor for terms.
      withoutAValidityDate: rows.filter((row) => row.expired === null).length,
    },
    citations,
    unavailable: rows.length === 0 ? "No vendor price has been recorded." : undefined,
  };
}

/**
 * Whether each GC relationship is still in force.
 *
 * Three independent things, none of which implies another: the MSA, the
 * prequalification, and whether the portal link they hold still works.
 *
 * Every date here is reported as UNRECORDED when null rather than as
 * current. That is the same rule certification_expiry follows and it
 * matters more here, because "the MSA is fine" is the sentence somebody
 * repeats to a GC before finding out it lapsed in March.
 */
async function gcRelationship(companyId: string): Promise<ToolResult> {
  const citations = [{ label: "Contacts", href: "/contacts" }];
  const contacts = await prisma.contact.findMany({
    where: { companyId },
    select: {
      name: true,
      msaExpirationDate: true,
      prequalificationExpiresAt: true,
      portalToken: true,
      portalRevokedAt: true,
    },
    orderBy: { name: "asc" },
  });

  const today = serverToday();
  const state = (date: string | null) =>
    date === null ? ("unrecorded" as const) : daysBetween(date, today) > 0 ? ("expired" as const) : ("current" as const);

  const rows = contacts.map((contact) => {
    const msa = iso(contact.msaExpirationDate);
    const prequal = iso(contact.prequalificationExpiresAt);
    return {
      contact: contact.name,
      msaExpiresOn: msa,
      msa: state(msa),
      prequalificationExpiresOn: prequal,
      prequalification: state(prequal),
      // Separate from the two above on purpose: a live portal link is a
      // thing somebody can still open, whatever the paperwork says.
      portalLink: contact.portalToken === null ? ("never issued" as const) : contact.portalRevokedAt ? ("revoked" as const) : ("live" as const),
    };
  });

  return {
    data: rows,
    summary: {
      contacts: rows.length,
      msaExpired: rows.filter((row) => row.msa === "expired").length,
      prequalificationExpired: rows.filter((row) => row.prequalification === "expired").length,
      livePortalLinks: rows.filter((row) => row.portalLink === "live").length,
    },
    citations,
    unavailable: rows.length === 0 ? "No GC or client is on file." : undefined,
  };
}


/**
 * Where each pay application sits in the GC's process.
 *
 * Deliberately NOT the same question as `receivables`, which answers who
 * owes what and how overdue. This answers whether the GC has moved it
 * along, which is the question asked the week before the money is late
 * rather than the week after.
 *
 * DISPUTED is pulled out because it changes what somebody does. Everything
 * else on this list is a timing problem and gets chased; a disputed
 * application is a conversation, and chasing it as though it were slow is
 * how a fortnight is lost.
 */
async function payApplicationStatus(companyId: string, input: Input): Promise<ToolResult> {
  const citations = [{ label: "Jobs", href: "/jobs" }];
  const jobMismatch = await jobNameMismatch(companyId, input.jobName);
  if (jobMismatch) return { data: [], citations, unavailable: jobMismatch };

  const invoices = await prisma.invoice.findMany({
    where: { job: { companyId } },
    select: {
      number: true,
      description: true,
      amount: true,
      status: true,
      issuedAt: true,
      job: { select: { name: true } },
    },
    orderBy: { issuedAt: "desc" },
  });

  const today = serverToday();
  const rows = invoices
    .filter((invoice) => matchesJobName(invoice.job.name, input.jobName))
    .map((invoice) => {
      const issuedOn = iso(invoice.issuedAt);
      return {
        job: invoice.job.name,
        application: `#${invoice.number}${invoice.description ? ` ${invoice.description}` : ""}`,
        amount: Number(invoice.amount),
        status: invoice.status,
        issuedOn,
        daysSinceIssued: issuedOn ? daysBetween(issuedOn, today) : null,
      };
    });

  const awaiting = rows.filter((row) => row.status === "SUBMITTED");
  const disputed = rows.filter((row) => row.status === "DISPUTED");

  return {
    data: rows,
    summary: {
      applications: rows.length,
      awaitingApproval: awaiting.length,
      awaitingApprovalTotal: awaiting.reduce((sum, row) => sum + row.amount, 0),
      // Its own line. A disputed application is not a slow one.
      disputed: disputed.length,
      disputedTotal: disputed.reduce((sum, row) => sum + row.amount, 0),
    },
    citations,
    unavailable:
      rows.length === 0
        ? input.jobName
          ? "Nothing has been billed on that job yet."
          : "Nothing has been billed yet."
        : undefined,
  };
}

/**
 * What is still coming back on us after the job finished.
 *
 * The end date is DERIVED from the start date and the number of months,
 * never stored — the rule this schema follows everywhere, and the reason a
 * stored flag cannot disagree with what it was derived from.
 *
 * A job with NO warranty period recorded is reported as unrecorded, not as
 * out of warranty. Nothing here knows what a subcontract actually obliges;
 * it knows what somebody typed. Saying "you are clear" from an empty field
 * is the one answer this tool must not give.
 */
async function warrantyObligations(companyId: string, input: Input): Promise<ToolResult> {
  const citations = [{ label: "Closeout", href: "/closeout" }];
  const jobMismatch = await jobNameMismatch(companyId, input.jobName);
  if (jobMismatch) return { data: [], citations, unavailable: jobMismatch };

  const jobs = await prisma.job.findMany({
    where: { companyId },
    select: {
      name: true,
      warrantyPeriod: { select: { startsOn: true, months: true } },
      warrantyServiceRequests: { select: { reportedOn: true, resolvedOn: true, description: true } },
    },
  });

  const today = serverToday();
  const rows = jobs
    .filter((job) => matchesJobName(job.name, input.jobName))
    .filter((job) => job.warrantyPeriod !== null || job.warrantyServiceRequests.length > 0)
    .map((job) => {
      const startsOn = iso(job.warrantyPeriod?.startsOn ?? null);
      const endsOn =
        startsOn && job.warrantyPeriod ? addMonthsClamped(startsOn, job.warrantyPeriod.months) : null;
      const open = job.warrantyServiceRequests.filter((request) => request.resolvedOn === null);
      return {
        job: job.name,
        warrantyStartsOn: startsOn,
        warrantyMonths: job.warrantyPeriod?.months ?? null,
        warrantyEndsOn: endsOn,
        // "unrecorded" rather than "out of warranty" when nothing is on file.
        warranty: endsOn === null ? ("unrecorded" as const) : daysBetween(endsOn, today) > 0 ? ("expired" as const) : ("in force" as const),
        callbacks: job.warrantyServiceRequests.length,
        openCallbacks: open.length,
        oldestOpenCallbackReportedOn: open
          .map((request) => iso(request.reportedOn))
          .filter((date): date is string => date !== null)
          .sort()[0] ?? null,
      };
    })
    .sort((a, b) => b.openCallbacks - a.openCallbacks);

  return {
    data: rows,
    summary: {
      jobs: rows.length,
      inForce: rows.filter((row) => row.warranty === "in force").length,
      withoutAWarrantyRecorded: rows.filter((row) => row.warranty === "unrecorded").length,
      openCallbacks: rows.reduce((sum, row) => sum + row.openCallbacks, 0),
    },
    citations,
    unavailable:
      rows.length === 0
        ? input.jobName
          ? "No warranty period or callback is recorded against that job. That is not the same as being out of warranty — nothing was entered."
          : "No warranty period or callback is recorded against any job. That is not the same as being clear — nothing was entered."
        : undefined,
  };
}

/**
 * What was sent, and whether it actually arrived.
 *
 * The delivery vocabulary is already written down in `MessageEventType` and
 * this tool exists to carry it faithfully rather than flatten it:
 *
 *   SENT      handed to the provider. NOT the same as arrived.
 *   DELIVERED the receiving server took it. The only status that means
 *             anything.
 *   BOUNCED   rejected, and `detail` carries the reason, which is what
 *             makes it fixable.
 *   OPENED    the weakest signal here. Image-blocking makes its ABSENCE
 *             meaningless, so this reports opens and never concludes
 *             anything from not having one.
 *
 * The latest event per message is what is reported: a message that bounced
 * after being sent is bounced, and reading the first event would call it
 * sent.
 */
async function outboundMessages(companyId: string): Promise<ToolResult> {
  const citations = [{ label: "Messages", href: "/messages" }];
  const messages = await prisma.outboundMessage.findMany({
    where: { companyId },
    select: {
      toAddress: true,
      toName: true,
      subject: true,
      createdAt: true,
      job: { select: { name: true } },
      events: { orderBy: { occurredAt: "desc" }, select: { type: true, occurredAt: true, detail: true } },
    },
    orderBy: { createdAt: "desc" },
    // No `take`. It was 50, and the SUMMARY was computed from the capped
    // set and presented as company-wide totals — 500 sent with 30 bounces
    // answered "50 messages, 2 need attention". `forModel` caps what
    // reaches the model and says so; a cap in the query happens before the
    // counting, and no downstream note can correct it. Found reviewing #303.
  });

  const rows = messages.map((message) => {
    // The LATEST event, not the first. A message that bounced after being
    // sent is bounced.
    const latest = message.events[0] ?? null;
    const failure = message.events.find(
      (event) => event.type === "BOUNCED" || event.type === "FAILED" || event.type === "COMPLAINED",
    );
    return {
      to: message.toName ? `${message.toName} <${message.toAddress}>` : message.toAddress,
      subject: message.subject,
      job: message.job?.name ?? null,
      sentOn: iso(message.createdAt),
      // Null when nothing has come back yet — not "sent", which would be a
      // claim the provider confirmed something it has not.
      latestEvent: latest?.type ?? null,
      latestEventOn: iso(latest?.occurredAt ?? null),
      failureReason: failure?.detail ?? null,
      opened: message.events.some((event) => event.type === "OPENED"),
    };
  });

  return {
    data: rows,
    summary: {
      messages: rows.length,
      delivered: rows.filter((row) => row.latestEvent === "DELIVERED").length,
      // The three that need somebody. Counted together because the action is
      // the same — look at the reason — and apart from everything else.
      needingAttention: rows.filter(
        (row) => row.latestEvent === "BOUNCED" || row.latestEvent === "FAILED" || row.latestEvent === "COMPLAINED",
      ).length,
      noEventYet: rows.filter((row) => row.latestEvent === null).length,
    },
    citations,
    unavailable: rows.length === 0 ? "No email has been sent from here." : undefined,
  };
}

/* ══════════════════════════════════════════════════════════════════════
 * THE EIGHT THE ASSISTANT COULD NOT SEE
 *
 * Every one of these reads a screen this app already has. They came out of
 * the hundred-question census (lib/ask/eval/top-questions.ts), which asked
 * what a contractor says on a Tuesday rather than what the registry was
 * built to serve — and found that eight of the thirteen unanswerable
 * questions were about features already built. Not missing features:
 * BUILT SCREENS THE ASSISTANT COULD NOT SEE, which is a much cheaper
 * problem and was invisible until the questions sat next to the registry.
 *
 * One question the census raised is deliberately NOT here. "What's in the
 * pipeline we haven't bid?" looked like a tool over SalesLead — and
 * sales.prisma's first line says that model is PROVA'S OWN CRM, for
 * selling this product, populated only on the operator company. A tool
 * over it would have handed every tenant the vendor's sales pipeline. It
 * stays a gap, with a corrected reason, and the near-miss is recorded in
 * tools.ts KNOWN_GAPS so the model refuses it rather than reaching for
 * bid_status.
 * ══════════════════════════════════════════════════════════════════════ */

/** How many weeks of payroll `certified_payroll` looks back over. Eight is
 * two months — long enough that a week somebody forgot is still in view,
 * short enough that the answer is readable. */
const CERTIFIED_PAYROLL_WEEKS = 8;

/**
 * Whether each recent week's payroll could actually PRODUCE a WH-347, and
 * what would be blank on it if it did.
 *
 * WHAT THIS DOES NOT SAY, and it is the first thing the tool says: nothing
 * in this app records that a week was FILED. There is no submission model —
 * the page computes a week live from TimeEntry every time it is opened — so
 * "is certified payroll in?" cannot be answered as asked, and this tool
 * must not let that read as a yes. What it answers instead is the question
 * underneath: is the week's data complete enough that the form would come
 * out right.
 *
 * Three ways it comes out wrong, and each is counted separately because
 * each sends a different person to do a different thing:
 *
 *   - HOURS THAT CANNOT BE PRICED. No fringe rate schedule in force for
 *     that craft on that day, so the wage column is blank. Somebody has to
 *     enter a rate schedule.
 *   - A WORKER WITH NO CRAFT TAG. The classification column is blank and
 *     the ratio review cannot see them either. Somebody has to tag them.
 *   - A WORKER WITH NO NAME ON THEIR ACCOUNT. The name column is blank,
 *     and lib/worker-name.ts is emphatic about why that matters: this
 *     column is a statement to a government agency about who did the work.
 *
 * The stakes are why this tool is first in this block. The certification
 * on a WH-347 is criminal, and debarment under 29 CFR 5.12 reaches the
 * owner personally for three years.
 */
async function certifiedPayroll(companyId: string, input: Input): Promise<ToolResult> {
  const mismatch = await jobNameMismatch(companyId, input.jobName);
  const citations = [{ label: "Certified payroll", href: "/jobs" }];
  if (mismatch) return { data: null, citations, unavailable: mismatch };

  const today = serverToday();
  // Back to the start of the week containing the day CERTIFIED_PAYROLL_WEEKS
  // weeks ago, so the oldest week in range is whole rather than clipped.
  const earliest = certifiedPayrollWeekStart(
    new Date(new Date(`${today}T00:00:00.000Z`).getTime() - CERTIFIED_PAYROLL_WEEKS * 7 * 86_400_000),
  );

  const [entries, crafts] = await Promise.all([
    prisma.timeEntry.findMany({
      // Scoped through the job to this company, and filtered in the QUERY
      // rather than afterwards — the defect that shipped in daily_field_reports
      // was a company-wide `take` running before an in-memory job filter.
      where: {
        job: {
          companyId,
          ...(input.jobName?.trim()
            ? { name: { contains: input.jobName.trim(), mode: "insensitive" as const } }
            : {}),
        },
        date: { gte: earliest },
      },
      select: {
        date: true,
        hours: true,
        payType: true,
        employeeUserId: true,
        crewMemberId: true,
        craftClassificationId: true,
        job: { select: { name: true } },
        employeeUser: { select: { name: true, email: true } },
        // The three legal-name parts, because lib/worker-name.ts builds the
        // payroll name from them and a `name` column does not exist here —
        // a crew member is a no-login worker recorded for exactly this form.
        crewMember: { select: { legalFirstName: true, legalMiddleName: true, legalLastName: true } },
      },
      orderBy: { date: "desc" },
    }),
    prisma.craftClassification.findMany({
      where: { companyId },
      select: { id: true, fringeRateSchedules: { orderBy: { effectiveFrom: "desc" } } },
    }),
  ]);

  const schedulesByCraft = new Map(
    crafts.map((craft) => [
      craft.id,
      craft.fringeRateSchedules.map((s) => ({
        baseWage: Number(s.baseWage),
        pensionRate: s.pensionRate != null ? Number(s.pensionRate) : null,
        vacationRate: s.vacationRate != null ? Number(s.vacationRate) : null,
        healthWelfareRate: s.healthWelfareRate != null ? Number(s.healthWelfareRate) : null,
        trainingRate: s.trainingRate != null ? Number(s.trainingRate) : null,
        effectiveFrom: s.effectiveFrom,
        effectiveTo: s.effectiveTo,
      })),
    ]),
  );

  type Week = {
    job: string;
    weekEnding: string;
    workers: Set<string>;
    hours: number;
    unpricedHours: number;
    noCraft: Set<string>;
    noName: Set<string>;
  };
  const weeks = new Map<string, Week>();

  for (const entry of entries) {
    const start = certifiedPayrollWeekStart(entry.date);
    // The week ENDING date, because that is what a payroll week is called
    // and what goes in the box on the form.
    const ending = iso(new Date(start.getTime() + 6 * 86_400_000))!;
    const key = `${entry.job.name}::${ending}`;
    let week = weeks.get(key);
    if (!week) {
      week = {
        job: entry.job.name,
        weekEnding: ending,
        workers: new Set(),
        hours: 0,
        unpricedHours: 0,
        noCraft: new Set(),
        noName: new Set(),
      };
      weeks.set(key, week);
    }

    const who = timeEntryWorkerId(entry);
    const hours = Number(entry.hours);
    week.workers.add(who);
    week.hours += hours;

    if (!entry.craftClassificationId) {
      week.noCraft.add(who);
    }
    if (timeEntryWorkerName(entry).nameMissing) {
      week.noName.add(who);
    }

    // Priced with the schedule in force on the ENTRY'S OWN DATE, the same
    // rule job_labor_cost and the page both use. A week straddling a rate
    // change must not be priced at one rate throughout.
    const schedule = findEffectiveFringeRateSchedule(
      entry.craftClassificationId ? (schedulesByCraft.get(entry.craftClassificationId) ?? []) : [],
      entry.date,
    );
    const cost = calculateTimeEntryLaborCost(
      { hours, payType: entry.payType, date: entry.date },
      schedule,
    );
    // ONLY when a craft WAS assigned. An entry with no craft is already
    // counted under `workersWithNoCraft`, and it cannot be priced either —
    // so counting it here too put the same worker under two holes and
    // undid the point of separating them. The three counts exist because
    // each sends a different person to do a different thing, and "10 hours
    // need a rate schedule" stops being actionable the moment it silently
    // includes hours that need a craft tag instead. Found by the test
    // asserting 10 and getting 16.
    if (cost == null && entry.craftClassificationId) week.unpricedHours += hours;
  }

  const rows = [...weeks.values()]
    .sort((a, b) => (a.weekEnding === b.weekEnding ? a.job.localeCompare(b.job) : b.weekEnding.localeCompare(a.weekEnding)))
    .map((week) => ({
      job: week.job,
      weekEnding: week.weekEnding,
      workers: week.workers.size,
      hours: Number(week.hours.toFixed(2)),
      // The three ways the form comes out with holes in it.
      hoursWithNoRate: Number(week.unpricedHours.toFixed(2)),
      workersWithNoCraft: week.noCraft.size,
      workersWithNoName: week.noName.size,
      readyToProduce: week.unpricedHours === 0 && week.noCraft.size === 0 && week.noName.size === 0,
      // Said on EVERY row rather than once in a note, because a row is what
      // gets quoted back and a caveat that only exists in the preamble is a
      // caveat that gets dropped.
      filed: "not recorded — this app does not track a payroll submission",
    }));

  return {
    data: rows,
    summary: {
      weeks: rows.length,
      weeksReadyToProduce: rows.filter((row) => row.readyToProduce).length,
      weeksWithHoles: rows.filter((row) => !row.readyToProduce).length,
    },
    citations,
    unavailable:
      rows.length === 0
        ? input.jobName
          ? `No hours have been logged on that job in the last ${CERTIFIED_PAYROLL_WEEKS} weeks, so there is no payroll week to produce. That is a gap in the records rather than a clean bill.`
          : `No hours have been logged anywhere in the last ${CERTIFIED_PAYROLL_WEEKS} weeks, so there is no payroll week to produce. That is a gap in the records rather than a clean bill.`
        : undefined,
  };
}

/**
 * Time-and-material tickets, and whether anybody signed them.
 *
 * `TmTicket` is written by the phone app and had no web page and no tool at
 * all, which made this the most expensive unanswerable question on the
 * census: an unsigned T&M ticket is extra work performed and never paid
 * for, and nobody finds out until the job closes.
 *
 * `signerName` and `signedAt` are non-null on the model, so every row here
 * IS signed — which sounds like there is nothing to report and is exactly
 * backwards. What the ticket does not carry is any link to a change order
 * or an invoice, so a signed ticket can sit there unbilled forever. This
 * reports the tickets, their age, and says plainly that whether one was
 * billed is not recorded rather than implying a signed ticket is a settled
 * one.
 */
async function tmTickets(companyId: string, input: Input): Promise<ToolResult> {
  const mismatch = await jobNameMismatch(companyId, input.jobName);
  const citations = [{ label: "Jobs", href: "/jobs" }];
  if (mismatch) return { data: null, citations, unavailable: mismatch };

  const today = serverToday();
  const tickets = await prisma.tmTicket.findMany({
    where: {
      companyId,
      ...(input.jobName?.trim()
        ? { job: { name: { contains: input.jobName.trim(), mode: "insensitive" as const } } }
        : {}),
    },
    select: {
      workDate: true,
      workDescription: true,
      signerName: true,
      signedAt: true,
      job: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
    },
    orderBy: { workDate: "desc" },
  });

  const rows = tickets.map((ticket) => ({
    job: ticket.job.name,
    workDate: iso(ticket.workDate),
    work: ticket.workDescription,
    signedBy: ticket.signerName,
    signedOn: iso(ticket.signedAt),
    daysSinceSigned: daysBetween(iso(ticket.signedAt)!, today),
    raisedBy: ticket.createdBy?.name ?? ticket.createdBy?.email ?? null,
    // NOT a status. Nothing joins a ticket to a change order or an invoice,
    // and a field called `billed: false` would be a claim this app cannot
    // make. Saying so on the row is the honest form.
    billed: "not recorded — nothing links a ticket to a change order or an invoice",
  }));

  return {
    data: rows,
    summary: {
      tickets: rows.length,
      // The ones old enough that somebody should have chased them. Thirty
      // days is the ordinary pay-application cycle in this trade.
      olderThan30Days: rows.filter((row) => row.daysSinceSigned > 30).length,
    },
    citations,
    unavailable:
      rows.length === 0
        ? input.jobName
          ? "No time-and-material ticket has been raised on that job. Nothing was written up, which is not the same as no extra work having been done."
          : "No time-and-material ticket has been raised at all. Nothing was written up, which is not the same as no extra work having been done."
        : undefined,
  };
}

/**
 * Approved change orders and how much of each has actually been billed.
 *
 * The census called this a gap and it was WRONG about why: the join does
 * exist. An approved change order writes its added scope onto
 * `JobLineItem` (relation "OriginChangeOrder"), and `InvoiceLineItem`
 * points at `JobLineItem` — so added value and billed value are both
 * reachable. Recorded here rather than quietly fixed, because a gap list
 * that is wrong in this direction is worse than one that is wrong the
 * other way: it stops anybody looking.
 *
 * TWO BLIND SPOTS, BOTH REPORTED RATHER THAN PAPERED OVER.
 *
 * `InvoiceLineItem` exists only for invoices submitted as a full AIA-style
 * pay application — billing.prisma says so in terms. A change order billed
 * on a plain lump-sum invoice has no line rows at all and would read here
 * as unbilled, so `lumpSumInvoicesOnJob` counts the invoices on that job
 * carrying no breakdown. A non-zero count means this tool cannot see part
 * of the billing and the row says as much.
 *
 * And a change order that EDITS an existing line's value rather than adding
 * one (`ChangeOrderLineItemEdit`) raises a line that was already being
 * billed; nothing distinguishes the original value from the uplift once the
 * edit lands. Those change orders are counted apart under `editsOnly`
 * rather than reported as fully unbilled, which is what folding them in
 * would do.
 */
async function unbilledChangeOrders(companyId: string, input: Input): Promise<ToolResult> {
  const mismatch = await jobNameMismatch(companyId, input.jobName);
  const citations = [
    { label: "Change orders", href: "/jobs" },
    { label: "Cash flow", href: "/cash-flow" },
  ];
  if (mismatch) return { data: null, citations, unavailable: mismatch };

  const changeOrders = await prisma.changeOrder.findMany({
    where: {
      status: "APPROVED",
      job: {
        companyId,
        ...(input.jobName?.trim()
          ? { name: { contains: input.jobName.trim(), mode: "insensitive" as const } }
          : {}),
      },
    },
    select: {
      number: true,
      title: true,
      decidedOn: true,
      job: {
        select: {
          name: true,
          // Every invoice on the job, so a lump-sum one (no line rows) can
          // be COUNTED rather than silently making a change order look
          // unbilled.
          invoices: { select: { lineItems: { select: { lineItemId: true } } } },
        },
      },
      addedLineItems: {
        where: { isDeleted: false },
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          invoiceLineItems: { select: { thisPeriodBilled: true } },
        },
      },
      edits: { select: { id: true } },
    },
    orderBy: [{ job: { name: "asc" } }, { number: "asc" }],
  });

  const today = serverToday();
  const rows = changeOrders.map((co) => {
    const addedValue = co.addedLineItems.reduce(
      (sum, line) => sum + Number(line.quantity) * Number(line.unitPrice ?? 0),
      0,
    );
    const billed = co.addedLineItems.reduce(
      (sum, line) => sum + line.invoiceLineItems.reduce((n, row) => n + Number(row.thisPeriodBilled), 0),
      0,
    );
    const lumpSum = co.job.invoices.filter((invoice) => invoice.lineItems.length === 0).length;
    // A change order with no added lines only EDITED existing ones, and
    // nothing separates its uplift from the line's original value once the
    // edit has landed.
    const editsOnly = co.addedLineItems.length === 0 && co.edits.length > 0;
    return {
      job: co.job.name,
      changeOrder: `#${co.number} ${co.title}`,
      approvedOn: iso(co.decidedOn),
      daysSinceApproved: co.decidedOn ? daysBetween(iso(co.decidedOn)!, today) : null,
      // NULL, NOT ZERO, on an edits-only change order — and this is the
      // correction that matters more than the filter below it.
      //
      // Reporting `unbilled: 0` there says "nothing outstanding on this
      // change order", which is the false clean bill this whole tool is
      // supposed to be the cure for: the uplift may well be unbilled and
      // nothing here can tell. Zero is an answer. Null is the absence of
      // one, and only the second is true.
      //
      // Found by mutation: deleting the `measurable` filter below changed
      // nothing, because an edits-only row already contributed 0 to every
      // total. The filter was doing no work — the ROW was the lie.
      addedValue: editsOnly ? null : Number(addedValue.toFixed(2)),
      billedToDate: editsOnly ? null : Number(billed.toFixed(2)),
      unbilled: editsOnly ? null : Number((addedValue - billed).toFixed(2)),
      editsOnly,
      lumpSumInvoicesOnJob: lumpSum,
      billingVisible: lumpSum === 0,
    };
  });

  // Only the ones carrying a figure at all. Now load-bearing rather than
  // decorative: the rows it drops have null where a number would be, so
  // including them is a type error rather than a silently wrong total.
  const measurable = rows.filter((row): row is typeof row & { unbilled: number } => row.unbilled !== null);
  return {
    data: rows,
    summary: {
      approvedChangeOrders: rows.length,
      withMoneyStillUnbilled: measurable.filter((row) => row.unbilled > 0.005).length,
      unbilledTotal: Number(measurable.reduce((sum, row) => sum + Math.max(0, row.unbilled), 0).toFixed(2)),
      // Counted, because a total computed over 3 of 4 change orders and
      // presented as the book is the failure this tool would otherwise be.
      changeOrdersWithNoFigure: rows.length - measurable.length,
      // Named so the model can say it rather than assert a clean total.
      changeOrdersThatOnlyEditedLines: rows.filter((row) => row.editsOnly).length,
      changeOrdersWhereBillingIsPartlyInvisible: rows.filter((row) => !row.billingVisible).length,
    },
    citations,
    unavailable:
      rows.length === 0
        ? input.jobName
          ? "No change order has been approved on that job, so there is nothing approved waiting to be billed."
          : "No change order has been approved anywhere, so there is nothing approved waiting to be billed."
        : undefined,
  };
}

/**
 * Where each job stands against its own dates — and an explicit refusal to
 * forecast.
 *
 * "Are we going to finish on time?" cannot be answered from this data and
 * this tool must not imply otherwise. What it reports is DATES ONLY: the
 * scheduled start and end, how far through that window today is, and how
 * many days until (or past) the end.
 *
 * IT CARRIED COST PERCENT COMPLETE FOR ONE DRAFT AND THAT WAS WRONG, for a
 * reason the permissions file states outright. `/schedule` is on the open
 * list because "Job start dates and who is assigned. NO MONEY ON IT, and
 * everyone needs to know where they are working." A tool takes the gate of
 * the page it cites, so a schedule tool carrying a cost figure would either
 * put money on an open surface or take a gate that locks a foreman out of a
 * question about his own dates. Both are worse than splitting it.
 *
 * So the conflation this tool exists to prevent is handled where it
 * belongs — in the description, which says plainly that cost percent
 * complete is a DIFFERENT number living in `job_margin`. A job can be 80%
 * through its budget and 40% through its programme, and reading one as the
 * other is the mistake; `job_margin` reporting the cost figure alone is why
 * it was the near-miss named against this question in the census.
 *
 * No "ahead or behind" verdict is offered even to somebody holding both
 * tools. That comparison would be exactly the forecast this refuses to
 * make: a fit-out job front-loads material cost and a framing job does not.
 */
async function scheduleStatus(companyId: string, input: Input): Promise<ToolResult> {
  const mismatch = await jobNameMismatch(companyId, input.jobName);
  const citations = [{ label: "Schedule", href: "/schedule" }];
  if (mismatch) return { data: null, citations, unavailable: mismatch };

  const jobs = await prisma.job.findMany({
    where: {
      companyId,
      status: { in: ["CONTRACTED", "IN_PROGRESS"] },
      ...(input.jobName?.trim()
        ? { name: { contains: input.jobName.trim(), mode: "insensitive" as const } }
        : {}),
    },
    select: {
      name: true,
      status: true,
      startDate: true,
      endDate: true,
      substantialCompletionDate: true,
    },
    orderBy: { name: "asc" },
  });

  const today = serverToday();
  const rows = jobs.map((job) => {
    const start = iso(job.startDate);
    const end = iso(job.endDate);
    const wholeWindow = start && end ? daysBetween(start, end) : null;
    const elapsed = start ? daysBetween(start, today) : null;

    return {
      job: job.name,
      status: job.status,
      scheduledStart: start,
      scheduledEnd: end,
      // Negative once the date has passed, which is the number somebody
      // actually wants: "eleven days past the end date".
      daysToScheduledEnd: end ? daysBetween(today, end) : null,
      pastScheduledEnd: end ? daysBetween(today, end) < 0 : false,
      // Null rather than 0 when a date is missing: a job with no end date
      // is not a job that is 0% through its programme.
      scheduleElapsedPercent:
        wholeWindow != null && elapsed != null && wholeWindow > 0
          ? Math.round(Math.min(100, Math.max(0, (elapsed / wholeWindow) * 100)))
          : null,
      substantialCompletion: iso(job.substantialCompletionDate),
      datesOnFile: start !== null && end !== null,
    };
  });

  return {
    data: rows,
    summary: {
      jobs: rows.length,
      pastScheduledEnd: rows.filter((row) => row.pastScheduledEnd).length,
      // The ones nothing can be said about at all. Counted rather than
      // omitted, because a schedule answer computed over half the jobs and
      // presented as the whole book is the failure here.
      withoutBothDates: rows.filter((row) => !row.datesOnFile).length,
    },
    citations,
    unavailable:
      rows.length === 0
        ? "No job is contracted or in progress, so there is no programme to be on or off."
        : undefined,
  };
}

/**
 * What is actually in a job's estimate.
 *
 * Three commands WRITE estimate lines — `create_estimate_job`,
 * `draft_estimate_lines`, `add_catalog_line` — and until now nothing read
 * them back, so the assistant could build an estimate it could not then
 * describe. That is the shape CLAUDE.md calls "written, documented, and
 * never called", arriving from the opposite direction.
 *
 * `job_margin` was the near-miss named against this question in the census,
 * and the distinction is worth keeping: it reports a number ABOUT the
 * estimate (contract value, how much of it carries a cost estimate). This
 * reports the estimate.
 *
 * A LINE WITH NO PRICE IS COUNTED, NOT SKIPPED. ARCHITECTURE.md makes
 * `lineItems` the one unified object — estimate, budget, contract content
 * and job-costing structure at once — so a line can legitimately exist with
 * a scope and no price yet. Summing only the priced ones and calling it the
 * estimate total is how a bid goes out light.
 */
async function estimateDetail(companyId: string, input: Input): Promise<ToolResult> {
  const mismatch = await jobNameMismatch(companyId, input.jobName);
  const citations = [{ label: "Jobs", href: "/jobs" }];
  if (mismatch) return { data: null, citations, unavailable: mismatch };

  const jobs = await prisma.job.findMany({
    where: {
      companyId,
      ...(input.jobName?.trim()
        ? { name: { contains: input.jobName.trim(), mode: "insensitive" as const } }
        : {}),
    },
    select: {
      name: true,
      status: true,
      lineItems: {
        where: { isDeleted: false },
        select: {
          description: true,
          quantity: true,
          unit: true,
          unitPrice: true,
          laborHours: true,
          tradeScope: true,
          craftClassification: { select: { name: true } },
          originChangeOrder: { select: { number: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
      estimateVersions: { select: { versionNumber: true, createdAt: true, note: true }, orderBy: { versionNumber: "desc" }, take: 1 },
    },
    orderBy: { name: "asc" },
  });

  const rows = jobs.flatMap((job) =>
    job.lineItems.map((line) => ({
      job: job.name,
      jobStatus: job.status,
      line: line.description,
      quantity: Number(line.quantity),
      unit: line.unit,
      // Null, never 0. A line nobody has priced yet is not a line worth
      // nothing, and the two read identically once a zero is printed.
      unitPrice: line.unitPrice != null ? Number(line.unitPrice) : null,
      lineValue: line.unitPrice != null ? Number((Number(line.quantity) * Number(line.unitPrice)).toFixed(2)) : null,
      laborHours: line.laborHours != null ? Number(line.laborHours) : null,
      tradeScope: line.tradeScope,
      craft: line.craftClassification?.name ?? null,
      // A line that arrived on an approved change order rather than in the
      // original bid. Worth seeing: "what's in the estimate" and "what did
      // we bid" stopped being the same question the moment one was approved.
      fromChangeOrder: line.originChangeOrder ? `#${line.originChangeOrder.number}` : null,
      latestEstimateVersion: job.estimateVersions[0]?.versionNumber ?? null,
    })),
  );

  const priced = rows.filter((row) => row.lineValue !== null);
  return {
    data: rows,
    summary: {
      lines: rows.length,
      linesWithNoPrice: rows.length - priced.length,
      // Named `pricedLinesTotal`, not `estimateTotal`. With unpriced lines
      // on the job the second name would be a claim the data does not
      // support, and `linesWithNoPrice` sitting beside it is what makes the
      // figure readable rather than misleading.
      pricedLinesTotal: Number(priced.reduce((sum, row) => sum + (row.lineValue ?? 0), 0).toFixed(2)),
      linesFromChangeOrders: rows.filter((row) => row.fromChangeOrder !== null).length,
    },
    citations,
    unavailable:
      rows.length === 0
        ? input.jobName
          ? "That job has no estimate lines on it yet — nothing has been priced or scoped."
          : "No job has any estimate lines on it yet."
        : undefined,
  };
}

/**
 * What is sitting in the intake tray waiting for a person.
 *
 * `/intake` is built and had no tool, so the assistant could not answer the
 * one question the intake feature exists to answer.
 *
 * PROPOSED is the only state that means "somebody still has to do
 * something". FILED and DISMISSED are both decisions a person made, and
 * folding them together as "handled" would be right but useless — the tray
 * is the thing being asked about.
 *
 * The classifier's own confidence is carried through unchanged. A LOW
 * confidence proposal is the one most likely to be filed to the wrong place
 * by somebody clicking through a tray, and it is the model's business to be
 * able to say so.
 */
async function documentIntake(companyId: string): Promise<ToolResult> {
  const citations = [{ label: "Intake", href: "/intake" }];
  const today = serverToday();

  const documents = await prisma.documentIntake.findMany({
    where: { companyId, status: "PROPOSED" },
    select: {
      fileName: true,
      createdAt: true,
      proposedKind: true,
      proposedConfidence: true,
      proposedReason: true,
      job: { select: { name: true } },
      jobHint: true,
      uploadedBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = documents.map((document) => ({
    file: document.fileName,
    arrivedOn: iso(document.createdAt),
    daysWaiting: daysBetween(iso(document.createdAt)!, today),
    // The classifier's guess, plainly labelled as a guess.
    proposedAs: document.proposedKind.replace(/_/g, " ").toLowerCase(),
    confidence: document.proposedConfidence,
    why: document.proposedReason,
    // The job it was filed against if somebody already said, else the
    // classifier's HINT — two different things, and a hint presented as a
    // filing is how a pay app ends up on the wrong job.
    job: document.job?.name ?? null,
    jobHint: document.job ? null : document.jobHint,
    uploadedBy: document.uploadedBy?.name ?? document.uploadedBy?.email ?? null,
  }));

  return {
    data: rows,
    summary: {
      waiting: rows.length,
      lowConfidence: rows.filter((row) => row.confidence === "LOW").length,
      // A week in the tray is a document nobody is going to remember
      // arriving.
      waitingMoreThan7Days: rows.filter((row) => row.daysWaiting > 7).length,
      withNoJobAtAll: rows.filter((row) => row.job === null && !row.jobHint).length,
    },
    citations,
    unavailable:
      rows.length === 0
        ? "Nothing is waiting in the intake tray. Everything that came in has been filed or dismissed."
        : undefined,
  };
}

/**
 * Who is on the books, and what the app knows about each of them.
 *
 * `/team` is built and had no tool. The census asked "what is Mike on an
 * hour?" and the honest answer is that THIS APP HAS NO PER-PERSON RATE —
 * a rate belongs to a craft classification and a fringe schedule in force
 * on a date, which is why `job_labor_cost` prices an HOUR rather than a
 * person. So this reports the crafts a person has actually worked under and
 * says where the rate lives, rather than inventing a headline number.
 *
 * It also reports what is MISSING on a person, because those blanks are
 * what break the paperwork downstream: no name on an account puts a blank
 * in the name column of a WH-347, and no craft on their hours puts a blank
 * in the classification column and takes them out of the ratio review.
 */
async function teamRoster(companyId: string): Promise<ToolResult> {
  const citations = [
    { label: "Team", href: "/team" },
    { label: "Certifications", href: "/certifications" },
  ];

  const people = await prisma.user.findMany({
    where: { companyId },
    select: {
      name: true,
      email: true,
      role: true,
      jobFunction: true,
      timeEntries: {
        select: { craftClassification: { select: { name: true } } },
      },
      certifications: { select: { id: true } },
    },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });

  const rows = people.map((person) => {
    const crafts = [
      ...new Set(
        person.timeEntries.flatMap((entry) => (entry.craftClassification ? [entry.craftClassification.name] : [])),
      ),
    ].sort();
    const untagged = person.timeEntries.filter((entry) => entry.craftClassification === null).length;
    return {
      name: person.name,
      email: person.email,
      role: person.role,
      jobFunction: person.jobFunction,
      // No `rate`. There is none on a person — see the tool's description.
      craftsWorkedUnder: crafts,
      hoursEntriesWithNoCraft: untagged,
      certificationsOnFile: person.certifications.length,
      // The two blanks that break a government form.
      nameMissing: !person.name?.trim(),
    };
  });

  return {
    data: rows,
    summary: {
      people: rows.length,
      withNoNameOnTheirAccount: rows.filter((row) => row.nameMissing).length,
      withNoCertificationOnFile: rows.filter((row) => row.certificationsOnFile === 0).length,
      withUntaggedHours: rows.filter((row) => row.hoursEntriesWithNoCraft > 0).length,
    },
    citations,
    unavailable: rows.length === 0 ? "Nobody has an account on this company yet." : undefined,
  };
}

/**
 * Union dispatch slips — who the hall sent to which job, and when.
 *
 * Closest thing this app has to "who is on that job", and DELIBERATELY NOT
 * offered as an answer to it. A dispatch slip is a record that a worker was
 * dispatched, not a forward schedule: it says somebody was sent, never that
 * they are there tomorrow. The census's `who-is-on-tomorrow` gap stands,
 * and tools.ts KNOWN_GAPS carries it so the model refuses rather than
 * reaching for this or for `crew_assignments`.
 *
 * What it IS for is the compliance question: a job whose workers have no
 * dispatch slip on file is a finding in a union audit, and nothing in the
 * app surfaced that.
 */
async function dispatchSlips(companyId: string, input: Input): Promise<ToolResult> {
  const mismatch = await jobNameMismatch(companyId, input.jobName);
  const citations = [{ label: "Union compliance", href: "/union-compliance" }];
  if (mismatch) return { data: null, citations, unavailable: mismatch };

  const slips = await prisma.dispatchSlip.findMany({
    where: {
      job: {
        companyId,
        ...(input.jobName?.trim()
          ? { name: { contains: input.jobName.trim(), mode: "insensitive" as const } }
          : {}),
      },
    },
    // `select` rather than a bare field list: the relations below are what
    // this tool is for, and a select that omits them silently returns the
    // scalar row with none of them — which is what the first attempt did.
    select: {
      dispatchNumber: true,
      dispatchDate: true,
      fileUrl: true,
      note: true,
      job: { select: { name: true } },
      employeeUser: { select: { name: true, email: true } },
      craftClassification: {
        select: {
          name: true,
          // A local has no `name`. It is an international plus a number —
          // "United Brotherhood of Carpenters Local 213" — and the pieces
          // are stored apart so a filing knows which is which.
          unionLocal: { select: { parentInternational: true, localNumber: true } },
        },
      },
    },
    orderBy: { dispatchDate: "desc" },
  });

  const rows = slips.map((slip) => ({
    job: slip.job.name,
    worker: slip.employeeUser.name ?? slip.employeeUser.email,
    dispatchedOn: iso(slip.dispatchDate),
    dispatchNumber: slip.dispatchNumber,
    craft: slip.craftClassification?.name ?? null,
    local: slip.craftClassification
      ? `${slip.craftClassification.unionLocal.parentInternational} Local ${slip.craftClassification.unionLocal.localNumber}`
      : null,
    // The distinction an audit turns on: a row saying a slip exists is not
    // a slip. `wage_determinations` makes the same one and for the same
    // reason.
    documentAttached: slip.fileUrl !== null,
    note: slip.note,
  }));

  return {
    data: rows,
    summary: {
      slips: rows.length,
      withoutTheDocument: rows.filter((row) => !row.documentAttached).length,
      withoutACraft: rows.filter((row) => row.craft === null).length,
      jobsCovered: new Set(rows.map((row) => row.job)).size,
    },
    citations,
    unavailable:
      rows.length === 0
        ? input.jobName
          ? "No dispatch slip is on file for that job. That is a gap in the records — it does not mean nobody was dispatched."
          : "No dispatch slip is on file anywhere. That is a gap in the records — it does not mean nobody was dispatched."
        : undefined,
  };
}

/**
 * Who is planned where, and which planned days nobody logged hours against.
 *
 * TWO ANSWERS IN ONE TOOL, and they are one tool because they are one
 * model read twice — forward for the plan, backward for the gap between
 * the plan and the hours.
 *
 * THE SECOND ONE IS WORDED WITH MORE CARE THAN ANYTHING ELSE IN THIS FILE.
 * A planned day with no hours means NOBODY LOGGED THAT DAY. It does not
 * mean the person did not work, and the difference is not pedantry: "Marco
 * did not work Tuesday" is a claim about a man and goes in front of a
 * foreman, and "nobody logged Marco's Tuesday" is a claim about paperwork
 * and goes in front of whoever runs payroll. Only the second is supported,
 * so every field name and every sentence here says the second.
 *
 * And the honest limit, stated rather than left to be assumed: this can
 * only see days somebody actually PUT on the schedule. An empty list is not
 * proof that every hour was logged — it is proof that every planned day
 * has hours, which is a much smaller claim.
 */
async function crewSchedule(companyId: string, input: Input): Promise<ToolResult> {
  const mismatch = await jobNameMismatch(companyId, input.jobName);
  const citations = [{ label: "Schedule", href: "/schedule" }];
  if (mismatch) return { data: null, citations, unavailable: mismatch };

  const today = serverToday();
  const wanted = input.jobName?.trim();
  const job = wanted
    ? await prisma.job.findFirst({
        where: { companyId, name: { contains: wanted, mode: "insensitive" } },
        select: { id: true },
      })
    : null;

  const [upcoming, missing] = await Promise.all([
    loadUpcomingSchedule(companyId, today, job?.id),
    loadPlannedDaysMissingHours(companyId, today, job?.id),
  ]);

  const planned = upcoming.map((day) => ({
    job: day.job.name,
    day: iso(day.workDate),
    worker: scheduledWorkerName(day),
    craft: day.craftClassification?.name ?? null,
    note: day.note,
  }));

  const noHours = missing.map((day) => ({
    job: day.job.name,
    day: iso(day.workDate),
    worker: scheduledWorkerName(day),
    // Spelled out on the ROW, because a row is what gets quoted back and a
    // caveat that lives only in the tool description is a caveat that gets
    // dropped somewhere between here and a person.
    means: "nobody logged hours for that day — not that they did not work",
  }));

  return {
    data: { planned, plannedDaysWithNoHoursLogged: noHours },
    summary: {
      plannedDaysAhead: planned.length,
      jobsWithSomebodyOn: new Set(planned.map((row) => row.job)).size,
      plannedDaysWithNoHoursLogged: noHours.length,
    },
    citations,
    unavailable:
      planned.length === 0 && noHours.length === 0
        ? wanted
          ? "Nobody has been put on the schedule for that job. That is a gap in the plan rather than a quiet week — nothing fills the schedule in for you."
          : "Nobody has been put on the schedule at all. That is a gap in the plan rather than a quiet fortnight — nothing fills the schedule in for you."
        : undefined,
  };
}

/**
 * Lien-rights deadlines, per job: unserved ones with the days left or the
 * days overdue, and the served ones as the record.
 *
 * THIS APP NEVER COMPUTES A LEGAL DEADLINE, and this handler is where the
 * temptation would be strongest, so it is said again here. Every `deadline`
 * in the output is a date a PERSON entered; each row carries
 * `deadlineSource: "entered"` so the model is told on the row, not only in
 * the description, where the date came from. The only arithmetic is the
 * count of days between today and that entered date — never a way of
 * producing a date.
 *
 * "Today" is serverToday (UTC), like every handler here, because a tool
 * call has no viewer cookie in hand. For the US that errs EARLY — in the
 * evening a deadline reads one day closer than the person's own calendar —
 * which is the safe direction for this tool to be wrong in.
 *
 * An empty answer says nothing has been ENTERED, never that no deadline is
 * running: silence here is the most dangerous thing this tool could say.
 */
async function lienDeadlines(companyId: string, input: Input): Promise<ToolResult> {
  const citations = [{ label: "Lien deadlines", href: "/lien-deadlines" }];
  const mismatch = await jobNameMismatch(companyId, input.jobName);
  if (mismatch) return { data: null, citations, unavailable: mismatch };

  const today = serverToday();
  const wanted = input.jobName?.trim();
  // EVERY job the name matches, not the first: "Riverside" can be two jobs,
  // and answering for one of them silently drops the other's deadlines.
  const matchedJobs = wanted
    ? await prisma.job.findMany({
        where: { companyId, name: { contains: wanted, mode: "insensitive" } },
        select: { id: true, name: true },
      })
    : undefined;
  const jobIds = matchedJobs?.map((job) => job.id);

  const rows = await loadLienDeadlines(companyId, today, jobIds);
  const summary = summarizeLienDeadlines(rows, today);

  const byJob = new Map<string, { job: string; unserved: unknown[]; served: unknown[]; note?: string }>();
  // With a job filter, EVERY matched job gets a group — seeded before the
  // rows, so one with nothing entered is named rather than left out. The
  // old shape built groups from rows alone: "Riverside" matching Ph 1 (with
  // deadlines) and Ph 2 (none) answered for Ph 1 and said nothing about
  // Ph 2, which reads as "nothing due there". The note says what is true:
  // nothing has been ENTERED. Replaced below if a row turns up.
  for (const job of matchedJobs ?? []) {
    byJob.set(job.id, {
      job: job.name,
      unserved: [],
      served: [],
      note: "No lien deadline has been entered for this job. That is not the same as no deadline running — the date has to come from their attorney or the statute and be added on the Lien deadlines page. Do not work one out.",
    });
  }
  for (const row of rows) {
    const seeded = byJob.get(row.jobId);
    const group = seeded && !seeded.note ? seeded : { job: row.jobName, unserved: [], served: [] };
    byJob.set(row.jobId, group);
    const base = {
      what: lienKindLabel(row.kind, row.otherLabel),
      recipient: row.recipient,
      deadline: row.dueOn,
      deadlineSource: "entered" as const,
    };
    if (row.state === "served") {
      group.served.push({
        ...base,
        servedOn: row.servedOn,
        // A fact about two entered dates, and deliberately no more.
        ...(row.servedAfterDueDate
          ? { note: "served after the deadline that was entered — whether that still counts is for counsel" }
          : {}),
      });
    } else {
      const days = row.daysUntilDue as number;
      group.unserved.push({
        ...base,
        state: row.state,
        ...(days < 0 ? { daysOverdue: -days } : { daysLeft: days }),
      });
    }
  }

  return {
    data: { today, jobs: [...byJob.values()] },
    summary: {
      overdueUnserved: summary.overdueUnserved,
      dueWithin14Days: summary.dueWithin14Days,
      served: summary.served,
    },
    citations,
    unavailable:
      rows.length === 0
        ? wanted
          ? "No lien deadline has been entered for that job. That is not the same as no deadline running — the date has to come from their attorney or the statute and be added on the Lien deadlines page. Do not work one out."
          : "No lien deadlines have been entered at all. That is not the same as none running — each date has to come from their attorney or the statute and be added on the Lien deadlines page. Do not work one out."
        : undefined,
  };
}
