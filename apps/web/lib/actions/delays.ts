"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { DelayInputError, isDelayDayLockError, parseDelay } from "@/lib/delays-core";
import { FIELD_ONLY } from "@/lib/field-reports-core";
import { liveSignoff, lockedDayMessage } from "@/lib/timesheet-signoff";
import { actionFail as fail, actionOk as ok, type ActionResult } from "./shared";

/**
 * Structured delays from the web job page. The phone logs them through
 * POST /api/v1/jobs/[id]/delays; both validate with lib/delays-core.ts.
 *
 * MANAGE_FIELD, the capability that owns daily reports. Every refusal is
 * returned, never thrown — production redacts a thrown message.
 */

function revalidateJob(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/field-reports");
}

function formInput(formData: FormData) {
  const get = (k: string) => String(formData.get(k) ?? "");
  return {
    date: get("date"),
    cause: get("cause"),
    responsibleParty: get("responsibleParty"),
    responsibleName: get("responsibleName"),
    startTime: get("startTime"),
    endTime: get("endTime"),
    workersAffected: get("workersAffected"),
    hoursLost: get("hoursLost"),
    description: get("description"),
    gcNotifiedHow: get("gcNotifiedHow"),
    gcNotifiedWho: get("gcNotifiedWho"),
    // A datetime-local value has no zone; the browser's offset rides along
    // in a hidden field so the stored instant is the moment the person meant.
    gcNotifiedAt: get("gcNotifiedAt"),
  };
}

export async function logDelay(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { companyId: true } });
  if (!job || job.companyId !== context.company.id) return fail("Job not found");

  let fields;
  try {
    fields = parseDelay(formInput(formData));
  } catch (error) {
    if (error instanceof DelayInputError) return fail(error.message);
    throw error;
  }

  const live = await liveSignoff(jobId, fields.date);
  if (live) return fail(lockedDayMessage(fields.date, live));

  try {
    await prisma.delayEvent.create({
      data: { ...fields, companyId: context.company.id, jobId, loggedByUserId: context.id },
    });
  } catch (error) {
    if (isDelayDayLockError(error)) return fail("That day was just signed, so its delays are locked.");
    throw error;
  }
  revalidateJob(jobId);
  return ok;
}

export async function removeDelay(delayId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);
  const delay = await prisma.delayEvent.findUnique({ where: { id: delayId } });
  if (!delay || delay.companyId !== context.company.id) return fail("That delay is gone. Reload the page.");
  // A delay a change order was drafted from is part of that change order's
  // story; take the change order apart first if it really was a mistake.
  if (delay.changeOrderId) return fail("A change order was drafted from this delay, so it stays on the record.");

  const live = await liveSignoff(delay.jobId, delay.date);
  if (live) return fail(lockedDayMessage(delay.date, live));
  try {
    await prisma.delayEvent.delete({ where: { id: delay.id } });
  } catch (error) {
    if (isDelayDayLockError(error)) return fail("That day was just signed, so its delays are locked.");
    throw error;
  }
  revalidateJob(delay.jobId);
  return ok;
}
