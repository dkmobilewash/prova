"use server";

import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { assertJobInCompany, assertLineItemOnJob, craftClassificationIdFromForm, nullableDecimalFromForm } from "./shared";

const TIME_ENTRY_PAY_TYPES = ["STRAIGHT", "OVERTIME", "DOUBLE_TIME", "SHIFT_DIFFERENTIAL"] as const;

/** Unrecognized/missing selection falls back to STRAIGHT rather than
 * erroring — every entry needs some pay type, and straight time is the
 * overwhelmingly common case. */
function timeEntryPayTypeFromForm(formData: FormData): (typeof TIME_ENTRY_PAY_TYPES)[number] {
  const raw = String(formData.get("payType") ?? "");
  return TIME_ENTRY_PAY_TYPES.includes(raw as (typeof TIME_ENTRY_PAY_TYPES)[number])
    ? (raw as (typeof TIME_ENTRY_PAY_TYPES)[number])
    : "STRAIGHT";
}

/** Logs a day's hours for one employee against a job — optionally tied to
 * a specific line item (cost code/SOV line) and craft classification. See
 * TimeEntry in schema.prisma for why pay types are separate rows rather
 * than one row with a rate multiplier. */
export async function logTimeEntry(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const employeeUserId = String(formData.get("employeeUserId") ?? "");
  const employee = await prisma.user.findUnique({ where: { id: employeeUserId } });
  if (!employee || employee.companyId !== company.id) {
    throw new Error("Employee not found");
  }

  const lineItemIdRaw = String(formData.get("lineItemId") ?? "").trim();
  const lineItemId = lineItemIdRaw ? (await assertLineItemOnJob(lineItemIdRaw, jobId)).id : null;

  const craftClassificationId = await craftClassificationIdFromForm(formData, company.id);

  const dateRaw = String(formData.get("date") ?? "").trim();
  if (!dateRaw) {
    throw new Error("Date is required");
  }
  const date = new Date(dateRaw);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date");
  }

  const hoursRaw = String(formData.get("hours") ?? "").trim();
  if (!hoursRaw || Number.isNaN(Number(hoursRaw)) || Number(hoursRaw) <= 0) {
    throw new Error("Hours must be a positive number");
  }

  const note = String(formData.get("note") ?? "").trim();
  const perDiemAmount = nullableDecimalFromForm(formData, "perDiemAmount");
  const travelPayAmount = nullableDecimalFromForm(formData, "travelPayAmount");

  await prisma.timeEntry.create({
    data: {
      jobId,
      lineItemId,
      employeeUserId,
      craftClassificationId,
      date,
      hours: hoursRaw,
      payType: timeEntryPayTypeFromForm(formData),
      perDiemAmount,
      travelPayAmount,
      note: note || null,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
}

const DISPATCH_SLIP_MEDIA_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;

const DISPATCH_SLIP_MAX_BYTES = 15 * 1024 * 1024;

/** Records a union hiring hall's dispatch of one worker to this job. The
 * scanned slip is optional — some halls dispatch by phone with just a
 * referral number, no document to attach. */
export async function uploadDispatchSlip(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const employeeUserId = String(formData.get("employeeUserId") ?? "");
  const employee = await prisma.user.findUnique({ where: { id: employeeUserId } });
  if (!employee || employee.companyId !== company.id) {
    throw new Error("Employee not found");
  }

  const craftClassificationId = await craftClassificationIdFromForm(formData, company.id);

  const dispatchDateRaw = String(formData.get("dispatchDate") ?? "").trim();
  if (!dispatchDateRaw) {
    throw new Error("Dispatch date is required");
  }
  const dispatchDate = new Date(dispatchDateRaw);
  if (Number.isNaN(dispatchDate.getTime())) {
    throw new Error("Invalid dispatch date");
  }

  const dispatchNumber = String(formData.get("dispatchNumber") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  const file = formData.get("file");
  let fileUrl: string | null = null;
  let fileName: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (!(DISPATCH_SLIP_MEDIA_TYPES as readonly string[]).includes(file.type)) {
      throw new Error("Upload a PDF, PNG, JPEG, or WEBP file");
    }
    if (file.size > DISPATCH_SLIP_MAX_BYTES) {
      throw new Error("File is too large (max 15MB)");
    }
    const buffer = await file.arrayBuffer().then(Buffer.from);
    const blob = await put(`dispatch-slips/${jobId}/${file.name}`, buffer, {
      access: "public",
      contentType: file.type,
    });
    fileUrl = blob.url;
    fileName = file.name;
  }

  await prisma.dispatchSlip.create({
    data: {
      jobId,
      employeeUserId,
      craftClassificationId,
      dispatchDate,
      dispatchNumber: dispatchNumber || null,
      fileUrl,
      fileName,
      note: note || null,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
}

export async function deleteDispatchSlip(jobId: string, dispatchSlipId: string) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const slip = await prisma.dispatchSlip.findUnique({ where: { id: dispatchSlipId } });
  if (!slip || slip.jobId !== jobId) {
    throw new Error("Dispatch slip not found on this job");
  }

  await prisma.dispatchSlip.delete({ where: { id: dispatchSlipId } });

  revalidatePath(`/jobs/${jobId}`);
}

export async function deleteTimeEntry(jobId: string, timeEntryId: string) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const timeEntry = await prisma.timeEntry.findUnique({ where: { id: timeEntryId } });
  if (!timeEntry || timeEntry.jobId !== jobId) {
    throw new Error("Time entry not found on this job");
  }

  await prisma.timeEntry.delete({ where: { id: timeEntryId } });

  revalidatePath(`/jobs/${jobId}`);
}

const PREVAILING_WAGE_DETERMINATION_MEDIA_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;

const PREVAILING_WAGE_DETERMINATION_MAX_BYTES = 15 * 1024 * 1024;

/** Attaches a government wage-determination document (or a link to one)
 * for a job's jurisdiction. This is attached storage, not a lookup --
 * there's no licensed prevailing-wage dataset in this app to query. */
export async function uploadPrevailingWageDetermination(jobId: string, formData: FormData) {
  const { company, ...user } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const jurisdiction = String(formData.get("jurisdiction") ?? "").trim();
  if (!jurisdiction) {
    throw new Error("Jurisdiction is required");
  }

  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  const file = formData.get("file");
  let fileUrl: string | null = null;
  let fileName: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (!(PREVAILING_WAGE_DETERMINATION_MEDIA_TYPES as readonly string[]).includes(file.type)) {
      throw new Error("Upload a PDF, PNG, JPEG, or WEBP file");
    }
    if (file.size > PREVAILING_WAGE_DETERMINATION_MAX_BYTES) {
      throw new Error("File is too large (max 15MB)");
    }
    const buffer = await file.arrayBuffer().then(Buffer.from);
    const blob = await put(`prevailing-wage/${jobId}/${file.name}`, buffer, {
      access: "public",
      contentType: file.type,
    });
    fileUrl = blob.url;
    fileName = file.name;
  }

  if (!fileUrl && !sourceUrl) {
    throw new Error("Attach a file or a source link");
  }

  await prisma.prevailingWageDetermination.create({
    data: {
      jobId,
      jurisdiction,
      fileUrl,
      fileName,
      sourceUrl: sourceUrl || null,
      note: note || null,
      uploadedByUserId: user.id,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
}

export async function deletePrevailingWageDetermination(jobId: string, determinationId: string) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const determination = await prisma.prevailingWageDetermination.findUnique({ where: { id: determinationId } });
  if (!determination || determination.jobId !== jobId) {
    throw new Error("Prevailing wage determination not found on this job");
  }

  await prisma.prevailingWageDetermination.delete({ where: { id: determinationId } });

  revalidatePath(`/jobs/${jobId}`);
}

// ---------------------------------------------------------------------------
// Punch lists (Cyrus's lane — WORK-SPLIT.md task 5).
//
// Built as its own page rather than a section on jobs/[id]/page.tsx, which
// WORK-SPLIT assigns to Diego and which he has been editing this week. A
// standalone page also matches how the list is actually used: a super
// walking three jobs wants everything still open, not one job at a time.
// The per-job section can be added later as a thin read of the same model.
// ---------------------------------------------------------------------------
