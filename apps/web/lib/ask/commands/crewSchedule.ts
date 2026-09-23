import { prisma } from "@prova/db";
import { scheduleCrewDay } from "@/lib/actions/crewSchedule";
import { dayLabel, parseDateWords, relativeToToday } from "../dates";
import { rankByName } from "../resolve";
import { formDataFrom, throughAction } from "./adapter";
import { findJob } from "./findJob";
import type {
  CommandContext,
  CommandInput,
  DirectCommandDefinition,
  Executed,
  Option,
  ResolvedPayload,
  Resolution,
} from "../commands";

/**
 * "Put Mike on Riverside Tuesday" — one planned day on the crew schedule.
 *
 * The exclusion this replaces called it "a card worth designing": three
 * things resolved at once. Designed here as three resolutions in a fixed
 * order, each returning early the way every other command does:
 *
 *   - THE WORKER is a User OR a crew member with no login, as the
 *     /schedule form offers them — one list, archived crew left out, the
 *     same `user:<id>` / `crew:<id>` value the form posts. A name matching
 *     several is a chip row; matching nobody is a refusal pointing at the
 *     team page, because the schedule cannot name someone who is not on it.
 *   - THE JOB through `findJob`, the resolver every job-taking command uses.
 *   - THE DAY through lib/ask/dates.ts against the person's OWN today. A
 *     bare weekday is the next one; a month-day already past is a
 *     which-year chip row; a shift has nothing on a new row to count from.
 *
 * DIRECT over `scheduleCrewDay`, called with the FormData its form posts,
 * so MANAGE_FIELD, the in-company re-reads and the duplicate refusal ("They
 * are already on that job that day", a unique key) are the action's own.
 * `resolve` checks the duplicate first only so the person sees a link to
 * the existing day instead of a card whose button can only fail.
 */

const str = (payload: ResolvedPayload, key: string): string | null =>
  typeof payload[key] === "string" ? (payload[key] as string) : null;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const WORKER_VALUE = /^(user|crew):(.+)$/;

type Worker = { value: string; name: string; detail: string };

/** Everybody the /schedule form would offer whose name matches, as that
 * form's own values. */
async function matchingWorkers(companyId: string, text: string): Promise<Worker[]> {
  const wanted = text.trim();
  const contains = { contains: wanted, mode: "insensitive" as const };
  const [users, crew] = await Promise.all([
    prisma.user.findMany({
      where: { companyId, OR: [{ name: contains }, { email: contains }] },
      select: { id: true, name: true, email: true },
      take: 20,
    }),
    prisma.crewMember.findMany({
      // Legal names are two columns, so "Mike Rossi" is matched word by
      // word; the full-name ranking below then narrows it.
      where: {
        companyId,
        archivedAt: null,
        OR: wanted
          .split(/\s+/)
          .filter(Boolean)
          .flatMap((word) => [
            { legalFirstName: { contains: word, mode: "insensitive" as const } },
            { legalLastName: { contains: word, mode: "insensitive" as const } },
          ]),
      },
      select: { id: true, legalFirstName: true, legalLastName: true },
      take: 20,
    }),
  ]);
  const workers: Worker[] = [
    ...users.map((u) => ({ value: `user:${u.id}`, name: u.name ?? u.email, detail: u.email })),
    ...crew.map((c) => ({ value: `crew:${c.id}`, name: `${c.legalFirstName} ${c.legalLastName}`, detail: "crew, no login" })),
  ];
  const ranked = rankByName(workers, wanted);
  // Exact full-name matches win outright, then substrings of the full name.
  // When neither hits (a crew member matched on one word of two), what the
  // database matched is offered as chips rather than dropped.
  return ranked.length > 0 ? ranked : workers;
}

