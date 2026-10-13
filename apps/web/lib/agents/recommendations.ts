import { prisma, type Prisma } from "@prova/db";
import { calculateRetainageSummary } from "@/lib/retainage";
import { retainageAlerts } from "@/lib/alerts";
import { calculateArAgingInvoice } from "@/lib/cash-flow";
import { serverToday } from "@/lib/serverToday";
import type { FindingSource } from "./core";
import { AGENT_RUNNERS, type AgentContext } from "./run";
import { gcHistory, type GcHistory } from "./bidHistory";
import { estimateLinesFor, priceHistoryFor, unitPriceOutliers } from "./estimateCheck";

/**
 * RECOMMENDATIONS: a ranked "what to do next" list, deterministic, no model.
 *
 * Four kinds, each built from logic the app already trusts rather than a
 * second copy of it:
 *
 *   - bid_or_pass, per INVITED bid: the GC's win rate, pay speed and
 *     backcharges (bidHistory.ts over gc-reliability.ts) and how many other
 *     invited bids are due the same fortnight. The reason names every
 *     factor with its number; a factor with no data says so.
 *   - price_outlier, per INVITED bid with a linked estimate: estimateCheck's
 *     own outlier rule.
 *   - releasable_retainage, per job: `retainageAlerts` (lib/alerts.ts) — the
 *     alert list's notion of collectable, not a new one.
 *   - overdue_chase, per invoice: `calculateArAgingInvoice` (lib/cash-flow.ts),
 *     the one overdue rule the dashboard and the aging table share.
 *
 * Rows are upserted on (company, kind, subject). A row whose subject no
 * longer qualifies is marked "done" by the engine (resolvedByUserId null);
 * one a PERSON dismissed or marked done stays that way. An engine-closed
 * row whose subject qualifies again reopens.
 */

export const RECOMMENDATION_KINDS = ["bid_or_pass", "price_outlier", "releasable_retainage", "overdue_chase"] as const;

export type DraftRecommendation = {
  kind: (typeof RECOMMENDATION_KINDS)[number];
  subjectType: string;
  subjectId: string;
  title: string;
  reason: string;
  confidence: "low" | "medium" | "high";
  score: number;
  href: string;
  sources: FindingSource[];
};

const money = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const DAY = 24 * 60 * 60 * 1000;
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * The bid-or-pass score, 0-100, and the sentence that explains it. Pure and
 * exported: the weights are a judgement, and a judgement is pinned by a test.
 *
 * ponytail: hand-set weights. Replace with outcome-fitted weights once
 * enough BidOutcome rows exist to fit anything.
 */
export function bidOrPass(history: GcHistory, othersDueSameFortnight: number | null): Pick<DraftRecommendation, "score" | "confidence" | "reason"> {
  const parts: string[] = [];
  let score = 50;
  const decided = history.bids.won.length + history.bids.lost.length;

  if (history.bids.winRate === null) {
    parts.push("no decided bids with this GC yet");
  } else {
    score += Math.max(-30, Math.min(30, (history.bids.winRate - 0.3) * 100));
    parts.push(`win rate ${Math.round(history.bids.winRate * 100)}% (${history.bids.won.length} of ${decided})`);
  }

  const days = history.paySpeed.averageDaysToPay;
  if (days === null) {
    parts.push("no pay history");
  } else {
    score += days <= 45 ? 10 : days > 90 ? -25 : days > 60 ? -15 : 0;
    parts.push(`pays in about ${Math.round(days)} days`);
  }

  const bc = history.backcharges;
  if (bc.count === 0) {
    parts.push("no backcharges");
  } else {
    score -= (bc.openCount > 0 ? 10 : 0) + (bc.count >= 3 ? 10 : 0);
    parts.push(`${bc.count} backcharge${bc.count === 1 ? "" : "s"} (${money(bc.claimedTotal)} claimed)`);
  }

  if (othersDueSameFortnight === null) {
    parts.push("no due date to weigh workload against");
  } else {
    score -= Math.min(20, Math.max(0, othersDueSameFortnight - 2) * 5);
    parts.push(`${othersDueSameFortnight} other invited bid${othersDueSameFortnight === 1 ? "" : "s"} due within a week of it`);
  }

  const evidence = decided + history.paySpeed.settledCount;
  const confidence = evidence >= 6 ? "high" : evidence >= 2 ? "medium" : "low";
  const sentence = parts.join(", ");
  return { score: clamp(score), confidence, reason: sentence.charAt(0).toUpperCase() + sentence.slice(1) + "." };
}

