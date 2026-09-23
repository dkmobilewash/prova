import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@prova/db";
import { DelayInputError, isDelayDayLockError, listDelaysForJob, parseDelay, toDelayRow } from "@/lib/delays-core";
import { FIELD_ONLY } from "@/lib/field-reports-core";
import { isUniqueViolation, liveSignoff, lockedDayMessage } from "@/lib/timesheet-signoff";

export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

async function jobFor(id: string, companyId: string) {
  const job = await prisma.job.findUnique({ where: { id }, select: { id: true, companyId: true } });
  return job && job.companyId === companyId ? job : null;
}

/** The job's delays, newest day first. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);
  // READS are guarded too, and they were not. Every one of these routes
  // asserted the capability on its POST and left its GET open, so a
  // bearer token belonging to somebody whose job function excludes field
  // records could still read a job's — which makes the phone's role shell
  // cosmetic. Found by the per-handler census in lib/mobile-api-guards.test.ts,
  // after the same census, written per FILE, reported all seven as guarded.
  if (!can(context, "MANAGE_FIELD")) return jsonError(FIELD_ONLY, 403);
  const job = await jobFor((await params).id, context.companyId);
  if (!job) return jsonError("Job not found", 400);
  return NextResponse.json(await listDelaysForJob(job.id));
}

/**
 * Logs one delay from the phone. Idempotent on clientOperationId, so a
 * retried offline POST replays. A signed day answers 409, which the phone's
 * queue treats as final and shows as "wasn't saved" rather than retrying.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);
  if (!can(context, "MANAGE_FIELD")) return jsonError(FIELD_ONLY, 403);
  const job = await jobFor((await params).id, context.companyId);
  if (!job) return jsonError("Job not found", 400);

  let input: Record<string, unknown>;
  try {
    input = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const clientOperationId = String(input.clientOperationId ?? "").trim() || undefined;
  if (clientOperationId) {
    const existing = await prisma.delayEvent.findUnique({
      where: { companyId_clientOperationId: { companyId: context.companyId, clientOperationId } },
    });
    if (existing) return NextResponse.json(toDelayRow(existing), { status: 200 });
  }

  let fields;
  try {
    fields = parseDelay(input);
  } catch (error) {
    if (error instanceof DelayInputError) return jsonError(error.message, 400);
    throw error;
  }

  const live = await liveSignoff(job.id, fields.date);
  if (live) return jsonError(lockedDayMessage(fields.date, live), 409);

  try {
    const created = await prisma.delayEvent.create({
      data: { ...fields, companyId: context.companyId, jobId: job.id, loggedByUserId: context.id, clientOperationId },
    });
    return NextResponse.json(toDelayRow(created), { status: 201 });
  } catch (error) {
    if (isDelayDayLockError(error)) return jsonError("That day was just signed, so its delays are locked.", 409);
    if (isUniqueViolation(error) && clientOperationId) {
      const existing = await prisma.delayEvent.findUnique({
        where: { companyId_clientOperationId: { companyId: context.companyId, clientOperationId } },
      });
      if (existing) return NextResponse.json(toDelayRow(existing), { status: 200 });
    }
    throw error;
  }
}