/** A worker value from a chip, re-read through THIS company. */
async function workerFromValue(companyId: string, value: string): Promise<Worker | null> {
  const m = WORKER_VALUE.exec(value);
  if (!m) return null;
  if (m[1] === "user") {
    const u = await prisma.user.findFirst({ where: { id: m[2], companyId }, select: { id: true, name: true, email: true } });
    return u ? { value, name: u.name ?? u.email, detail: u.email } : null;
  }
  const c = await prisma.crewMember.findFirst({
    where: { id: m[2], companyId, archivedAt: null },
    select: { id: true, legalFirstName: true, legalLastName: true },
  });
  return c ? { value, name: `${c.legalFirstName} ${c.legalLastName}`, detail: "crew, no login" } : null;
}

function workDayFor(text: string, today: string): { day: string } | Resolution {
  const parsed = parseDateWords(text, today);
  if (!parsed) {
    return {
      kind: "need",
      missing: `the day as a calendar day — "${text}" isn't one this app can read. Say it like "tomorrow", "Tuesday" or "October 6"`,
    };
  }
  switch (parsed.kind) {
    case "on":
      return { day: parsed.day };
    case "which-year":
      return {
        kind: "clarify",
        field: "workDate",
        question: `"${text}" has already passed this year — which day?`,
        options: [
          { value: parsed.thisYear, label: dayLabel(parsed.thisYear), detail: relativeToToday(parsed.thisYear, today) },
          { value: parsed.nextYear, label: dayLabel(parsed.nextYear), detail: relativeToToday(parsed.nextYear, today) },
        ],
      };
    case "shift":
    case "shift-either-way":
      return {
        kind: "need",
        missing: `the day itself — "${text}" is counted from a date nobody gave. Say it like "tomorrow", "Tuesday" or "October 6"`,
      };
  }
}

async function resolveScheduleCrew(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const missing: string[] = [];
  if (!input.workerName && !input.worker) missing.push("who is going");
  if (!input.jobName && !input.jobId) missing.push("which job");
  if (!input.workDate) missing.push("which day");
  if (missing.length > 0) return { kind: "need", missing: missing.join(", ") };

  let worker: Worker;
  if (input.worker) {
    const found = await workerFromValue(ctx.companyId, input.worker);
    if (!found) return { kind: "refuse", reason: "That person isn't on your account, or has been archived.", href: "/team" };
    worker = found;
  } else {
    const found = await matchingWorkers(ctx.companyId, input.workerName ?? "");
    if (found.length === 0) {
      return {
        kind: "refuse",
        reason: `Nobody on the team or the crew list matches "${input.workerName}". Add them on the Team page first, then ask again.`,
        href: "/team",
      };
    }
    if (found.length > 1) {
      const options: Option[] = found.map((w) => ({ value: w.value, label: w.name, detail: w.detail }));
      return { kind: "clarify", field: "worker", question: `Which ${input.workerName}?`, options };
    }
    worker = found[0];
  }

  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;

  const dayResult = workDayFor(input.workDate ?? "", ctx.today);
  if (!("day" in dayResult)) return dayResult;
  const workDate = dayResult.day;

  const warnings: string[] = [];
  if (workDate < ctx.today) {
    warnings.push(`${dayLabel(workDate)} has already passed — this plans a day that is over. Hours worked are logged separately.`);
  }

  const note = input.note ?? null;
  const resolved: ResolvedPayload = { worker: worker.value, workerName: worker.name, jobId: job.id, jobName: job.name, workDate, note };
  const preview = [
    { label: "Who", value: `${worker.name} (${worker.detail})` },
    { label: "Job", value: job.name },
    { label: "Day", value: `${dayLabel(workDate)} — ${relativeToToday(workDate, ctx.today)}` },
    { label: "Note", value: note ?? "none" },
    { label: "Craft", value: "not set — pick one on the Schedule page if this day needs it" },
  ];

  // The action's unique key, (job, worker, day), checked first.
  const m = WORKER_VALUE.exec(worker.value)!;
  const twin = await prisma.crewScheduleDay.findFirst({
    where: {
      companyId: ctx.companyId,
      jobId: job.id,
      workDate: new Date(`${workDate}T00:00:00.000Z`),
      ...(m[1] === "user" ? { scheduledUserId: m[2] } : { crewMemberId: m[2] }),
    },
    select: { id: true },
  });
  if (twin) {
    return {
      kind: "ready",
      resolved,
      preview,
      warnings,
      existing: { label: `${worker.name} is already on ${job.name} on ${dayLabel(workDate)}`, href: "/schedule" },
    };
  }

  return { kind: "ready", resolved, preview, warnings };
}

