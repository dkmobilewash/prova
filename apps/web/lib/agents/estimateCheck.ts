import { prisma } from "@prova/db";
import { normaliseReference } from "@/lib/addenda-overlap";
import { paperWhere } from "@/lib/estimating/bid-papers";
import { addFinding, type FindingSource, type NewFinding } from "./core";
import { AGENT_RUNNERS, type AgentContext } from "./run";
import { similarJobs } from "./bidHistory";

/**
 * THE ESTIMATE CHECK: before a bid goes out, compare its lines to what this
 * company has bid before. Deterministic — no model call, so it costs
 * nothing and says the same thing twice. It never edits a line.
 *
 * WHICH LINES. A bid's priced estimate is the `JobLineItem` rows on the job
 * the bid is linked to (`BidInvitation.wonJobId`, settable at any status
 * since 2026-10-04 — "the estimate it is being built on before the award").
 * `BidLine` holds the alternates, unit prices and allowances around that
 * number, so those are read for (d) only. No linked job is said plainly.
 *
 * WHAT IT COMPARES. Lines match across jobs on the catalog entry they came
 * from, else on the description with case and spacing ignored. That is the
 * text-matching `price-anomalies.ts` declined for COST; here it is a
 * consistency check on what WE have charged for a line we named the same
 * way, and every finding shows the comparison set so a person can see what
 * was matched. A renamed line simply does not match — a miss, never a
 * false flag.
 *
 * Price, not cost, is compared, which `price-anomalies.ts` leaves to the
 * estimator's judgement. That is why nothing here is worse than "warn" and
 * every body states the numbers rather than a verdict: it is "you usually
 * charge X for this", never "this is wrong".
 */

/** ±25% from the median of the same line on past jobs. */
export const OUTLIER_BAND = 0.25;
/** A median of fewer than three prices is not a history. */
export const OUTLIER_MIN_SAMPLE = 3;
/** A line on at least 60% of similar jobs is "usually there". */
export const SCOPE_SHARE = 0.6;
/** ...of at least three similar jobs with estimates. */
export const SCOPE_MIN_JOBS = 3;

export type CheckLine = {
  id: string;
  jobId: string;
  description: string;
  /** JobLineItem.sourceCatalogEntryId, read only. */
  catalogEntryId: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
};

