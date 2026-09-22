import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma, type Prisma } from "@prova/db";
import { summarizeManpower } from "@/lib/manpower";
import { toDelayRow } from "@/lib/delays-core";
import {
  dayText,
  isUniqueViolation,
  isValidSignaturePath,
  liveSignoff,
  lockedDayMessage,
  parseDay,
  signoffState,
} from "@/lib/timesheet-signoff";

export const dynamic = "force-dynamic";

const FIELD_ONLY =
  "Signing field time isn't part of your job function. The account owner sets who sees what, on the Team page.";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

type Signoff = {
  id: string;
  date: Date;
  signerName: string;
  signedAt: Date;
  entryCount: number;
  totalHours: unknown;
  approvedAt: Date | null;
};

function toJson(s: Signoff) {
  return {
    id: s.id,
    date: dayText(s.date),
    state: signoffState(s),
    signerName: s.signerName,
    signedAt: s.signedAt.toISOString(),
    entryCount: s.entryCount,
    totalHours: String(s.totalHours),
    approvedAt: s.approvedAt?.toISOString() ?? null,
  };
}

const select = {
  id: true,
  date: true,
  signerName: true,
  signedAt: true,
  entryCount: true,
  totalHours: true,
  approvedAt: true,
} as const;

/** The job's live sign-offs — the days that are signed (and possibly
 * approved) and therefore locked. A day with none is open. */
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

  const { id } = await params;
  const job = await prisma.job.findUnique({ where: { id }, select: { id: true, companyId: true } });
  if (!job || job.companyId !== context.companyId) return jsonError("Job not found", 400);

  const signoffs = await prisma.timesheetSignoff.findMany({
    where: { jobId: job.id, reopenedAt: null },
    orderBy: { date: "desc" },
    take: 120,
    select,
  });
  return NextResponse.json(signoffs.map(toJson));
}

/**
 * The foreman signs the day: one drawn signature for everyone's hours on
 * this job on this date. From here the day is locked until the office
 * reopens it.
 *
 * Refusals are 4xx with a sentence. A 409 is final — the day is already
 * signed — and the phone's queue drops it rather than retrying forever.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const date = parseDay(input.date);
  if (!date) return jsonError("Date must be yyyy-mm-dd", 400);

  const signerName = String(input.signerName ?? "").trim();
  if (!signerName) return jsonError("Print your name under the signature", 400);
  if (signerName.length > 120) return jsonError("That name is too long", 400);

  if (!isValidSignaturePath(input.signaturePath)) return jsonError("Draw your signature in the box", 400);
  const signaturePath = input.signaturePath;

  // Idempotent: a retried offline POST replays instead of signing twice.
  const clientOperationId = String(input.clientOperationId ?? "").trim() || undefined;
  if (clientOperationId) {
    const existing = await prisma.timesheetSignoff.findUnique({
      where: { companyId_clientOperationId: { companyId: context.companyId, clientOperationId } },
      select,
    });
    if (existing) return NextResponse.json(toJson(existing), { status: 200 });
  }

  const live = await liveSignoff(job.id, date);
  if (live) return jsonError(lockedDayMessage(date, live), 409);

  const entries = await prisma.timeEntry.findMany({
    where: { jobId: job.id, date },
    select: {
      hours: true,
      employeeUserId: true,
      crewMemberId: true,
      craftClassification: { select: { name: true } },
    },
  });
  if (entries.length === 0) return jsonError(`There are no hours on ${dayText(date)} to sign.`, 409);
  const totalHours = entries.reduce((sum, e) => sum + Number(e.hours), 0);

  // What the signature covers besides the hours: the crew by craft, and the
  // day's report and delays as they stand now. Frozen here so a reopen can't
  // quietly change what was signed.
  const [report, delays] = await Promise.all([
    prisma.dailyFieldReport.findUnique({ where: { jobId_reportDate: { jobId: job.id, reportDate: date } } }),
    prisma.delayEvent.findMany({ where: { jobId: job.id, date }, orderBy: { createdAt: "asc" } }),
  ]);
  const reportSnapshot =
    report || delays.length > 0
      ? {
          report: report
            ? {
                workPerformed: report.workPerformed,
                otherTradesOnSite: report.crewPresent,
                siteConditionsNote: report.weather,
                weather: report.weatherAuto,
                legacyDelaysText: report.delays,
              }
            : null,
          delays: delays.map(toDelayRow),
        }
      : null;

  try {
    const signoff = await prisma.timesheetSignoff.create({
      data: {
        companyId: context.companyId,
        jobId: job.id,
        date,
        signerName,
        signaturePath,
        signedByUserId: context.id,
        signedAt: new Date(),
        entryCount: entries.length,
        totalHours: totalHours.toFixed(2),
        manpower: summarizeManpower(entries) as unknown as Prisma.InputJsonValue,
        ...(reportSnapshot ? { reportSnapshot: reportSnapshot as unknown as Prisma.InputJsonValue } : {}),
        clientOperationId,
      },
      select,
    });
    return NextResponse.json(toJson(signoff), { status: 201 });
  } catch (error) {
    // Somebody else signed the same day between the check above and here.
    if (isUniqueViolation(error)) return jsonError(`${dayText(date)} was just signed by someone else.`, 409);
    throw error;
  }
}
