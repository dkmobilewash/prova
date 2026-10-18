import { prisma, type BidInvitationStatus, type TradeScope } from "@prova/db";
import { calculatePaymentReliability } from "@/lib/gc-reliability";
import { summarizeBackcharges } from "@/lib/backcharges";

/**
 * What this company's own records say about a GC and about work like this
 * bid. Pure reads, no model. EVERY NUMBER COMES BACK WITH THE IDS IT WAS
 * COUNTED FROM, so an agent finding can cite the rows rather than assert a
 * figure — an uncited number is a bug (lib/agents/core.ts refuses it).
 *
 * The arithmetic is not re-derived here: pay speed is
 * `calculatePaymentReliability` (lib/gc-reliability.ts, the contact page's
 * own panel, with its retainage and platform-fee rules) and backcharge
 * totals are `summarizeBackcharges`. This file only chooses the rows.
 */

export type GcHistory = {
  contact: { id: string; name: string } | null;
  bids: {
    invited: string[];
    /** Sent to the GC: SUBMITTED, WON or LOST. */
    submitted: string[];
    won: string[];
    lost: string[];
    declined: string[];
    /** won / (won + lost). Null when nothing has been decided. */
    winRate: number | null;
  };
  paySpeed: {
    averageDaysToPay: number | null;
    settledCount: number;
    /** Why there is no figure, when there is none. */
    reason: string | null;
    invoiceIds: string[];
    jobIds: string[];
  };
  backcharges: { count: number; claimedTotal: number; openCount: number; openClaimed: number; ids: string[]; jobIds: string[] };
  lostReasons: { bidInvitationId: string; projectName: string; reason: string; note: string | null; winnerName: string | null }[];
};

const SUBMITTED: BidInvitationStatus[] = ["SUBMITTED", "WON", "LOST"];

export async function gcHistory(companyId: string, contactId: string): Promise<GcHistory> {
  const [contact, bids, jobs] = await Promise.all([
    prisma.contact.findFirst({ where: { id: contactId, companyId }, select: { id: true, name: true } }),
    prisma.bidInvitation.findMany({
      where: { companyId, contactId },
      select: {
        id: true,
        projectName: true,
        status: true,
        outcome: { select: { result: true, reason: true, note: true, winnerName: true } },
      },
    }),
    prisma.job.findMany({
      where: { companyId, contactId },
      select: {
        id: true,
        invoices: {
          select: {
            id: true,
            amount: true,
            retainageWithheld: true,
            issuedAt: true,
            dueAt: true,
            payments: { select: { amount: true, feeAmount: true, receivedAt: true } },
          },
        },
        backcharges: { select: { id: true, claimedAmount: true, status: true, resolvedAmount: true } },
      },
    }),
  ]);

  const ids = (statuses: BidInvitationStatus[]) => bids.filter((b) => statuses.includes(b.status)).map((b) => b.id);
  const won = ids(["WON"]);
  const lost = ids(["LOST"]);
  const decided = won.length + lost.length;

  const invoices = jobs.flatMap((job) => job.invoices.map((invoice) => ({ jobId: job.id, invoice })));
  const reliability = calculatePaymentReliability(
    invoices.map(({ invoice }) => ({
      amount: Number(invoice.amount),
      retainageWithheld: invoice.retainageWithheld != null ? Number(invoice.retainageWithheld) : null,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      paidAmount: invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0),
      feesDeducted: invoice.payments.reduce((sum, p) => sum + Number(p.feeAmount ?? 0), 0),
      lastPaymentAt: invoice.payments.reduce<Date | null>((latest, p) => (!latest || p.receivedAt > latest ? p.receivedAt : latest), null),
    })),
  );
  const paid = invoices.filter(({ invoice }) => invoice.payments.length > 0);

  const backcharges = jobs.flatMap((job) => job.backcharges.map((bc) => ({ jobId: job.id, bc })));
  const summary = summarizeBackcharges(
    backcharges.map(({ bc }) => ({
      status: bc.status,
      claimedAmount: Number(bc.claimedAmount),
      resolvedAmount: bc.resolvedAmount != null ? Number(bc.resolvedAmount) : null,
    })),
  );

  return {
    contact,
    bids: {
      invited: bids.map((b) => b.id),
      submitted: ids(SUBMITTED),
      won,
      lost,
      declined: ids(["DECLINED"]),
      winRate: decided === 0 ? null : won.length / decided,
    },
    paySpeed: {
      averageDaysToPay: reliability.averageDaysToPay,
      settledCount: reliability.settledCount,
      reason:
        invoices.length === 0
          ? "No invoices on any job for this GC yet."
          : reliability.averageDaysToPay === null
            ? "No invoice for this GC has been paid in full yet."
            : null,
      invoiceIds: paid.map(({ invoice }) => invoice.id),
      jobIds: [...new Set(paid.map(({ jobId }) => jobId))],
    },
    backcharges: {
      count: backcharges.length,
      claimedTotal: backcharges.reduce((sum, { bc }) => sum + Number(bc.claimedAmount), 0),
      openCount: summary.openCount,
      openClaimed: summary.openClaimed,
      ids: backcharges.map(({ bc }) => bc.id),
      jobIds: [...new Set(backcharges.map(({ jobId }) => jobId))],
    },
    lostReasons: bids
      .filter((b) => b.status === "LOST" && b.outcome)
      .map((b) => ({
        bidInvitationId: b.id,
        projectName: b.projectName,
        reason: b.outcome!.reason,
        note: b.outcome!.note,
        winnerName: b.outcome!.winnerName,
      })),
  };
}

