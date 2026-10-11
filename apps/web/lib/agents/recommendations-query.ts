import { prisma } from "@prova/db";
import type { FindingSource } from "./core";

/** Reads for the /ai page: the recommendation list and its activity feed. */

export type RecommendationRow = {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  title: string;
  reason: string;
  confidence: string;
  score: number;
  href: string | null;
  sources: FindingSource[];
  status: string;
  updatedAt: Date;
};

const SELECT = {
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
} as const;

export function toRecommendationRow(row: Omit<RecommendationRow, "sources"> & { sources: unknown }): RecommendationRow {
  return { ...row, sources: Array.isArray(row.sources) ? (row.sources as FindingSource[]) : [] };
}

export async function listRecommendations(
  companyId: string,
  opts: { status?: "open" | "all"; limit?: number } = {},
): Promise<RecommendationRow[]> {
  const rows = await prisma.aiRecommendation.findMany({
    where: { companyId, ...(opts.status === "all" ? {} : { status: "open" }) },
    orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
    take: opts.limit ?? 50,
    select: SELECT,
  });
  return rows.map(toRecommendationRow);
}

export type RecommendationActivity = {
  id: string;
  at: Date;
  kind: "recommendation" | "outcome";
  title: string;
  detail: string;
  href: string | null;
};

/** Newest first: recommendations as they were raised or resolved, and bid
 *  outcomes as they were recorded. */
export async function recommendationActivity(companyId: string, limit = 20): Promise<RecommendationActivity[]> {
  const [recs, outcomes] = await Promise.all([
    prisma.aiRecommendation.findMany({
      where: { companyId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, title: true, reason: true, status: true, href: true, updatedAt: true },
    }),
    prisma.bidOutcome.findMany({
      where: { companyId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        result: true,
        reason: true,
        winnerName: true,
        updatedAt: true,
        bidInvitationId: true,
        bidInvitation: { select: { projectName: true } },
      },
    }),
  ]);
  const items: RecommendationActivity[] = [
    ...recs.map((r) => ({
      id: r.id,
      at: r.updatedAt,
      kind: "recommendation" as const,
      title: r.status === "open" ? r.title : `${r.title} (${r.status})`,
      detail: r.reason,
      href: r.href,
    })),
    ...outcomes.map((o) => ({
      id: o.id,
      at: o.updatedAt,
      kind: "outcome" as const,
      title: `${o.bidInvitation.projectName}: ${o.result === "WON" ? "won" : "lost"}`,
      detail: `Reason: ${o.reason.toLowerCase()}${o.winnerName ? `. Went to ${o.winnerName}` : ""}.`,
      href: `/ai/bids/${o.bidInvitationId}`,
    })),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
