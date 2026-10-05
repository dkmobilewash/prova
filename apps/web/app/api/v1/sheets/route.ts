import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@prova/db";
import { pinContentProblem, pinPlacementProblem, type SheetPinKind } from "@/lib/sheet-pins";

/**
 * THE SHEETS OF A JOB'S DRAWINGS, AND THE PINS ON THEM — for the phone.
 *
 * `MANAGE_JOBS`, matching both the web route (`/drawings` in
 * `ROUTE_CAPABILITY`) and the phone's existing drawings endpoint. The same
 * records, so the same gate. The FIELD job function holds it, which is the
 * point: a foreman is exactly who pins a photo to a wall.
 *
 * **WHAT THIS RETURNS AND WHY IT IS AN IMAGE RATHER THAN A PDF.** `imageUrl`
 * is a rasterised PNG of the sheet. The phone has no PDF renderer and no
 * WebView — `react-native-svg` is its only graphics dependency — so the field
 * surface is an `<Image>` with an SVG overlay. A sheet whose `imageUrl` is
 * null is NOT an error: it is a sheet nobody has prepared yet, and the phone
 * says so rather than showing an empty frame.
 *
 * **THE COORDINATES ARE IN THE PAGE-WIDTH BOX** — `x` 0..1, `y` 0..H/W, both
 * divided by the WIDTH. `widthPt`/`heightPt` travel with every sheet so the
 * phone can turn a tap back into that box without opening anything.
 * `lib/sheet-geometry.ts` is the one definition; the phone must not grow a
 * second one.
 */
export const dynamic = "force-dynamic";

const JOBS_ONLY =
  "Job records aren't part of your job function. The account owner sets who sees what, on the Team page.";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET(request: NextRequest) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);
  if (!can(context, "MANAGE_JOBS")) return jsonError(JOBS_ONLY, 403);

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) return jsonError("jobId is required", 400);

  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, companyId: true } });
  if (!job || job.companyId !== context.companyId) return jsonError("Job not found", 400);

  const pages = await prisma.sheetPage.findMany({
    where: { revision: { set: { jobId: job.id, companyId: context.companyId } } },
    orderBy: [{ revision: { issuedOn: "desc" } }, { pageNumber: "asc" }],
    select: {
      id: true,
      pageNumber: true,
      label: true,
      widthPt: true,
      heightPt: true,
      imageUrl: true,
      imageWidthPx: true,
      revision: { select: { id: true, label: true, set: { select: { id: true, name: true } } } },
      pins: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          x: true,
          y: true,
          kind: true,
          note: true,
          mediaId: true,
          punchItemId: true,
          punchItem: { select: { description: true } },
        },
      },
    },
  });

  return NextResponse.json(
    pages.map((page) => ({
      id: page.id,
      pageNumber: page.pageNumber,
      label: page.label,
      widthPt: page.widthPt,
      heightPt: page.heightPt,
      imageUrl: page.imageUrl,
      imageWidthPx: page.imageWidthPx,
      setName: page.revision.set.name,
      revisionLabel: page.revision.label,
      pins: page.pins.map((pin) => ({
        id: pin.id,
        x: pin.x,
        y: pin.y,
        kind: pin.kind,
        note: pin.note,
        mediaId: pin.mediaId,
        punchItemId: pin.punchItemId,
        // Sent rather than left for the phone to join: a pin whose punch item
        // was deleted still renders, and the phone has no second request to
        // discover what it used to say.
        punchItemDescription: pin.punchItem?.description ?? null,
      })),
    })),
  );
}

export async function POST(request: NextRequest) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);
  if (!can(context, "MANAGE_JOBS")) return jsonError(JOBS_ONLY, 403);

  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!input) return jsonError("Expected a JSON body", 400);

  const pageId = String(input.pageId ?? "").trim();
  if (!pageId) return jsonError("pageId is required", 400);

  const page = await prisma.sheetPage.findFirst({
    where: { id: pageId, revision: { set: { companyId: context.companyId } } },
    select: { id: true, widthPt: true, heightPt: true },
  });
  if (!page) return jsonError("Sheet not found", 400);

  /**
   * Idempotent create: a retried offline POST replays instead of duplicating.
   *
   * THE READ IS NOT THE GUARANTEE — the unique index is, and that sentence is
   * copied from the punch-list route because it was learned the expensive way:
   * two flushes carrying the same key can both pass this check before either
   * inserts, and on 2026-09-20 production returned a 500 for a request whose
   * whole purpose was to be safely repeatable. The catch below reads a
   * collision back as the replay it always was.
   */
  const clientOperationId = String(input.clientOperationId ?? "").trim() || undefined;
  if (clientOperationId) {
    const existing = await prisma.sheetPin.findUnique({
      where: { companyId_clientOperationId: { companyId: context.companyId, clientOperationId } },
    });
    if (existing) return NextResponse.json(existing, { status: 200 });
  }

  const kind = String(input.kind ?? "") as SheetPinKind;
  if (!["PHOTO", "PUNCH", "NOTE"].includes(kind)) return jsonError("kind must be PHOTO, PUNCH or NOTE", 400);

  const x = Number(input.x);
  const y = Number(input.y);
  const placement = pinPlacementProblem(x, y, page);
  if (placement) return jsonError(placement, 400);

  const mediaId = String(input.mediaId ?? "").trim() || null;
  const punchItemId = String(input.punchItemId ?? "").trim() || null;
  const note = String(input.note ?? "").trim() || null;
  const content = pinContentProblem(kind, { mediaId, punchItemId, note });
  if (content) return jsonError(content, 400);

  // The target has to be on this account too. Without these a pin could name
  // another company's photo by id, and the phone would render it.
  if (mediaId) {
    const media = await prisma.jobMedia.findFirst({
      where: { id: mediaId, companyId: context.companyId },
      select: { id: true },
    });
    if (!media) return jsonError("That photo is not on this account", 400);
  }
  if (punchItemId) {
    const item = await prisma.punchListItem.findFirst({
      where: { id: punchItemId, companyId: context.companyId },
      select: { id: true },
    });
    if (!item) return jsonError("That punch item is not on this account", 400);
  }

  try {
    const pin = await prisma.sheetPin.create({
      data: {
        companyId: context.companyId,
        pageId: page.id,
        x,
        y,
        kind,
        mediaId: kind === "PHOTO" ? mediaId : null,
        punchItemId: kind === "PUNCH" ? punchItemId : null,
        note: kind === "NOTE" ? note : null,
        clientOperationId,
        createdByUserId: context.id,
      },
    });
    return NextResponse.json(pin, { status: 201 });
  } catch (error) {
    // The collision the read above cannot prevent. A replay, not a failure.
    if (clientOperationId && error instanceof Error && /Unique constraint/i.test(error.message)) {
      const existing = await prisma.sheetPin.findUnique({
        where: { companyId_clientOperationId: { companyId: context.companyId, clientOperationId } },
      });
      if (existing) return NextResponse.json(existing, { status: 200 });
    }
    throw error;
  }
}
