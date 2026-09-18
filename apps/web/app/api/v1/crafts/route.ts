import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { prisma } from "@prova/db";

export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** The company's craft classifications, for the phone's craft picker —
 * each with who works under it (WorkerCraft), so the phone can show a worker
 * only their own crafts without a second request. `mine` is the caller's
 * own ("Me" on the time screen); `crewMemberIds` covers the no-login crew. */
export async function GET(_request: NextRequest) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);

  const crafts = await prisma.craftClassification.findMany({
    where: { companyId: context.companyId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      tier: true,
      workerCrafts: { select: { userId: true, crewMemberId: true } },
    },
  });

  return NextResponse.json(
    crafts.map((c) => ({
      id: c.id,
      name: c.name,
      tier: c.tier,
      mine: c.workerCrafts.some((w) => w.userId === context.id),
      crewMemberIds: c.workerCrafts.flatMap((w) => (w.crewMemberId ? [w.crewMemberId] : [])),
    })),
  );
}
