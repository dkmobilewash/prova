"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { Prisma, prisma } from "@prova/db";
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

/** Day counts only mean anything for these two outcomes. The form hides
 * the inputs otherwise, but a form is not a validator: a direct action
 * call with FIRST_AID_ONLY and daysAway=40 would store both and the log
 * would print "First aid · 40 days away" — a row that contradicts itself
 * on a document an inspector reads. Cleared here so the record can't. */
function daysForOutcome(outcome: string, daysAway: number | null, daysRestricted: number | null) {
  const counted = outcome === "DAYS_AWAY" || outcome === "RESTRICTED_OR_TRANSFER";
  return {
    daysAway: counted ? daysAway : null,
    daysRestricted: counted ? daysRestricted : null,
  };
}

async function optionalJobId(formData: FormData, companyId: string) {
  const raw = String(formData.get("jobId") ?? "").trim();
  if (!raw) return null;
  const job = await prisma.job.findUnique({ where: { id: raw } });
  if (!job || job.companyId !== companyId) throw new Error("Job not found");
  return job.id;
}

/** Issues the next case number for a company and year.
 *
 * Reads nothing from SafetyIncident on purpose. An earlier version took
 * `max(caseNumber) + 1`, which looks right and isn't: delete the highest
 * case and the max drops back, so the next case reissues that number. A
 * row count fails the same way. Anything derived from the rows that still
 * exist can be reissued, because deleting a row changes the answer.
 *
 * The counter only ever increments, so a deleted case's number is retired.
 * Must be called with a transaction client so the increment and the
 * incident are one atomic step — otherwise two people filing at the same
 * moment both read the same value and collide on the unique constraint.
 */
async function issueCaseNumber(
  tx: Prisma.TransactionClient,
  companyId: string,
  caseYear: number,
) {
  const counter = await tx.safetyCaseCounter.upsert({
    where: { companyId_caseYear: { companyId, caseYear } },
    create: { companyId, caseYear, lastCaseNumber: 1 },
    update: { lastCaseNumber: { increment: 1 } },
    select: { lastCaseNumber: true },
  });
  return counter.lastCaseNumber;
}

/** What identifies one OSHA case: who was hurt, when, and what happened.
 *
 * Deliberately NOT the classification, the outcome or the day counts.
 * Those are what the record SAYS about the injury rather than which
 * injury it is, they stay editable afterwards, and including them would
 * let a resubmission that corrected one of them file a second case for the
 * same person on the same day — the exact duplicate this is here to stop.
 */
type CaseIdentity = {
  occurredAt: Date;
  employeeName: string;
  description: string;
};

/** Is this injury already on the log?
 *
 * Run `createSafetyIncident` twice and nothing in the schema refused the
 * second one. The only relevant constraint is
 * `@@unique([companyId, caseYear, caseNumber])`, and `issueCaseNumber`
 * hands the second run a fresh number, so the duplicate is unique by
 * construction. One injury became two recordable cases in the count a GC
 * reads at prequalification.
 *
 * Deleting the duplicate afterwards is worse than leaving it, which is why
 * this has to be prevention rather than cleanup: the counter only ever
 * increments, on purpose, so a deleted case retires its number for good
 * and the filed log is left with a gap in the sequence and nothing on the
 * document to explain it.
 *
 * Must run inside the transaction and BEFORE the counter is touched. A
 * guard that refused after issuing a number would still burn it, and
 * produce that same unexplained gap without any duplicate to blame.
 *
 * WHAT THIS DOES NOT CLOSE: two identical submissions arriving at the same
 * instant can both read nothing here and both insert. Only a unique index
 * in the database can refuse that one, and adding it is a migration.
 */
async function alreadyFiled(
  tx: Prisma.TransactionClient,
  companyId: string,
  identity: CaseIdentity,
) {
  return tx.safetyIncident.findFirst({
    where: { companyId, ...identity },
    select: { id: true },
  });
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

  const jobId = await optionalJobId(formData, company.id);
  const classification = pick(formData, "classification", CLASSIFICATIONS);
  const outcome = pick(formData, "outcome", OUTCOMES);
  const days = daysForOutcome(
    outcome,
    countFromForm(formData, "daysAway"),
    countFromForm(formData, "daysRestricted"),
  );

  await prisma.$transaction(async (tx) => {
    // Silent on purpose. This runs when somebody's report did not appear
    // to go through and they sent it again, and the truthful outcome of
    // that is the one case that is already filed — the page revalidates
    // below and shows it. An error would report a failure that did not
    // happen, about a record that exists, and in production the message
    // would be redacted to a digest anyway.
    if (await alreadyFiled(tx, company.id, { occurredAt, employeeName, description })) {
      return;
    }

    await tx.safetyIncident.create({
      data: {
        companyId: company.id,
        jobId,
        caseYear,
        caseNumber: await issueCaseNumber(tx, company.id, caseYear),
        occurredAt,
        employeeName,
        jobTitle: jobTitle || null,
        location: location || null,
        description,
        classification,
        outcome,
        ...days,
        reportedByUserId: user.id,
      },
    });
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

  const updatedOutcome = pick(formData, "outcome", OUTCOMES);

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
      outcome: updatedOutcome,
      ...daysForOutcome(
        updatedOutcome,
        countFromForm(formData, "daysAway"),
        countFromForm(formData, "daysRestricted"),
      ),
    },
  });

  revalidatePath("/safety");
}

export async function deleteSafetyIncident(incidentId: string) {
  const context = await requireCompanyContext();
  assertOwner(context, "Only the account owner can remove a safety case");
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
  assertOwner(context, "Only the account owner can remove a toolbox talk");
  const { company } = context;

  const talk = await prisma.toolboxTalk.findUnique({ where: { id: talkId } });
  if (!talk || talk.companyId !== company.id) throw new Error("Toolbox talk not found");

  await prisma.toolboxTalk.delete({ where: { id: talkId } });
  revalidatePath("/safety");
}
