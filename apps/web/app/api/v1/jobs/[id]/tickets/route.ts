import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { timeEntryWorkerName } from "@/lib/worker-name";

export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function parseDate(raw: unknown): Date | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const d = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toJson(t: {
  id: string;
  workDate: Date;
  workDescription: string;
  snapshot: unknown;
  signerName: string;
  signedAt: Date;
}) {
  return {
    id: t.id,
    workDate: t.workDate.toISOString().slice(0, 10),
    workDescription: t.workDescription,
    snapshot: t.snapshot,
    signerName: t.signerName,
    signedAt: t.signedAt.toISOString(),
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

  const tickets = await prisma.tmTicket.findMany({
    where: { jobId: id },
    orderBy: { workDate: "desc" },
  });

  return NextResponse.json(tickets.map(toJson));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);

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

  const workDate = parseDate(input.workDate);
  if (!workDate) return jsonError("A work date is required", 400);

  const workDescription = String(input.workDescription ?? "").trim();
  if (!workDescription) return jsonError("Describe the work", 400);

  const signerName = String(input.signerName ?? "").trim();
  if (!signerName) return jsonError("The client's name is required to sign", 400);

  // Idempotent create: a retried offline POST replays instead of duplicating.
  const clientOperationId = String(input.clientOperationId ?? "").trim() || undefined;
  if (clientOperationId) {
    const existing = await prisma.tmTicket.findUnique({
      where: { companyId_clientOperationId: { companyId: context.companyId, clientOperationId } },
    });
    if (existing) return NextResponse.json(toJson(existing), { status: 200 });
  }

  // Aggregate the day's labor + material entries into the snapshot. Frozen at
  // signing, so a later edit to the entries cannot change what was signed.
  const [labor, materials] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { jobId: job.id, date: workDate },
      orderBy: { createdAt: "asc" },
      select: {
        hours: true,
        payType: true,
        employeeUser: { select: { name: true, email: true } },
        crewMember: { select: { legalFirstName: true, legalMiddleName: true, legalLastName: true } },
        craftClassification: { select: { name: true } },
        lineItem: { select: { description: true } },
      },
    }),
    prisma.materialOrder.findMany({
      where: { jobId: job.id, orderedOn: workDate },
      orderBy: { createdAt: "asc" },
      select: { description: true, vendor: { select: { name: true } }, orderedOn: true },
    }),
  ]);

  const snapshot = {
    labor: labor.map((e) => ({
      workerName: timeEntryWorkerName(e).label,
      hours: String(e.hours),
      payType: e.payType,
      craftLabel: e.craftClassification?.name ?? null,
      lineItemDescription: e.lineItem?.description ?? null,
    })),
    materials: materials.map((m) => ({
      description: m.description,
      vendorName: m.vendor.name,
      orderedOn: m.orderedOn.toISOString().slice(0, 10),
    })),
  };

  const ticket = await prisma.tmTicket.create({
    data: {
      companyId: context.companyId,
      jobId: job.id,
      workDate,
      workDescription,
      snapshot,
      signerName,
      signedAt: new Date(),
      createdByUserId: context.id,
      clientOperationId,
    },
  });

  return NextResponse.json(toJson(ticket), { status: 201 });
}
