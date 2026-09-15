import { prisma } from "@prova/db";
import { isLive, type BidStatus } from "./bid-pipeline";
import { renewalAlerts } from "./compliance-expiry";
import { renewalSourcesForCompany } from "./renewals";
import { loadRetainageHeld } from "./retainage-query";
import { serverToday } from "./serverToday";
import { submittalState, type RevisionData } from "@/components/submittalLabels";

/**
 * The five figures behind the "Money Rail" — the nav-as-pipeline concept
 * where each stage of the business carries the number that stage is
 * actually about. Data groundwork only: nothing renders this yet, and
 * nothing here is stored — every figure is derived on read, same rule as
 * lib/wip.ts, lib/retainage-query.ts and the Today dashboard.
 *
 * Every definition below is REUSED from the surface that already answers
 * the question, so the rail can never disagree with the page it links to.
 * That is the #46/#97 lesson (two retainage figures eighteen inches
 * apart) applied in advance rather than after the bug report:
 *
 *  - "outstanding bid" is lib/bid-pipeline.ts `isLive` — INVITED or
 *    SUBMITTED, exactly the /bids pipeline's "outstanding" column;
 *  - "active job" is `status IN (CONTRACTED, IN_PROGRESS)`, the same
 *    population lib/company-financials-query.ts calls active, and
 *    contract value is quantity × unitPrice over non-deleted lines —
 *    the same arithmetic as calculateLineItemWip.contractValue and the
 *    dashboard's jobValue;
 *  - "waiting on the GC" is Rfi.status = SENT (the Ask tool's open-RFI
 *    population) plus submittals whose derived state is WITH_GC — the
 *    exact `submittalState` the /submittals page counts with, never a
 *    stored status;
 *  - "at risk" compliance is renewalAlerts' EXPIRED + DUE_SOON, the same
 *    filter the Today dashboard's "Documents expiring" tile uses, with
 *    the same per-kind horizons (30 days for a COI or policy, 60 for a
 *    licence or bond, because those take a state board to renew);
 *  - retainage held is loadRetainageHeld — THE query, not a query. Its
 *    population is deliberately unfiltered; see lib/retainage-query.ts.
 *
 * Money figures are dollars as plain numbers (Prisma Decimal through
 * Number(), formatted by lib/money.ts at render time), the convention
 * every dashboard figure already follows. No cents integers.
 */

export type MoneyRailStageKey =
  | "bidding"
  | "building"
  | "proving"
  | "staying-legal"
  | "getting-paid";

export type MoneyRailFigure =
  | { kind: "money"; amount: number }
  | { kind: "count"; n: number; noun: string };

export interface MoneyRailStage {
  key: MoneyRailStageKey;
  label: string;
  figure: MoneyRailFigure;
  /** One supporting sentence, same role as the dashboard StatCard's
   * detail line. Presentation renders it verbatim; no arithmetic there. */
  detail: string;
}

/** Everything the assembly needs, already reduced to plain numbers so the
 * deciding half is testable without a database — the same split as
 * lib/bid-pipeline.ts vs lib/bid-pipeline-query.ts. */
export interface MoneyRailInput {
  /** SUM(bidAmount) over live (INVITED or SUBMITTED) bid invitations. */
  outstandingBidValue: number;
  /** Live invitations with no bidAmount recorded. When above zero the
   * bidding figure is a floor, not a total — same honesty rule as
   * GcRecord.valueWonUnpriced. */
  outstandingBidsUnpriced: number;
  /** Jobs with status CONTRACTED or IN_PROGRESS. */
  activeJobCount: number;
  /** SUM(quantity × unitPrice) over those jobs' non-deleted line items. */
  activeContractValue: number;
  /** RFIs with status SENT — out the door, no written answer yet. */
  openRfiCount: number;
  /** Submittals whose latest revision is out and unreturned (WITH_GC). */
  submittalsWithGcCount: number;
  /** Renewals EXPIRED or DUE_SOON across every record that can lapse. */
  complianceAtRiskCount: number;
  /** Of those, already expired — the detail line names them separately
   * because "lapsed" and "lapsing" call for different phone calls. */
  complianceExpiredCount: number;
  /** SUM over active jobs of max(contractValue − billed, 0). Per-job
   * floor on purpose: an overbilled job must not cancel out another
   * job's unbilled value — this is "left to invoice", not net position. */
  unbilledContractValue: number;
  /** Withheld minus released, whole company, no status filter — see
   * lib/retainage-query.ts for why any narrowing here is a bug. */
  retainageHeld: number;
}

const plural = (n: number, singular: string, pluralWord: string) =>
  n === 1 ? singular : pluralWord;

/** Pure assembly: numbers in, the five stages out. No Prisma, no dates,
 * no I/O — the vitest half. */
