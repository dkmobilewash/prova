import { prisma } from "@prova/db";
import { documentUrlProblem } from "@/lib/document-uploads";

/**
 * THE PLAN SET'S BYTES, fetched server-side and proved to belong to the caller's
 * company.
 *
 * NOT THROUGH `/api/takeoff/plan/[planId]`, which is the obvious-looking seam and
 * the wrong one: that route authenticates with `requireCompanyContext`, and the
 * cron that advances an abandoned run has no session and never will. So the tenancy
 * check is the `findFirst` below — the same check that route makes, against the same
 * two columns.
 *
 * THE URL IS RE-VALIDATED ON THE WAY OUT, not trusted because it came out of our own
 * database. `uploadComplianceDocument` and `readBidQuoteDocument` both do this and
 * for the same reason: read the other way round, this is a server-side request to an
 * address a caller once chose. `documentUrlProblem` checks both halves — our own
 * store, and this job's own path prefix.
 *
 * RETURNS A SENTENCE, NEVER THROWS. Both callers put the result on a screen: one in
 * a stage's failure list, one as an action's refusal.
 */
export type PlanBytes = { ok: true; bytes: Buffer } | { ok: false; error: string };

export async function readPlanBytes(planId: string, companyId: string): Promise<PlanBytes> {
  const plan = await prisma.takeoffPlan.findFirst({
    where: { id: planId, companyId },
    select: { fileUrl: true, jobId: true },
  });
  if (!plan) return { ok: false, error: "That plan set is no longer on file, so nothing was read." };

  const problem = documentUrlProblem(plan.fileUrl, "plan-takeoff", plan.jobId, process.env);
  if (problem) return { ok: false, error: problem };

  try {
    const upstream = await fetch(plan.fileUrl);
    if (!upstream.ok) {
      return { ok: false, error: "The plan file couldn't be fetched just now. Try again in a moment." };
    }
    return { ok: true, bytes: Buffer.from(await upstream.arrayBuffer()) };
  } catch (err) {
    console.error("[plan-ingest] the plan file could not be fetched", { planId, err });
    return { ok: false, error: "The plan file couldn't be fetched just now. Try again in a moment." };
  }
}
