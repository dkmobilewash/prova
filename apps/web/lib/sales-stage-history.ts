/**
 * How long a deal has been where it is, derived from SalesStageChange.
 *
 * SalesOpportunity.stage says WHERE a deal is. This says how it got there
 * and when, which is the half a single mutable field cannot hold. Nothing
 * here is stored -- every figure is computed from the recorded moves at
 * read time, so correcting a move's date moves these with it.
 *
 * Owner-only, like everything else under /sales.
 */

import { daysUntil } from "./compliance-expiry";

export type OpportunityStage =
  | "NEW"
  | "CONTACTED"
  | "DEMO_SCHEDULED"
  | "TRIAL"
  | "WON"
  | "LOST";

export interface RecordedStageChange {
  id: string;
  /** Null on the opening record — it was created at this stage. */
  fromStage: OpportunityStage | null;
  toStage: OpportunityStage;
  /** ISO day at UTC midnight. The day the DEAL moved, entered. */
  effectiveOn: string;
  note: string | null;
  /** Full timestamp the row was written. Tie-break only. */
  recordedAt: string;
}

/** Oldest first, ties broken by the moment each was written. */
export function inOrder(changes: readonly RecordedStageChange[]): RecordedStageChange[] {
  return [...changes].sort((a, b) => {
    if (a.effectiveOn !== b.effectiveOn) return a.effectiveOn < b.effectiveOn ? -1 : 1;
    if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
    return 0;
  });
}

export function latestChange(
  changes: readonly RecordedStageChange[],
): RecordedStageChange | null {
  const ordered = inOrder(changes);
  return ordered.length === 0 ? null : ordered[ordered.length - 1];
}

/**
 * The day the deal entered the stage it is in now, or null when nothing
 * has been recorded.
 *
 * Null is not zero and is not the day the row was created. An opportunity
 * that predates this history, or one whose history has never been written,
 * genuinely does not know — and `createdAt` is not an answer, because it
 * says when the OPPORTUNITY began, not when it entered its CURRENT stage.
 * Using it would state a falsehood for every deal that has ever moved.
 */
export function currentStageSince(changes: readonly RecordedStageChange[]): string | null {
  return latestChange(changes)?.effectiveOn ?? null;
}

/**
 * The history disagrees with the stored stage.
 *
 * Should be unreachable: both writes happen in one transaction. That is
 * exactly why it is worth rendering if it ever appears — it means
 * something wrote SalesOpportunity.stage without recording the move, and a
 * silent disagreement between two records of the same fact is the bug
 * class this codebase keeps finding. Same treatment as enrollmentState's
 * CONTRADICTORY on /union-compliance.
 */
export function historyDisagrees(
  changes: readonly RecordedStageChange[],
  storedStage: OpportunityStage,
): boolean {
  const latest = latestChange(changes);
  if (latest === null) return false; // no history at all is silence, not disagreement
  return latest.toStage !== storedStage;
}

/**
 * Whole days the deal has been in its current stage.
 *
 * Null when nothing is recorded, and null when the recorded move is dated
 * in the FUTURE — a deal cannot already have spent time in a stage it has
 * not reached, and "-3 days" is worse than saying nothing. Zero is a real
 * answer and means it moved today.
 */
export function daysInCurrentStage(
  changes: readonly RecordedStageChange[],
  todayIso: string,
): number | null {
  const since = currentStageSince(changes);
  if (since === null) return null;
  const days = daysUntil(todayIso, since);
  return days < 0 ? null : days;
}

/** True when the latest recorded move is dated after today. */
export function isFutureDated(
  changes: readonly RecordedStageChange[],
  todayIso: string,
): boolean {
  const since = currentStageSince(changes);
  if (since === null) return false;
  return daysUntil(since, todayIso) > 0;
}

export interface StageSpell {
  stage: OpportunityStage;
  enteredOn: string;
  /** Null while the deal is still in this stage. */
  leftOn: string | null;
  /**
   * Whole days spent in the stage. Null for the spell still running when
   * its start is future-dated, for the same reason daysInCurrentStage is.
   */
  days: number | null;
  /** True for the spell the deal is in now. */
  isCurrent: boolean;
}

/**
 * One entry per stretch the deal spent in a stage, oldest first.
 *
 * A deal that goes NEW -> TRIAL -> LOST -> TRIAL produces four spells, not
 * three: coming back to a stage is a second, separate stretch, and summing
 * them into "18 days in TRIAL" would hide that it was written off in
 * between. The history is the record; this reads it, it does not condense
 * it.
 */
export function stageSpells(
  changes: readonly RecordedStageChange[],
  todayIso: string,
): StageSpell[] {
  const ordered = inOrder(changes);
  return ordered.map((change, index) => {
    const next = ordered[index + 1] ?? null;
    const isCurrent = next === null;
    const endIso = next?.effectiveOn ?? todayIso;
    const days = daysUntil(endIso, change.effectiveOn);
    return {
      stage: change.toStage,
      enteredOn: change.effectiveOn,
      leftOn: next?.effectiveOn ?? null,
      days: days < 0 ? null : days,
      isCurrent,
    };
  });
}

export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  DEMO_SCHEDULED: "Demo scheduled",
  TRIAL: "Trial",
  WON: "Won",
  LOST: "Lost",
};

/** Pipeline order, declared rather than relying on object key order. */
export const OPPORTUNITY_STAGE_ORDER: readonly OpportunityStage[] = [
  "NEW",
  "CONTACTED",
  "DEMO_SCHEDULED",
  "TRIAL",
  "WON",
  "LOST",
];

/**
 * The <select> options, DERIVED from the labels above rather than typed out
 * a second time.
 *
 * This lives here, in a plain module, and not in SalesOpportunityFields.tsx
 * where it used to. That file is "use client", and a non-component export
 * from a client module does not survive the RSC boundary: a server
 * component importing it receives a client-reference proxy, so `.find` is
 * not a function. /sales/[id] did exactly that and 500'd on any lead with
 * an opportunity -- the failure looked data-dependent only because the call
 * sat inside opportunities.map(), so a lead with none rendered fine.
 * lib/client-boundary.test.ts now fails if anything crosses that boundary
 * again.
 */
export const OPPORTUNITY_STAGE_OPTIONS: readonly { value: OpportunityStage; label: string }[] =
  OPPORTUNITY_STAGE_ORDER.map((value) => ({ value, label: OPPORTUNITY_STAGE_LABELS[value] }));

/**
 * How a spell reads on the page. Separate from the numbers so the wording
 * is decided once rather than in three components.
 */
export function stageTiming(days: number | null): string {
  if (days === null) return "not recorded";
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}
