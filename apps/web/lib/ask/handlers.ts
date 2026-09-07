import { prisma } from "@prova/db";
import { calculateJobWip, calculateLineItemWip } from "@/lib/wip";
import {
  jobCostVariance,
  jobEarnedRevenue,
  jobOverUnderBilling,
} from "@/lib/company-financials";
import { renewalAlerts, renewalTiming } from "@/lib/compliance-expiry";
import { renewalSourcesForCompany } from "@/lib/renewals";
import { serverToday } from "@/lib/serverToday";
import { daysPastDueFor, effectiveDueDateFor } from "@/lib/cash-flow";
import { currentRevision, setState, stateLabel, unreceivedRevisions } from "@/components/drawingLabels";
import { orderState, stateLabel as orderStateLabel, daysLate } from "@/components/materialOrderLabels";
import { currentAssignment } from "@/components/equipmentDeployment";
import { matchesJobName, type ToolName, type ToolResult } from "./tools";

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

type Input = { jobName?: string };

const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

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
  bid_status: (companyId) => bidStatus(companyId),
  open_rfis: openRfis,
  material_deliveries: materialDeliveries,
  equipment_location: (companyId) => equipmentLocation(companyId),
  receivables: (companyId) => receivables(companyId),
};

export async function runTool(
  companyId: string,
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
  return handler(companyId, input);
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
      filtered.length === 0 ? "Nothing is open on the punch list for that job." : undefined,
  };
}

async function complianceStatus(companyId: string): Promise<ToolResult> {
  // The same ranking the dashboard and /compliance show, so the answer and
  // the screen cannot drift apart.
  const sources = await renewalSourcesForCompany(companyId);
  const alerts = renewalAlerts(sources, serverToday());

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
    unavailable:
      alerts.length === 0
        ? "Nothing is expired or expiring: every certificate, licence, policy and bond on file is current."
        : undefined,
  };
}

async function drawingCurrency(companyId: string, input: Input): Promise<ToolResult> {
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
        state: stateLabel(state),
        issuedButNotReceived: unreceivedRevisions(revisions).map((r) => r.label),
        asOf: today,
      };
    }),
    citations: [{ label: "Drawings", href: "/drawings" }],
    unavailable: filtered.length === 0 ? "No drawing sets are recorded for that job." : undefined,
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
        percentComplete: wip.percentComplete,
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
        shareOfValueWithACostEstimate: wip.estimatedCoverage,
        shareOfValueWithAnEarnedRevenueFigure: wip.earnedCoverage,
      };
    }),
    citations: [{ label: "Today", href: "/dashboard" }],
    unavailable: filtered.length === 0 ? "No active job matches that name." : undefined,
  };
}

async function bidStatus(companyId: string): Promise<ToolResult> {
  const bids = await prisma.bidInvitation.findMany({
    where: { companyId },
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

  return {
    data: bids.map((bid) => ({
      project: bid.projectName,
      gc: bid.contact.name,
      status: bid.status,
      dueDate: iso(bid.dueDate),
      trade: bid.tradeScope,
      notes: bid.notes,
    })),
    citations: [{ label: "Bids", href: "/bids" }],
    unavailable: bids.length === 0 ? "No bid invitations are recorded." : undefined,
  };
}

async function openRfis(companyId: string, input: Input): Promise<ToolResult> {
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

async function materialDeliveries(companyId: string, input: Input): Promise<ToolResult> {
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
  const filtered = orders.filter((order) => matchesJobName(order.job.name, input.jobName));

  return {
    data: filtered.map((order) => {
      const deliveries = order.deliveries.map((delivery) => ({
        ...delivery,
        deliveredOn: delivery.deliveredOn.toISOString().slice(0, 10),
      }));
      const promised = iso(order.promisedFor);
      return {
        order: order.number,
        what: order.description,
        job: order.job.name,
        vendor: order.vendor.name,
        vendorPhone: order.vendor.phone,
        promisedFor: promised,
        state: orderStateLabel(orderState(deliveries)),
        daysLate: daysLate(deliveries, promised, today),
      };
    }),
    citations: [{ label: "Material orders", href: "/material-orders" }],
    unavailable:
      filtered.length === 0 ? "No material orders are recorded for that job." : undefined,
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
