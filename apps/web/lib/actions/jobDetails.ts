"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { can } from "@/lib/permissions";
import { parseNumericInput } from "@/lib/numeric-input";
import {
  actionFail as fail,
  actionOk as ok,
  joinWithConjunction,
  ownerRefusal,
  type ActionResult,
} from "./shared";
import { deleteDocument } from "@/lib/blob";
import {
  JOB_DRAFT_CHILDREN,
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
  JOB_HISTORY_RELATIONS.filter((relation) => !relation.single && !relation.throughLineItems).map((relation) => [
    relation.key,
    true,
  ]),
) as Record<string, true>;

/** The one-to-one relations `_count` cannot count, selected by id instead. */
const HISTORY_SINGLE_SELECT = Object.fromEntries(
  JOB_HISTORY_RELATIONS.filter((relation) => relation.single).map((relation) => [
    relation.key,
    { select: { id: true } },
  ]),
) as Record<string, { select: { id: true } }>;

/** A Prisma delegate, as far as removing a job needs one. Every model in
 *  `JOB_DRAFT_CHILDREN` carries a `jobId`, which the census pins. */
type JobScopedDelegate = { deleteMany(args: { where: { jobId: string } }): Promise<unknown> };

/** Postgres refused a delete because a row still points at it. */
function isForeignKeyRefusal(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2003";
}

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

  // THE BUILDING'S GROSS AREA — a conceptual-estimating parameter, not a
  // takeoff quantity. Written only when the form CARRIES the field, the same
  // `formData.has` guard the site address uses above: a form that does not own
  // a field must not clear it by omission.
  let area = {};
  if (formData.has("grossAreaSqFt")) {
    const raw = String(formData.get("grossAreaSqFt") ?? "").trim();
    if (raw === "") {
      area = { grossAreaSqFt: null };
    } else {
      const parsed = parseNumericInput(raw, { label: "Gross area", min: 0 });
      if (!parsed.ok) return fail(parsed.error);
      // Zero is not an area. Stored as null rather than 0 so it simply does
      // not contribute to the benchmark — a job recorded as zero square feet
      // would divide into an infinite rate.
      area = { grossAreaSqFt: Number(parsed.value) === 0 ? null : parsed.value };
    }
  }

  await prisma.job.update({ where: { id: jobId }, data: { name, scope, contactId, ...site, ...area } });

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
 * So: owner only, estimate stage only, and no history hanging off it. The
 * refusal names what is holding it, the way `deleteSalesLead` does, because
 * "this cannot be deleted" without a reason is the message people ask you
 * about.
 *
 * "No history" is not "no rows". An estimate somebody took off and priced
 * has a takeoff plan, takeoff items and a saved bid recap, and until
 * 2026-10-25 every one of those was a RESTRICT foreign key this action did
 * not know about: "Remove it" threw `TakeoffPlan_jobId_fkey`, then
 * `JobBidRecap_jobId_fkey`, and production redacted both to "This page
 * didn't load". Those are the estimate's working papers and now go with it
 * (`JOB_DRAFT_CHILDREN`); evidence still refuses (`JOB_HISTORY_RELATIONS`).
 */
export async function deleteEstimateJob(jobId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();

  // CAPABILITY FIRST, OWNER SECOND, and the reorder is the ONLY change
  // here — the set of people admitted is identical either way, because an
  // OWNER holds every capability by construction, so no principal exists
  // whose outcome moves. What changes is which of two true sentences a
  // refused person is handed, and #392 settled that for the QuickBooks
  // pushes: the useful one names the thing they cannot do. A
  // PAYROLL_COMPLIANCE member told "only the account owner can remove a
  // job" would go and ask to be made an owner, which is not the change
  // they need and is a worse one to grant.
  if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);

  // ownerRefusal, not assertOwner: this action's type PROMISES the caller a
  // sentence it can render, and assertOwner throws — which production
  // redacts to a digest. `ownerRefusalCensus.test.ts` fails the build for
  // exactly that combination.
  const refusal = ownerRefusal(
    context,
    "Only the account owner can remove a job, even an empty estimate.",
  );
  if (refusal) return refusal;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      name: true,
      companyId: true,
      status: true,
      _count: { select: HISTORY_COUNT_SELECT },
      ...HISTORY_SINGLE_SELECT,
    },
  });
  if (!job || job.companyId !== context.company.id) return fail("Job not found");

  if (job.status !== "ESTIMATE") {
    return fail(
      `${job.name} is past the estimate stage, so its record stays. A job that has been contracted ` +
        "is the record of what you agreed and what you were paid.",
    );
  }

  const counts: Record<string, number> = { ...(job._count as unknown as Record<string, number>) };
  const row = job as unknown as Record<string, unknown>;
  for (const relation of JOB_HISTORY_RELATIONS) {
    if (relation.single) counts[relation.key] = row[relation.key] ? 1 : 0;
  }
  counts.costEntries = await prisma.costEntry.count({ where: { lineItem: { jobId } } });

  const held = describeJobHistory(counts);
  if (held.length > 0) {
    return fail(
      `${job.name} has ${joinWithConjunction(held)} on file, so its record stays. ` +
        "Only an estimate nobody has worked can be removed.",
    );
  }

  // Read BEFORE the delete, the way `deleteTakeoffPlan` does: once the rows
  // are gone there is nothing left to learn the file URLs from.
  const plans = await prisma.takeoffPlan.findMany({ where: { jobId }, select: { fileUrl: true } });

  // The estimate's working papers go with it — line items, takeoff, bid
  // recap, proposal text, counters (`JOB_DRAFT_CHILDREN` says why each one)
  // — in ONE transaction, because a job whose takeoff was deleted and whose
  // own delete then failed is worse than either outcome alone.
  //
  // Driven from the list rather than typed out a second time: a hand-written
  // copy is how the takeoff plan and the bid recap were missed in the first
  // place, and `jobRemoval.test.ts` derives the list's completeness from the
  // migrations.
  try {
    await prisma.$transaction(async (tx) => {
      const delegates = tx as unknown as Record<string, JobScopedDelegate>;
      for (const child of JOB_DRAFT_CHILDREN) {
        await delegates[child.model].deleteMany({ where: { jobId } });
      }
      await tx.job.delete({ where: { id: jobId } });
    });
  } catch (error) {
    // The census should make this unreachable. If a table is added that
    // neither list names, the person gets a sentence instead of a redacted
    // digest, and nothing has been deleted — the transaction rolled back.
    if (isForeignKeyRefusal(error)) {
      return fail(
        `${job.name} still has records attached that Prova does not remove with an estimate, so nothing ` +
          "was removed. Tell us which job this was and we will look at what is holding it.",
      );
    }
    throw error;
  }

  // Only once the rows are confirmed gone. `deleteDocument` swallows its own
  // failures, so a store that will not delete cannot turn a completed
  // removal into an error.
  for (const plan of plans) {
    if (plan.fileUrl) await deleteDocument(plan.fileUrl);
  }

  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  return ok;
}
