"use server";

import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { extractComplianceDocument } from "@prova/integrations";
import { BOND_TYPES, COMPLIANCE_DOCUMENT_TYPES, INSURANCE_POLICY_TYPES, JURISDICTION_TYPES, SETTABLE_LICENSE_STATUSES, type ActionResult, actionFail, actionOk, assertOwner, enumFromForm, nullableDecimalFromForm } from "./shared";

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

/* ------------------------------------------------------------------ */
/* Contractor licences                                                 */
/* ------------------------------------------------------------------ */

/**
 * A licence a company holds, per jurisdiction.
 *
 * One row per licence HELD, not per state — the schema is explicit about
 * why: Colorado has no state licence at all, only municipal ones, so a
 * company working in two Colorado cities holds two rows here and no
 * "Colorado" row exists.
 *
 * These actions return ActionResult rather than throwing. Production
 * redacts thrown Server Action messages, so "That licence number is
 * already recorded" would reach a user as an unexplained failure.
 */

/** A yyyy-mm-dd from a date input, at UTC midnight — or null when blank.
 * Returns undefined when the text is present but not a date, so the caller
 * can say so rather than storing an Invalid Date. */
function dateFromForm(formData: FormData, key: string): Date | null | undefined {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function licenceFieldsFromForm(formData: FormData) {
  const jurisdictionName = String(formData.get("jurisdictionName") ?? "").trim();
  const licenseNumber = String(formData.get("licenseNumber") ?? "").trim();
  const classificationCode = String(formData.get("classificationCode") ?? "").trim();
  const classificationLabel = String(formData.get("classificationLabel") ?? "").trim();
  const bondNumber = String(formData.get("bondNumber") ?? "").trim();

  if (!jurisdictionName) return actionFail("Which jurisdiction issued it?");
  if (!licenseNumber) return actionFail("A licence number is required.");

  const issueDate = dateFromForm(formData, "issueDate");
  if (issueDate === undefined) return actionFail("That issue date isn't a date.");
  const expirationDate = dateFromForm(formData, "expirationDate");
  if (expirationDate === undefined) return actionFail("That expiration date isn't a date.");

  // An expiry before the issue date is always a typo, and it would show up
  // in the renewals panel as an already-expired licence you just added.
  if (issueDate && expirationDate && expirationDate < issueDate) {
    return actionFail("The expiration date is before the issue date.");
  }

  return {
    jurisdictionType: enumFromForm(formData, "jurisdictionType", JURISDICTION_TYPES),
    jurisdictionName,
    licenseNumber,
    classificationCode: classificationCode || null,
    classificationLabel: classificationLabel || null,
    issueDate,
    expirationDate,
    status: enumFromForm(formData, "status", SETTABLE_LICENSE_STATUSES),
    bondNumber: bondNumber || null,
  };
}

export async function createCompanyLicense(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  assertOwner(context, "Only the account owner can add a licence");
  const { company } = context;

  const fields = licenceFieldsFromForm(formData);
  if ("ok" in fields) return fields;

  // The same licence entered twice in two jurisdictions is legitimate (a
  // number is only unique within the body that issued it), so this checks
  // the pair, not the number alone.
  const existing = await prisma.companyLicense.findFirst({
    where: {
      companyId: company.id,
      licenseNumber: fields.licenseNumber,
      jurisdictionName: fields.jurisdictionName,
    },
  });
  if (existing) {
    return actionFail(`${fields.jurisdictionName} licence ${fields.licenseNumber} is already recorded.`);
  }

  await prisma.companyLicense.create({ data: { companyId: company.id, ...fields } });

  revalidatePath("/settings");
  revalidatePath("/compliance");
  return actionOk;
}

export async function updateCompanyLicense(
  licenseId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  assertOwner(context, "Only the account owner can edit a licence");
  const { company } = context;

  const licence = await prisma.companyLicense.findUnique({ where: { id: licenseId } });
  if (!licence || licence.companyId !== company.id) {
    return actionFail("That licence no longer exists.");
  }

  const fields = licenceFieldsFromForm(formData);
  if ("ok" in fields) return fields;

  const clash = await prisma.companyLicense.findFirst({
    where: {
      companyId: company.id,
      licenseNumber: fields.licenseNumber,
      jurisdictionName: fields.jurisdictionName,
      id: { not: licenseId },
    },
  });
  if (clash) {
    return actionFail(`${fields.jurisdictionName} licence ${fields.licenseNumber} is already recorded.`);
  }

  await prisma.companyLicense.update({ where: { id: licenseId }, data: fields });

  revalidatePath("/settings");
  revalidatePath("/compliance");
  return actionOk;
}

export async function deleteCompanyLicense(licenseId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  assertOwner(context, "Only the account owner can remove a licence");
  const { company } = context;

  const licence = await prisma.companyLicense.findUnique({ where: { id: licenseId } });
  if (!licence || licence.companyId !== company.id) {
    return actionFail("That licence no longer exists.");
  }

  await prisma.companyLicense.delete({ where: { id: licenseId } });

  revalidatePath("/settings");
  revalidatePath("/compliance");
  return actionOk;
}
