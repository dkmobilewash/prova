import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { crewMemberName } from "@/lib/worker-name";

export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** The company's active crew members, for the phone's "who worked" picker.
 * Archived members are hidden — the field app offers only people who can
 * work today. */
export async function GET(_request: NextRequest) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);

  const crew = await prisma.crewMember.findMany({
    where: { companyId: context.companyId, archivedAt: null },
    orderBy: { legalLastName: "asc" },
    select: { id: true, legalFirstName: true, legalMiddleName: true, legalLastName: true },
  });

  return NextResponse.json(crew.map((c) => ({ id: c.id, name: crewMemberName(c).label })));
}
