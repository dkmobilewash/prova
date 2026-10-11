import { prisma, type AgentKind } from "@prova/db";
import type { FindingSource } from "./core";
import { openAddendumItems } from "./estimateCheck";
import { toRecommendationRow, type RecommendationRow } from "./recommendations-query";

/**
 * Everything the bid workspace on /ai shows for one bid, in one read. Only
 * reads; scoped to the company in every where clause.
 *
 * `FindingRow` is the shape lib/agents/queries.ts exports, restated here
 * structurally so this file does not depend on that one.
 */
export type FindingRow = {
  id: string;
  agent: AgentKind;
  kind: string;
  severity: string;
  title: string;
  body: string;
  sources: FindingSource[];
  fixHref: string | null;
  bidInvitationId: string | null;
  bidProjectName: string | null;
  createdAt: Date;
  dismissedAt: Date | null;
  runId: string;
};

export type BidWorkspace = {
  bid: {
    id: string;
    projectName: string;
    gcName: string;
    contactId: string;
    dueDate: Date | null;
    status: string;
    bidAmount: number | null;
    tradeScope: string | null;
  };
  research: FindingRow[];
  estimateCheck: FindingRow[];
  addenda: { id: string; reference: string; issuedOn: Date | null; read: boolean; openDecisions: number; href: string }[];
  decision: {
    recommendation: RecommendationRow | null;
    outcome: {
      result: string;
      reason: string;
      winningPrice: number | null;
      winnerName: string | null;
      note: string | null;
      decidedOn: Date | null;
    } | null;
  };
  lastRuns: { agent: AgentKind; finishedAt: Date | null; status: string }[];
  /** What the UI passes to AskPanel so threads attach to this bid. */
  subject: { type: "BidInvitation"; id: string };
};

export async function loadBidWorkspace(bidInvitationId: string, companyId: string): Promise<BidWorkspace | null> {
  const bid = await prisma.bidInvitation.findFirst({
    where: { id: bidInvitationId, companyId },
    select: {
      id: true,
      projectName: true,
      contactId: true,
      dueDate: true,
      status: true,
      bidAmount: true,
      tradeScope: true,
      contact: { select: { name: true } },
      outcome: { select: { result: true, reason: true, winningPrice: true, winnerName: true, note: true, decidedOn: true } },
      addenda: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          reference: true,
          issuedOn: true,
          readings: { orderBy: { createdAt: "desc" }, take: 1, select: { items: true } },
          decisions: { select: { normalisedReference: true } },
        },
      },
    },
  });
  if (!bid) return null;

  const [findings, recommendation, runs] = await Promise.all([
    prisma.agentFinding.findMany({
      where: { companyId, bidInvitationId, agent: { in: ["BID_RESEARCH", "ESTIMATE_CHECK"] }, dismissedAt: null },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        agent: true,
        kind: true,
        severity: true,
        title: true,
        body: true,
        sources: true,
        fixHref: true,
        bidInvitationId: true,
        createdAt: true,
        dismissedAt: true,
        runId: true,
      },
    }),
    prisma.aiRecommendation.findFirst({
      where: { companyId, kind: "bid_or_pass", subjectType: "BidInvitation", subjectId: bidInvitationId },
      select: {
        id: true,
        kind: true,
        subjectType: true,
        subjectId: true,
        title: true,
        reason: true,
        confidence: true,
        score: true,
        href: true,
        sources: true,
        status: true,
        updatedAt: true,
      },
    }),
    prisma.agentRun.findMany({
      where: { companyId, bidInvitationId },
      orderBy: { startedAt: "desc" },
      take: 20,
      select: { agent: true, finishedAt: true, status: true },
    }),
  ]);

  const rows: FindingRow[] = findings.map((f) => ({
    ...f,
    sources: Array.isArray(f.sources) ? (f.sources as FindingSource[]) : [],
    bidProjectName: bid.projectName,
  }));
  // The newest run of each agent (runs are newest first).
  const newestByAgent = new Map<AgentKind, (typeof runs)[number]>();
  for (const run of runs) if (!newestByAgent.has(run.agent)) newestByAgent.set(run.agent, run);

  return {
    bid: {
      id: bid.id,
      projectName: bid.projectName,
      gcName: bid.contact.name,
      contactId: bid.contactId,
      dueDate: bid.dueDate,
      status: bid.status,
      bidAmount: bid.bidAmount != null ? Number(bid.bidAmount) : null,
      tradeScope: bid.tradeScope,
    },
    research: rows.filter((r) => r.agent === "BID_RESEARCH"),
    estimateCheck: rows.filter((r) => r.agent === "ESTIMATE_CHECK"),
    addenda: bid.addenda.map((a) => ({
      id: a.id,
      reference: a.reference,
      issuedOn: a.issuedOn,
      read: a.readings.length > 0,
      openDecisions: openAddendumItems(a.readings[0]?.items, a.decisions).open,
      href: `/ai/bids/${bid.id}`,
    })),
    decision: {
      recommendation: recommendation ? toRecommendationRow(recommendation) : null,
      outcome: bid.outcome
        ? {
            result: bid.outcome.result,
            reason: bid.outcome.reason,
            winningPrice: bid.outcome.winningPrice != null ? Number(bid.outcome.winningPrice) : null,
            winnerName: bid.outcome.winnerName,
            note: bid.outcome.note,
            decidedOn: bid.outcome.decidedOn,
          }
        : null,
    },
    lastRuns: [...newestByAgent.values()].map((r) => ({ agent: r.agent, finishedAt: r.finishedAt, status: r.status })),
    subject: { type: "BidInvitation", id: bid.id },
  };
}
