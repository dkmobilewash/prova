"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { can } from "@/lib/permissions";
import {
  actionFail as fail,
  actionOk as ok,
  joinWithConjunction,
  ownerRefusal,
  type ActionResult,
} from "./shared";
import {
  JOB_HISTORY_RELATIONS,
  describeJobHistory,
  jobDetailsFromForm,
  mayChangeClient,
} from "@/lib/job-details";
import { geocodeSite } from "@/lib/weather";

const JOBS_ONLY = "Editing a job isn't part of your job function.";

/** The `_count` selection, built from the one list rather than typed out a
 *  second time — two copies of this would drift the moment a relation is
 *  added, and the one that drifts is the one nobody looks at. */
const HISTORY_COUNT_SELECT = Object.fromEntries(
  JOB_HISTORY_RELATIONS.map((relation) => [relation.key, true]),
) as Record<string, true>;

/**
 * Correct a job's name, scope or client.
 *
 * Until this existed there was NO way to change any of the three. `jobs.ts`
 * could update a line item, a forecast and the schedule; the job's own
 * identity was fixed at creation, so a name typed wrong — or drafted wrong
 * by the assistant from a spoken scope — was permanent, and the only remedy
 * was somebody running SQL.
 *
 * The client is the one field with a stage rule, and `mayChangeClient` says
 * why: a name and a scope are descriptions, but once a job is contracted
 * the client is who signed, who is billed and who holds the retainage.
 */
export async function updateJobDetails(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, companyId: true, status: true, contactId: true, siteAddress: true },
  });
  // The same sentence for "does not exist" and "belongs to someone else":
  // a different message for the second is a membership oracle.
  if (!job || job.companyId !== context.company.id) return fail("Job not found");

  const parsed = jobDetailsFromForm(formData);
  if (!parsed.ok) return fail(parsed.error);
  const { name, scope, contactId } = parsed.value;

  if (contactId !== job.contactId && !mayChangeClient(job.status)) {
    return fail(
      "The client can only be changed while a job is still an estimate. This one is contracted — " +
        "who it is for is on the signed contract and on everything billed against it.",
    );
  }

  // Scoped, not trusted: a contactId arrives from a form and naming another
  // company's contact would otherwise reassign this job to it.
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { companyId: true },
  });
  if (!contact || contact.companyId !== context.company.id) return fail("Client not found");

  // The site address is what daily-report weather is looked up for. Looked
  // up again only when it CHANGES (the lookup is two network calls), and a
  // miss is saved as blank coordinates rather than refused: the address is
  // still the right thing to record, and the job page says weather could not
  // be found for it.
  const siteAddress = String(formData.get("siteAddress") ?? "").trim() || null;
  let site = {};
  if (formData.has("siteAddress") && siteAddress !== job.siteAddress) {
    if (siteAddress && siteAddress.length > 300) return fail("Keep the site address under 300 characters.");
    const found = siteAddress ? await geocodeSite(siteAddress) : null;
    site = {
      siteAddress,
      siteLatitude: found?.latitude ?? null,
      siteLongitude: found?.longitude ?? null,
      siteTimeZone: found?.timeZone ?? null,
      siteGeocodedAt: found ? new Date() : null,
    };
  }

  await prisma.job.update({ where: { id: jobId }, data: { name, scope, contactId, ...site } });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  return ok;
}

/**
 * Remove an estimate that should not exist.
 *
 * A job that has been WORKED is never deleted, and the per-job invoice
 * counter makes that sharper than a principle: delete a job and its
 * invoices and a later invoice can reuse a number a GC has already been
 * sent (CLAUDE.md, #224). But an estimate created by accident is not
 * evidence of anything, and before this the only way to remove one was a
 * database script — which is what a person's first mistyped job actually
 * cost.
 *
 * So: owner only, estimate stage only, and nothing hanging off it. The
 * refusal names what is holding it, the way `deleteSalesLead` does, because
 * "this cannot be deleted" without a reason is the message people ask you
 * about.
 */
export async function deleteEstimateJob(jobId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();

  // ownerRefusal, not assertOwner: this action's type PROMISES the caller a
  // sentence it can render, and assertOwner throws — which production
  // redacts to a digest. `ownerRefusalCensus.test.ts` fails the build for
  // exactly that combination.
  const refusal = ownerRefusal(
    context,
    "Only the account owner can remove a job, even an empty estimate.",
  );
  if (refusal) return refusal;

  if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      name: true,
      companyId: true,
      status: true,
      _count: { select: HISTORY_COUNT_SELECT },
    },
  });
  if (!job || job.companyId !== context.company.id) return fail("Job not found");

  if (job.status !== "ESTIMATE") {
    return fail(
      `${job.name} is past the estimate stage, so its record stays. A job that has been contracted ` +
        "is the record of what you agreed and what you were paid.",
    );
  }

  const held = describeJobHistory(job._count as unknown as Record<string, number>);
  if (held.length > 0) {
    return fail(
      `${job.name} has ${joinWithConjunction(held)} on file, so its record stays. ` +
        "Only an estimate nobody has worked can be removed.",
    );
  }

  // Line items are the estimate itself rather than history, so they go with
  // it — in one transaction, because a job whose line items were deleted and
  // whose own delete then failed is worse than either outcome alone.
  await prisma.$transaction([
    prisma.jobLineItem.deleteMany({ where: { jobId } }),
    prisma.job.delete({ where: { id: jobId } }),
  ]);

  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  return ok;
}
