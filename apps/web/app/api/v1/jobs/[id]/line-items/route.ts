import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { prisma } from "@prova/db";

export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** A job's cost codes (SOV line items, deleted ones excluded), for the
 * phone's cost-code picker. Identified by `description` — there is no
 * "number" column on a line item. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);

  const { id } = await params;
  const job = await prisma.job.findUnique({ where: { id }, select: { id: true, companyId: true } });
  if (!job || job.companyId !== context.companyId) return jsonError("Job not found", 400);

  const items = await prisma.jobLineItem.findMany({
    where: { jobId: id, isDeleted: false },
    orderBy: { sortOrder: "asc" },
    select: { id: true, description: true },
  });

  return NextResponse.json(items);
}
