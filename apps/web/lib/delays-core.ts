import { prisma, type DelayCause, type DelayResponsibleParty, type NotificationMethod } from "@prova/db";

/**
 * Structured delays — one row per thing that cost the crew time — shared by
 * the web actions and the phone's API so the two cannot validate
 * differently. Replaces DailyFieldReport.delays, a single free-text box that
 * a delay claim could never be built from: no cause, no responsible party,
 * no times, no crew-hours, no record of telling the GC.
 */

export const DELAY_CAUSES: { value: DelayCause; label: string }[] = [
  { value: "WEATHER", label: "Weather" },
  { value: "GC_SCHEDULE", label: "GC schedule / sequencing" },
  { value: "OTHER_TRADE", label: "Another trade in the way" },
  { value: "MATERIAL", label: "Material late or wrong" },
  { value: "INSPECTION", label: "Inspection" },
  { value: "DESIGN_RFI", label: "Design question / RFI" },
  { value: "SITE_ACCESS", label: "Site access" },
  { value: "EQUIPMENT", label: "Equipment" },
  { value: "OTHER", label: "Other" },
];

export const RESPONSIBLE_PARTIES: { value: DelayResponsibleParty; label: string }[] = [
  { value: "GC", label: "GC" },
  { value: "OWNER", label: "Owner" },
  { value: "OTHER_TRADE", label: "Another trade" },
  { value: "SUPPLIER", label: "Supplier" },
  { value: "OURSELVES", label: "Us" },
  { value: "NOBODY", label: "Nobody (weather, act of God)" },
];

export const NOTIFICATION_METHODS: { value: NotificationMethod; label: string }[] = [
  { value: "PHONE", label: "Phone" },
  { value: "EMAIL", label: "Email" },
  { value: "TEXT", label: "Text" },
  { value: "IN_PERSON", label: "In person" },
  { value: "MEETING", label: "Meeting" },
  { value: "OTHER", label: "Other" },
];

export const causeLabel = (c: string) => DELAY_CAUSES.find((x) => x.value === c)?.label ?? c;
export const partyLabel = (p: string) => RESPONSIBLE_PARTIES.find((x) => x.value === p)?.label ?? p;
export const methodLabel = (m: string) => NOTIFICATION_METHODS.find((x) => x.value === m)?.label ?? m;

export class DelayInputError extends Error {}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** "7:30", "07:30", "730", "7" -> minutes after midnight; "" -> null. */
export function parseTimeOfDay(raw: unknown, label: string): number | null {
  const text = str(raw).toLowerCase().replace(/\s+/g, "");
  if (!text) return null;
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/.exec(text);
  if (!m) throw new DelayInputError(`${label} must be a time like 7:30`);
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const suffix = m[3];
  if (suffix?.startsWith("p") && h < 12) h += 12;
  if (suffix?.startsWith("a") && h === 12) h = 0;
  if (h > 23 || min > 59) throw new DelayInputError(`${label} must be a time like 7:30`);
  return h * 60 + min;
}