async function executeScheduleCrew(ctx: CommandContext, payload: ResolvedPayload): Promise<Executed> {
  const worker = str(payload, "worker");
  const workerName = str(payload, "workerName");
  const jobId = str(payload, "jobId");
  const jobName = str(payload, "jobName");
  const workDate = str(payload, "workDate");
  if (!worker || !WORKER_VALUE.test(worker) || !workerName || !jobId || !jobName || !workDate || !ISO_DAY.test(workDate)) {
    return { ok: false, error: "That card can't be executed. Ask again." };
  }
  const result = await throughAction("Schedule", () =>
    scheduleCrewDay(formDataFrom({ jobId, worker, workDate, note: str(payload, "note") })),
  );
  if (!result.ok) return { ok: false, error: result.error };
  const m = WORKER_VALUE.exec(worker)!;
  const row = await prisma.crewScheduleDay.findFirst({
    where: {
      companyId: ctx.companyId,
      jobId,
      workDate: new Date(`${workDate}T00:00:00.000Z`),
      ...(m[1] === "user" ? { scheduledUserId: m[2] } : { crewMemberId: m[2] }),
    },
    select: { id: true },
  });
  return {
    ok: true,
    message: `Put ${workerName} on ${jobName} for ${dayLabel(workDate)}.`,
    created: { label: `${workerName} · ${jobName}`, href: "/schedule", targetType: "CrewScheduleDay", targetId: row?.id ?? `${jobId}:${workDate}` },
    revalidate: [`/jobs/${jobId}`],
  };
}

export const scheduleCrewCommand: DirectCommandDefinition = {
  name: "schedule_crew",
  description:
    "Puts one person on one job for one day on the crew schedule — who is PLANNED to be there, as the Schedule page records it. The person can be a teammate with a login or a crew member without one. Needs who, which job and which day; ask for any that is missing. Pass the day exactly as said — 'tomorrow', 'Tuesday', 'October 6' — never convert or compute it. One person, one day per request: for a week or a whole crew, say that it is done one day at a time or on the Schedule page. Refuses when that person is already on that job that day. Does NOT log hours worked (that is log_time_entry), does not change a job's own start or end date (that is reschedule_job), and does not remove anybody from the schedule.",
  capability: "MANAGE_FIELD",
  tier: "T1_DRAFT",
  mode: "DIRECT",
  action: "scheduleCrewDay",
  core: "scheduleCrewDay",
  title: "Put them on the schedule",
  verb: "Preparing the schedule",
  button: "Schedule",
  input_schema: {
    type: "object",
    properties: {
      workerName: { type: "string", description: "Who is going, as the person named them, e.g. 'Mike' or 'Mike Rossi'. Required: ask if they did not say." },
      jobName: { type: "string", description: "The job, as the person named it, e.g. 'Riverside'. Required: ask if they did not say." },
      workDate: { type: "string", description: "The day, in the person's exact words, e.g. 'tomorrow', 'Tuesday', 'October 6'. Required: ask if they did not say." },
      note: { type: "string", description: "Anything else they said about the day, in their words, e.g. 'bring the lift'. Omit if nothing." },
    },
  },
  continuationKeys: ["worker", "jobId"],
  resolve: resolveScheduleCrew,
  execute: executeScheduleCrew,
};

export const crewScheduleCommands: DirectCommandDefinition[] = [scheduleCrewCommand];