/** The matching key: catalog entry first, else the description. */
export function lineKey(line: Pick<CheckLine, "description" | "catalogEntryId">): string {
  return line.catalogEntryId
    ? `catalog:${line.catalogEntryId}`
    : `desc:${line.description.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export type UnitPriceOutlier = {
  line: CheckLine;
  n: number;
  median: number;
  min: number;
  max: number;
  /** price / median - 1, signed. */
  off: number;
  jobIds: string[];
};

/** Lines whose unit price sits more than OUTLIER_BAND from the median of
 *  the same line on OTHER jobs. Pure; recommendations reuse it. */
export function unitPriceOutliers(lines: CheckLine[], history: CheckLine[]): UnitPriceOutlier[] {
  const byKey = new Map<string, CheckLine[]>();
  for (const past of history) {
    if (!(past.unitPrice && past.unitPrice > 0)) continue;
    const key = lineKey(past);
    byKey.set(key, [...(byKey.get(key) ?? []), past]);
  }
  const out: UnitPriceOutlier[] = [];
  for (const line of lines) {
    if (!(line.unitPrice && line.unitPrice > 0)) continue;
    const set = (byKey.get(lineKey(line)) ?? []).filter((p) => p.jobId !== line.jobId && (p.unit ?? "") === (line.unit ?? ""));
    if (set.length < OUTLIER_MIN_SAMPLE) continue;
    const prices = set.map((p) => p.unitPrice!);
    const mid = median(prices);
    const off = line.unitPrice / mid - 1;
    if (Math.abs(off) <= OUTLIER_BAND) continue;
    out.push({ line, n: set.length, median: mid, min: Math.min(...prices), max: Math.max(...prices), off, jobIds: [...new Set(set.map((p) => p.jobId))] });
  }
  return out;
}

export type MissingScope = { key: string; description: string; share: number; jobIds: string[]; ofJobs: number };

/** Lines present on ≥ SCOPE_SHARE of the similar jobs and absent here. */
export function missingScope(lines: CheckLine[], similarJobLines: Map<string, CheckLine[]>): MissingScope[] {
  if (similarJobLines.size < SCOPE_MIN_JOBS) return [];
  const here = new Set(lines.map(lineKey));
  const seen = new Map<string, { description: string; jobIds: Set<string> }>();
  for (const [jobId, jobLines] of similarJobLines) {
    for (const line of jobLines) {
      const key = lineKey(line);
      const entry = seen.get(key) ?? { description: line.description, jobIds: new Set<string>() };
      entry.jobIds.add(jobId);
      seen.set(key, entry);
    }
  }
  const out: MissingScope[] = [];
  for (const [key, entry] of seen) {
    const share = entry.jobIds.size / similarJobLines.size;
    if (share >= SCOPE_SHARE && !here.has(key)) {
      out.push({ key, description: entry.description, share, jobIds: [...entry.jobIds], ofJobs: similarJobLines.size });
    }
  }
  return out;
}

/** Items in an addendum's newest reading with no "mine / not mine"
 *  decision, keyed the way the decisions are (`normaliseReference`). */
export function openAddendumItems(items: unknown, decisions: { normalisedReference: string }[]): { open: number; total: number } {
  const list = Array.isArray(items) ? (items as { reference?: unknown }[]) : [];
  const decided = new Set(decisions.map((d) => d.normalisedReference));
  const open = list.filter((item) => typeof item.reference === "string" && !decided.has(normaliseReference(item.reference))).length;
  return { open, total: list.length };
}

const money = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (value: number) => `${Math.round(value * 100)}%`;
// Reads the catalog link, never writes it (catalogLineWriterCensus counts writers).
const LINE_SELECT = { id: true, jobId: true, description: true, sourceCatalogEntryId: true, quantity: true, unit: true, unitPrice: true } as const;
const toLine = (row: Partial<Record<keyof typeof LINE_SELECT, unknown>>): CheckLine => ({
  id: String(row.id),
  jobId: String(row.jobId),
  description: String(row.description),
  catalogEntryId: typeof row.sourceCatalogEntryId === "string" ? row.sourceCatalogEntryId : null,
  quantity: Number(row.quantity),
  unit: typeof row.unit === "string" ? row.unit : null,
  unitPrice: row.unitPrice != null ? Number(row.unitPrice) : null,
});
const jobSource = (id: string): FindingSource => ({ label: "Past estimate", href: `/jobs/${id}/estimate`, recordType: "Job", recordId: id });

/** The lines this bid is priced on, or null when no job is linked. */
export async function estimateLinesFor(companyId: string, wonJobId: string | null): Promise<CheckLine[] | null> {
  if (!wonJobId) return null;
  const rows = await prisma.jobLineItem.findMany({
    where: { jobId: wonJobId, isDeleted: false, job: { companyId } },
    select: LINE_SELECT,
  });
  return rows.map(toLine);
}

/** Past priced lines matching any of these lines, on other jobs of this company. */
export async function priceHistoryFor(companyId: string, lines: CheckLine[], excludeJobId: string): Promise<CheckLine[]> {
  if (lines.length === 0) return [];
  const catalogIds = [...new Set(lines.map((l) => l.catalogEntryId).filter((id): id is string => Boolean(id)))];
  const descriptions = [...new Set(lines.filter((l) => !l.catalogEntryId).map((l) => l.description.trim()))];
  const rows = await prisma.jobLineItem.findMany({
    where: {
      job: { companyId },
      jobId: { not: excludeJobId },
      isDeleted: false,
      unitPrice: { gt: 0 },
      OR: [
        ...(catalogIds.length ? [{ sourceCatalogEntry: { id: { in: catalogIds } } }] : []),
        ...(descriptions.length ? [{ description: { in: descriptions, mode: "insensitive" as const } }] : []),
      ],
    },
    select: LINE_SELECT,
    take: 2000,
  });
  return rows.map(toLine);
}

export async function checkEstimate(ctx: AgentContext): Promise<{ summary: string }> {
  if (!ctx.bidInvitationId) throw new Error("No bid given. The estimate check runs on one bid.");
  const bid = await prisma.bidInvitation.findFirst({
    where: { id: ctx.bidInvitationId, companyId: ctx.companyId },
    select: {
      id: true,
      projectName: true,
      tradeScope: true,
      bidAmount: true,
      wonJobId: true,
      bidProjectId: true,
      lines: { select: { id: true, kind: true, label: true, amount: true, unitPrice: true } },
    },
  });
  if (!bid) throw new Error("That bid is not on this account.");
  // The PROJECT's addenda, whichever GC's invitation each was filed under: an
  // addendum about the building is open on every GC's bid for it.
  const addenda = await prisma.bidAddendum.findMany({
    where: { companyId: ctx.companyId, ...paperWhere({ id: bid.id, bidProjectId: bid.bidProjectId }) },
    select: {
      id: true,
      reference: true,
      readings: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, items: true } },
      decisions: { select: { normalisedReference: true } },
    },
  });

  const bidHref = `/ai/bids/${bid.id}`;
  const estimateHref = bid.wonJobId ? `/jobs/${bid.wonJobId}/estimate` : bidHref;
  const bidSource: FindingSource = { label: bid.projectName, href: bidHref, recordType: "BidInvitation", recordId: bid.id };
  const base = { bidInvitationId: bid.id };
  const key = (kind: string, fact: string) => `check:${bid.id}:${kind}:${fact}`.slice(0, 190);
  const findings: NewFinding[] = [];

  const lines = await estimateLinesFor(ctx.companyId, bid.wonJobId);
  if (lines === null) {
    findings.push({
      ...base,
      kind: "no_estimate",
      severity: "info",
      title: "No estimate linked to this bid",
      body: "Link the job this bid is priced on, and the check can compare its lines with your past bids.",
      sources: [bidSource],
      fixHref: bidHref,
      dedupeKey: key("no_estimate", "1"),
    });
  } else {
    // (a) missing scope, against similar past jobs' estimates
    const similar = await similarJobs(ctx.companyId, {
      id: bid.id,
      tradeScope: bid.tradeScope,
      bidAmount: bid.bidAmount != null ? Number(bid.bidAmount) : null,
    });
    const jobIds = similar.rows.map((r) => r.wonJobId).filter((id): id is string => Boolean(id) && id !== bid.wonJobId);
    const similarLines = new Map<string, CheckLine[]>();
    if (jobIds.length > 0) {
      const rows = await prisma.jobLineItem.findMany({
        where: { jobId: { in: jobIds }, isDeleted: false, job: { companyId: ctx.companyId } },
        select: LINE_SELECT,
      });
      for (const row of rows) similarLines.set(row.jobId, [...(similarLines.get(row.jobId) ?? []), toLine(row)]);
    }
    for (const gap of missingScope(lines, similarLines)) {
      findings.push({
        ...base,
        kind: "missing_scope",
        severity: "warn",
        title: `"${gap.description}" is on most similar jobs, not this one`,
        body: `It appears on ${gap.jobIds.length} of ${gap.ofJobs} similar past estimates (${pct(gap.share)}) and is not on this estimate. Worth checking it is covered or excluded.`,
        sources: gap.jobIds.slice(0, 8).map(jobSource),
        fixHref: estimateHref,
        dedupeKey: key("missing_scope", gap.key),
      });
    }

    // (b) unit price outliers
    const history = await priceHistoryFor(ctx.companyId, lines, bid.wonJobId!);
    for (const o of unitPriceOutliers(lines, history)) {
      const unit = o.line.unit ? `/${o.line.unit}` : "";
      findings.push({
        ...base,
        kind: "unit_price_outlier",
        severity: Math.abs(o.off) > 1 ? "warn" : "info",
        title: `${o.line.description} at ${money(o.line.unitPrice!)}${unit} is ${pct(Math.abs(o.off))} ${o.off > 0 ? "above" : "below"} your usual`,
        body: `Past ${o.n} prices for this line: median ${money(o.median)}${unit}, lowest ${money(o.min)}, highest ${money(o.max)}. This estimate has ${money(o.line.unitPrice!)}${unit}.`,
        sources: [
          { label: "This estimate line", href: estimateHref, recordType: "JobLineItem", recordId: o.line.id },
          ...o.jobIds.slice(0, 7).map(jobSource),
        ],
        fixHref: estimateHref,
        dedupeKey: key("unit_price_outlier", `${o.line.id}:${o.line.unitPrice}`),
      });
    }

    // (d) zero quantity / zero price on the estimate
    for (const line of lines) {
      const zeroQty = line.quantity === 0;
      const zeroPrice = line.unitPrice === 0;
      if (!zeroQty && !zeroPrice) continue;
      findings.push({
        ...base,
        kind: "zero_line",
        severity: "flag",
        title: `${line.description} has ${zeroQty ? "zero quantity" : "a zero price"}`,
        body: `This line adds nothing to the bid as it stands (quantity ${line.quantity}, unit price ${line.unitPrice ?? "none"}).`,
        sources: [{ label: line.description, href: estimateHref, recordType: "JobLineItem", recordId: line.id }],
        fixHref: estimateHref,
        dedupeKey: key("zero_line", `${line.id}:${line.quantity}:${line.unitPrice}`),
      });
    }
  }

  // (d) unit-price bid lines priced at zero
  for (const line of bid.lines) {
    if (line.kind !== "UNIT_PRICE" || line.unitPrice == null || Number(line.unitPrice) !== 0) continue;
    findings.push({
      ...base,
      kind: "zero_line",
      severity: "flag",
      title: `Unit price "${line.label}" is priced at zero`,
      body: "A unit price the GC asked for is filled in as $0.00.",
      sources: [{ label: line.label, href: bidHref, recordType: "BidLine", recordId: line.id }],
      fixHref: bidHref,
      dedupeKey: key("zero_line", `${line.id}:0`),
    });
  }

  // (c) addenda not reflected: never read, or items still undecided
  for (const addendum of addenda) {
    const reading = addendum.readings[0];
    const { open, total } = openAddendumItems(reading?.items, addendum.decisions);
    if (reading && open === 0) continue;
    findings.push({
      ...base,
      kind: "addendum_open",
      severity: "warn",
      title: reading ? `Addendum ${addendum.reference}: ${open} item${open === 1 ? "" : "s"} not decided` : `Addendum ${addendum.reference} has not been read`,
      body: reading
        ? `${open} of ${total} items it names have no "mine / not mine" decision yet.`
        : "Nobody has read this addendum into the bid yet, so any scope it changes may not be priced.",
      sources: [{ label: `Addendum ${addendum.reference}`, href: bidHref, recordType: "BidAddendum", recordId: addendum.id }],
      fixHref: bidHref,
      dedupeKey: key("addendum_open", `${addendum.id}:${reading?.id ?? "unread"}:${open}`),
    });
  }

  let written = 0;
  for (const finding of findings) if (await addFinding(ctx.run, finding)) written += 1;
  return { summary: `${written} new finding${written === 1 ? "" : "s"} on ${bid.projectName}'s estimate.` };
}

AGENT_RUNNERS.ESTIMATE_CHECK = checkEstimate;
