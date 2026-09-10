import { prisma, type BidInvitationStatus } from "@prova/db";
import {
  calculateJobWip,
  calculateLineItemWip,
  formatCoveragePercent,
  formatPercentComplete,
} from "@/lib/wip";
import {
  jobCostVariance,
  jobEarnedRevenue,
  jobOverUnderBilling,
} from "@/lib/company-financials";
import { renewalAlerts, renewalCoverage, renewalCoverageMessage, renewalTiming } from "@/lib/compliance-expiry";
import { renewalSourcesForCompany } from "@/lib/renewals";
import { serverToday } from "@/lib/serverToday";
import { daysPastDueFor, effectiveDueDateFor } from "@/lib/cash-flow";
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

type Input = { jobName?: string; status?: string };

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
  open_punch_list: openPunchList,
  compliance_status: (companyId) => complianceStatus(companyId),
  drawing_currency: drawingCurrency,
  job_margin: jobMargin,
  bid_status: bidStatus,
  open_rfis: openRfis,
  material_deliveries: materialDeliveries,
  equipment_location: (companyId) => equipmentLocation(companyId),
  receivables: (companyId) => receivables(companyId),
};

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
  const jobs = await prisma.job.findMany({
    where: { companyId, status: { in: ["CONTRACTED", "IN_PROGRESS"] } },
    select: {
      id: true,
      name: true,
      contact: { select: { name: true } },
      lineItems: {
        where: { isDeleted: false },
        select: {
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
    },
  });

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
          actualCostToDate: line.costEntries.reduce((sum, cost) => sum + Number(cost.amount), 0),
        }),
      );
      const billed = job.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
      const wip = calculateJobWip(lines, billed);

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
        outstanding: amount - paid,
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
