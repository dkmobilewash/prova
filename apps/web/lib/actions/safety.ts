"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { assertOwner } from "./shared";

const OUTCOMES = [
  "DEATH",
  "DAYS_AWAY",
  "RESTRICTED_OR_TRANSFER",
  "OTHER_RECORDABLE",
  "FIRST_AID_ONLY",
] as const;

const CLASSIFICATIONS = [
  "INJURY",
  "SKIN_DISORDER",
  "RESPIRATORY_CONDITION",
  "POISONING",
  "HEARING_LOSS",
  "OTHER_ILLNESS",
] as const;

function pick<T extends readonly string[]>(formData: FormData, key: string, allowed: T): T[number] {
  const raw = String(formData.get(key) ?? "");
  if (!allowed.includes(raw as T[number])) {
    throw new Error(`"${key}" must be one of: ${allowed.join(", ")}`);
  }
  return raw as T[number];
}

function dateFromForm(formData: FormData, key: string): Date {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) throw new Error("Date is required");
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Date is not valid");
  return date;
}

function countFromForm(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`"${key}" must be a whole number of days`);
  return n;
}

async function optionalJobId(formData: FormData, companyId: string) {
  const raw = String(formData.get("jobId") ?? "").trim();
  if (!raw) return null;
  const job = await prisma.job.findUnique({ where: { id: raw } });
  if (!job || job.companyId !== companyId) throw new Error("Job not found");
  return job.id;
}

/** OSHA case numbers restart at 1 each calendar year. Taking the current
 * max rather than counting rows so deleting a case never reissues its
 * number — the log is a legal record and duplicate case numbers in a year
 * are a finding. */
async function nextCaseNumber(companyId: string, caseYear: number) {
  const latest = await prisma.safetyIncident.findFirst({
    where: { companyId, caseYear },
    orderBy: { caseNumber: "desc" },
    select: { caseNumber: true },
  });
  return (latest?.caseNumber ?? 0) + 1;
}

export async function createSafetyIncident(formData: FormData) {
  const { company, ...user } = await requireCompanyContext();

  const employeeName = String(formData.get("employeeName") ?? "").trim();
  if (!employeeName) throw new Error("Employee name is required");
  const description = String(formData.get("description") ?? "").trim();
  if (!description) throw new Error("Description is required");

  const occurredAt = dateFromForm(formData, "occurredAt");
  const caseYear = occurredAt.getUTCFullYear();
  const jobTitle = String(formData.get("jobTitle") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();

  await prisma.safetyIncident.create({
    data: {
      companyId: company.id,
      jobId: await optionalJobId(formData, company.id),
      caseYear,
      caseNumber: await nextCaseNumber(company.id, caseYear),
      occurredAt,
      employeeName,
      jobTitle: jobTitle || null,
      location: location || null,
      description,
      classification: pick(formData, "classification", CLASSIFICATIONS),
      outcome: pick(formData, "outcome", OUTCOMES),
      daysAway: countFromForm(formData, "daysAway"),
      daysRestricted: countFromForm(formData, "daysRestricted"),
      reportedByUserId: user.id,
    },
  });

  revalidatePath("/safety");
}

export async function updateSafetyIncident(incidentId: string, formData: FormData) {
  const { company } = await requireCompanyContext();

  const incident = await prisma.safetyIncident.findUnique({ where: { id: incidentId } });
  if (!incident || incident.companyId !== company.id) throw new Error("Incident not found");

  const employeeName = String(formData.get("employeeName") ?? "").trim();
  if (!employeeName) throw new Error("Employee name is required");
  const description = String(formData.get("description") ?? "").trim();
  if (!description) throw new Error("Description is required");
  const jobTitle = String(formData.get("jobTitle") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();

  // caseNumber/caseYear are deliberately not editable: they identify the
  // case on a filed log.
  await prisma.safetyIncident.update({
    where: { id: incidentId },
    data: {
      jobId: await optionalJobId(formData, company.id),
      employeeName,
      jobTitle: jobTitle || null,
      location: location || null,
      description,
      classification: pick(formData, "classification", CLASSIFICATIONS),
      outcome: pick(formData, "outcome", OUTCOMES),
      daysAway: countFromForm(formData, "daysAway"),
      daysRestricted: countFromForm(formData, "daysRestricted"),
    },
  });

  revalidatePath("/safety");
}

export async function deleteSafetyIncident(incidentId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const incident = await prisma.safetyIncident.findUnique({ where: { id: incidentId } });
  if (!incident || incident.companyId !== company.id) throw new Error("Incident not found");

  await prisma.safetyIncident.delete({ where: { id: incidentId } });
  revalidatePath("/safety");
}

export async function createToolboxTalk(formData: FormData) {
  const { company, ...user } = await requireCompanyContext();

  const topic = String(formData.get("topic") ?? "").trim();
  if (!topic) throw new Error("Topic is required");
  const presenter = String(formData.get("presenter") ?? "").trim();
  const attendees = String(formData.get("attendees") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  await prisma.toolboxTalk.create({
    data: {
      companyId: company.id,
      jobId: await optionalJobId(formData, company.id),
      heldOn: dateFromForm(formData, "heldOn"),
      topic,
      presenter: presenter || null,
      attendees: attendees || null,
      notes: notes || null,
      recordedByUserId: user.id,
    },
  });

  revalidatePath("/safety");
}

export async function deleteToolboxTalk(talkId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const talk = await prisma.toolboxTalk.findUnique({ where: { id: talkId } });
  if (!talk || talk.companyId !== company.id) throw new Error("Toolbox talk not found");

  await prisma.toolboxTalk.delete({ where: { id: talkId } });
  revalidatePath("/safety");
}
