"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { actionFail as fail, actionOk as ok, isUniqueConstraintError, type ActionResult } from "./shared";
import { CrewScheduleInputError, workDateFromString } from "@/lib/crew-schedule";

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

export async function scheduleCrewDay(formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  if (!can(user, "MANAGE_FIELD")) return fail(NO_PERMISSION);

  const jobId = text(formData, "jobId");
  const worker = workerFromValue(text(formData, "worker"));
  if (!jobId) return fail("Pick a job.");
  if (!worker) return fail("Pick who is going.");

  let workDate: Date;
  try {
    workDate = workDateFromString(text(formData, "workDate"));
  } catch (err) {
    if (err instanceof CrewScheduleInputError) return fail(err.message);
    throw err;
  }

  // Both the job and the worker are re-read through THIS company rather
  // than trusted from the form. A forged id finds no row and is refused in
  // the same words as a typo, which is the same rule page-context-query.ts
  // follows: no "that belongs to someone else" branch, because that is an
  // existence oracle.
  const job = await prisma.job.findFirst({ where: { id: jobId, companyId: company.id }, select: { id: true } });
  if (!job) return fail("That job is not on your account.");

  if ("scheduledUserId" in worker) {
    const found = await prisma.user.findFirst({
      where: { id: worker.scheduledUserId, companyId: company.id },
      select: { id: true },
    });
    if (!found) return fail("That person is not on your account.");
  } else {
    const found = await prisma.crewMember.findFirst({
      where: { id: worker.crewMemberId, companyId: company.id, archivedAt: null },
      select: { id: true },
    });
    if (!found) return fail("That crew member is not on your account, or has been archived.");
  }

  const craftRaw = text(formData, "craftClassificationId");
  const craftClassificationId =
    craftRaw &&
    (await prisma.craftClassification.findFirst({
      where: { id: craftRaw, companyId: company.id },
      select: { id: true },
    }))
      ? craftRaw
      : null;

  try {
    await prisma.crewScheduleDay.create({
      data: {
        companyId: company.id,
        jobId,
        workDate,
        craftClassificationId,
        note: text(formData, "note") || null,
        createdByUserId: user.id,
        ...worker,
      },
    });
  } catch (err) {
    // The unique key is (job, worker, day). Caught and said in words rather
    // than left to throw: "already on that job that day" is information,
    // and a redacted digest is not.
    //
    // BY `code`, NOT BY `instanceof`, and this line cost a click test. It
    // was `err instanceof Prisma.PrismaClientKnownRequestError && err.code
    // === "P2002"`, which is false at runtime even though the thrown error
    // IS that class with that code — the server log printed
    // `Error [PrismaClientKnownRequestError] … code: 'P2002'` while the
    // branch did not take. So the second submit escaped as an unhandled
    // throw and the person got the error boundary: "This page didn't load
    // … reference 2348556877", on a form whose whole job was to say one
    // readable sentence.
    //
    // `isUniqueConstraintError` already existed for exactly this and its
    // own comment says instanceof is false here, measured 2026-08-28. The
    // helper was written, documented — and not called by me.
    if (isUniqueConstraintError(err)) {
      return fail("They are already on that job that day.");
    }
    throw err;
  }

  revalidatePath("/schedule");
  revalidatePath(`/jobs/${jobId}`);
  return ok;
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
