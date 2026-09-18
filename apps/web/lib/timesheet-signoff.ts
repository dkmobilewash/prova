import { prisma } from "@prova/db";

/**
 * Timesheet sign-off: the foreman signs a job's hours for a day, the office
 * approves them, and a signed day's hours are locked until somebody reopens
 * it. The model and the two triggers that enforce it are in labor.prisma and
 * 20260918230000_add_timesheet_signoff; this file holds the checks the app
 * makes FIRST, so people see a sentence rather than a database error.
 */

export { SIGNATURE_HEIGHT, SIGNATURE_WIDTH, isValidSignaturePath } from "./signature-path";

export type SignoffDayState = "OPEN" | "SUBMITTED" | "APPROVED";

/** Derived, never stored: see TimesheetSignoff in labor.prisma. */
export function signoffState(live: { approvedAt: Date | null } | null): SignoffDayState {
  if (!live) return "OPEN";
  return live.approvedAt ? "APPROVED" : "SUBMITTED";
}

/** yyyy-mm-dd, the calendar day, at UTC midnight — how every date that
 * matters is stored. Null when it is not a real day. */
export function parseDay(raw: unknown): Date | null {
  const text = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
  return date;
}

export function dayText(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The sign-off holding (jobId, date) locked, if any. At most one exists —
 * the partial unique index allows one live sign-off per job per day. */
export async function liveSignoff(jobId: string, date: Date) {
  return prisma.timesheetSignoff.findFirst({ where: { jobId, date, reopenedAt: null } });
}

export function lockedDayMessage(date: Date, live: { approvedAt: Date | null }): string {
  const how = live.approvedAt ? "signed and approved" : "signed";
  return `${dayText(date)} is ${how}, so its hours are locked. The office can reopen it on the job page if something needs fixing.`;
}

/** True for the refusal the TimeEntry day-lock trigger raises — the race
 * where a day was signed between the app's own check and the write. */
export function isDayLockError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("TimeEntry day is signed and locked");
}

/** Prisma's unique-constraint error: here, a second live sign-off for a day. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
