import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@prova/db";

export const dynamic = "force-dynamic";

const FIELD_ONLY =
  "Field records aren't part of your job function. The account owner sets who sees what, on the Team page.";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** The shape the phone reads.
 *
 * `isDone` and `completedAt` are gone from the row and from here with it.
 * The phone's punch screen reads `status`, and the only build that can
 * reach this deploy is one served from this branch. `readyAt`/`verifiedAt`
 * are where "when was it closed" now lives. */
function toJson(i: {
  id: string;
  description: string;
  status: string;
  readyAt: Date | null;
  verifiedAt: Date | null;
  area: string | null;
  dueOn: Date | null;
  assignedName: string | null;
  photoCount?: number;
}) {
  return {
    id: i.id,
    description: i.description,
    status: i.status,
    readyAt: i.readyAt ? i.readyAt.toISOString() : null,
    verifiedAt: i.verifiedAt ? i.verifiedAt.toISOString() : null,
    area: i.area,
    dueOn: i.dueOn ? i.dueOn.toISOString() : null,
    assignedName: i.assignedName,
    photoCount: i.photoCount ?? 0,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);

  const { id } = await params;
  const job = await prisma.job.findUnique({ where: { id }, select: { id: true, companyId: true } });
  if (!job || job.companyId !== context.companyId) return jsonError("Job not found", 400);

  const items = await prisma.punchListItem.findMany({
    where: { jobId: id },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { media: true } } },
  });

  return NextResponse.json(items.map((i) => toJson({ ...i, photoCount: i._count.media })));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);
  if (!can(context, "MANAGE_FIELD")) return jsonError(FIELD_ONLY, 403);

  const { id } = await params;
  const job = await prisma.job.findUnique({ where: { id }, select: { id: true, companyId: true } });
  if (!job || job.companyId !== context.companyId) return jsonError("Job not found", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const input = (body ?? {}) as Record<string, unknown>;

  const description = String(input.description ?? "").trim();
  if (!description) return jsonError("Description is required", 400);

  // Idempotent create: a retried offline POST replays instead of duplicating.
  const clientOperationId = String(input.clientOperationId ?? "").trim() || undefined;
  if (clientOperationId) {
    const existing = await prisma.punchListItem.findUnique({
      where: { companyId_clientOperationId: { companyId: context.companyId, clientOperationId } },
    });
    if (existing) return NextResponse.json(toJson(existing), { status: 200 });
  }

  // Where it is, typed on the phone standing in front of it. The phone
  // does not assign people or set due dates — those are a desk decision,
  // and a picker of every crew member is not a control for a 5-inch screen
  // in a stairwell.
  const area = String(input.area ?? "").trim() || null;

  const item = await prisma.punchListItem.create({
    data: {
      companyId: context.companyId,
      jobId: job.id,
      description,
      area,
      raisedByUserId: context.id,
      clientOperationId,
    },
  });

  return NextResponse.json(toJson(item), { status: 201 });
}
