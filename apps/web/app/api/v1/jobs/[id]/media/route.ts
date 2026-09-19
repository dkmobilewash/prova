import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@prova/db";
import { put } from "@vercel/blob";
import {
  isAllowedJobMediaType,
  jobMediaMaxBytes,
  jobMediaUploadPathname,
} from "@/lib/job-media";
import { locationProblemMessage, parseCapturedLocation } from "@/lib/job-media-location";

/**
 * The mobile site-capture surface: list a job's media, and upload one.
 *
 * Unlike the web's two-step upload (the browser uploads to Vercel Blob
 * directly, then records the URL), a phone posts the file THROUGH this
 * route and the server uploads it. That is fine here where the web's
 * direct path was not: a Route Handler has no 1MB body cap (the Server
 * Action did — issue #27), and the server performing the upload means the
 * URL never has to be re-proven against a stranger's store.
 */

export const dynamic = "force-dynamic";

const FIELD_ONLY =
  "Site photos aren't part of your job function. The account owner sets who sees what, on the Team page.";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function toJson(m: {
  id: string;
  blobUrl: string;
  contentType: string;
  byteSize: number;
  caption: string | null;
  capturedAt: Date;
  capturedLatitude: number | null;
  capturedLongitude: number | null;
  capturedAccuracyMeters: number | null;
  dailyFieldReportId: string | null;
  punchListItemId: string | null;
  tags: { tag: { id: string; name: string } }[];
}) {
  return {
    id: m.id,
    blobUrl: m.blobUrl,
    contentType: m.contentType,
    byteSize: m.byteSize,
    caption: m.caption,
    capturedAt: m.capturedAt.toISOString(),
    capturedLatitude: m.capturedLatitude,
    capturedLongitude: m.capturedLongitude,
    capturedAccuracyMeters: m.capturedAccuracyMeters,
    dailyFieldReportId: m.dailyFieldReportId,
    punchListItemId: m.punchListItemId,
    tags: m.tags.map((t) => ({ id: t.tag.id, name: t.tag.name })),
  };
}

const mediaSelect = {
  id: true,
  blobUrl: true,
  contentType: true,
  byteSize: true,
  caption: true,
  capturedAt: true,
  capturedLatitude: true,
  capturedLongitude: true,
  capturedAccuracyMeters: true,
  dailyFieldReportId: true,
  punchListItemId: true,
  tags: { select: { tag: { select: { id: true, name: true } } } },
} as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);

  const { id } = await params;
  const job = await prisma.job.findUnique({ where: { id }, select: { id: true, companyId: true } });
  if (!job || job.companyId !== context.companyId) return jsonError("Job not found", 400);

  const media = await prisma.jobMedia.findMany({
    where: { jobId: id },
    orderBy: { capturedAt: "desc" },
    select: mediaSelect,
  });

  return NextResponse.json(media.map(toJson));
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("Malformed upload", 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return jsonError("A file is required", 400);

  const contentType = file.type;
  if (!isAllowedJobMediaType(contentType)) {
    return jsonError("Upload a photo, a video, or a voice recording", 400);
  }
  const maxBytes = jobMediaMaxBytes(contentType);
  if (maxBytes === null || file.size > maxBytes) return jsonError("That file is too large", 400);

  const pathname = jobMediaUploadPathname(job.id, file.name);
  if (pathname === null) return jsonError("That file name is not valid", 400);

  // Entered, not stamped: a crew uploading Friday's photos on Monday must
  // not have them filed as Monday's.
  const capturedAtRaw = String(formData.get("capturedAt") ?? "").trim();
  const capturedAt = capturedAtRaw ? new Date(capturedAtRaw) : new Date();
  if (Number.isNaN(capturedAt.getTime())) return jsonError("That capture time is not valid", 400);

  const caption = String(formData.get("caption") ?? "").trim();

  // Where it was taken, parsed by the same function the web upload uses, so
  // a phone and a browser cannot record a coordinate differently.
  const parsedLocation = parseCapturedLocation({
    latitude: formData.get("capturedLatitude")?.toString(),
    longitude: formData.get("capturedLongitude")?.toString(),
    accuracyMeters: formData.get("capturedAccuracyMeters")?.toString(),
  });
  if (!parsedLocation.ok) return jsonError(locationProblemMessage(parsedLocation.problem), 400);
  const location = parsedLocation.location;

  // Idempotent: a queued photo retried after a lost signal replays rather
  // than uploading a second copy — checked BEFORE the blob is written, so a
  // replay does not even cost the upload.
  const clientOperationId = String(formData.get("clientOperationId") ?? "").trim() || null;
  if (clientOperationId) {
    const existing = await prisma.jobMedia.findUnique({
      where: { companyId_clientOperationId: { companyId: context.companyId, clientOperationId } },
      select: mediaSelect,
    });
    if (existing) return NextResponse.json(toJson(existing), { status: 200 });
  }

  // What it was taken for. Both must be on THIS job: a report or punch item
  // id from another job is a bug or a probe, and either way not this photo's.
  const dailyFieldReportId = String(formData.get("dailyFieldReportId") ?? "").trim() || null;
  if (dailyFieldReportId) {
    const report = await prisma.dailyFieldReport.findUnique({
      where: { id: dailyFieldReportId },
      select: { jobId: true },
    });
    if (!report || report.jobId !== job.id) return jsonError("That daily report is not on this job", 400);
  }
  const punchListItemId = String(formData.get("punchListItemId") ?? "").trim() || null;
  if (punchListItemId) {
    const item = await prisma.punchListItem.findUnique({
      where: { id: punchListItemId },
      select: { jobId: true },
    });
    if (!item || item.jobId !== job.id) return jsonError("That punch list item is not on this job", 400);
  }

  // Tags picked at the shutter. Company-scoped, deduplicated, and silently
  // narrowed to the ones that exist — a tag renamed or deleted between
  // taking the photo and the upload going through must not lose the photo.
  const tagIds = [...new Set(formData.getAll("tagIds").map((t) => String(t).trim()).filter(Boolean))];
  const tags = tagIds.length
    ? await prisma.jobMediaTag.findMany({
        where: { id: { in: tagIds }, companyId: context.companyId },
        select: { id: true },
      })
    : [];

  const body = Buffer.from(await file.arrayBuffer());
  const result = await put(pathname, body, {
    access: "public",
    addRandomSuffix: true,
    contentType,
  });

  const media = await prisma.jobMedia.create({
    data: {
      companyId: context.companyId,
      jobId: job.id,
      blobUrl: result.url,
      contentType,
      byteSize: file.size,
      caption: caption || null,
      capturedAt,
      capturedByUserId: context.id,
      capturedLatitude: location?.latitude ?? null,
      capturedLongitude: location?.longitude ?? null,
      capturedAccuracyMeters: location?.accuracyMeters ?? null,
      dailyFieldReportId,
      punchListItemId,
      clientOperationId,
      tags: tags.length
        ? { create: tags.map((t) => ({ tagId: t.id, taggedByUserId: context.id })) }
        : undefined,
    },
    select: mediaSelect,
  });

  return NextResponse.json(toJson(media), { status: 201 });
}
