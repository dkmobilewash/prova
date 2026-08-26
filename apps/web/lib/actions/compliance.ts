"use server";

import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { extractComplianceDocument } from "@prova/integrations";
import { BOND_TYPES, COMPLIANCE_DOCUMENT_TYPES, INSURANCE_POLICY_TYPES, assertOwner, enumFromForm, nullableDecimalFromForm } from "./shared";

/** Adds a company insurance policy record (GL, workers' comp, auto, umbrella). */
export async function createInsurancePolicy(formData: FormData) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const policyType = enumFromForm(formData, "policyType", INSURANCE_POLICY_TYPES);
  const carrier = String(formData.get("carrier") ?? "").trim();
  const policyNumber = String(formData.get("policyNumber") ?? "").trim();
  const coverageLimits = String(formData.get("coverageLimits") ?? "").trim();
  const effectiveRaw = String(formData.get("effectiveDate") ?? "").trim();
  const expirationRaw = String(formData.get("expirationDate") ?? "").trim();

  if (!carrier || !policyNumber) {
    throw new Error("Carrier and policy number are required");
  }

  await prisma.companyInsurancePolicy.create({
    data: {
      companyId: company.id,
      policyType,
      carrier,
      policyNumber,
      coverageLimits: coverageLimits || null,
      effectiveDate: effectiveRaw ? new Date(effectiveRaw) : null,
      expirationDate: expirationRaw ? new Date(expirationRaw) : null,
    },
  });

  revalidatePath("/settings");
}

export async function deleteInsurancePolicy(policyId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const policy = await prisma.companyInsurancePolicy.findUnique({ where: { id: policyId } });
  if (!policy || policy.companyId !== company.id) {
    throw new Error("Insurance policy not found");
  }

  await prisma.companyInsurancePolicy.delete({ where: { id: policyId } });

  revalidatePath("/settings");
}

/** Adds a company bonding record (license bond or performance/payment capacity). */
export async function createBond(formData: FormData) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const bondType = enumFromForm(formData, "bondType", BOND_TYPES);
  const suretyName = String(formData.get("suretyName") ?? "").trim();
  const aggregateBondingCapacity = nullableDecimalFromForm(formData, "aggregateBondingCapacity");
  const singleJobLimit = nullableDecimalFromForm(formData, "singleJobLimit");
  const agentContactName = String(formData.get("agentContactName") ?? "").trim();
  const agentContactPhone = String(formData.get("agentContactPhone") ?? "").trim();
  const agentContactEmail = String(formData.get("agentContactEmail") ?? "").trim();
  const renewalRaw = String(formData.get("renewalDate") ?? "").trim();

  if (!suretyName) {
    throw new Error("Surety name is required");
  }

  await prisma.companyBond.create({
    data: {
      companyId: company.id,
      suretyName,
      bondType,
      aggregateBondingCapacity,
      singleJobLimit,
      agentContactName: agentContactName || null,
      agentContactPhone: agentContactPhone || null,
      agentContactEmail: agentContactEmail || null,
      renewalDate: renewalRaw ? new Date(renewalRaw) : null,
    },
  });

  revalidatePath("/settings");
}

export async function deleteBond(bondId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const bond = await prisma.companyBond.findUnique({ where: { id: bondId } });
  if (!bond || bond.companyId !== company.id) {
    throw new Error("Bond not found");
  }

  await prisma.companyBond.delete({ where: { id: bondId } });

  revalidatePath("/settings");
}

const COMPLIANCE_UPLOAD_MEDIA_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;

const COMPLIANCE_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

/** Uploads a compliance document (lien waiver, COI, certified payroll,
 * union fringe filing) and has Claude read it into structured fields —
 * see extractComplianceDocument in @prova/integrations. Not owner-gated:
 * any team member can log paperwork they receive from a sub or vendor,
 * same reasoning as addCostEntry. The extracted fields are saved as a
 * normal, editable row (aiExtracted just flags it for review, not a
 * lock) — a bad extraction is fixed the same way a typo would be. */
