"use server";

import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { deleteDocument } from "@/lib/blob";
import { issueContractDocumentVersion } from "@/lib/billing/contract-document-version";
import { buildRiderDraft, MAX_RIDER_LENGTH } from "@/lib/subcontract-review/rider";
import { renderRiderPdf } from "@/lib/subcontract-review/riderPdf";
import { COVERAGES, ENDORSEMENTS, type Coverage, type Endorsement } from "@/lib/subcontract-review/insurance";
import { loadReviewPage } from "@/lib/subcontract-review/query";
import { actionFail, actionOk, type ActionResult, type ActionResultWith } from "@/lib/actions/shared";

/**
 * AI SUBCONTRACT REVIEW, PHASE 3 — what a person does with the findings.
 * Design: docs/ai/SUBCONTRACT-REVIEW.md.
 *
 * EVERY ACTION HERE IS A PERSON'S PRESS, and none calls a model:
 *
 *   - a rider is DRAFTED by code from the job's clauses and the findings the
 *     person marked negotiating, EDITED by them, and ATTACHED by them as a new
 *     contract version. Attaching sends nothing: the version then sits on the
 *     job where the existing e-sign and DocuSign controls already are, and
 *     sending is a separate press there.
 *   - an obligation or an insurance requirement exists only once confirmed,
 *     every field editable first. Obligations feed the alerts system; the
 *     insurance list is stored for the COI work and read by nothing yet.
 */

const NOT_YOURS =
  "Contract documents aren't part of your job function. The account owner sets who sees what, on the Team page.";

function reviewPath(jobId: string) {
  return `/jobs/${jobId}/subcontract-review`;
}

async function jobFor(jobId: string, companyId: string) {
  return prisma.job.findFirst({
    where: { id: jobId, companyId },
    select: { id: true, name: true, contact: { select: { name: true } } },
  });
}

// ── The rider ────────────────────────────────────────────────────────────────

export async function createSubcontractRider(jobId: string): Promise<ActionResultWith<{ riderId: string }>> {
  const fail = (error: string) => ({ ok: false as const, error });
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return fail(NOT_YOURS);
  const { company, ...user } = context;

  const job = await jobFor(jobId, company.id);
  if (!job) return fail("That job is no longer on your list.");

  // The newest version that has a review — riders are drafted from what was
  // reviewed and decided, never from an unread contract.
  const reviewed = await prisma.subcontractReview.findFirst({
    where: { jobId: job.id },
    orderBy: [{ contractDocument: { versionNumber: "desc" } }, { startedAt: "desc" }],
    select: { id: true, contractDocumentId: true, contractDocument: { select: { versionNumber: true } } },
  });
  const page = reviewed ? await loadReviewPage(job.id, company.id, reviewed.contractDocumentId) : null;
  const clauses = await prisma.jobProposalClause.findMany({
    where: { jobId: job.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, kind: true, text: true },
  });

  const draft = buildRiderDraft({
    jobName: job.name,
    gcName: job.contact.name,
    companyName: company.name,
    versionNumber: reviewed?.contractDocument.versionNumber ?? null,
    clauses,
    negotiated: page?.review?.findings ?? [],
  });
  if (draft.sourceKeys.length === 0) {
    return fail(
      "There is nothing to put in a rider yet: this job has no exclusions or clarifications, and no finding is marked Negotiating.",
    );
  }

  const rider = await prisma.subcontractRider.create({
    data: {
      jobId: job.id,
      sourceReviewId: reviewed?.id ?? null,
      title: draft.title,
      body: draft.body,
      sourceKeys: draft.sourceKeys,
      createdByUserId: user.id,
    },
    select: { id: true },
  });
  revalidatePath(reviewPath(job.id));
  return { ok: true, value: { riderId: rider.id } };
}

async function draftRider(riderId: string, companyId: string) {
  return prisma.subcontractRider.findFirst({
    where: { id: riderId, job: { companyId } },
    select: { id: true, jobId: true, status: true, title: true, body: true },
  });
}

export async function saveSubcontractRider(riderId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NOT_YOURS);
  const rider = await draftRider(riderId, context.company.id);
  if (!rider) return actionFail("That rider is no longer on this job.");
  if (rider.status !== "DRAFT") {
    return actionFail("This rider is already attached to the contract, so it can't change. Start a new rider instead.");
  }
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").replace(/\r\n/g, "\n").trim();
  if (!title) return actionFail("Give the rider a title.");
  if (!body) return actionFail("The rider is empty.");
  if (body.length > MAX_RIDER_LENGTH) return actionFail(`Keep the rider under ${MAX_RIDER_LENGTH.toLocaleString("en-US")} characters.`);
  await prisma.subcontractRider.update({ where: { id: rider.id }, data: { title: title.slice(0, 200), body } });
  revalidatePath(reviewPath(rider.jobId));
  return actionOk;
}