export function assembleMoneyRailStages(input: MoneyRailInput): MoneyRailStage[] {
  return [
    {
      key: "bidding",
      label: "Bidding",
      figure: { kind: "money", amount: input.outstandingBidValue },
      detail:
        input.outstandingBidsUnpriced > 0
          ? `Out with GCs awaiting an answer — a floor: ${input.outstandingBidsUnpriced} live ${plural(
              input.outstandingBidsUnpriced,
              "bid has",
              "bids have",
            )} no amount recorded`
          : "Out with GCs awaiting an answer",
    },
    {
      key: "building",
      label: "Building",
      figure: { kind: "money", amount: input.activeContractValue },
      detail: `${input.activeJobCount} ${plural(
        input.activeJobCount,
        "job",
        "jobs",
      )} under contract or in progress`,
    },
    {
      key: "proving",
      label: "Proving",
      figure: {
        kind: "count",
        n: input.openRfiCount + input.submittalsWithGcCount,
        noun: plural(
          input.openRfiCount + input.submittalsWithGcCount,
          "item waiting on the GC",
          "items waiting on the GC",
        ),
      },
      detail: `${input.openRfiCount} ${plural(input.openRfiCount, "RFI", "RFIs")} unanswered, ${
        input.submittalsWithGcCount
      } ${plural(input.submittalsWithGcCount, "submittal", "submittals")} with the GC`,
    },
    {
      key: "staying-legal",
      label: "Staying legal",
      figure: {
        kind: "count",
        n: input.complianceAtRiskCount,
        noun: plural(
          input.complianceAtRiskCount,
          "document expired or due soon",
          "documents expired or due soon",
        ),
      },
      detail:
        input.complianceAtRiskCount === 0
          ? "Certificates, licences, policies and bonds are current"
          : `${input.complianceExpiredCount} already expired, ${
              input.complianceAtRiskCount - input.complianceExpiredCount
            } inside the renewal window`,
    },
    {
      key: "getting-paid",
      label: "Getting paid",
      figure: {
        kind: "money",
        amount: input.unbilledContractValue + input.retainageHeld,
      },
      detail: "Active contract value not yet invoiced, plus retainage held",
    },
  ];
}

/**
 * Loads the five stages for a company. Scoped by companyId, same as every
 * dashboard loader (loadTodayDashboard, loadCompanyFinancials,
 * loadRetainageHeld); `todayIso` defaults to the server's UTC calendar
 * date, the same serverToday() the dashboard hands to renewalAlerts.
 */
export async function getMoneyRailStages(
  companyId: string,
  todayIso: string = serverToday(),
): Promise<MoneyRailStage[]> {
  const [liveBids, activeJobs, openRfiCount, submittals, renewalSources, retainageHeld] =
    await Promise.all([
      prisma.bidInvitation.findMany({
        // isLive's population, expressed as a where-clause so the database
        // does the filtering; the predicate itself stays the shared one.
        where: { companyId, status: { in: ["INVITED", "SUBMITTED"] } },
        select: { status: true, bidAmount: true },
      }),
      prisma.job.findMany({
        where: { companyId, status: { in: ["CONTRACTED", "IN_PROGRESS"] } },
        select: {
          lineItems: {
            where: { isDeleted: false },
            select: { quantity: true, unitPrice: true },
          },
          // amount only: billed-to-date for the unbilled figure. Retainage
          // is NOT read from this active-job list — that is issue #97.
          invoices: { select: { amount: true } },
        },
      }),
      prisma.rfi.count({ where: { companyId, status: "SENT" } }),
      prisma.submittal.findMany({
        where: { companyId },
        select: {
          revisions: {
            select: {
              revisionNumber: true,
              sentOn: true,
              dueBack: true,
              returnedOn: true,
              outcome: true,
              responseNotes: true,
            },
          },
        },
      }),
      renewalSourcesForCompany(companyId),
      loadRetainageHeld(companyId),
    ]);

  // Belt and braces: the where-clause above already narrows to live
  // statuses, and isLive is still applied so the definition in
  // lib/bid-pipeline.ts stays the one that decides.
  const outstanding = liveBids.filter((bid) => isLive({ status: bid.status as BidStatus }));
  const outstandingBidValue = outstanding.reduce(
    (sum, bid) => sum + (bid.bidAmount === null ? 0 : Number(bid.bidAmount)),
    0,
  );
  const outstandingBidsUnpriced = outstanding.filter((bid) => bid.bidAmount === null).length;

  let activeContractValue = 0;
  let unbilledContractValue = 0;
  for (const job of activeJobs) {
    const contractValue = job.lineItems.reduce(
      (sum, line) => sum + Number(line.quantity) * Number(line.unitPrice ?? 0),
      0,
    );
    const billed = job.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
    activeContractValue += contractValue;
    unbilledContractValue += Math.max(contractValue - billed, 0);
  }

  const isoDate = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
  const submittalsWithGcCount = submittals.filter((submittal) => {
    const revisions: RevisionData[] = submittal.revisions.map((rev) => ({
      revisionNumber: rev.revisionNumber,
      sentOn: isoDate(rev.sentOn) as string,
      dueBack: isoDate(rev.dueBack),
      returnedOn: isoDate(rev.returnedOn),
      outcome: rev.outcome,
      responseNotes: rev.responseNotes,
    }));
    return submittalState(revisions) === "WITH_GC";
  }).length;

  const renewals = renewalAlerts(renewalSources, todayIso);
  const atRisk = renewals.filter(
    (renewal) => renewal.urgency === "EXPIRED" || renewal.urgency === "DUE_SOON",
  );
  const complianceExpiredCount = atRisk.filter((r) => r.urgency === "EXPIRED").length;

  return assembleMoneyRailStages({
    outstandingBidValue,
    outstandingBidsUnpriced,
    activeJobCount: activeJobs.length,
    activeContractValue,
    openRfiCount,
    submittalsWithGcCount,
    complianceAtRiskCount: atRisk.length,
    complianceExpiredCount,
    unbilledContractValue,
    retainageHeld,
  });
}
