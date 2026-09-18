/**
 * Lien-rights deadlines — the derived state, with no database in it.
 *
 * THE APP NEVER COMPUTES A LEGAL DEADLINE. Every `dueOn` this file sees
 * was ENTERED by a person, from their counsel or their own reading of the
 * statute. Nothing here, and nothing anywhere else in the app, turns a
 * first-furnishing date, a completion date, a state or a tier into a
 * deadline — the rules differ by state, by public versus private work and
 * by the contractor's tier, and a computed deadline that is wrong costs the
 * whole remedy while reading exactly like one that is right.
 *
 * What this file does is the arithmetic that is safe: how many days lie
 * between today and a date somebody else decided, and which of three
 * states a row is in. None of the three is stored — see liens.prisma — for
 * the reason this schema applies everywhere: a stored `overdue` flag is
 * wrong the morning after it was written.
 */

/** The remedies, in the order a person reads them. Mirrors the
 * `LienDeadlineKind` enum; kept as a literal list rather than imported from
 * `@prova/db` so client components can use it without pulling in Prisma. */
export const LIEN_DEADLINE_KINDS = [
  "PRELIMINARY_NOTICE",
  "MECHANICS_LIEN",
  "STOP_PAYMENT_NOTICE",
  "BOND_CLAIM",
  "OTHER",
] as const;

export type LienDeadlineKind = (typeof LIEN_DEADLINE_KINDS)[number];

const KIND_LABELS: Record<LienDeadlineKind, string> = {
  PRELIMINARY_NOTICE: "Preliminary notice",
  MECHANICS_LIEN: "Mechanic's lien",
  STOP_PAYMENT_NOTICE: "Stop payment notice",
  BOND_CLAIM: "Payment bond claim",
  OTHER: "Other",
};

/** A kind as a person says it. OTHER carries its real name in
 * `otherLabel`; an OTHER nobody named says so rather than rendering the
 * word "Other" as if it were the name of a remedy. */
export function lienKindLabel(kind: string, otherLabel: string | null | undefined): string {
  if (kind === "OTHER") return otherLabel?.trim() || "Unnamed lien deadline";
  return KIND_LABELS[kind as LienDeadlineKind] ?? kind;
}

/** How close "due soon" reaches. Fourteen days, the window the Ask tool's
 * summary reports and the page highlights. It is a REMINDER horizon, not a
 * legal one — it says nothing about how long any statute allows. */
export const DUE_SOON_DAYS = 14;

export type LienDeadlineState = "served" | "overdue" | "due_soon" | "upcoming";

export class LienDeadlineInputError extends Error {}

/** A yyyy-mm-dd from a form, as UTC midnight — how every date that matters
 * is stored here. Refuses an empty or unreadable value rather than
 * guessing: a deadline the app made up is the one thing it must never
 * hold. */
export function lienDateFromString(raw: unknown, what = "A date"): Date {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) throw new LienDeadlineInputError(`${what} is required`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new LienDeadlineInputError(`${what} is not a valid date`);
  const date = new Date(`${value}T00:00:00.000Z`);
  // `new Date("2026-02-31T00:00:00Z")` is Invalid in V8, but round-trip
  // anyway: a date that normalises to a different day is not the one typed.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new LienDeadlineInputError(`${what} is not a valid date`);
  }
  return date;
}

/** Whole days from `todayIso` to `dateIso`; negative once it has passed.
 * Both are calendar days, so this is a count between two dates somebody
 * already has — never a way of producing one. */
export function daysFromToday(dateIso: string, todayIso: string): number {
  const ms = Date.parse(`${dateIso}T00:00:00.000Z`) - Date.parse(`${todayIso}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Which state a deadline is in today.
 *
 * SERVED WINS, EVEN WHEN IT WAS SERVED AFTER THE ENTERED DATE. A notice
 * served late is still a notice that was served; whether late service
 * still preserves the right is a legal question this app does not answer,
 * and calling the row "overdue" would tell somebody to serve it again.
 * `servedAfterDueDate` below reports the fact without the judgement.
 *
 * A deadline due TODAY is due soon, not overdue — the day is not over.
 */
export function lienDeadlineState(
  row: { dueOn: string; servedOn: string | null },
  todayIso: string,
): LienDeadlineState {
  if (row.servedOn) return "served";
  const days = daysFromToday(row.dueOn, todayIso);
  if (days < 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "due_soon";
  return "upcoming";
}

/** True when the entered served date is after the entered due date. A
 * fact about two dates somebody typed — NOT a statement that the right was
 * lost, which is for counsel. */
export function servedAfterDueDate(row: { dueOn: string; servedOn: string | null }): boolean {
  return row.servedOn !== null && row.servedOn > row.dueOn;
}

const STATE_RANK: Record<LienDeadlineState, number> = {
  overdue: 0,
  due_soon: 1,
  upcoming: 2,
  served: 3,
};

/**
 * The chase order: overdue unserved first, then everything else unserved
 * by the date it is due, then the served ones, most recently served first.
 *
 * Overdue sorts ahead of due-soon explicitly rather than falling out of
 * the date sort, because the two already agree today and the explicit rank
 * is what keeps them agreeing if "due soon" ever gains a second meaning.
 */
export function sortLienDeadlines<T extends { dueOn: string; servedOn: string | null }>(
  rows: T[],
  todayIso: string,
): T[] {
  return [...rows].sort((a, b) => {
    const rank = STATE_RANK[lienDeadlineState(a, todayIso)] - STATE_RANK[lienDeadlineState(b, todayIso)];
    if (rank !== 0) return rank;
    if (a.servedOn && b.servedOn) return b.servedOn.localeCompare(a.servedOn);
    return a.dueOn.localeCompare(b.dueOn);
  });
}

export type LienDeadlineSummary = {
  overdueUnserved: number;
  dueWithin14Days: number;
  served: number;
  total: number;
};

/** The three counts the page header and the Ask tool both report, from
 * one function so the two surfaces cannot disagree. `dueWithin14Days`
 * counts UNSERVED rows only: a notice already served is not due. */
export function summarizeLienDeadlines(
  rows: { dueOn: string; servedOn: string | null }[],
  todayIso: string,
): LienDeadlineSummary {
  let overdueUnserved = 0;
  let dueWithin14Days = 0;
  let served = 0;
  for (const row of rows) {
    const state = lienDeadlineState(row, todayIso);
    if (state === "overdue") overdueUnserved += 1;
    else if (state === "due_soon") dueWithin14Days += 1;
    else if (state === "served") served += 1;
  }
  return { overdueUnserved, dueWithin14Days, served, total: rows.length };
}
