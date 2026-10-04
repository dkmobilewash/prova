"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";

import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { certifiedPayrollWeekStart } from "@/lib/certified-payroll-week";
import { wh347StatementFromForm } from "@/lib/wh347-statement";
import { actionFail, actionOk, type ActionResult } from "./shared";

/**
 * Recording WH-347 page 2 — the Statement of Compliance for one job-week.
 *
 * GATED ON MANAGE_COMPLIANCE, matching `requireCapability("MANAGE_COMPLIANCE")`
 * on the page this is submitted from and `issuePayrollNumber` beside it. The
 * Compliance TAB has no capability wall and `complianceFacts.ts` is
 * deliberately ungated to match it; this page does have one, so an ungated
 * action here would be a door around it.
 *
 * REFUSALS ARE RETURNED, NEVER THROWN. Production redacts a thrown Server
 * Action message to a digest, and every refusal here is a sentence about
 * something a person just typed. `ownerRefusal` is not used because this is a
 * capability question rather than an owner one — see `shared.ts` on the pair.
 *
 * AN UPSERT, not an issue-once insert. `Wh347PayrollNumber` next door is
 * write-once because a filing sequence that changes is not a sequence; a
 * statement is a draft a person edits until it is right, and nothing here
 * records that anybody signed it (see lib/wh347-statement.ts on why there is
 * no signature). So there is no history to protect and no counter to bump.
 */
export async function saveWh347Statement(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) {
    return actionFail(
      "Certified payroll isn't part of your job function. The account owner sets who sees what, on the Team page.",
    );
  }

  const jobId = String(formData.get("jobId") ?? "");
  const weekStartRaw = String(formData.get("weekStart") ?? "");
  const parsedWeek = new Date(`${weekStartRaw}T00:00:00.000Z`);
  if (!jobId || Number.isNaN(parsedWeek.getTime())) {
    return actionFail("That week couldn't be read. Reload the page and try again.");
  }
  // Normalised to the week's Sunday exactly as `issuePayrollNumber` does, so a
  // date one day out cannot create a second statement for the same week that
  // the page would then never read back.
  const weekStart = certifiedPayrollWeekStart(parsedWeek);

  // Tenancy. `Wh347Statement` has no `companyId` — it hangs off the job, like
  // `Wh347PayrollNumber` — so the job is where the boundary is checked.
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { companyId: true } });
  if (!job || job.companyId !== context.company.id) {
    return actionFail("That job isn't on this account.");
  }

  const parsed = wh347StatementFromForm(formData);
  if (!parsed.ok) return actionFail(parsed.error);
  const { signatoryName, signatoryTitle, fringeMode, remarks, exceptions } = parsed.value;

  // Section 4(c) rows are REPLACED, not merged, and that is the whole reason
  // this is a transaction: the form posts the complete set every time, so a
  // delete-then-create is the only write that can remove a row. Doing it in
  // two statements outside a transaction would leave a window where the
  // statement has no exceptions at all — and a reader in that window would
  // see a filing asserting no exceptions, which is the one wrong answer that
  // looks like a real one.
  //
  // The database refuses a blank explanation (`explanation String`, required),
  // so a row the builder would report as blocking cannot be stored at all.
  // Filtered here rather than relying on the constraint to throw: a refusal a
  // person can read beats a redacted digest.
  const storable = exceptions.filter((row) => row.craftName && row.explanation);

  await prisma.$transaction(async (tx) => {
    const statement = await tx.wh347Statement.upsert({
      where: { jobId_weekStart: { jobId, weekStart } },
      create: { jobId, weekStart, signatoryName, signatoryTitle, fringeMode, remarks },
      update: { signatoryName, signatoryTitle, fringeMode, remarks },
      select: { id: true },
    });
    await tx.wh347StatementException.deleteMany({ where: { statementId: statement.id } });
    if (storable.length > 0) {
      await tx.wh347StatementException.createMany({
        data: storable.map((row) => ({
          statementId: statement.id,
          craftName: row.craftName,
          explanation: row.explanation,
        })),
      });
    }
  });

  // The page reads `searchParams.weekStart`, so a path-level revalidate covers
  // every week of this job — which is what `issuePayrollNumber` already does.
  revalidatePath(`/jobs/${jobId}/certified-payroll/wh-347`);
  revalidatePath(`/jobs/${jobId}/certified-payroll`);
  return actionOk;
}
