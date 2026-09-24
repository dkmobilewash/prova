"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { isProposalClauseKind, type ProposalClauseKindValue } from "@/lib/proposal-clauses";
import { actionFail, actionOk, ownerRefusal, type ActionResult } from "./shared";

/**
 * Bid proposals — the scope + price + exclusions document a sub sends a GC.
 *
 * The gate is MANAGE_ESTIMATING, the same as /catalog, /bids and /pipeline:
 * building a bid proposal is estimating, not job costing. Every action
 * RETURNS its failure rather than throwing — production redacts a thrown
 * Server Action message to a digest, and "write the clause text first" is a
 * sentence a person needs to read.
 *
 * Two layers, mirroring the catalog. The LIBRARY (ProposalClause) is the
 * company's reusable standard set of inclusions/exclusions/clarifications/
 * alternates. A JOB'S PROPOSAL (JobProposalClause) is a SNAPSHOT of the text,
 * copied from the library or typed inline — so a proposal already sent to a
 * GC never changes because the library did, same rule as an invoice
 * snapshotting its retainage.
 */

const NO_JOB = "That job isn't on your account any more.";

/** The job, scoped to the company IN THE QUERY. Returned rather than asserted:
 * `assertJobInCompany` throws, and a throw from an ActionResult action reaches
 * the person as a redacted digest. */
async function jobInCompany(jobId: string, companyId: string) {
  return prisma.job.findFirst({ where: { id: jobId, companyId }, select: { id: true } });
}

const NO_ESTIMATING =
  "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";

/** The clause kind from a <select>. A forged value falls back to EXCLUSION —
 * the UI only ever sends a valid kind, and refusing a broken post loudly would
 * turn a bug into a dead form. */
function kindFromForm(formData: FormData): ProposalClauseKindValue {
  const raw = String(formData.get("kind") ?? "");
  return isProposalClauseKind(raw) ? raw : "EXCLUSION";
}

function textFromForm(formData: FormData): string {
  return String(formData.get("text") ?? "").trim();
}

/* ------------------------------------------------- the library (standard set) */

export async function createProposalClause(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING);
  const { company } = context;

  const text = textFromForm(formData);
  if (!text) return actionFail("Write the clause text first.");

  await prisma.proposalClause.create({
    data: { companyId: company.id, kind: kindFromForm(formData), text },
  });

  revalidatePath("/proposals");
  return actionOk;
}

export async function updateProposalClause(clauseId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING);
  const { company } = context;

  const clause = await prisma.proposalClause.findFirst({
    where: { id: clauseId, companyId: company.id },
    select: { id: true },
  });
  if (!clause) return actionFail("That clause is no longer in your library.");

  const text = textFromForm(formData);
  if (!text) return actionFail("Write the clause text first.");

  await prisma.proposalClause.update({
    where: { id: clauseId },
    data: { kind: kindFromForm(formData), text },
  });

  revalidatePath("/proposals");
  return actionOk;
}

export async function deleteProposalClause(clauseId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING);
  const { company } = context;
  const refusal = ownerRefusal(context, "Only the account owner can delete a library clause. Edit it instead.");
  if (refusal) return refusal;

  const removed = await prisma.proposalClause.deleteMany({ where: { id: clauseId, companyId: company.id } });
  if (removed.count === 0) return actionFail("That clause is already gone.");

  revalidatePath("/proposals");
  return actionOk;
}

/* ---------------------------------------------------- a job's proposal (SOV + clauses) */

export async function addProposalClauseToJob(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING);
  const { company } = context;
  if (!(await jobInCompany(jobId, company.id))) return actionFail(NO_JOB);

  const clauseId = String(formData.get("clauseId") ?? "").trim();
  if (clauseId) {
    // Copy from the library into a SNAPSHOT: kind and text are copied now, so
    // a later edit to the library does not move an already-built proposal.
    const source = await prisma.proposalClause.findFirst({
      where: { id: clauseId, companyId: company.id },
      select: { kind: true, text: true },
    });
    if (!source) return actionFail("That library clause is gone. Pick another, or type the text inline.");
    await prisma.jobProposalClause.create({
      data: { companyId: company.id, jobId, kind: source.kind, text: source.text },
    });
  } else {
    const text = textFromForm(formData);
    if (!text) return actionFail("Pick a library clause, or type the text of a new one.");
    await prisma.jobProposalClause.create({
      data: { companyId: company.id, jobId, kind: kindFromForm(formData), text },
    });
  }

  revalidatePath(`/jobs/${jobId}/proposal`);
  return actionOk;
}

export async function removeProposalClause(jobId: string, clauseId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING);
  const { company } = context;
  if (!(await jobInCompany(jobId, company.id))) return actionFail(NO_JOB);

  const removed = await prisma.jobProposalClause.deleteMany({
    where: { id: clauseId, jobId, companyId: company.id },
  });
  if (removed.count === 0) return actionFail("That clause is already off the proposal.");

  revalidatePath(`/jobs/${jobId}/proposal`);
  return actionOk;
}
