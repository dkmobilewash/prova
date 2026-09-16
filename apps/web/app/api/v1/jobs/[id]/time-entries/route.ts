import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { prisma, TimeEntryPayType } from "@prova/db";

export const dynamic = "force-dynamic";

const PAY_TYPES = ["STRAIGHT", "OVERTIME", "DOUBLE_TIME", "SHIFT_DIFFERENTIAL"];

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function toJson(e: {
  id: string;
  date: Date;
  hours: unknown;
  payType: string;
  note: string | null;
  employeeUser: { name: string | null; email: string };
}) {
  return {
    id: e.id,
    date: e.date.toISOString().slice(0, 10),
    hours: String(e.hours),
    payType: e.payType,
    note: e.note,
    employeeName: e.employeeUser.name ?? e.employeeUser.email,
  };
}

/** A positive number of hours, at most two decimal places, no more than a
 * day. Returned as the decimal STRING Prisma wants for a Decimal column. */
function parseHours(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0 || n > 24) return null;
  return text;
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

  const entries = await prisma.timeEntry.findMany({
    where: { jobId: id },
    orderBy: { date: "desc" },
    select: {
      id: true,
      date: true,
      hours: true,
      payType: true,
      note: true,
      employeeUser: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json(entries.map(toJson));
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

  const dateRaw = String(input.date ?? "").trim();
  if (!dateRaw) return jsonError("Date is required", 400);
  const date = new Date(`${dateRaw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return jsonError("Date is not valid", 400);

  const hours = parseHours(input.hours);
  if (hours === null) return jsonError("Hours must be a positive number, up to two decimals", 400);

  const payTypeRaw = String(input.payType ?? "STRAIGHT");
  const payType = (PAY_TYPES.includes(payTypeRaw) ? payTypeRaw : "STRAIGHT") as TimeEntryPayType;

  const entry = await prisma.timeEntry.create({
    data: {
      jobId: job.id,
      employeeUserId: context.id,
      date,
      hours,
      payType,
      note: String(input.note ?? "").trim() || null,
    },
    select: {
      id: true,
      date: true,
      hours: true,
      payType: true,
      note: true,
      employeeUser: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json(toJson(entry), { status: 201 });
}
