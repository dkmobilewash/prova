import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { IncidentClassification, IncidentOutcome, prisma } from "@prova/db";

export const dynamic = "force-dynamic";

const FIELD_ONLY =
  "Field records aren't part of your job function. The account owner sets who sees what, on the Team page.";

const OUTCOMES = ["DEATH", "DAYS_AWAY", "RESTRICTED_OR_TRANSFER", "OTHER_RECORDABLE", "FIRST_AID_ONLY"];
const CLASSIFICATIONS = ["INJURY", "SKIN_DISORDER", "RESPIRATORY_CONDITION", "POISONING", "HEARING_LOSS", "OTHER_ILLNESS"];

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function toJson(i: {
  id: string;
  caseNumber: number;
  caseYear: number;
  occurredAt: Date;
  employeeName: string;
  jobTitle: string | null;
  location: string | null;
  description: string;
  classification: string;
  outcome: string;
  daysAway: number | null;
  daysRestricted: number | null;
}) {
  return {
    id: i.id,
    caseNumber: i.caseNumber,
    caseYear: i.caseYear,
    occurredAt: i.occurredAt.toISOString().slice(0, 10),
    employeeName: i.employeeName,
    jobTitle: i.jobTitle,
    location: i.location,
    description: i.description,
    classification: i.classification,
    outcome: i.outcome,
    daysAway: i.daysAway,
    daysRestricted: i.daysRestricted,
  };
}

function pickEnum(raw: unknown, allowed: readonly string[]): string | null {
  const value = String(raw ?? "");
  return allowed.includes(value) ? value : null;
}

function parseDays(raw: unknown): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
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

  const incidents = await prisma.safetyIncident.findMany({
    where: { jobId: id },
    orderBy: { occurredAt: "desc" },
  });

  return NextResponse.json(incidents.map(toJson));
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

  const employeeName = String(input.employeeName ?? "").trim();
  if (!employeeName) return jsonError("Employee name is required", 400);
  const description = String(input.description ?? "").trim();
  if (!description) return jsonError("Description is required", 400);

  const occurredAtRaw = String(input.occurredAt ?? "").trim();
  const occurredAt = occurredAtRaw ? new Date(`${occurredAtRaw}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(occurredAt.getTime())) return jsonError("Date is not valid", 400);

  const classification = pickEnum(input.classification, CLASSIFICATIONS);
  if (!classification) return jsonError("classification must be a valid value", 400);
  const outcome = pickEnum(input.outcome, OUTCOMES);
  if (!outcome) return jsonError("outcome must be a valid value", 400);

  const counted = outcome === "DAYS_AWAY" || outcome === "RESTRICTED_OR_TRANSFER";
  const daysAway = counted ? parseDays(input.daysAway) : null;
  const daysRestricted = counted ? parseDays(input.daysRestricted) : null;

  const caseYear = occurredAt.getUTCFullYear();

  // Idempotent create: a retried offline POST replays instead of duplicating.
  const clientOperationId = String(input.clientOperationId ?? "").trim() || undefined;
  if (clientOperationId) {
    const existing = await prisma.safetyIncident.findUnique({
      where: { companyId_clientOperationId: { companyId: context.companyId, clientOperationId } },
    });
    if (existing) return NextResponse.json(toJson(existing), { status: 200 });
  }

  // One transaction: duplicate check first, then the counter increment, then
  // the row — so a resubmission files nothing new and a number is never burned.
  const incident = await prisma.$transaction(async (tx) => {
    const already = await tx.safetyIncident.findFirst({
      where: { companyId: context.companyId, occurredAt, employeeName, description },
      select: { id: true },
    });
    if (already) return null;

    const counter = await tx.safetyCaseCounter.upsert({
      where: { companyId_caseYear: { companyId: context.companyId, caseYear } },
      create: { companyId: context.companyId, caseYear, lastCaseNumber: 1 },
      update: { lastCaseNumber: { increment: 1 } },
      select: { lastCaseNumber: true },
    });

    return tx.safetyIncident.create({
      data: {
        companyId: context.companyId,
        jobId: job.id,
        caseYear,
        caseNumber: counter.lastCaseNumber,
        occurredAt,
        employeeName,
        jobTitle: String(input.jobTitle ?? "").trim() || null,
        location: String(input.location ?? "").trim() || null,
        description,
        classification: classification as IncidentClassification,
        outcome: outcome as IncidentOutcome,
        daysAway,
        daysRestricted,
        reportedByUserId: context.id,
        clientOperationId,
      },
    });
  });

  // A duplicate returns the existing case (already on the log) rather than
  // an error — the truthful outcome of a resubmission.
  if (!incident) {
    const existing = await prisma.safetyIncident.findFirst({
      where: { companyId: context.companyId, occurredAt, employeeName, description },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(toJson(existing!), { status: 200 });
  }

  return NextResponse.json(toJson(incident), { status: 201 });
}
