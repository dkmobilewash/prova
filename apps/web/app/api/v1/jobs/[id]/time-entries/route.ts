import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { prisma, TimeEntryPayType } from "@prova/db";
import { crewMemberName } from "@/lib/worker-name";

export const dynamic = "force-dynamic";

const PAY_TYPES = ["STRAIGHT", "OVERTIME", "DOUBLE_TIME", "SHIFT_DIFFERENTIAL"];

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

const entrySelect = {
  id: true,
  date: true,
  hours: true,
  payType: true,
  note: true,
  employeeUser: { select: { name: true, email: true } },
  crewMember: { select: { legalFirstName: true, legalMiddleName: true, legalLastName: true } },
  lineItem: { select: { description: true } },
  craftClassification: { select: { name: true } },
} as const;

function toJson(e: {
  id: string;
  date: Date;
  hours: unknown;
  payType: string;
  note: string | null;
  employeeUser: { name: string | null; email: string } | null;
  crewMember: { legalFirstName: string; legalMiddleName: string | null; legalLastName: string } | null;
  lineItem: { description: string } | null;
  craftClassification: { name: string } | null;
}) {
  return {
    id: e.id,
    date: e.date.toISOString().slice(0, 10),
    hours: String(e.hours),
    payType: e.payType,
    note: e.note,
    // The worker the hours are for: an employee (User) or a crew member.
    employeeName: e.employeeUser
      ? e.employeeUser.name ?? e.employeeUser.email
      : e.crewMember
        ? crewMemberName(e.crewMember).label
        : "Name not recorded",
    lineItemDescription: e.lineItem?.description ?? null,
    craftLabel: e.craftClassification?.name ?? null,
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

/** An ISO timestamp, or null when absent — clock capture evidence, present
 * only on entries that were clocked. The server stores it but never
 * recomputes `hours` from it: hours is authoritative and correctable. */
function parseOptionalTimestamp(
  raw: unknown,
  label: string,
): { ok: true; value: Date | null } | { ok: false; error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, value: null };
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return { ok: false, error: `${label} must be a valid timestamp` };
  return { ok: true, value: d };
}

/** Whole, non-negative break minutes, or null when absent. */
function parseOptionalBreakMinutes(
  raw: unknown,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, value: null };
  if (!/^\d+$/.test(text)) {
    return { ok: false, error: "clockBreakMinutes must be a whole number of minutes, or omitted" };
  }
  return { ok: true, value: Number(text) };
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
    select: entrySelect,
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

  // Who the hours are for — the caller, or a crew member they name. Exactly
  // one (the XOR constraint on TimeEntry enforces it). A crew entry leaves
  // employeeUserId null.
  let employeeUserId: string | null = context.id;
  let crewMemberId: string | null = null;
  const crewMemberIdRaw = String(input.crewMemberId ?? "").trim();
  if (crewMemberIdRaw) {
    const crewMember = await prisma.crewMember.findUnique({ where: { id: crewMemberIdRaw } });
    if (!crewMember || crewMember.companyId !== context.companyId) return jsonError("Crew member not found", 400);
    if (crewMember.archivedAt) return jsonError("That crew member is archived", 400);
    employeeUserId = null;
    crewMemberId = crewMember.id;
  }

  // Cost code (SOV line) — attribution only, and only on this job.
  let lineItemId: string | null = null;
  const lineItemIdRaw = String(input.lineItemId ?? "").trim();
  if (lineItemIdRaw) {
    const lineItem = await prisma.jobLineItem.findUnique({ where: { id: lineItemIdRaw } });
    if (!lineItem || lineItem.jobId !== job.id || lineItem.isDeleted) return jsonError("Cost code not found", 400);
    lineItemId = lineItem.id;
  }

  // Craft — must be this company's.
  let craftClassificationId: string | null = null;
  const craftClassificationIdRaw = String(input.craftClassificationId ?? "").trim();
  if (craftClassificationIdRaw) {
    const craft = await prisma.craftClassification.findUnique({ where: { id: craftClassificationIdRaw } });
    if (!craft || craft.companyId !== context.companyId) return jsonError("Craft not found", 400);
    craftClassificationId = craft.id;
  }

  // Clock capture evidence — optional, and only ever from the phone's clock
  // flow. Stored as-is; never used to recompute `hours`.
  const clockStartedAt = parseOptionalTimestamp(input.clockStartedAt, "clockStartedAt");
  if (!clockStartedAt.ok) return jsonError(clockStartedAt.error, 400);
  const clockEndedAt = parseOptionalTimestamp(input.clockEndedAt, "clockEndedAt");
  if (!clockEndedAt.ok) return jsonError(clockEndedAt.error, 400);
  const clockBreakMinutes = parseOptionalBreakMinutes(input.clockBreakMinutes);
  if (!clockBreakMinutes.ok) return jsonError(clockBreakMinutes.error, 400);

  // Idempotent create: a retried offline POST replays instead of duplicating.
  const clientOperationId = String(input.clientOperationId ?? "").trim() || undefined;
  if (clientOperationId) {
    const existing = await prisma.timeEntry.findUnique({
      where: { jobId_clientOperationId: { jobId: job.id, clientOperationId } },
      select: entrySelect,
    });
    if (existing) return NextResponse.json(toJson(existing), { status: 200 });
  }

  const entry = await prisma.timeEntry.create({
    data: {
      jobId: job.id,
      employeeUserId,
      crewMemberId,
      lineItemId,
      craftClassificationId,
      date,
      hours,
      payType,
      clockStartedAt: clockStartedAt.value,
      clockEndedAt: clockEndedAt.value,
      clockBreakMinutes: clockBreakMinutes.value,
      note: String(input.note ?? "").trim() || null,
      clientOperationId,
    },
    select: entrySelect,
  });

  return NextResponse.json(toJson(entry), { status: 201 });
}