export async function deleteSubcontractRider(riderId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NOT_YOURS);
  const rider = await draftRider(riderId, context.company.id);
  if (!rider) return actionFail("That rider is no longer on this job.");
  if (rider.status !== "DRAFT") {
    return actionFail("An attached rider is a contract version. Remove that version from the job instead.");
  }
  await prisma.subcontractRider.delete({ where: { id: rider.id } });
  revalidatePath(reviewPath(rider.jobId));
  return actionOk;
}

/**
 * Render the rider to a PDF and file it as the job's next contract version.
 * The blob is written first and removed again if the database half fails, so
 * a failure leaves neither a version without a file nor a file without a
 * version.
 */
export async function attachSubcontractRider(riderId: string): Promise<ActionResultWith<{ versionNumber: number }>> {
  const fail = (error: string) => ({ ok: false as const, error });
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return fail(NOT_YOURS);
  const { company, ...user } = context;

  const rider = await draftRider(riderId, company.id);
  if (!rider) return fail("That rider is no longer on this job.");
  if (rider.status !== "DRAFT") return fail("This rider is already attached.");

  let url: string;
  try {
    const pdf = await renderRiderPdf(rider.title, rider.body);
    const uploaded = await put(`contracts/${rider.jobId}/subcontract-rider.pdf`, pdf, {
      access: "public",
      addRandomSuffix: true,
      contentType: "application/pdf",
    });
    url = uploaded.url;
  } catch (err) {
    console.error("[subcontract-rider] the rider PDF could not be written", { error: err instanceof Error ? err.name : "unknown" });
    return fail("The rider couldn't be saved as a PDF just now. Nothing was attached; try again in a moment.");
  }

  try {
    const versionNumber = await prisma.$transaction(async (tx) => {
      // Re-checked inside the transaction: two presses must not file two versions.
      const claimed = await tx.subcontractRider.updateMany({
        where: { id: rider.id, status: "DRAFT" },
        data: { status: "ATTACHED", attachedAt: new Date() },
      });
      if (claimed.count === 0) throw new Error("already attached");
      const number = await issueContractDocumentVersion(tx, rider.jobId);
      const doc = await tx.contractDocument.create({
        data: {
          jobId: rider.jobId,
          versionNumber: number,
          fileUrl: url,
          fileName: `${rider.title.replace(/[^\w .,-]+/g, "").slice(0, 80) || "Subcontract rider"}.pdf`,
          note: "Subcontract rider drafted from the subcontract review.",
          uploadedByUserId: user.id,
        },
        select: { id: true },
      });
      await tx.subcontractRider.update({ where: { id: rider.id }, data: { attachedContractDocumentId: doc.id } });
      return number;
    });
    revalidatePath(reviewPath(rider.jobId));
    revalidatePath(`/jobs/${rider.jobId}`);
    return { ok: true, value: { versionNumber } };
  } catch (err) {
    await deleteDocument(url).catch(() => {});
    if (err instanceof Error && err.message === "already attached") return fail("This rider is already attached.");
    console.error("[subcontract-rider] the version could not be recorded", { error: err instanceof Error ? err.name : "unknown" });
    return fail("The rider couldn't be attached just now. Nothing was filed; try again in a moment.");
  }
}

// ── Obligations (feed the alerts) ───────────────────────────────────────────

const OBLIGATION_KINDS = ["NOTICE_WINDOW", "MONTHLY_DAY", "DATED"] as const;

function intIn(raw: FormDataEntryValue | null, min: number, max: number): number | null | "bad" {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (!/^\d+$/.test(text)) return "bad";
  const n = Number(text);
  return n >= min && n <= max ? n : "bad";
}

function dateIn(raw: FormDataEntryValue | null): Date | null | "bad" {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "bad";
  const value = new Date(`${text}T00:00:00.000Z`);
  // Round trip: 2026-02-31 parses and silently becomes March.
  return Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== text ? "bad" : value;
}

/** The finding a confirmation came from, for its words — or null. Never trusted
 *  beyond this job: a key from another job's review finds nothing. */
async function findingSnapshot(jobId: string, companyId: string, key: string) {
  if (!key) return null;
  return prisma.subcontractFinding.findFirst({
    where: { key, review: { jobId, job: { companyId } } },
    orderBy: { createdAt: "desc" },
    select: { key: true, quote: true, pageStart: true },
  });
}

