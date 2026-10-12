"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { actionFail, actionOk as ok, type ActionResult, type ActionResultWith } from "./shared";
import {
  CrewScheduleInputError,
  dayKey,
  scheduleDays,
  scheduleSavedMessage,
  workDateFromString,
  workerKey,
} from "@/lib/crew-schedule";
import { scheduledWorkerName } from "@/lib/crew-schedule-query";

/** `actionFail`, narrowed so it also fits `ActionResultWith` — its failure
 * branch is the same shape, typed as the wider union. */
const fail = (error: string) => actionFail(error) as Extract<ActionResult, { ok: false }>;

/**
 * Writing the crew schedule.
 *
 * READING the schedule is open — `/schedule` is on the open list because
 * "no money on it, and everyone needs to know where they are working."
 * WRITING it is MANAGE_FIELD, because deciding who goes where is the
 * foreman's job and not everyone's. A tool or page may be more open than
 * the action behind it; the reverse is what locks somebody out of a screen
 * they can already read.
 *
 * Every action RETURNS its failure rather than throwing. Production redacts
 * a thrown Server Action message to an opaque digest, and the two sentences
 * this module most needs to say — "that person is already on that job that
 * day" and "you do not have permission" — are exactly the ones a person
 * needs to read to know what to do next.
 */

const NO_PERMISSION = "Only someone with field access can change the crew schedule.";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/**
 * Turn the form's one "worker" value into the XOR the table requires.
 *
 * The select carries `user:<id>` or `crew:<id>` in a single option value,
 * which is what keeps the form one control instead of two mutually
 * exclusive ones. Splitting it here rather than in the component means the
 * server never trusts which kind the browser said it was — it reads the
 * prefix itself and looks the row up in this company.
 */
function workerFromValue(raw: string): { scheduledUserId: string } | { crewMemberId: string } | null {
  if (raw.startsWith("user:") && raw.length > 5) return { scheduledUserId: raw.slice(5) };
  if (raw.startsWith("crew:") && raw.length > 5) return { crewMemberId: raw.slice(5) };
  return null;
}

/**
 * One person on one day, or several people across a date range — the same
 * form and the same action, so the 1 × 1 case cannot drift from the N × range
 * one. Every row goes in with ONE `createMany … skipDuplicates` (a single
 * INSERT … ON CONFLICT DO NOTHING, so all or nothing), which makes a repeat
 * save idempotent: rows already there are counted, not refused.
 */
export async function scheduleCrewDay(formData: FormData): Promise<ActionResultWith<{ message: string }>> {
  const { company, ...user } = await requireCompanyContext();
  if (!can(user, "MANAGE_FIELD")) return fail(NO_PERMISSION);

  const jobId = text(formData, "jobId");
  const rawWorkers = [...new Set(formData.getAll("worker").map((v) => String(v).trim()).filter(Boolean))];
  const workers = rawWorkers.map(workerFromValue);
  if (!jobId) return fail("Pick a job.");
  if (workers.length === 0 || workers.some((w) => w === null)) return fail("Pick who is going.");

  let days: string[];
  try {
    const start = dayKey(workDateFromString(text(formData, "workDate")));
    const endRaw = text(formData, "endDate");
    const end = endRaw ? dayKey(workDateFromString(endRaw)) : start;
    days = scheduleDays(start, end, formData.get("skipWeekends") === "on");
  } catch (err) {
    if (err instanceof CrewScheduleInputError) return fail(err.message);
    throw err;
  }
  if (days.length === 0) return fail("Every day in that range is a weekend — untick Skip weekends to plan them.");

  // Both the job and the workers are re-read through THIS company rather
  // than trusted from the form. A forged id finds no row and is refused in
  // the same words as a typo, which is the same rule page-context-query.ts
  // follows: no "that belongs to someone else" branch, because that is an
  // existence oracle.
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId: company.id },
    select: { id: true, name: true },
  });
  if (!job) return fail("That job is not on your account.");

  const userIds = workers.flatMap((w) => (w && "scheduledUserId" in w ? [w.scheduledUserId] : []));
  const crewIds = workers.flatMap((w) => (w && "crewMemberId" in w ? [w.crewMemberId] : []));
  const [users, crew] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds }, companyId: company.id },
      select: { id: true, name: true, email: true },
    }),
    prisma.crewMember.findMany({
      where: { id: { in: crewIds }, companyId: company.id, archivedAt: null },
      select: { id: true, legalFirstName: true, legalMiddleName: true, legalLastName: true },
    }),
  ]);
  if (users.length !== userIds.length) return fail("That person is not on your account.");
  if (crew.length !== crewIds.length) {
    return fail("That crew member is not on your account, or has been archived.");
  }
  const names = new Map<string, string>([
    ...users.map((u) => [`user:${u.id}`, scheduledWorkerName({ scheduledUser: u, crewMember: null })] as const),
    ...crew.map((c) => [`crew:${c.id}`, scheduledWorkerName({ scheduledUser: null, crewMember: c })] as const),
  ]);

  const craftRaw = text(formData, "craftClassificationId");
  const craftClassificationId =
    craftRaw &&
    (await prisma.craftClassification.findFirst({
      where: { id: craftRaw, companyId: company.id },
      select: { id: true },
    }))
      ? craftRaw
      : null;

  const note = text(formData, "note") || null;
  const workDates = days.map((day) => workDateFromString(day));
  const rows = workers.flatMap((worker) =>
    workDates.map((workDate) => ({
      companyId: company.id,
      jobId,
      workDate,
      craftClassificationId,
      note,
      createdByUserId: user.id,
      ...worker!,
    })),
  );

  // One transaction: the double-booking read and the write see the same
  // schedule. ANOTHER job, same worker, same day — warned about, not refused.
  //
  // The unique key (job, worker, day) used to be caught here as P2002 and
  // refused as "already on that job that day". `skipDuplicates` turns that
  // into ON CONFLICT DO NOTHING, so a repeat is counted in the message
  // instead — and a range that overlaps last week's plan saves the new days
  // rather than refusing all of them over one.
  const [clashRows, { count: created }] = await prisma.$transaction([
    prisma.crewScheduleDay.findMany({
      where: {
        companyId: company.id,
        jobId: { not: jobId },
        workDate: { in: workDates },
        OR: [{ scheduledUserId: { in: userIds } }, { crewMemberId: { in: crewIds } }],
      },
      select: { workDate: true, scheduledUserId: true, crewMemberId: true, job: { select: { name: true } } },
      orderBy: { workDate: "asc" },
    }),
    prisma.crewScheduleDay.createMany({ data: rows, skipDuplicates: true }),
  ]);

  revalidatePath("/schedule");
  revalidatePath(`/jobs/${jobId}`, "layout");
  return {
    ok: true,
    value: {
      message: scheduleSavedMessage({
        workers: rawWorkers.map((key) => names.get(key) ?? key),
        jobName: job.name,
        days,
        created,
        clashes: clashRows.map((row) => ({
          worker: names.get(workerKey(row)) ?? "Someone",
          jobName: row.job.name,
          day: dayKey(row.workDate),
        })),
      }),
    },
  };
}

export async function unscheduleCrewDay(id: string): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  if (!can(user, "MANAGE_FIELD")) return fail(NO_PERMISSION);

  // Scoped in the WHERE rather than fetched and checked, so a row belonging
  // to another company simply does not match.
  const removed = await prisma.crewScheduleDay.deleteMany({ where: { id, companyId: company.id } });
  if (removed.count === 0) return fail("That day is no longer on the schedule.");

  revalidatePath("/schedule");
  return ok;
}
