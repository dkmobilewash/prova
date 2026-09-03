/** Shared closeout and warranty semantics, so the page, the rows and the
 * counters can't disagree.
 *
 * Nothing here is stored. Closeout completeness, warranty expiry, and
 * whether a callback fell inside the warranty are all derived on every
 * read — a stored flag can disagree with the dates underneath it, and
 * "that job is closed out" and "that call was in warranty" are both
 * claims someone makes while chasing money.
 */

export type CloseoutItemData = {
  id: string;
  name: string;
  isRequired: boolean;
  completedOn: string | null;
  note: string | null;
  documentUrl: string | null;
  documentName: string | null;
};

export type WarrantyPeriodData = {
  startsOn: string;
  months: number;
  note: string | null;
};

export type ServiceRequestData = {
  id: string;
  reportedOn: string;
  description: string;
  reportedBy: string | null;
  responsibility: string;
  resolvedOn: string | null;
  resolutionNote: string | null;
};

/* ---------------------------------------------------------------- closeout */

export function requiredItems(items: CloseoutItemData[]) {
  return items.filter((i) => i.isRequired);
}

/** Required items still without a completion date. Optional items are
 * deliberately excluded — they are tracked, but they don't hold closeout
 * open, which is the whole reason the flag exists. */
export function outstandingRequired(items: CloseoutItemData[]) {
  return requiredItems(items).filter((i) => !i.completedOn);
}

/** A job's closeout is complete when every REQUIRED item has a completion
 * date. A job with no checklist at all is NOT complete — nothing has been
 * asserted about it, and reporting "complete" for an empty list would be
 * the most dangerous possible default. */
export function isCloseoutComplete(items: CloseoutItemData[]) {
  return requiredItems(items).length > 0 && outstandingRequired(items).length === 0;
}

/* ---------------------------------------------------------------- warranty */

/** Adds whole months to a UTC-midnight ISO date, clamping to the end of
 * the target month.
 *
 * 31 Aug + 6 months is 28 Feb, not 3 March. JavaScript's Date rolls the
 * overflow forward, which would silently extend a warranty past what the
 * contract says. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDayOfTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const day = Math.min(d, lastDayOfTarget);
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), day))
    .toISOString()
    .slice(0, 10);
}

/** The day the warranty runs out. Derived from start + months on every
 * read, never stored — a stored expiry is wrong the moment either input
 * is corrected. */
export function warrantyExpiry(period: WarrantyPeriodData): string {
  return addMonths(period.startsOn, period.months);
}

export type WarrantyState = "NONE" | "ACTIVE" | "EXPIRED";

export function warrantyState(period: WarrantyPeriodData | null, today: string): WarrantyState {
  if (!period) return "NONE";
  return today <= warrantyExpiry(period) ? "ACTIVE" : "EXPIRED";
}

export function warrantyStateLabel(state: WarrantyState) {
  switch (state) {
    case "NONE":
      return "No warranty recorded";
    case "ACTIVE":
      return "In warranty";
    case "EXPIRED":
      return "Warranty expired";
  }
}

/** Whole days between two UTC-midnight ISO dates. */
export function daysBetween(fromIso: string, toIso: string) {
  const ms = Date.parse(`${toIso}T00:00:00.000Z`) - Date.parse(`${fromIso}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

/** Days remaining on an active warranty. Null when there is no warranty or
 * it has already expired, so the caller can never render "-30 days left". */
export function daysOfWarrantyLeft(period: WarrantyPeriodData | null, today: string) {
  if (warrantyState(period, today) !== "ACTIVE") return null;
  return daysBetween(today, warrantyExpiry(period as WarrantyPeriodData));
}

/* -------------------------------------------------------- service requests */

/** Whether a callback fell inside the warranty, by its REPORTED date — not
 * by when it was resolved and not by today. A call reported in warranty
 * stays in warranty however long it takes to fix, which is the point of
 * recording the reported date separately.
 *
 * NULL when no warranty period has been recorded, because "we never wrote
 * down a warranty" is not "this call was outside the warranty" — same rule
 * as daysOfWarrantyLeft above. It returned `false` for a null period until
 * 2026-09-03, and the card rendered the negation: every callback on a job
 * with no recorded period was badged "outside warranty", in amber, beside
 * a chip correctly reading "No warranty recorded". That is the difference
 * between a favour and work you should be paid for, so the absence has to
 * be a third state the caller renders rather than a false the caller can
 * negate. */
export function wasInWarranty(
  request: ServiceRequestData,
  period: WarrantyPeriodData | null,
): boolean | null {
  if (!period) return null;
  return request.reportedOn >= period.startsOn && request.reportedOn <= warrantyExpiry(period);
}

export function isOpen(request: ServiceRequestData) {
  return !request.resolvedOn;
}

export const RESPONSIBILITIES = [
  { value: "UNDETERMINED", label: "Not decided yet" },
  { value: "OURS", label: "Ours to put right" },
  { value: "NOT_OURS", label: "Not ours" },
] as const;

export function responsibilityLabel(value: string) {
  return RESPONSIBILITIES.find((r) => r.value === value)?.label ?? value;
}

/** How long a callback took to close, or how long it has been open. Null
 * when the dates are the wrong way round, so a mis-entered pair renders as
 * nothing rather than as a negative. */
export function daysToResolve(request: ServiceRequestData, today: string): number | null {
  const end = request.resolvedOn ?? today;
  const days = daysBetween(request.reportedOn, end);
  return days >= 0 ? days : null;
}
