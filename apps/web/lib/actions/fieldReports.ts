"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { Prisma, prisma } from "@prova/db";

/** Reports are keyed by date with no time component. Everything is written
 * at UTC midnight so the @@unique([jobId, reportDate]) constraint means
 * "one per calendar day" rather than "one per instant". */
function reportDateFromForm(formData: FormData): Date {
  const raw = String(formData.get("reportDate") ?? "").trim();
  if (!raw) {
    throw new Error("Date is required");
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Date is not valid");
  }
  return date;
}

function fieldsFromForm(formData: FormData) {
  const workPerformed = String(formData.get("workPerformed") ?? "").trim();
  if (!workPerformed) {
    throw new Error("Work performed is required");
  }
  const crewPresent = String(formData.get("crewPresent") ?? "").trim();
  const weather = String(formData.get("weather") ?? "").trim();
  const delays = String(formData.get("delays") ?? "").trim();
  return {
    workPerformed,
    crewPresent: crewPresent || null,
    weather: weather || null,
    delays: delays || null,
  };
}

export async function createDailyFieldReport(jobId: string, formData: FormData) {
  const { company, ...user } = await requireCompanyContext();

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.companyId !== company.id) {
    throw new Error("Job not found");
  }

  try {
    await prisma.dailyFieldReport.create({
      data: {
        companyId: company.id,
        jobId,
        reportDate: reportDateFromForm(formData),
        filedByUserId: user.id,
        ...fieldsFromForm(formData),
      },
    });
  } catch (error) {
    // P2002 = the one-per-job-per-day constraint. Say what actually
    // happened rather than surfacing a Prisma error code to a foreman.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("A report already exists for that date — edit it instead of adding a second one");
    }
    throw error;
  }

  revalidatePath(`/jobs/${jobId}`);
}

export async function updateDailyFieldReport(reportId: string, formData: FormData) {
  const { company } = await requireCompanyContext();

  const report = await prisma.dailyFieldReport.findUnique({ where: { id: reportId } });
  if (!report || report.companyId !== company.id) {
    throw new Error("Report not found");
  }

  await prisma.dailyFieldReport.update({
    where: { id: reportId },
    data: fieldsFromForm(formData),
  });

  revalidatePath(`/jobs/${report.jobId}`);
}

/** The date is deliberately not editable: it's the identity of the record.
 * Filed against the wrong day, delete it and file the right one. */
export async function deleteDailyFieldReport(reportId: string) {
  const { company } = await requireCompanyContext();

  const report = await prisma.dailyFieldReport.findUnique({ where: { id: reportId } });
  if (!report || report.companyId !== company.id) {
    throw new Error("Report not found");
  }

  await prisma.dailyFieldReport.delete({ where: { id: reportId } });

  revalidatePath(`/jobs/${report.jobId}`);
}
