import { prisma } from "@prova/db";
import { END_BEFORE_START, setJobScheduleDates } from "@/lib/estimating/job-schedule";
import { dayLabel, parseDateWords, relativeToToday } from "../dates";
import { addDays } from "../numbers";
import { findJob } from "./findJob";
import type {
  CommandContext,
  CommandInput,
  DirectCommandDefinition,
  PreviewLine,
  ResolvedPayload,
  Resolution,
} from "../commands";

/**
 * Diego's lane, phase 4b: the first command that rewrites a record to
 * values the person STATED.
 *
 * Every command before this one created something — a job, an RFI, an
 * invoice, a time entry — handed off into a form, or (the phase-2a T2s)
 * stamped today on a stay or closed an order. "Push Riverside's start to
 * October 6" overwrites two columns on a row that already exists with
 * dates the person chose, and that is a different shape in three ways,
 * each of which is a rule here rather than a habit:
 *
 *   - THE CARD SHOWS CURRENT AND PROPOSED. Both dates are read off the Job
 *     row at resolution time and put beside the new ones, so the person
 *     sees what changes, not just what it changes to. A proposed date that
 *     equals the stored one is said so and offered no card: a no-op tap
 *     is a tap that taught someone the box does nothing.
 *   - THE MODEL NEVER SUPPLIES A DATE. It passes the person's own words —
 *     "October 6", "10/6", "next Monday", "a week later", "back a week" —
 *     and lib/ask/dates.ts decides what they mean against `ctx.today`.
 *     Ambiguity is a chip row (which year? which way?), never a guess;
 *     anything the parser does not know is a question back to the person.
 *   - THE TAP RE-CHECKS. The payload carries the dates the card was made
 *     from, and the lifted core (lib/estimating/job-schedule.ts) writes
 *     only while the row still holds exactly those. Somebody else's edit
 *     in the meantime is refused in a sentence naming what the row holds
 *     now, rather than overwritten.
 *
 * DIRECT over that lifted core rather than over `updateJobSchedule`
 * itself, because the action throws its one refusal and production
 * redacts thrown messages; the action keeps its throw for the form and
 * throws the same constant the core returns, so the card and the page
 * refuse an end-before-start in one sentence. T2_MODIFY, beside the
 * equipment and delivery commands. Offered on MANAGE_JOBS — "jobs
 * themselves", per the capability's own doc comment — and
 * `confirmAskProposal` refuses anyone without it in a returned sentence
 * before anything is claimed.
 */

const str = (payload: ResolvedPayload, key: string): string | null =>
  typeof payload[key] === "string" ? (payload[key] as string) : null;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const utcMidnight = (day: string | null) => (day ? new Date(`${day}T00:00:00.000Z`) : null);
const isoDay = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

type Field = "startDate" | "endDate";
const FIELDS: Field[] = ["startDate", "endDate"];
const NOUN: Record<Field, string> = { startDate: "start", endDate: "end" };

type Days = { startDate: string | null; endDate: string | null };

/** "starts Oct 6, 2026 (Tuesday) and ends Nov 20, 2026 (Friday)". */
function describe(days: Days): string {
  const start = days.startDate ? dayLabel(days.startDate) : null;
  const end = days.endDate ? dayLabel(days.endDate) : null;
  if (start && end) return `starts ${start} and ends ${end}`;
  if (start) return `starts ${start}, with no end date set`;
  if (end) return `has no start date set and ends ${end}`;
  return "has no dates set";
}

/**
 * One field's words turned into a day, or the Resolution that stops here.
 * `stored` is the date the row holds for this field, which a relative
 * phrase moves from; a phrase that needs it when there is none is a
 * question, not a guess about where to count from.
 */
