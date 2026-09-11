import { prisma } from "@prova/db";
import { logTimeEntry } from "@/lib/actions/labor";
import { parseHours } from "../numbers";
import { resolveEmployee } from "../resolve";
import { formDataFrom, throughAction } from "./adapter";
import { findJob } from "./findJob";
import type {
  CommandContext,
  CommandInput,
  DirectCommandDefinition,
  Exclusion,
  PreviewLine,
  ResolvedPayload,
  Resolution,
} from "../commands";

/**
 * Hours, phase 3. "Log 8 hours for Mike on Riverside" is the sentence a
 * foreman says at the truck, and it is T3 because those hours are
 * evidence: they feed the WH-347, the apprentice ratio and burdened cost.
 * `logTimeEntry` returns ActionResult for its duplicate guard and throws
 * only for malformed input a resolver never sends, so it is DIRECT.
 *
 * Today is `ctx.today`, the person's calendar day; yesterday's hours are
 * a page job. The pay type is straight time unless the person said
 * otherwise, because the action falls back to STRAIGHT anyway and a card
 * should say what will be written rather than leave it to a default.
 * Cost code and craft classification are not offered: both are picks from
 * lists the card cannot show, and the job page has them.
 */

const str = (payload: ResolvedPayload, key: string): string | null =>
  typeof payload[key] === "string" ? (payload[key] as string) : null;

const utcMidnight = (day: string) => new Date(`${day}T00:00:00.000Z`);

const PAY_TYPES = {
  STRAIGHT: "straight time",
  OVERTIME: "overtime",
  DOUBLE_TIME: "double time",
  SHIFT_DIFFERENTIAL: "shift differential",
} as const;
type PayType = keyof typeof PAY_TYPES;

/** The person's words for a pay type, or straight time. Never a guess:
 * an unrecognised phrase is straight time with a warning on the card. */
export function payTypeFrom(text: string | undefined): { payType: PayType; recognised: boolean } {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return { payType: "STRAIGHT", recognised: true };
  if (/double/.test(t)) return { payType: "DOUBLE_TIME", recognised: true };
  if (/over ?time|\bot\b|time and a half|1\.5/.test(t)) return { payType: "OVERTIME", recognised: true };
  if (/shift|differential/.test(t)) return { payType: "SHIFT_DIFFERENTIAL", recognised: true };
  if (/straight|regular|st\b/.test(t)) return { payType: "STRAIGHT", recognised: true };
  return { payType: "STRAIGHT", recognised: false };
}

async function resolveLogTimeEntry(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  if (!(input.jobName || input.jobId)) return { kind: "need", missing: "which job the hours are on" };
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;

  let person: { id: string; name: string };
  if (input.employeeUserId) {
    const row = await prisma.user.findFirst({
      where: { id: input.employeeUserId, companyId: ctx.companyId },
      select: { id: true, name: true, email: true },
    });
    if (!row) return { kind: "refuse", reason: "That person isn't on your team." };
    person = { id: row.id, name: row.name ?? row.email };
  } else {
    if (!input.employeeName) return { kind: "need", missing: "who the hours are for" };
    const found = await resolveEmployee(ctx.companyId, input.employeeName);
    if (found.kind === "none") {
      return {
        kind: "refuse",
        reason: `Nobody on your team matches "${input.employeeName}". Hours are logged against people with a login; add them on the Team page first.`,
        href: "/team",
      };
    }
    if (found.kind === "many") {
      return { kind: "clarify", field: "employeeUserId", question: "Which person?", options: found.options };
    }
    person = { id: found.match.id, name: found.match.name };
  }

  const hours = parseHours(input.hours);
  if (!hours) {
    return {
      kind: "need",
      missing: input.hours ? `the hours as a plain number up to 24 — "${input.hours}" isn't one` : "how many hours",
    };
  }
  const { payType, recognised } = payTypeFrom(input.payType);
  const note = input.note ?? null;

  const preview: PreviewLine[] = [
    { label: "Job", value: job.name },
    { label: "Person", value: person.name },
    { label: "Date", value: `${ctx.today} (today, on your calendar)` },
    { label: "Hours", value: hours.display },
    { label: "Pay type", value: PAY_TYPES[payType] },
  ];
  if (note) preview.push({ label: "Note", value: note });

  const warnings: string[] = [];
  if (!recognised) warnings.push(`"${input.payType}" isn't a pay type this app knows; logged as straight time. Change it on the job page if that's wrong.`);
  if (Number(hours.value) > 12) warnings.push("More than 12 hours in one day. Check it before you tap.");

  return {
    kind: "ready",
    resolved: {
      jobId: job.id,
      jobName: job.name,
      employeeUserId: person.id,
      employeeName: person.name,
      date: ctx.today,
      hours: hours.value,
      payType,
      note,
    },
    preview,
    warnings,
  };
}

