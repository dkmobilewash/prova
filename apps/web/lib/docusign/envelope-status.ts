import type { DocuSignEnvelopeState } from "@prova/integrations";

/**
 * How an envelope row follows what DocuSign says about it. Pure.
 *
 * STATUS ONLY MOVES FORWARD. Connect retries, delivers out of order, and a
 * person can press Refresh while a webhook is in flight, so the same answer
 * — or an OLDER one — arrives more than once. A "delivered" that lands after
 * "completed" must not reopen a completed contract. Rank decides:
 *
 *     SENT (1) -> DELIVERED (2) -> COMPLETED | DECLINED | VOIDED (3)
 *
 * and a terminal status never changes to another terminal status.
 *
 * DATES ARE DOCUSIGN'S. Each is copied from the envelope DocuSign returned
 * (its own sentDateTime, completedDateTime, …), never from this server's
 * clock. A date DocuSign stops reporting is not erased.
 *
 * `planEnvelopeUpdate` returns null when nothing would change, so a
 * duplicate delivery writes nothing at all — which is what makes the
 * webhook idempotent rather than merely harmless.
 */

export const TRACKED_STATUSES = ["SENT", "DELIVERED", "COMPLETED", "DECLINED", "VOIDED"] as const;
export type TrackedStatus = (typeof TRACKED_STATUSES)[number];

const RANK: Record<TrackedStatus, number> = { SENT: 1, DELIVERED: 2, COMPLETED: 3, DECLINED: 3, VOIDED: 3 };

/** DocuSign's lowercase envelope status -> ours, or null for the ones this
 * app does not track ("created" is a draft, "signed"/"correct"/… are
 * intermediate states that change nothing a contractor acts on). */
export function mapDocuSignStatus(status: string | null | undefined): TrackedStatus | null {
  switch ((status ?? "").toLowerCase()) {
    case "sent":
      return "SENT";
    case "delivered":
      return "DELIVERED";
    case "completed":
      return "COMPLETED";
    case "declined":
      return "DECLINED";
    case "voided":
      return "VOIDED";
    default:
      return null;
  }
}

export function isTerminal(status: TrackedStatus): boolean {
  return RANK[status] === 3;
}

export type EnvelopeRowState = {
  status: TrackedStatus;
  sentAt: Date;
  deliveredAt: Date | null;
  completedAt: Date | null;
  declinedAt: Date | null;
  voidedAt: Date | null;
  voidedReason: string | null;
};

export type EnvelopeUpdate = Partial<Omit<EnvelopeRowState, "sentAt">> & { sentAt?: Date };

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function planEnvelopeUpdate(row: EnvelopeRowState, remote: DocuSignEnvelopeState): EnvelopeUpdate | null {
  const update: EnvelopeUpdate = {};

  const next = mapDocuSignStatus(remote.status);
  if (next && next !== row.status && !isTerminal(row.status) && RANK[next] > RANK[row.status]) {
    update.status = next;
  }

  const dates: [keyof EnvelopeRowState, string | null][] = [
    ["sentAt", remote.sentDateTime],
    ["deliveredAt", remote.deliveredDateTime],
    ["completedAt", remote.completedDateTime],
    ["declinedAt", remote.declinedDateTime],
    ["voidedAt", remote.voidedDateTime],
  ];
  for (const [field, raw] of dates) {
    const parsed = parseDate(raw);
    const current = row[field] as Date | null;
    if (parsed && (!current || current.getTime() !== parsed.getTime())) {
      (update as Record<string, unknown>)[field] = parsed;
    }
  }

  if (remote.voidedReason && remote.voidedReason !== row.voidedReason) update.voidedReason = remote.voidedReason;

  return Object.keys(update).length > 0 ? update : null;
}

/**
 * The calendar day an instant fell on in a zone, as a Date at UTC midnight
 * — the storage convention for every entered date in this app.
 *
 * Used for the one date that matters on completion: the executed date of
 * the contract. The instant is DocuSign's completedDateTime; the zone is the
 * sender's, captured when they pressed Send. Taking the UTC day instead
 * would record an evening signature in California as the next day. An
 * unknown zone falls back to UTC rather than throwing.
 */
export function calendarDayInZone(instant: Date, timeZone: string): Date {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00.000Z`);
}

/** A zone name worth storing, or UTC. */
export function normaliseTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

export const STATUS_LABEL: Record<TrackedStatus, string> = {
  SENT: "Sent",
  DELIVERED: "Opened",
  COMPLETED: "Signed",
  DECLINED: "Declined",
  VOIDED: "Voided",
};