function dayFor(field: Field, text: string, stored: string | null, jobName: string, today: string): { day: string } | Resolution {
  const noun = NOUN[field];
  const parsed = parseDateWords(text, today);
  if (!parsed) {
    return {
      kind: "need",
      missing: `the new ${noun} date as a calendar day — "${text}" isn't one this app can read. Say it like "October 6", "10/6/2026" or "next Monday"`,
    };
  }
  switch (parsed.kind) {
    case "on":
      return { day: parsed.day };
    case "which-year":
      return {
        kind: "clarify",
        field,
        question: `"${text}" has already passed this year — which ${noun} date?`,
        options: [
          { value: parsed.thisYear, label: dayLabel(parsed.thisYear), detail: relativeToToday(parsed.thisYear, today) },
          { value: parsed.nextYear, label: dayLabel(parsed.nextYear), detail: relativeToToday(parsed.nextYear, today) },
        ],
      };
    case "shift":
    case "shift-either-way": {
      if (!stored) {
        return {
          kind: "need",
          missing: `the ${noun} date itself — ${jobName} has no ${noun} date on record to move "${text}" from`,
        };
      }
      if (parsed.kind === "shift") return { day: addDays(stored, parsed.days) };
      const earlier = addDays(stored, -parsed.days);
      const later = addDays(stored, parsed.days);
      return {
        kind: "clarify",
        field,
        question: `"${text}" from ${jobName}'s ${noun} of ${dayLabel(stored)} — which way?`,
        options: [
          { value: earlier, label: `Earlier: ${dayLabel(earlier)}` },
          { value: later, label: `Later: ${dayLabel(later)}` },
        ],
      };
    }
  }
}

async function resolveRescheduleJob(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  if (!(input.jobName || input.jobId)) return { kind: "need", missing: "which job to reschedule" };
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;

  if (!input.startDate && !input.endDate) {
    return { kind: "need", missing: `the new start or end date for ${job.name}, in their own words` };
  }

  // The row, read now: what the card shows as current, and what the tap
  // will require the row to still hold.
  const row = await prisma.job.findFirst({
    where: { id: job.id, companyId: ctx.companyId },
    select: { startDate: true, endDate: true, contact: { select: { name: true } } },
  });
  if (!row) return { kind: "refuse", reason: "That job isn't on your account." };
  const stored: Days = { startDate: isoDay(row.startDate), endDate: isoDay(row.endDate) };

  const proposed: Days = { ...stored };
  const changed: Field[] = [];
  const same: Field[] = [];
  for (const field of FIELDS) {
    const text = input[field];
    if (!text) continue;
    const result = dayFor(field, text, stored[field], job.name, ctx.today);
    if (!("day" in result)) return result;
    proposed[field] = result.day;
    (result.day === stored[field] ? same : changed).push(field);
  }

  if (changed.length === 0) {
    // Everything the person named is already what the row holds. Said,
    // not carded: a button that changes nothing is worse than none.
    const already =
      same.length === 2
        ? `${job.name} already ${describe(stored)}`
        : `${job.name}'s ${NOUN[same[0]]} date is already ${dayLabel(stored[same[0]] as string)}`;
    return { kind: "refuse", reason: `${already}. Nothing to change.`, href: `/jobs/${job.id}` };
  }

  if (proposed.startDate && proposed.endDate && proposed.endDate < proposed.startDate) {
    // The action's own words. The core checks again on the tap regardless.
    return {
      kind: "refuse",
      reason: `${END_BEFORE_START}: ${job.name} would start ${dayLabel(proposed.startDate)} and end ${dayLabel(proposed.endDate)}.`,
      href: `/jobs/${job.id}`,
    };
  }

  const current = (field: Field) => (stored[field] ? dayLabel(stored[field] as string) : "not set");
  const next = (field: Field) => {
    if (!input[field]) return "unchanged";
    if (same.includes(field)) return "unchanged — already that date";
    return dayLabel(proposed[field] as string);
  };
  const preview: PreviewLine[] = [
    { label: "Job", value: `${job.name} · ${row.contact.name}` },
    { label: "Current start", value: current("startDate") },
    { label: "New start", value: next("startDate") },
    { label: "Current end", value: current("endDate") },
    { label: "New end", value: next("endDate") },
  ];

  const warnings = same.map(
    (field) =>
      `${job.name}'s ${NOUN[field]} date is already ${dayLabel(stored[field] as string)}; only the ${NOUN[field === "startDate" ? "endDate" : "startDate"]} changes.`,
  );

  return {
    kind: "ready",
    resolved: {
      jobId: job.id,
      jobName: job.name,
      startDate: proposed.startDate,
      endDate: proposed.endDate,
      wasStartDate: stored.startDate,
      wasEndDate: stored.endDate,
    },
    preview,
    warnings,
  };
}

