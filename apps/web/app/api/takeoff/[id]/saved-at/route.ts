import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/authz";
import { requireJobGivenContext } from "@/lib/jobs/job-access";
import { takeoffSavedSignature } from "@/lib/takeoff/workspaceLoad";

/**
 * ── WHEN THIS JOB'S TAKEOFF WAS LAST WRITTEN ──
 *
 * One timestamp, so a workspace that has been sitting open can notice that
 * another tab has saved since and say so. The later save already wins — every
 * write is a server action against the same rows — and what was missing is
 * that the other tab goes on showing numbers nobody is looking at any more.
 *
 * A timestamp and nothing else, deliberately. The question is "is what I am
 * looking at still current", and answering it with the takeoff itself would
 * make a tab that is merely OPEN re-fetch a plan set on every focus.
 *
 * Authenticated like every other route under `/api` that reads a job: the
 * capability first, then the job within the caller's own company, so an id
 * from another company is a 404 rather than a date.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { context, allowed } = await requireCapability("VIEW_JOB_COSTS");
  if (!allowed) return NextResponse.json({ error: "not allowed" }, { status: 403 });
  const { company, job } = await requireJobGivenContext(id, context);

  return NextResponse.json(
    { savedAt: await takeoffSavedSignature(company.id, job.id) },
    { headers: { "cache-control": "no-store" } },
  );
}
