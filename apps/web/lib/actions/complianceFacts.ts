"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { determinationFactsFromForm, jobComplianceFactsFromForm } from "@/lib/determination-facts";
import { actionFail, actionOk, assertJobInCompany, type ActionResult } from "./shared";

/**
 * The two facts forms on a job's Compliance tab — phase 1 of per-job
 * compliance research, which has NO AI in it: a person types the dates
 * off the call for bids and off the determination document, and
 * lib/determination-standing.ts derives whether the determination is
 * still in force from them.
 *
 * WHY NOT `updateJobDetails`. That is the job's Overview form in
 * lib/actions/jobDetails.ts, Diego's file, and the schema announcement in
 * #prova-build said this work would stay out of it. These four columns
 * are compliance facts read by the Compliance tab and /prevailing-wage,
 * so they are entered where they are read.
 *
 * UNGATED BEYOND COMPANY MEMBERSHIP, deliberately and with the same
 * reasoning as `uploadPrevailingWageDetermination` on the same tab: the
 * Compliance tab carries no capability wall (its own doc comment says so,
 * and why), and an action behind an ungated page that asserted one would
 * refuse people the page invites in. `assertJobInCompany` is the tenancy
 * check, and it is the one that matters.
 *
 * Refusals are returned, never thrown — production redacts a thrown
 * Server Action message to a digest, and every refusal here is a sentence
 * about a date a person just typed.
 */

function revalidateComplianceSurfaces(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/compliance`);
  revalidatePath("/prevailing-wage");
}

export async function updateJobComplianceFacts(jobId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const parsed = jobComplianceFactsFromForm(formData);
  if (!parsed.ok) return actionFail(parsed.error);

  await prisma.job.update({ where: { id: jobId }, data: parsed.value });

  revalidateComplianceSurfaces(jobId);
  return actionOk;
}

export async function updateDeterminationFacts(
  jobId: string,
  determinationId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const determination = await prisma.prevailingWageDetermination.findUnique({
    where: { id: determinationId },
    select: { jobId: true },
  });
  if (!determination || determination.jobId !== jobId) {
    return actionFail("That determination isn't on this job any more — reload the page.");
  }

  const parsed = determinationFactsFromForm(formData);
  if (!parsed.ok) return actionFail(parsed.error);

  await prisma.prevailingWageDetermination.update({ where: { id: determinationId }, data: parsed.value });

  revalidateComplianceSurfaces(jobId);
  return actionOk;
}