/** A `yyyy-mm-dd` or an explicit null from the payload; anything else is
 * a card this code did not write. */
function dayOrNull(payload: ResolvedPayload, key: string): string | null | undefined {
  const value = payload[key];
  if (value === null) return null;
  return typeof value === "string" && ISO_DAY.test(value) ? value : undefined;
}

async function executeRescheduleJob(ctx: CommandContext, payload: ResolvedPayload) {
  const jobId = str(payload, "jobId");
  const jobName = str(payload, "jobName");
  const startDate = dayOrNull(payload, "startDate");
  const endDate = dayOrNull(payload, "endDate");
  const wasStartDate = dayOrNull(payload, "wasStartDate");
  const wasEndDate = dayOrNull(payload, "wasEndDate");
  if (!jobId || !jobName || [startDate, endDate, wasStartDate, wasEndDate].some((d) => d === undefined)) {
    return { ok: false as const, error: "That card can't be executed. Ask again." };
  }
  const result = await setJobScheduleDates(ctx.companyId, jobId, {
    startDate: utcMidnight(startDate as string | null),
    endDate: utcMidnight(endDate as string | null),
    expected: {
      startDate: utcMidnight(wasStartDate as string | null),
      endDate: utcMidnight(wasEndDate as string | null),
    },
  });
  if (!result.ok) return { ok: false as const, error: result.error };
  return {
    ok: true as const,
    message: `${jobName} now ${describe({ startDate: startDate as string | null, endDate: endDate as string | null })}.`,
    // The record the card was about, for the audit row and the link —
    // `created` is the field's name from the create commands; here it is
    // the row that changed.
    created: { label: jobName, href: `/jobs/${jobId}`, targetType: "Job", targetId: jobId },
    // The action revalidates both of these; the confirm action covers
    // the job page through `created.href` and this covers the rest.
    revalidate: ["/schedule"],
  };
}

export const rescheduleJobCommand: DirectCommandDefinition = {
  name: "reschedule_job",
  description:
    "Moves or sets a job's scheduled start date, end date or both, to what the person said. Needs the job and the person's own words for each date they mentioned — 'October 6', '10/6', 'next Monday', 'a week later', 'back a week' — passed through exactly as said: never convert, compute, complete or invent a date, and omit any date they did not mention. The app reads the job's current dates off its row and shows current and new side by side on the card; if what they said is already the date on the job it says so and offers nothing. Does NOT clear a date, does not change a job's status, crew, location or line items, does not move time entries or invoices, and does not touch any job but the one named.",
  capability: "MANAGE_JOBS",
  tier: "T2_MODIFY",
  mode: "DIRECT",
  action: "updateJobSchedule",
  core: "setJobScheduleDates",
  title: "Reschedule the job",
  verb: "Reading the job's dates",
  button: "Save the dates",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job whose dates move, as the person named it. Required." },
      startDate: {
        type: "string",
        description:
          "The new start date in the person's exact words, e.g. 'October 6', '10/6', 'next Monday', 'a week later', 'back a week'. Omit if they did not mention the start.",
      },
      endDate: {
        type: "string",
        description:
          "The new end date — finish, completion — in the person's exact words, the same way. Omit if they did not mention the end.",
      },
    },
  },
  continuationKeys: ["jobId"],
  resolve: resolveRescheduleJob,
  execute: executeRescheduleJob,
};

export const scheduleCommands: DirectCommandDefinition[] = [rescheduleJobCommand];