export async function uploadComplianceDocument(formData: FormData) {
  const { company, ...user } = await requireCompanyContext();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("A file is required");
  }
  if (!(COMPLIANCE_UPLOAD_MEDIA_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("Upload a PDF, PNG, JPEG, or WEBP file");
  }
  if (file.size > COMPLIANCE_UPLOAD_MAX_BYTES) {
    throw new Error("File is too large (max 15MB)");
  }

  const jobIdRaw = String(formData.get("jobId") ?? "").trim();
  let jobId: string | null = null;
  if (jobIdRaw) {
    const job = await prisma.job.findUnique({ where: { id: jobIdRaw } });
    if (!job || job.companyId !== company.id) {
      throw new Error("Job not found");
    }
    jobId = job.id;
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mediaType = file.type as (typeof COMPLIANCE_UPLOAD_MEDIA_TYPES)[number];

  const [blob, extraction] = await Promise.all([
    put(`compliance/${company.id}/${file.name}`, buffer, { access: "public", contentType: file.type }),
    extractComplianceDocument({ fileBase64: buffer.toString("base64"), mediaType, fileName: file.name }),
  ]);

  await prisma.complianceDocument.create({
    data: {
      companyId: company.id,
      jobId,
      type: extraction.type,
      partyName: extraction.partyName,
      amount: extraction.amount != null ? extraction.amount.toString() : null,
      periodStart: extraction.periodStart ? new Date(extraction.periodStart) : null,
      periodEnd: extraction.periodEnd ? new Date(extraction.periodEnd) : null,
      effectiveDate: extraction.effectiveDate ? new Date(extraction.effectiveDate) : null,
      expiresAt: extraction.expiresAt ? new Date(extraction.expiresAt) : null,
      notes: extraction.notes,
      fileUrl: blob.url,
      fileName: file.name,
      aiExtracted: true,
      uploadedByUserId: user.id,
    },
  });

  revalidatePath("/compliance");
}

/** Edits a compliance document's fields — how a bad AI extraction gets
 * fixed (same as fixing a typo, not a separate "correction" flow) but
 * also just how anyone edits a manually-entered record. Not owner-gated,
 * same reasoning as uploadComplianceDocument. */
export async function updateComplianceDocument(documentId: string, formData: FormData) {
  const { company } = await requireCompanyContext();

  const document = await prisma.complianceDocument.findUnique({ where: { id: documentId } });
  if (!document || document.companyId !== company.id) {
    throw new Error("Compliance document not found");
  }

  const type = enumFromForm(formData, "type", COMPLIANCE_DOCUMENT_TYPES);
  const partyName = String(formData.get("partyName") ?? "").trim();
  if (!partyName) {
    throw new Error("Party name is required");
  }
  const amount = nullableDecimalFromForm(formData, "amount");
  const periodStartRaw = String(formData.get("periodStart") ?? "").trim();
  const periodEndRaw = String(formData.get("periodEnd") ?? "").trim();
  const effectiveRaw = String(formData.get("effectiveDate") ?? "").trim();
  const expiresRaw = String(formData.get("expiresAt") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  await prisma.complianceDocument.update({
    where: { id: documentId },
    data: {
      type,
      partyName,
      amount,
      periodStart: periodStartRaw ? new Date(periodStartRaw) : null,
      periodEnd: periodEndRaw ? new Date(periodEndRaw) : null,
      effectiveDate: effectiveRaw ? new Date(effectiveRaw) : null,
      expiresAt: expiresRaw ? new Date(expiresRaw) : null,
      notes: notes || null,
    },
  });

  revalidatePath("/compliance");
}

/** Marks a compliance document RECEIVED (e.g. the lien waiver came back
 * signed, or the sub's updated COI arrived). */
export async function markComplianceDocumentReceived(documentId: string) {
  const { company } = await requireCompanyContext();

  const document = await prisma.complianceDocument.findUnique({ where: { id: documentId } });
  if (!document || document.companyId !== company.id) {
    throw new Error("Compliance document not found");
  }

  await prisma.complianceDocument.update({ where: { id: documentId }, data: { status: "RECEIVED" } });

  revalidatePath("/compliance");
}

export async function deleteComplianceDocument(documentId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const document = await prisma.complianceDocument.findUnique({ where: { id: documentId } });
  if (!document || document.companyId !== company.id) {
    throw new Error("Compliance document not found");
  }

  await prisma.complianceDocument.delete({ where: { id: documentId } });

  revalidatePath("/compliance");
}

// ---------------------------------------------------------------------------
// Vendors (Cyrus's lane — WORK-SPLIT.md task 2). Appended at the end of the
// file per WORK-SPLIT.md's shared-file rule.
// ---------------------------------------------------------------------------
