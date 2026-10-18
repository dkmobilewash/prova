/** Shared RFI display semantics, so the form, the row and the counters
 * can't disagree about what "open" or "overdue" means. */
export const RFI_STATUSES = [
  { value: "DRAFT", label: "Draft", tone: "slate" },
  { value: "SENT", label: "Awaiting answer", tone: "blue" },
  { value: "ANSWERED", label: "Answered", tone: "green" },
  { value: "CLOSED", label: "Closed", tone: "slate" },
] as const;

export function statusLabel(value: string) {
  return RFI_STATUSES.find((s) => s.value === value)?.label ?? value;
}

/** Open means we are still waiting on someone else. Answered-but-not-closed
 * is our court, not theirs, so it doesn't count as open. */
export function isOpen(status: string) {
  return status === "SENT";
}

/** Overdue is derived from the dates every time it's shown, never stored —
 * a stored flag goes stale the day after it's written. `today` is passed in
 * from the server so the server and the browser can't disagree about what
 * day it is. */
export function isOverdue(rfi: { status: string; dueBy: string | null }, today: string) {
  return isOpen(rfi.status) && !!rfi.dueBy && rfi.dueBy < today;
}

/** How long an RFI with no due date may sit unanswered before it is flagged. */
export const RFI_WAITING_DAYS = 7;

/** Sent a week or more ago, unanswered, and with NO due date — so it can
 * never read as overdue, which is how a ten-day-old question sat under
 * "none overdue" (ux round 4). An RFI with a due date is judged by that date
 * alone. Derived on every read, like overdue. */
export function isWaitingAWeekPlus(
  rfi: { status: string; sentOn: string | null; dueBy: string | null },
  today: string,
) {
  return isOpen(rfi.status) && !rfi.dueBy && !!rfi.sentOn && daysBetween(rfi.sentOn, today) >= RFI_WAITING_DAYS;
}

/** Whole days between two UTC-midnight ISO dates. */
export function daysBetween(fromIso: string, toIso: string) {
  const ms = Date.parse(`${toIso}T00:00:00.000Z`) - Date.parse(`${fromIso}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}
