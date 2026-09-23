import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@prova/db";
import { listDrawingsForJob } from "@/lib/drawings-core";

/**
 * The job's drawing sets, for the phone.
 *
 * READ ONLY, and that is a decision rather than a first step: drawings
 * are recorded off a transmittal at a desk, with a file to attach and a
 * revision label to copy off a title block. What site needs is the
 * answer to "is what I am holding still current", which is this.
 *
 * `MANAGE_JOBS` to match the web route (`/drawings` in ROUTE_CAPABILITY)
 * — the same records, so the same gate. The FIELD job function holds it,
 * which is the point: a foreman is exactly who this is for.
 */
export const dynamic = "force-dynamic";

const JOBS_ONLY =
  "Job records aren't part of your job function. The account owner sets who sees what, on the Team page.";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);
  if (!can(context, "MANAGE_JOBS")) return jsonError(JOBS_ONLY, 403);

  const { id } = await params;
  const job = await prisma.job.findUnique({ where: { id }, select: { id: true, companyId: true } });
  if (!job || job.companyId !== context.companyId) return jsonError("Job not found", 400);

  return NextResponse.json(await listDrawingsForJob(job.id));
}
