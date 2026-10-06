import type { ScheduleProposalRowView } from "@/components/ScheduleProposals";

/**
 * `PlanScheduleProposal.rows` IS A `Json` COLUMN, SO IT IS CHECKED ON THE WAY OUT.
 *
 * A row written by an older build, or by a reader whose shape has since changed,
 * is not evidence of anything — the same posture `findingsFromJson` takes for
 * spec findings and `verticesProblem` takes for a traced shape. The failure this
 * prevents is specific: a `mark` that arrives as `undefined` renders as nothing,
 * and a schedule row with no mark on screen looks like a blank line in a table
 * rather than like data the app could not read.
 *
 * A row that does not pass is DROPPED, not repaired. There is no honest default
 * for a door mark.
 */

function isRow(value: unknown): value is ScheduleProposalRowView {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  // The mark is the identity. Everything else may legitimately be absent.
  if (typeof row.mark !== "string" || row.mark.trim().length === 0) return false;
  const nullableString = (candidate: unknown) => candidate === null || typeof candidate === "string";
  if (!nullableString(row.description)) return false;
  if (!nullableString(row.size)) return false;
  if (!nullableString(row.notes)) return false;
  if (row.quantity !== null && typeof row.quantity !== "number") return false;
  return true;
}

/** True when every element is a usable row. */
export function isScheduleRowArray(value: unknown): value is ScheduleProposalRowView[] {
  return Array.isArray(value) && value.every(isRow);
}

/**
 * The usable rows, dropping any that are not — for the case where one row of a
 * long schedule is malformed and the rest are fine.
 *
 * `isScheduleRowArray` answers "is this whole column trustworthy" and this
 * answers "what of it can I show". Both exist because the caller wants different
 * things: a type guard for the common path, and a salvage for a column written
 * across a shape change.
 */
export function scheduleRowsFromJson(value: unknown): ScheduleProposalRowView[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRow);
}