export type SimilarBid = {
  bidInvitationId: string;
  projectName: string;
  gcName: string;
  status: BidInvitationStatus;
  bidAmount: number | null;
  wonJobId: string | null;
  outcome: { result: string; reason: string; winningPrice: number | null } | null;
};

export type SimilarJobs = {
  /** "trade and value" when the bid has an amount to compare, "trade only"
   *  when it does not, "none" when it carries no trade tag. */
  basis: "trade and value" | "trade only" | "none";
  rows: SimilarBid[];
};

/** Within ±50% of the bid's value. Exported so a test can pin it. */
export const SIMILAR_VALUE_BAND = 0.5;

export function withinBand(candidate: number | null, target: number | null): boolean {
  if (target === null || !(target > 0)) return true;
  if (candidate === null) return false;
  return candidate >= target * (1 - SIMILAR_VALUE_BAND) && candidate <= target * (1 + SIMILAR_VALUE_BAND);
}

export async function similarJobs(
  companyId: string,
  bid: { id: string; tradeScope: TradeScope | null; bidAmount: number | null },
): Promise<SimilarJobs> {
  if (!bid.tradeScope) return { basis: "none", rows: [] };
  const past = await prisma.bidInvitation.findMany({
    where: { companyId, tradeScope: bid.tradeScope, id: { not: bid.id } },
    select: {
      id: true,
      projectName: true,
      status: true,
      bidAmount: true,
      wonJobId: true,
      contact: { select: { name: true } },
      outcome: { select: { result: true, reason: true, winningPrice: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const rows = past
    .map((b) => ({
      bidInvitationId: b.id,
      projectName: b.projectName,
      gcName: b.contact.name,
      status: b.status,
      bidAmount: b.bidAmount != null ? Number(b.bidAmount) : null,
      wonJobId: b.wonJobId,
      outcome: b.outcome
        ? { result: b.outcome.result, reason: b.outcome.reason, winningPrice: b.outcome.winningPrice != null ? Number(b.outcome.winningPrice) : null }
        : null,
    }))
    .filter((row) => withinBand(row.bidAmount, bid.bidAmount));
  return { basis: bid.bidAmount !== null && bid.bidAmount > 0 ? "trade and value" : "trade only", rows };
}
