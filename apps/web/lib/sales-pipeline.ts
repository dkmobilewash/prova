/**
 * Prova's own pipeline, read across every opportunity.
 *
 * /sales lists LEADS. This answers the question a list of leads cannot:
 * where the deals are, what they are worth, and which of them have gone
 * quiet. Nothing here is stored — every figure is computed from the rows
 * at read time, so a stage corrected on a lead's page moves these with it.
 *
 * THERE IS DELIBERATELY NO WEIGHTED FORECAST. The usual one multiplies
 * each stage by a probability — 10% for New, 50% for Trial, and so on —
 * and nobody at Prova has ever supplied those numbers. Inventing them
 * would produce a confident dollar figure derived from nothing, which is
 * the exact failure this codebase keeps finding in other forms. What IS
 * here is built only from facts somebody entered: the open total, and
 * close-date buckets read off the dates themselves.
 */

import { daysUntil } from "./compliance-expiry";
import type { OpportunityStage } from "./sales-stage-history";

export type { OpportunityStage };

/** The stages a deal is still live in, in the order it moves through them. */
export const OPEN_STAGES: readonly OpportunityStage[] = [
  "NEW",
  "CONTACTED",
  "DEMO_SCHEDULED",
  "TRIAL",
];

export function isOpen(stage: OpportunityStage): boolean {
  return OPEN_STAGES.includes(stage);
}

export interface PipelineOpportunity {
  id: string;
  leadId: string;
  companyName: string;
  stage: OpportunityStage;
  /** Null when nobody has priced it. NOT zero — see every total below. */
  estimatedMrr: number | null;
  /** ISO day at UTC midnight, or null when nobody named a date. */
  expectedCloseDate: string | null;
  /** From SalesStageChange. Null when the history does not know. */
  daysInStage: number | null;
}

export interface StageColumn {
  stage: OpportunityStage;
  count: number;
  /**
   * The sum of the deals that HAVE a number. Deals without one are not
   * counted as zero here — they are counted in `unpriced`, so a column
   * reading "$0 across 3 deals" is impossible and "£X across 3, 2
   * unpriced" is what you get instead.
   */
  mrr: number;
  unpriced: number;
  /**
   * The longest any deal has sat in this stage, in whole days. Null when
   * no deal in the column has a recorded history — not zero, which would
   * read as "all fresh".
   */
  longestDaysInStage: number | null;
}

/** A slice of the open pipeline, counted and totalled the same way. */
export interface PipelineSlice {
  count: number;
  mrr: number;
  unpriced: number;
}

export interface SalesPipeline {
  /** One per open stage, in pipeline order, including empty ones. */
  columns: StageColumn[];
  won: StageColumn;
  lost: StageColumn;

  open: PipelineSlice;
  /**
   * won / (won + lost), or null when nothing has been decided yet.
   *
   * Null rather than 0 is the point: a pipeline with four live deals and
   * nothing closed has no win rate, and printing "0%" would report a
   * track record of losing that does not exist. Same rule as the GC bid
   * pipeline's.
   */
  winRate: number | null;

  /** Open deals whose entered close date falls within the horizon. */
  closingSoon: PipelineSlice;
  /** Open deals whose entered close date has already passed. */
  overdueToClose: PipelineSlice;
  /**
   * Open deals nobody gave a close date. Kept as its own number rather
   * than folded into either bucket above, because "we don't know when"
   * is not the same as "not soon".
   */
  openWithoutCloseDate: number;
}

export const CLOSING_SOON_DAYS = 30;

function slice(opportunities: readonly PipelineOpportunity[]): PipelineSlice {
  return {
    count: opportunities.length,
    mrr: opportunities.reduce((sum, o) => sum + (o.estimatedMrr ?? 0), 0),
    unpriced: opportunities.filter((o) => o.estimatedMrr === null).length,
  };
}

function column(
  stage: OpportunityStage,
  opportunities: readonly PipelineOpportunity[],
): StageColumn {
  const inStage = opportunities.filter((o) => o.stage === stage);
  const recorded = inStage
    .map((o) => o.daysInStage)
    .filter((days): days is number => days !== null);

  return {
    stage,
    ...slice(inStage),
    longestDaysInStage: recorded.length === 0 ? null : Math.max(...recorded),
  };
}

export function buildSalesPipeline(
  opportunities: readonly PipelineOpportunity[],
  todayIso: string,
): SalesPipeline {
  const openDeals = opportunities.filter((o) => isOpen(o.stage));
  const wonCount = opportunities.filter((o) => o.stage === "WON").length;
  const lostCount = opportunities.filter((o) => o.stage === "LOST").length;
  const decided = wonCount + lostCount;

  const dated = openDeals.filter(
    (o): o is PipelineOpportunity & { expectedCloseDate: string } =>
      o.expectedCloseDate !== null,
  );

  return {
    columns: OPEN_STAGES.map((stage) => column(stage, opportunities)),
    won: column("WON", opportunities),
    lost: column("LOST", opportunities),

    open: slice(openDeals),
    winRate: decided === 0 ? null : wonCount / decided,

    closingSoon: slice(
      dated.filter((o) => {
        const days = daysUntil(o.expectedCloseDate, todayIso);
        return days >= 0 && days <= CLOSING_SOON_DAYS;
      }),
    ),
    overdueToClose: slice(
      dated.filter((o) => daysUntil(o.expectedCloseDate, todayIso) < 0),
    ),
    openWithoutCloseDate: openDeals.length - dated.length,
  };
}

/**
 * The deals sitting longest, for the "what has gone quiet" read.
 *
 * Deliberately NOT filtered by a staleness threshold: nobody has decided
 * what "too long" is for Prova's own sales, and a number invented here
 * would be as made-up as the stage probabilities this module refuses.
 * Open deals whose time in stage is unrecorded are excluded entirely
 * rather than sorted as if they were fresh.
 */
export function longestOpen(
  opportunities: readonly PipelineOpportunity[],
  limit: number,
): (PipelineOpportunity & { daysInStage: number })[] {
  return opportunities
    .filter(
      (o): o is PipelineOpportunity & { daysInStage: number } =>
        isOpen(o.stage) && o.daysInStage !== null,
    )
    .sort((a, b) => {
      if (a.daysInStage !== b.daysInStage) return b.daysInStage - a.daysInStage;
      return a.companyName.localeCompare(b.companyName);
    })
    .slice(0, limit);
}

/** "67%", or null when there is no rate to show. Formatted once, here. */
export function winRateLabel(winRate: number | null): string | null {
  if (winRate === null) return null;
  return `${Math.round(winRate * 100)}%`;
}
