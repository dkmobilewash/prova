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

function toJson(o: {
  id: string;
  number: number;
  description: string;
  vendorReference: string | null;
  notes: string | null;
  orderedOn: Date;
  promisedFor: Date | null;
  vendor: { name: string };
}) {
  return {
    id: o.id,
    number: o.number,
    description: o.description,
    vendorReference: o.vendorReference,
    notes: o.notes,
    orderedOn: o.orderedOn.toISOString().slice(0, 10),
    promisedFor: o.promisedFor ? o.promisedFor.toISOString().slice(0, 10) : null,
    vendorName: o.vendor.name,
  };
}

const orderSelect = {
  id: true,
  number: true,
  description: true,
  vendorReference: true,
  notes: true,
  orderedOn: true,
  promisedFor: true,
  vendor: { select: { name: true } },
} as const;

function parseDate(raw: unknown, label: string): Date | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const d = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
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

  const orders = await prisma.materialOrder.findMany({
    where: { jobId: id },
    orderBy: { number: "desc" },
    select: orderSelect,
  });

  return NextResponse.json(orders.map(toJson));
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
  if (!description) return jsonError("What was ordered is required", 400);

  const vendorId = String(input.vendorId ?? "").trim();
  if (!vendorId) return jsonError("Vendor is required", 400);
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || vendor.companyId !== context.companyId) return jsonError("Vendor not found", 400);

  const orderedOn = parseDate(input.orderedOn, "Date ordered");
  if (orderedOn === null) return jsonError("Date ordered is required", 400);

  const promisedFor = parseDate(input.promisedFor, "Promised for");
  if (promisedFor && promisedFor < orderedOn) {
    return jsonError("The promised date can't be before the order was placed", 400);
  }

  // Idempotent create: a retried offline POST replays instead of duplicating.
  const clientOperationId = String(input.clientOperationId ?? "").trim() || undefined;
  if (clientOperationId) {
    const existing = await prisma.materialOrder.findUnique({
      where: { companyId_clientOperationId: { companyId: context.companyId, clientOperationId } },
      select: orderSelect,
    });
    if (existing) return NextResponse.json(toJson(existing), { status: 200 });
  }

  const order = await prisma.$transaction(async (tx) => {
    const counter = await tx.materialOrderCounter.upsert({
      where: { jobId: job.id },
      create: { jobId: job.id, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
      select: { lastNumber: true },
    });

    return tx.materialOrder.create({
      data: {
        companyId: context.companyId,
        jobId: job.id,
        number: counter.lastNumber,
        vendorId,
        description,
        vendorReference: String(input.vendorReference ?? "").trim() || null,
        notes: String(input.notes ?? "").trim() || null,
        orderedOn,
        promisedFor,
        orderedByUserId: context.id,
        clientOperationId,
      },
      select: orderSelect,
    });
  });

  return NextResponse.json(toJson(order), { status: 201 });
}
