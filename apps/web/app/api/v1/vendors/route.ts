import { NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { prisma } from "@prova/db";

export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET() {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);

  const vendors = await prisma.vendor.findMany({
    where: { companyId: context.companyId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return NextResponse.json(vendors);
}
