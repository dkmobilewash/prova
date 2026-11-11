"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { JOB_HISTORY_RELATIONS, describeJobHistory } from "@/lib/job-details";
import { buildSampleJob } from "@/lib/sample-job/buildSampleJob";
import { actionFail, actionOk, joinWithConjunction, type ActionResult, type ActionResultWith } from "./shared";
import { postSheetWalls } from "./takeoff";
import { confirmSheetSuggestions } from "./wallGroupType";
import { addStarterWallTypes } from "./wallTypes";

const JOBS_ONLY = "Starting a job isn't part of your job function.";

/**
 * "Try it on a sample set": a sample job on an invented drawing, scale set, walls
 * found, one group typed into the estimate and the rest waiting in the review
 * queue (`lib/sample-job/buildSampleJob.ts`). One per company: pressed again, it
 * opens the one already there.
 */
export async function createSampleJob(): Promise<ActionResultWith<{ jobId: string }>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_JOBS") || !can(context, "VIEW_JOB_COSTS")) return actionFail(JOBS_ONLY) as ActionResultWith<never>;
  const companyId = context.company.id;
  // A type with parts is what prices walls. A company with none (the trade "Other")
  // gets the starter assemblies, as Wall types' own button would add them.
  const priced = await prisma.wallType.count({ where: { companyId, components: { some: {} } } });
  if (priced === 0 && can(context, "MANAGE_ESTIMATING")) await addStarterWallTypes();
  const built = await buildSampleJob(companyId, context.id, { postSheetWalls, confirmSheetSuggestions });
  if (!built.ok) return actionFail(built.error) as ActionResultWith<never>;
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  return { ok: true, value: { jobId: built.jobId } };
}

const HISTORY_COUNT_SELECT = Object.fromEntries(JOB_HISTORY_RELATIONS.map((relation) => [relation.key, true])) as Record<string, true>;

/**
 * Deletes a sample job in one press, takeoff and all: its plan (the shipped file is
 * not the store's, so nothing is deleted there), its items and its lines. Only a
 * sample, and only while nobody has used it for real work: invoices, time, a
 * contract and the rest are history, and history is never deleted here.
 */
export async function deleteSampleJob(jobId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_JOBS")) return actionFail(JOBS_ONLY);
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId: context.company.id },
    select: { id: true, name: true, isSample: true, contactId: true, _count: { select: HISTORY_COUNT_SELECT } },
  });
  if (!job) return actionFail("That job is no longer here. Reload the page.");
  if (!job.isSample) return actionFail(`${job.name} is a real job, not the sample, so it is not removed from here.`);
  const held = describeJobHistory(job._count as unknown as Record<string, number>);
  if (held.length > 0) {
    return actionFail(`${job.name} has ${joinWithConjunction(held)} on file now, so it is kept. Remove those first, or keep it.`);
  }
  await prisma.$transaction(async (tx) => {
    // The plan's pages, scales, finds and measurements go with it (cascade).
    await tx.takeoffPlan.deleteMany({ where: { jobId } });
    await tx.takeoffItem.deleteMany({ where: { jobId } });
    await tx.jobLineItem.deleteMany({ where: { jobId } });
    await tx.job.delete({ where: { id: jobId } });
    // The invented GC goes too, unless a real job was put under it.
    if ((await tx.job.count({ where: { contactId: job.contactId } })) === 0) {
      await tx.contact.deleteMany({ where: { id: job.contactId, companyId: context.company.id } });
    }
  });
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  return actionOk;
}
