import { prisma } from "@prova/db";
import { documentUrlProblem, planTooLargeProblem } from "@/lib/document-uploads";
import { isLocalPlanUrl, readLocalPlan } from "@/lib/plan-ingest/localPlanFile";

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
  return readJobFileBytes(plan.fileUrl, plan.jobId, planId);
}

/**
 * The same read for any file stored under a job's plan-set path — a plan set, or a
 * spec book (`SpecBook`), which is uploaded the same way and held to the same rules,
 * `local:` included. The CALLER proves the row is the company's; this proves the URL
 * is ours and this job's.
 */
export async function readJobFileBytes(fileUrl: string, jobId: string, logId: string): Promise<PlanBytes> {
  const plan = { fileUrl, jobId };
  const planId = logId;

  // ── A PLAN HELD ON THIS MACHINE, FOR CONFIDENTIAL DRAWINGS ──
  //
  // Checked BEFORE the blob guard and never instead of it: a `local:` URL is
  // a different scheme that the blob path never sees, and everything else
  // still goes through `documentUrlProblem` exactly as before. See
  // `localPlanFile.ts` for the gate and why it refuses in production.
  if (isLocalPlanUrl(plan.fileUrl)) {
    const local = await readLocalPlan(plan.fileUrl, process.env);
    if (!local.ok) return { ok: false, error: local.error };
    const tooLarge = planTooLargeProblem(local.bytes.length);
    return tooLarge ? { ok: false, error: tooLarge } : { ok: true, bytes: local.bytes };
  }

  const problem = documentUrlProblem(plan.fileUrl, "plan-takeoff", plan.jobId, process.env);
  if (problem) return { ok: false, error: problem };

  try {
    const upstream = await fetch(plan.fileUrl);
    if (!upstream.ok) {
      return { ok: false, error: "The plan file couldn't be fetched just now. Try again in a moment." };
    }
    // Refused from the header, BEFORE the body is read: downloading a set too big
    // to hold is the failure this exists to prevent (`planProcessMaxBytes`).
    const tooLarge = planTooLargeProblem(Number(upstream.headers.get("content-length") ?? 0));
    if (tooLarge) {
      await upstream.body?.cancel().catch(() => {});
      return { ok: false, error: tooLarge };
    }
    return { ok: true, bytes: Buffer.from(await upstream.arrayBuffer()) };
  } catch (err) {
    console.error("[plan-ingest] the plan file could not be fetched", { planId, err });
    return { ok: false, error: "The plan file couldn't be fetched just now. Try again in a moment." };
  }
}
