import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { prisma } from "@prova/db";

/**
 * GET /api/v1/jobs — the mobile job list.
 *
 * Same edges as the field-reports routes: no session is a 401 (a phone has
 * no /sign-in page to redirect to). The list is scoped to the caller's
 * company by requireApiContext, exactly as the web app scopes every read —
 * a phone never sees another company's jobs.
 */

export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET(_request: NextRequest) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);

  const jobs = await prisma.job.findMany({
    where: { companyId: context.company.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      startDate: true,
      endDate: true,
    },
  });

  return NextResponse.json(
    jobs.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      startDate: job.startDate ? job.startDate.toISOString() : null,
      endDate: job.endDate ? job.endDate.toISOString() : null,
    })),
  );
}