export function formatMinutes(minutes: number | null): string | null {
  if (minutes === null) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function oneOf<T extends string>(raw: unknown, options: { value: T }[], label: string, optional: boolean): T | null {
  const text = str(raw);
  if (!text) {
    if (optional) return null;
    throw new DelayInputError(`Pick ${label}`);
  }
  const match = options.find((o) => o.value === text);
  if (!match) throw new DelayInputError(`That ${label} isn't one of the choices`);
  return match.value;
}

export type DelayInput = {
  date?: unknown;
  cause?: unknown;
  responsibleParty?: unknown;
  responsibleName?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  workersAffected?: unknown;
  hoursLost?: unknown;
  description?: unknown;
  gcNotifiedHow?: unknown;
  gcNotifiedWho?: unknown;
  gcNotifiedAt?: unknown;
  clientOperationId?: unknown;
};

export type DelayFields = {
  date: Date;
  cause: DelayCause;
  responsibleParty: DelayResponsibleParty;
  responsibleName: string | null;
  startMinute: number | null;
  endMinute: number | null;
  workersAffected: number | null;
  hoursLost: string | null;
  description: string;
  gcNotifiedHow: NotificationMethod | null;
  gcNotifiedWho: string | null;
  gcNotifiedAt: Date | null;
};

/**
 * Validates one delay. Crew-hours lost is ENTERED when known; when it is
 * left blank and workers, start and end are all given, it is worked out as
 * workers x (end - start) — the number a claim needs and nobody wants to do
 * arithmetic for on site. "GC notified" needs a method before it records a
 * who or a when; a time without a method would be a notice with no channel.
 */
export function parseDelay(input: DelayInput, now: Date = new Date()): DelayFields {
  const dateText = str(input.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) throw new DelayInputError("Date must be yyyy-mm-dd");
  const date = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateText) {
    throw new DelayInputError("That date is not valid");
  }

  const cause = oneOf(input.cause, DELAY_CAUSES, "a cause", false)!;
  const responsibleParty = oneOf(input.responsibleParty, RESPONSIBLE_PARTIES, "who caused it", false)!;
  const description = str(input.description);
  if (!description) throw new DelayInputError("Say what happened");
  if (description.length > 2000) throw new DelayInputError("Keep the description under 2000 characters");

  const startMinute = parseTimeOfDay(input.startTime, "Start time");
  const endMinute = parseTimeOfDay(input.endTime, "End time");
  if (startMinute !== null && endMinute !== null && endMinute <= startMinute) {
    throw new DelayInputError("The delay has to end after it starts");
  }

  const workersText = str(input.workersAffected);
  let workersAffected: number | null = null;
  if (workersText) {
    if (!/^\d{1,3}$/.test(workersText) || Number(workersText) === 0) {
      throw new DelayInputError("Workers affected must be a whole number");
    }
    workersAffected = Number(workersText);
  }

  const hoursText = str(input.hoursLost);
  let hoursLost: string | null = null;
  if (hoursText) {
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(hoursText) || Number(hoursText) <= 0) {
      throw new DelayInputError("Crew-hours lost must be a positive number, up to two decimals");
    }
    hoursLost = Number(hoursText).toFixed(2);
  } else if (workersAffected !== null && startMinute !== null && endMinute !== null) {
    hoursLost = ((workersAffected * (endMinute - startMinute)) / 60).toFixed(2);
  }

  const gcNotifiedHow = oneOf(input.gcNotifiedHow, NOTIFICATION_METHODS, "how the GC was told", true);
  const gcNotifiedWho = gcNotifiedHow ? str(input.gcNotifiedWho) || null : null;
  let gcNotifiedAt: Date | null = null;
  if (gcNotifiedHow) {
    const atText = str(input.gcNotifiedAt);
    gcNotifiedAt = atText ? new Date(atText) : now;
    if (Number.isNaN(gcNotifiedAt.getTime())) throw new DelayInputError("When the GC was told is not a valid time");
  }

  return {
    date,
    cause,
    responsibleParty,
    responsibleName: str(input.responsibleName) || null,
    startMinute,
    endMinute,
    workersAffected,
    hoursLost,
    description,
    gcNotifiedHow,
    gcNotifiedWho,
    gcNotifiedAt,
  };
}

export type DelayRow = {
  id: string;
  date: string;
  cause: string;
  causeLabel: string;
  responsibleParty: string;
  responsibleLabel: string;
  responsibleName: string | null;
  start: string | null;
  end: string | null;
  workersAffected: number | null;
  hoursLost: string | null;
  description: string;
  gcNotifiedHow: string | null;
  gcNotifiedWho: string | null;
  gcNotifiedAt: string | null;
  changeOrderId: string | null;
};

type DelayDbRow = {
  id: string;
  date: Date;
  cause: string;
  responsibleParty: string;
  responsibleName: string | null;
  startMinute: number | null;
  endMinute: number | null;
  workersAffected: number | null;
  hoursLost: unknown;
  description: string;
  gcNotifiedHow: string | null;
  gcNotifiedWho: string | null;
  gcNotifiedAt: Date | null;
  changeOrderId: string | null;
};

export function toDelayRow(d: DelayDbRow): DelayRow {
  return {
    id: d.id,
    date: d.date.toISOString().slice(0, 10),
    cause: d.cause,
    causeLabel: causeLabel(d.cause),
    responsibleParty: d.responsibleParty,
    responsibleLabel: partyLabel(d.responsibleParty),
    responsibleName: d.responsibleName,
    start: formatMinutes(d.startMinute),
    end: formatMinutes(d.endMinute),
    workersAffected: d.workersAffected,
    hoursLost: d.hoursLost === null || d.hoursLost === undefined ? null : String(Number(d.hoursLost)),
    description: d.description,
    gcNotifiedHow: d.gcNotifiedHow,
    gcNotifiedWho: d.gcNotifiedWho,
    gcNotifiedAt: d.gcNotifiedAt?.toISOString() ?? null,
    changeOrderId: d.changeOrderId,
  };
}

/** True for the refusal the DelayEvent day-lock trigger raises. */
export function isDelayDayLockError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("DelayEvent day is signed and locked");
}

export async function listDelaysForJob(jobId: string): Promise<DelayRow[]> {
  const rows = await prisma.delayEvent.findMany({
    where: { jobId },
    orderBy: [{ date: "desc" }, { createdAt: "asc" }],
    take: 200,
  });
  return rows.map(toDelayRow);
}
