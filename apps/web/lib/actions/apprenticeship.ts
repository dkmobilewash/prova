"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { actionFail as fail, actionOk as ok, isUniqueConstraintError, type ActionResult } from "./shared";

/** Failures are RETURNED — production redacts a thrown Server Action
 * message to a digest, so a correctable mistake would arrive as the
 * full-page error boundary. */

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** A blank date is null, not today. Nothing here fills in a date on
 * somebody's behalf: these are dates on an indenture, and the app has no
 * way to know them. */
function date(formData: FormData, key: string): Date | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Blank is null — "nobody looked it up" — and is deliberately NOT zero.
 * Returns a sentinel so a non-numeric entry can be refused rather than
 * silently becoming null. */
function hours(formData: FormData, key: string): number | null | "invalid" {
  const raw = text(formData, key);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return n;
}

async function assertUserInCompany(userId: string, companyId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, companyId } });
  return user !== null;
}

export async function createApprenticeshipEnrollment(formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  const apprenticeUserId = text(formData, "apprenticeUserId");
  if (!apprenticeUserId) return fail("Choose whose indenture this is.");
  if (!(await assertUserInCompany(apprenticeUserId, company.id))) {
    return fail("That person isn't on this company's team.");
  }

  const sponsorName = text(formData, "sponsorName");
  if (!sponsorName) {
    return fail("Name the sponsor — the JATC, state agency or local that registered the programme.");
  }

  const enrolledOn = date(formData, "enrolledOn");
  if (enrolledOn === null) return fail("Enter the date on the indenture.");

  const requiredOjt = hours(formData, "requiredOjtHoursPerPeriod");
  const requiredClassroom = hours(formData, "requiredClassroomHoursPerPeriod");
  if (requiredOjt === "invalid" || requiredClassroom === "invalid") {
    return fail("Hours must be a number, or left blank if the programme hasn't told you.");
  }

  const craftClassificationId = text(formData, "craftClassificationId") || null;
  const unionLocalId = text(formData, "unionLocalId") || null;

  await prisma.apprenticeshipEnrollment.create({
    data: {
      companyId: company.id,
      apprenticeUserId,
      sponsorName,
      programNumber: text(formData, "programNumber") || null,
      craftClassificationId,
      unionLocalId,
      enrolledOn,
      requiredOjtHoursPerPeriod: requiredOjt === null ? null : String(requiredOjt),
      requiredClassroomHoursPerPeriod:
        requiredClassroom === null ? null : String(requiredClassroom),
      note: text(formData, "note") || null,
    },
  });

  revalidatePath("/union-compliance");
  return ok;
}

export async function updateApprenticeshipEnrollment(
  enrollmentId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  const existing = await prisma.apprenticeshipEnrollment.findFirst({
    where: { id: enrollmentId, companyId: company.id },
  });
  if (existing === null) return fail("That enrolment isn't on this company.");

  const completedOn = date(formData, "completedOn");
  const cancelledOn = date(formData, "cancelledOn");

  // Refused rather than resolved by precedence. An indenture that both
  // completed and was cancelled is a data-entry error, and quietly picking
  // one would bury it on a record somebody may have to defend.
  if (completedOn !== null && cancelledOn !== null) {
    return fail("An indenture is either completed or cancelled, not both. Clear one of the dates.");
  }

  const requiredOjt = hours(formData, "requiredOjtHoursPerPeriod");
  const requiredClassroom = hours(formData, "requiredClassroomHoursPerPeriod");
  if (requiredOjt === "invalid" || requiredClassroom === "invalid") {
    return fail("Hours must be a number, or left blank if the programme hasn't told you.");
  }

  const sponsorName = text(formData, "sponsorName");
  if (!sponsorName) return fail("Name the sponsor.");

  await prisma.apprenticeshipEnrollment.update({
    where: { id: enrollmentId },
    data: {
      sponsorName,
      programNumber: text(formData, "programNumber") || null,
      completedOn,
      cancelledOn,
      requiredOjtHoursPerPeriod: requiredOjt === null ? null : String(requiredOjt),
      requiredClassroomHoursPerPeriod:
        requiredClassroom === null ? null : String(requiredClassroom),
      note: text(formData, "note") || null,
    },
  });

  revalidatePath("/union-compliance");
  return ok;
}

export async function deleteApprenticeshipEnrollment(enrollmentId: string): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  const existing = await prisma.apprenticeshipEnrollment.findFirst({
    where: { id: enrollmentId, companyId: company.id },
  });
  if (existing === null) return fail("That enrolment isn't on this company.");

  // Period records go with it (ON DELETE CASCADE). No TimeEntry is touched:
  // the hours belong to the timesheet, not to the indenture, and removing a
  // registration must never remove a record of work done.
  await prisma.apprenticeshipEnrollment.delete({ where: { id: enrollmentId } });

  revalidatePath("/union-compliance");
  return ok;
}

export async function recordApprenticeshipPeriod(
  enrollmentId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  const existing = await prisma.apprenticeshipEnrollment.findFirst({
    where: { id: enrollmentId, companyId: company.id },
  });
  if (existing === null) return fail("That enrolment isn't on this company.");

  const periodNumber = Number(text(formData, "periodNumber"));
  if (!Number.isInteger(periodNumber) || periodNumber < 1) {
    return fail("Period number must be a whole number, 1 or above.");
  }

  const classroomHours = hours(formData, "classroomHours");
  if (classroomHours === "invalid") {
    return fail("Classroom hours must be a number, or left blank if nobody has recorded them.");
  }

  const signedOffOn = date(formData, "signedOffOn");

  try {
    await prisma.apprenticeshipPeriodRecord.create({
      data: {
        enrollmentId,
        periodNumber,
        classroomHours: classroomHours === null ? null : String(classroomHours),
        signedOffOn,
        signedOffBy: text(formData, "signedOffBy") || null,
        note: text(formData, "note") || null,
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return fail(`Period ${periodNumber} is already recorded on this indenture. Edit that one instead.`);
    }
    throw err;
  }

  revalidatePath("/union-compliance");
  return ok;
}

export async function updateApprenticeshipPeriod(
  periodId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  const existing = await prisma.apprenticeshipPeriodRecord.findFirst({
    where: { id: periodId, enrollment: { companyId: company.id } },
  });
  if (existing === null) return fail("That period isn't on this company.");

  const classroomHours = hours(formData, "classroomHours");
  if (classroomHours === "invalid") {
    return fail("Classroom hours must be a number, or left blank if nobody has recorded them.");
  }

  await prisma.apprenticeshipPeriodRecord.update({
    where: { id: periodId },
    data: {
      classroomHours: classroomHours === null ? null : String(classroomHours),
      signedOffOn: date(formData, "signedOffOn"),
      signedOffBy: text(formData, "signedOffBy") || null,
      note: text(formData, "note") || null,
    },
  });

  revalidatePath("/union-compliance");
  return ok;
}

export async function deleteApprenticeshipPeriod(periodId: string): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  const existing = await prisma.apprenticeshipPeriodRecord.findFirst({
    where: { id: periodId, enrollment: { companyId: company.id } },
  });
  if (existing === null) return fail("That period isn't on this company.");

  await prisma.apprenticeshipPeriodRecord.delete({ where: { id: periodId } });

  revalidatePath("/union-compliance");
  return ok;
}
