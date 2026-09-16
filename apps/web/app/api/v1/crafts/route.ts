import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { prisma } from "@prova/db";

export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** The company's craft classifications, for the phone's craft picker. */
export async function GET(_request: NextRequest) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);

  const crafts = await prisma.craftClassification.findMany({
    where: { companyId: context.companyId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return NextResponse.json(crafts);
}