async function bidRecommendations(companyId: string): Promise<DraftRecommendation[]> {
  const bids = await prisma.bidInvitation.findMany({
    where: { companyId, status: "INVITED" },
    select: { id: true, projectName: true, contactId: true, dueDate: true, wonJobId: true, contact: { select: { name: true } } },
  });
  const histories = new Map<string, GcHistory>();
  const out: DraftRecommendation[] = [];
  for (const bid of bids) {
    const history = histories.get(bid.contactId) ?? (await gcHistory(companyId, bid.contactId));
    histories.set(bid.contactId, history);
    const due = bid.dueDate?.getTime() ?? null;
    const others =
      due === null ? null : bids.filter((b) => b.id !== bid.id && b.dueDate && Math.abs(b.dueDate.getTime() - due) <= 7 * DAY).length;
    const { score, confidence, reason } = bidOrPass(history, others);
    const verdict = score >= 60 ? "Worth bidding" : score <= 35 ? "Consider passing" : "Your call";
    out.push({
      kind: "bid_or_pass",
      subjectType: "BidInvitation",
      subjectId: bid.id,
      title: `${verdict}: ${bid.projectName} for ${bid.contact.name}`,
      reason,
      confidence,
      score,
      href: `/ai/bids/${bid.id}`,
      sources: [
        { label: bid.projectName, href: `/ai/bids/${bid.id}`, recordType: "BidInvitation", recordId: bid.id },
        { label: bid.contact.name, href: `/contacts/${bid.contactId}`, recordType: "Contact", recordId: bid.contactId },
        ...[...history.bids.won, ...history.bids.lost].filter((id) => id !== bid.id).slice(0, 4).map((id) => ({ label: "Decided bid", href: `/ai/bids/${id}`, recordType: "BidInvitation", recordId: id })),
        ...history.paySpeed.jobIds.slice(0, 3).map((id) => ({ label: "Paid invoices", href: `/jobs/${id}`, recordType: "Job", recordId: id })),
      ],
    });

    // price_outlier: the estimate check's own rule, on the bid's linked estimate.
    const lines = await estimateLinesFor(companyId, bid.wonJobId);
    if (lines && lines.length > 0 && bid.wonJobId) {
      const outliers = unitPriceOutliers(lines, await priceHistoryFor(companyId, lines, bid.wonJobId));
      if (outliers.length > 0) {
        const worst = outliers.reduce((a, b) => (Math.abs(b.off) > Math.abs(a.off) ? b : a));
        out.push({
          kind: "price_outlier",
          subjectType: "BidInvitation",
          subjectId: bid.id,
          title: `Check ${outliers.length} unit price${outliers.length === 1 ? "" : "s"} on ${bid.projectName}`,
          reason: `${worst.line.description} is ${Math.round(Math.abs(worst.off) * 100)}% ${worst.off > 0 ? "above" : "below"} the median of ${worst.n} past prices (${money(worst.median)}).${outliers.length > 1 ? ` ${outliers.length - 1} more line${outliers.length === 2 ? "" : "s"} outside 25%.` : ""}`,
          confidence: worst.n >= 6 ? "high" : "medium",
          score: clamp(55 + Math.abs(worst.off) * 20),
          href: `/jobs/${bid.wonJobId}/estimate`,
          sources: [
            ...outliers.slice(0, 4).map((o) => ({ label: o.line.description, href: `/jobs/${bid.wonJobId}/estimate`, recordType: "JobLineItem", recordId: o.line.id })),
            ...worst.jobIds.slice(0, 4).map((id) => ({ label: "Past estimate", href: `/jobs/${id}/estimate`, recordType: "Job", recordId: id })),
          ],
        });
      }
    }
  }
  return out;
}