async function executeLogTimeEntry(_ctx: CommandContext, payload: ResolvedPayload) {
  const jobId = str(payload, "jobId");
  const jobName = str(payload, "jobName");
  const employeeUserId = str(payload, "employeeUserId");
  const employeeName = str(payload, "employeeName");
  const date = str(payload, "date");
  const hours = str(payload, "hours");
  const payType = str(payload, "payType");
  if (!jobId || !jobName || !employeeUserId || !employeeName || !date || !hours || !payType) {
    return { ok: false as const, error: "That card can't be executed. Ask again." };
  }
  const result = await throughAction("Log time", () =>
    logTimeEntry(jobId, formDataFrom({ employeeUserId, date, hours, payType, note: str(payload, "note") })),
  );
  if (!result.ok) return { ok: false as const, error: result.error };
  const row = await prisma.timeEntry.findFirst({
    where: { jobId, employeeUserId, date: utcMidnight(date) },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return {
    ok: true as const,
    message: `Logged ${hours} ${Number(hours) === 1 ? "hour" : "hours"} for ${employeeName} on ${jobName}, ${date}.`,
    created: {
      label: `${employeeName}, ${date}`,
      href: `/jobs/${jobId}`,
      targetType: "TimeEntry",
      targetId: row?.id ?? jobId,
    },
  };
}

export const logTimeEntryCommand: DirectCommandDefinition = {
  name: "log_time_entry",
  description:
    "Logs TODAY's hours for one person on one job: who, how many hours, straight time unless the person said overtime, double time or shift differential. Needs the job, the person's name and the hours as the person said them; ask for any that is missing and never estimate hours. Always for today on the person's own calendar — it does NOT log another day (that is done on the job page), does not pick a cost code or craft classification, and does not log several people at once: for a crew, propose the first and say the rest are next.",
  capability: "MANAGE_FIELD",
  tier: "T3_MONEY_EVIDENCE",
  mode: "DIRECT",
  action: "logTimeEntry",
  core: "logTimeEntry",
  title: "Log today's hours",
  verb: "Preparing the time entry",
  button: "Log hours",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job the hours are on, as the person named it. Required." },
      employeeName: { type: "string", description: "Who worked the hours, as the person named them. Required." },
      hours: { type: "string", description: "The hours exactly as the person said them, e.g. 8 or 7.5. Required; never estimate." },
      payType: {
        type: "string",
        description: "Only if the person said it: overtime, double time, shift differential. Omit for ordinary hours.",
      },
      note: { type: "string", description: "Anything else the person said about the entry. Omit if nothing." },
    },
  },
  continuationKeys: ["jobId", "employeeUserId"],
  resolve: resolveLogTimeEntry,
  execute: executeLogTimeEntry,
};

export const laborCommands: DirectCommandDefinition[] = [logTimeEntryCommand];

/** The rest of lib/actions/labor.ts, each with its reason. */
export const laborExclusions: Exclusion[] = [
  { action: "uploadDispatchSlip", reason: "Needs a real File from the hiring hall; page only until a hand-off mode carries attachments." },
  { action: "deleteDispatchSlip", reason: "T5: deletes are never commands." },
  { action: "deleteTimeEntry", reason: "T5: deletes are never commands, and a time entry is payroll evidence." },
  { action: "uploadPrevailingWageDetermination", reason: "Needs a real File and is compliance configuration for a job; page only." },
  { action: "deletePrevailingWageDetermination", reason: "T5: deletes are never commands." },
];
