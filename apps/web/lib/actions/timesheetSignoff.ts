"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { dayText } from "@/lib/timesheet-signoff";
import { actionFail as fail, actionOk as ok, runAction, type ActionResult } from "./shared";

/**
 * The office's half of timesheet sign-off: approve a day the foreman signed,
 * or reopen it so its hours can be fixed. The foreman's half — the signature
 * — is on the phone (POST /api/v1/jobs/[id]/signoffs).
 *
 * MANAGE_COMPLIANCE, because an approved day is what certified payroll is
 * built from and that capability is the one that already owns certified
 * payroll (both payroll pages demand it). A field member can sign; approving
 * their own signature is the office's call.
 *
 * Both writes are CONDITIONAL updates — `updateMany` matching the state the
 * button was drawn in — so two people pressing at once cannot approve a day
 * that was reopened a second earlier. A zero count is that race, and says so.
 */

const PAYROLL_ONLY =
  "Approving and reopening timesheets isn't part of your job function. The account owner sets who sees what, on the Team page.";

function revalidateSignoffPages(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/certified-payroll`);
  revalidatePath(`/jobs/${jobId}/certified-payroll/wh-347`);
}

export async function approveTimesheetDay(signoffId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(PAYROLL_ONLY);
    const signoff = await prisma.timesheetSignoff.findUnique({ where: { id: signoffId } });
    if (!signoff || signoff.companyId !== context.company.id) return fail("That sign-off is gone. Reload the page.");
    if (signoff.reopenedAt) return fail(`${dayText(signoff.date)} was reopened, so there is nothing to approve until it is signed again.`);
    if (signoff.approvedAt) return fail(`${dayText(signoff.date)} is already approved.`);

    const { count } = await prisma.timesheetSignoff.updateMany({
      where: { id: signoff.id, approvedAt: null, reopenedAt: null },
      data: { approvedAt: new Date(), approvedByUserId: context.id },
    });
    if (count === 0) return fail("Somebody changed this day a moment ago. Reload the page.");

    revalidateSignoffPages(signoff.jobId);
    return ok;
  });
}

export async function reopenTimesheetDay(signoffId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(PAYROLL_ONLY);
    const signoff = await prisma.timesheetSignoff.findUnique({ where: { id: signoffId } });
    if (!signoff || signoff.companyId !== context.company.id) return fail("That sign-off is gone. Reload the page.");
    if (signoff.reopenedAt) return fail(`${dayText(signoff.date)} is already open.`);

    // Why it was reopened stays on the record, because a reopened approval
    // is the moment payroll changes after somebody signed for it.
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reason) return fail("Say why it is being reopened — it stays on the record.");
    if (reason.length > 500) return fail("Keep the reason under 500 characters.");

    const { count } = await prisma.timesheetSignoff.updateMany({
      where: { id: signoff.id, reopenedAt: null },
      data: { reopenedAt: new Date(), reopenedByUserId: context.id, reopenReason: reason },
    });
    if (count === 0) return fail("Somebody changed this day a moment ago. Reload the page.");

    revalidateSignoffPages(signoff.jobId);
    return ok;
  });
}
