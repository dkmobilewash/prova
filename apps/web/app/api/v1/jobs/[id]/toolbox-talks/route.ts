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

function toJson(t: {
  id: string;
  jobId: string | null;
  heldOn: Date;
  topic: string;
  presenter: string | null;
  attendees: string | null;
  notes: string | null;
}) {
  return {
    id: t.id,
    jobId: t.jobId,
    heldOn: t.heldOn.toISOString().slice(0, 10),
    topic: t.topic,
    presenter: t.presenter,
    attendees: t.attendees,
    notes: t.notes,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);
  // READS are guarded too, and they were not. Every one of these routes
  // asserted the capability on its POST and left its GET open, so a
  // bearer token belonging to somebody whose job function excludes field
  // records could still read a job's — which makes the phone's role shell
  // cosmetic. Found by the per-handler census in lib/mobile-api-guards.test.ts,
  // after the same census, written per FILE, reported all seven as guarded.
  if (!can(context, "MANAGE_FIELD")) return jsonError(FIELD_ONLY, 403);

  const { id } = await params;
  const job = await prisma.job.findUnique({ where: { id }, select: { id: true, companyId: true } });
  if (!job || job.companyId !== context.companyId) return jsonError("Job not found", 400);

  const talks = await prisma.toolboxTalk.findMany({
    where: { jobId: id },
    orderBy: { heldOn: "desc" },
  });

  return NextResponse.json(talks.map(toJson));
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

  const topic = String(input.topic ?? "").trim();
  if (!topic) return jsonError("Topic is required", 400);

  const heldOnRaw = String(input.heldOn ?? "").trim();
  const heldOn = heldOnRaw ? new Date(`${heldOnRaw}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(heldOn.getTime())) return jsonError("Date is not valid", 400);

  // Idempotent create: a retried offline POST replays instead of duplicating.
  const clientOperationId = String(input.clientOperationId ?? "").trim() || undefined;
  if (clientOperationId) {
    const existing = await prisma.toolboxTalk.findUnique({
      where: { companyId_clientOperationId: { companyId: context.companyId, clientOperationId } },
    });
    if (existing) return NextResponse.json(toJson(existing), { status: 200 });
  }

  const talk = await prisma.toolboxTalk.create({
    data: {
      companyId: context.companyId,
      jobId: job.id,
      heldOn,
      topic,
      presenter: String(input.presenter ?? "").trim() || null,
      attendees: String(input.attendees ?? "").trim() || null,
      notes: String(input.notes ?? "").trim() || null,
      recordedByUserId: context.id,
      clientOperationId,
    },
  });

  return NextResponse.json(toJson(talk), { status: 201 });
}