export async function confirmSubcontractObligation(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NOT_YOURS);
  const job = await jobFor(jobId, context.company.id);
  if (!job) return actionFail("That job is no longer on your list.");

  const kind = String(formData.get("kind") ?? "");
  if (!(OBLIGATION_KINDS as readonly string[]).includes(kind)) return actionFail("Choose what kind of deadline this is.");
  const label = String(formData.get("label") ?? "").trim().slice(0, 120);
  if (!label) return actionFail("Say what the deadline is — e.g. “48-hour delay notice”.");

  const windowHours = intIn(formData.get("windowHours"), 1, 720);
  const windowDays = intIn(formData.get("windowDays"), 1, 365);
  const dayOfMonth = intIn(formData.get("dayOfMonth"), 1, 31);
  const dueOn = dateIn(formData.get("dueOn"));
  if (windowHours === "bad" || windowDays === "bad") return actionFail("A notice window is a whole number of hours or days.");
  if (dayOfMonth === "bad") return actionFail("The day of the month is 1 to 31.");
  if (dueOn === "bad") return actionFail("The due date needs to be a real date.");
  if (kind === "NOTICE_WINDOW" && windowHours === null && windowDays === null) {
    return actionFail("A notice window needs its hours or its days.");
  }
  if (kind === "MONTHLY_DAY" && dayOfMonth === null) return actionFail("Say which day of the month.");
  if (kind === "DATED" && dueOn === null) return actionFail("Enter the date.");

  const source = await findingSnapshot(job.id, context.company.id, String(formData.get("findingKey") ?? ""));
  const text = (name: string) => String(formData.get(name) ?? "").trim().slice(0, 200) || null;
  await prisma.subcontractObligation.create({
    data: {
      jobId: job.id,
      findingKey: source?.key ?? null,
      quote: source?.quote ?? null,
      pageStart: source?.pageStart ?? null,
      kind: kind as (typeof OBLIGATION_KINDS)[number],
      label,
      windowHours: kind === "NOTICE_WINDOW" ? windowHours : null,
      windowDays: kind === "NOTICE_WINDOW" && windowHours === null ? windowDays : null,
      dayOfMonth: kind === "MONTHLY_DAY" ? dayOfMonth : null,
      dueOn: kind === "DATED" ? dueOn : null,
      recipient: text("recipient"),
      form: text("form"),
      confirmedByUserId: context.id,
    },
  });
  revalidatePath(reviewPath(job.id));
  revalidatePath("/alerts");
  return actionOk;
}

export async function removeSubcontractObligation(obligationId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NOT_YOURS);
  const row = await prisma.subcontractObligation.findFirst({
    where: { id: obligationId, job: { companyId: context.company.id } },
    select: { id: true, jobId: true },
  });
  if (!row) return actionFail("That deadline is no longer on this job.");
  await prisma.subcontractObligation.delete({ where: { id: row.id } });
  revalidatePath(reviewPath(row.jobId));
  revalidatePath("/alerts");
  return actionOk;
}

// ── Insurance requirements (stored for the COI work) ────────────────────────

function moneyIn(raw: FormDataEntryValue | null): number | null | "bad" {
  const text = String(raw ?? "").replace(/[$,\s]/g, "");
  if (!text) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return "bad";
  const n = Number(text);
  return n <= 1_000_000_000 ? n : "bad";
}

export async function confirmSubcontractInsurance(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NOT_YOURS);
  const job = await jobFor(jobId, context.company.id);
  if (!job) return actionFail("That job is no longer on your list.");

  const coverage = String(formData.get("coverage") ?? "");
  if (!(COVERAGES as readonly string[]).includes(coverage)) return actionFail("Choose the coverage.");
  const perOccurrence = moneyIn(formData.get("limitPerOccurrence"));
  const aggregate = moneyIn(formData.get("limitAggregate"));
  if (perOccurrence === "bad" || aggregate === "bad") return actionFail("A limit is a dollar amount, like 1,000,000.");
  const completedOps = intIn(formData.get("completedOpsYears"), 1, 20);
  if (completedOps === "bad") return actionFail("Completed operations is a number of years, 1 to 20.");
  const endorsements = formData
    .getAll("endorsements")
    .map(String)
    .filter((e): e is Endorsement => (ENDORSEMENTS as readonly string[]).includes(e));

  const source = await findingSnapshot(job.id, context.company.id, String(formData.get("findingKey") ?? ""));
  const text = (name: string, max: number) => String(formData.get(name) ?? "").trim().slice(0, max) || null;
  await prisma.subcontractInsuranceRequirement.create({
    data: {
      jobId: job.id,
      findingKey: source?.key ?? null,
      quote: source?.quote ?? null,
      pageStart: source?.pageStart ?? null,
      coverage: coverage as Coverage,
      coverageLabel: text("coverageLabel", 120),
      limitPerOccurrence: perOccurrence,
      limitAggregate: aggregate,
      endorsements: [...new Set(endorsements)],
      completedOpsYears: completedOps,
      notes: text("notes", 1000),
      confirmedByUserId: context.id,
    },
  });
  revalidatePath(reviewPath(job.id));
  return actionOk;
}

export async function removeSubcontractInsurance(requirementId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NOT_YOURS);
  const row = await prisma.subcontractInsuranceRequirement.findFirst({
    where: { id: requirementId, job: { companyId: context.company.id } },
    select: { id: true, jobId: true },
  });
  if (!row) return actionFail("That requirement is no longer on this job.");
  await prisma.subcontractInsuranceRequirement.delete({ where: { id: row.id } });
  revalidatePath(reviewPath(row.jobId));
  return actionOk;
}