async function moneyRecommendations(companyId: string, today: string): Promise<DraftRecommendation[]> {
  const jobs = await prisma.job.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      substantialCompletionDate: true,
      contact: { select: { name: true, paymentTermsDays: true } },
      invoices: {
        select: { id: true, number: true, amount: true, issuedAt: true, dueAt: true, retainageWithheld: true, payments: { select: { amount: true } } },
      },
      retainageReleases: { select: { amount: true } },
      closeoutSubmissions: { orderBy: { attempt: "desc" }, take: 1, select: { status: true, respondedOn: true } },
    },
  });
  const asOf = new Date(`${today}T00:00:00.000Z`);
  const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  const out: DraftRecommendation[] = [];

  for (const job of jobs) {
    // releasable_retainage — lib/alerts.ts decides what "collectable" means.
    const balance = calculateRetainageSummary({
      invoiceRetainageWithheld: job.invoices.map((i) => (i.retainageWithheld != null ? Number(i.retainageWithheld) : null)),
      releaseAmounts: job.retainageReleases.map((r) => Number(r.amount)),
      substantialCompletionDate: job.substantialCompletionDate,
    }).balance;
    const latest = job.closeoutSubmissions[0] ?? null;
    const [alert] = retainageAlerts(
      [
        {
          jobId: job.id,
          jobName: job.name,
          balance,
          closeoutAcceptedOn: latest?.status === "ACCEPTED" ? iso(latest.respondedOn) : null,
          substantialCompletionDate: iso(job.substantialCompletionDate),
          hasCloseoutSubmission: latest !== null,
        },
      ],
      today,
    );
    // OVERDUE: the GC accepted closeout and the horizon passed. STANDING with a
    // date: forecast completion passed (hedged). The "no path to release" and
    // "soon" alerts are not something to act on today.
    if (alert && (alert.severity === "OVERDUE" || (alert.severity === "STANDING" && alert.dueOn))) {
      const withRetainage = job.invoices.filter((i) => i.retainageWithheld != null && Number(i.retainageWithheld) > 0);
      out.push({
        kind: "releasable_retainage",
        subjectType: "Job",
        subjectId: job.id,
        title: `${alert.title} (${money(balance)})`,
        reason: alert.detail,
        confidence: alert.severity === "OVERDUE" ? "high" : "medium",
        score: clamp((alert.severity === "OVERDUE" ? 60 : 40) + Math.min(30, balance / 2000)),
        href: `/jobs/${job.id}/retainage`,
        sources: [
          { label: job.name, href: `/jobs/${job.id}/retainage`, recordType: "Job", recordId: job.id },
          ...withRetainage.slice(0, 6).map((i) => ({ label: `Invoice #${i.number}`, href: `/jobs/${job.id}/billing`, recordType: "Invoice", recordId: i.id })),
        ],
      });
    }

    // overdue_chase — the one overdue rule.
    for (const invoice of job.invoices) {
      const aged = calculateArAgingInvoice(
        {
          invoiceId: invoice.id,
          jobId: job.id,
          jobName: job.name,
          contactName: job.contact.name,
          amount: Number(invoice.amount),
          paidAmount: invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0),
          retainageWithheld: invoice.retainageWithheld != null ? Number(invoice.retainageWithheld) : null,
          issuedAt: invoice.issuedAt,
          dueAt: invoice.dueAt,
          paymentTermsDays: job.contact.paymentTermsDays,
        },
        asOf,
      );
      if (!aged || aged.daysPastDue <= 0) continue;
      out.push({
        kind: "overdue_chase",
        subjectType: "Invoice",
        subjectId: invoice.id,
        title: `Chase ${job.contact.name} for invoice #${invoice.number} on ${job.name}`,
        reason: `${money(aged.balance)} is ${aged.daysPastDue} day${aged.daysPastDue === 1 ? "" : "s"} past due (retainage not counted).`,
        confidence: "high",
        score: clamp(40 + Math.min(30, aged.daysPastDue / 3) + Math.min(30, aged.balance / 2000)),
        href: `/jobs/${job.id}/billing`,
        sources: [{ label: `Invoice #${invoice.number}, ${job.name}`, href: `/jobs/${job.id}/billing`, recordType: "Invoice", recordId: invoice.id }],
      });
    }
  }
  return out;
}

const keyOf = (r: { kind: string; subjectType: string; subjectId: string }) => `${r.kind}|${r.subjectType}|${r.subjectId}`;

/** Writes the drafts and closes what no longer qualifies. Returns counts. */
export async function saveRecommendations(companyId: string, drafts: DraftRecommendation[]) {
  const existing = await prisma.aiRecommendation.findMany({
    where: { companyId, kind: { in: [...RECOMMENDATION_KINDS] } },
    select: { id: true, kind: true, subjectType: true, subjectId: true, status: true, resolvedByUserId: true },
  });
  const byKey = new Map(existing.map((row) => [keyOf(row), row]));
  const live = new Set<string>();
  let opened = 0;
  for (const draft of drafts) {
    live.add(keyOf(draft));
    const row = byKey.get(keyOf(draft));
    const fields = {
      title: draft.title,
      reason: draft.reason,
      confidence: draft.confidence,
      score: draft.score,
      href: draft.href,
      sources: draft.sources as unknown as Prisma.InputJsonValue,
    };
    if (!row) {
      await prisma.aiRecommendation.create({ data: { companyId, kind: draft.kind, subjectType: draft.subjectType, subjectId: draft.subjectId, ...fields } });
      opened += 1;
      continue;
    }
    const reopen = row.status === "done" && row.resolvedByUserId === null;
    await prisma.aiRecommendation.update({
      where: { id: row.id },
      data: reopen ? { ...fields, status: "open", resolvedAt: null } : fields,
    });
    if (reopen) opened += 1;
  }
  const stale = existing.filter((row) => row.status === "open" && !live.has(keyOf(row))).map((row) => row.id);
  if (stale.length > 0) {
    await prisma.aiRecommendation.updateMany({ where: { id: { in: stale } }, data: { status: "done", resolvedAt: new Date() } });
  }
  return { opened, closed: stale.length, total: drafts.length };
}

export async function runRecommendations(ctx: AgentContext): Promise<{ summary: string }> {
  const drafts = [...(await bidRecommendations(ctx.companyId)), ...(await moneyRecommendations(ctx.companyId, serverToday()))];
  for (const draft of drafts) {
    // The same rule addFinding enforces: no source, no row.
    if (draft.sources.length === 0) throw new Error(`recommendation "${draft.kind}" has no source`);
  }
  const { opened, closed, total } = await saveRecommendations(ctx.companyId, drafts);
  return { summary: `${total} recommendation${total === 1 ? "" : "s"} current, ${opened} new, ${closed} no longer apply.` };
}

AGENT_RUNNERS.RECOMMENDATIONS = runRecommendations;
