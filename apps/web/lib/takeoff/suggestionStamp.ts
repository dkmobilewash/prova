import { prisma } from "@prova/db";

/**
 * ── WHICH RULES A SHEET'S SUGGESTIONS WERE WORKED OUT UNDER ──
 *
 * A run stores what the review queue suggests — the tag type of each group, the
 * windows to confirm — from the legend it could see THEN. A legend read that
 * lands after the run (the legend pump on a new customer), or a code change to
 * those rules, left Baker showing untyped groups and "Ceiling 10'-0"" until
 * somebody pressed Run takeoff again (Chrome, 2026-11-06). Each detection that
 * writes a sheet's walls stamps the sheet with these rules and the moment it read
 * the legend; a stale stamp is what `suggestionRefresh.ts` works out again.
 *
 * BUMP `SUGGESTION_RULES` when a change alters what a run suggests (tag reading,
 * grouping, window typing). Every counted sheet is then worked out again once,
 * on its next queue load, without a model call.
 */
export const SUGGESTION_RULES = 1;
export const SUGGESTIONS_READ = "SUGGESTIONS_READ";

export async function stampSuggestions(planId: string, pageNumber: number, readAt: Date): Promise<void> {
  const where = { planId_pageNumber_kind: { planId, pageNumber, kind: SUGGESTIONS_READ } };
  const value = { rules: SUGGESTION_RULES };
  await prisma.takeoffPlanTextRead.upsert({ where, create: { planId, pageNumber, kind: SUGGESTIONS_READ, value, computedAt: readAt }, update: { value, computedAt: readAt } });
}

/** A sheet's stamp, or null for a sheet worked out before stamps existed. */
export type SuggestionStamp = { rules: number | null; readAt: Date } | null;

/** Whether a sheet's stored suggestions predate the rules or the newest legend save. */
export function suggestionsStale(stamp: SuggestionStamp, legendSavedAt: Date | null, rules: number = SUGGESTION_RULES): boolean {
  if (stamp === null || stamp.rules !== rules) return true;
  return legendSavedAt !== null && legendSavedAt.getTime() > stamp.readAt.getTime();
}

export function stampOf(value: unknown, computedAt: Date): SuggestionStamp {
  const rules = (value as { rules?: unknown } | null)?.rules;
  return { rules: typeof rules === "number" ? rules : null, readAt: computedAt };
}
