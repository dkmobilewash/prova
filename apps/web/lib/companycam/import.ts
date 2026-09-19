import { put } from "@vercel/blob";
import { prisma } from "@prova/db";
import {
  companyCamDownloadUri,
  fetchCompanyCamPhotoPage,
  listCompanyCamProjects,
  type CompanyCamPhoto,
  type CompanyCamProject,
} from "@prova/integrations";
import { withCompanyCamToken, type CompanyCamDeps } from "@/lib/companycam/connection";
import { JOB_MEDIA_PHOTO_MAX_BYTES, jobMediaUploadPathname } from "@/lib/job-media";

/**
 * The pull: one CompanyCam project's photos into one job's gallery,
 * through the EXISTING job-media path — the file lands in this app's own
 * blob store under `job-media/<jobId>/…` (the same prefix the upload
 * route writes and `deleteJobMedia` trusts), and the row is an ordinary
 * JobMedia row. Nothing downstream — galleries, tags, annotations, the
 * portal share — knows or cares that CompanyCam was involved, except the
 * provenance mark `companycamPhotoId`.
 *
 * READ-ONLY toward CompanyCam: every API call goes through the GET-only
 * client, and the file download is itself a GET with NO Authorization
 * header — the bearer token is for api.companycam.com and must not be
 * sprayed at whatever CDN host the photo URL points to.
 *
 * RE-IMPORT IMPORTS NOTHING TWICE. The guard is the database, not this
 * loop: JobMedia carries `@@unique([jobId, companycamPhotoId])`, and this
 * import both pre-filters against the existing ids AND treats a unique
 * violation on insert (two imports racing) as "already there", counted
 * as skipped.
 *
 * BOUNDED PER PRESS. A Server Action cannot download a 5,000-photo
 * project in one request, so one press imports at most
 * `COMPANYCAM_IMPORT_BATCH_LIMIT` new files and says plainly that more
 * remain — the summary's `remaining` is rendered as "press Import again",
 * never silently dropped.
 */

/** New files written per press. Sized for a Server Action's time budget:
 * ~60 web-variant JPEGs is tens of megabytes of download + re-upload. */
export const COMPANYCAM_IMPORT_BATCH_LIMIT = 60;

/** CompanyCam's documented per_page maximum. */
export const COMPANYCAM_PAGE_SIZE = 100;

/** How many pages one press will walk looking for new photos, so a
 * project where everything is already imported still terminates quickly
 * (30 pages = 3,000 photos scanned) rather than walking an unbounded
 * history inside a Server Action. */
export const COMPANYCAM_IMPORT_MAX_PAGES = 30;

export type CompanyCamImportSummary = {
  /** New JobMedia rows written. */
  imported: number;
  /** Photos already on the job (by companycamPhotoId), or not ready
   * (still processing at CompanyCam). */
  skipped: number;
  /** Photos whose file could not be fetched or stored. */
  failed: number;
  /** True when the project has more photos this press did not examine. */
  remaining: boolean;
  /** One sentence for the link's status line and the sync log. */
  message: string;
};

export type CompanyCamImportDeps = CompanyCamDeps & {
  /** The CDN download. Separate from the API `fetchImpl` so a test can
   * serve bytes without faking the whole API. */
  downloadImpl?: (url: string) => Promise<Response>;
  putImpl?: typeof put;
};

/** The image types the gallery renders. The import takes only photos, so
 * the video/audio types recordJobMedia accepts are deliberately absent. */
const IMPORTABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function fileExtension(contentType: string): string {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return "jpg";
  }
}

/** The projects the connected CompanyCam account can see, for the Link
 * picker. Writes nothing anywhere. */
export async function listLinkableCompanyCamProjects(
  companyId: string,
  deps: CompanyCamImportDeps = {},
): Promise<{ projects: CompanyCamProject[]; truncated: boolean }> {
  return withCompanyCamToken(companyId, (token) => listCompanyCamProjects(token, deps), deps);
}

async function importOne(
  photo: CompanyCamPhoto,
  target: { companyId: string; jobId: string },
  deps: CompanyCamImportDeps,
): Promise<"imported" | "skipped" | "failed"> {
  const download = deps.downloadImpl ?? ((url: string) => fetch(url, { method: "GET" }));
  const putImpl = deps.putImpl ?? put;

  const uri = companyCamDownloadUri(photo);
  if (!uri) return "failed";

  let response: Response;
  try {
    response = await download(uri);
  } catch {
    return "failed";
  }
  if (!response.ok) return "failed";

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!IMPORTABLE_TYPES.has(contentType)) return "failed";

  let body: Buffer;
  try {
    body = Buffer.from(await response.arrayBuffer());
  } catch {
    return "failed";
  }
  if (body.byteLength === 0 || body.byteLength > JOB_MEDIA_PHOTO_MAX_BYTES) return "failed";

  const pathname = jobMediaUploadPathname(target.jobId, `companycam-${photo.id}.${fileExtension(contentType)}`);
  if (pathname === null) return "failed";

  const stored = await putImpl(pathname, body, {
    access: "public",
    addRandomSuffix: true,
    contentType,
  });

  try {
    await prisma.jobMedia.create({
      data: {
        companyId: target.companyId,
        jobId: target.jobId,
        blobUrl: stored.url,
        contentType,
        byteSize: body.byteLength,
        // CompanyCam's own description, when there is one. The provenance
        // mark is the column, not the caption — a caption is editable and
        // must stay the person's to edit.
        caption: photo.description,
        // Entered, not stamped: CompanyCam's captured_at is the device's
        // capture time, the exact fact this column wants. A photo whose
        // capture time CompanyCam did not state is filed at import time,
        // which is then honestly the only time anybody knows.
        capturedAt: photo.capturedAt ?? new Date(),
        capturedByUserId: null,
        companycamPhotoId: photo.id,
      },
    });
  } catch (error) {
    // Two imports racing past the pre-filter onto the unique index: the
    // other press already stored this photo. The blob written here is
    // removed best-effort so a lost race does not strand a file.
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      try {
        const { del } = await import("@vercel/blob");
        await del(stored.url);
      } catch {
        // Best effort only.
      }
      return "skipped";
    }
    throw error;
  }
  return "imported";
}

/**
 * One press of "Import photos" for one link. The caller (the Server
 * Action) has already proven the link belongs to the session's company;
 * this re-reads it through `companyId` anyway, because a lib function
 * trusted to be called correctly is how a cross-tenant read gets written.
 */
export async function runCompanyCamImport(
  companyId: string,
  linkId: string,
  deps: CompanyCamImportDeps = {},
): Promise<CompanyCamImportSummary> {
  const link = await prisma.companyCamProjectLink.findFirst({
    where: { id: linkId, companyId },
    select: { id: true, jobId: true, companycamProjectId: true, companycamProjectName: true },
  });
  if (!link) throw new Error("That CompanyCam link is gone. Reload the page.");

  const existing = await prisma.jobMedia.findMany({
    where: { jobId: link.jobId, companycamPhotoId: { not: null } },
    select: { companycamPhotoId: true },
  });
  const seen = new Set(existing.map((row) => row.companycamPhotoId));

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let remaining = false;

  await withCompanyCamToken(
    companyId,
    async (token) => {
      let page = 1;
      for (; page <= COMPANYCAM_IMPORT_MAX_PAGES; page++) {
        const { photos, hasNext } = await fetchCompanyCamPhotoPage(
          token,
          link.companycamProjectId,
          page,
          COMPANYCAM_PAGE_SIZE,
          deps,
        );
        for (const photo of photos) {
          if (imported >= COMPANYCAM_IMPORT_BATCH_LIMIT) {
            remaining = true;
            return;
          }
          if (seen.has(photo.id)) {
            skipped++;
            continue;
          }
          if (photo.processingStatus !== null && photo.processingStatus !== "processed") {
            // Still uploading or broken at CompanyCam — a re-run picks it
            // up once processed; importing now would store a placeholder.
            skipped++;
            continue;
          }
          const outcome = await importOne(photo, { companyId, jobId: link.jobId }, deps);
          if (outcome === "imported") {
            imported++;
            seen.add(photo.id);
          } else if (outcome === "skipped") skipped++;
          else failed++;
        }
        if (!hasNext) return;
      }
      // Page ceiling reached with more pages promised.
      remaining = true;
    },
    deps,
  );

  const parts = [`Imported ${imported} photo${imported === 1 ? "" : "s"} from ${link.companycamProjectName}`];
  if (skipped > 0) parts.push(`${skipped} already here or not ready`);
  if (failed > 0) parts.push(`${failed} couldn't be fetched`);
  if (remaining) parts.push("more remain — press Import photos again");
  const message = `${parts.join("; ")}.`;

  const now = new Date();
  const status = failed > 0 && imported === 0 ? ("FAILURE" as const) : ("SUCCESS" as const);
  const connection = await prisma.integrationConnection.findUnique({
    where: { companyId_provider: { companyId, provider: "COMPANYCAM" } },
    select: { id: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.companyCamProjectLink.updateMany({
      where: { id: link.id, companyId },
      data: { lastImportedAt: now, lastImportStatus: status, lastImportMessage: message },
    });
    if (connection) {
      await tx.integrationConnection.update({
        where: { id: connection.id },
        data: { lastSyncedAt: now, lastSyncStatus: status },
      });
      await tx.integrationSyncLog.create({
        data: { connectionId: connection.id, direction: "PULL", status, message, occurredAt: now },
      });
    }
  });

  return { imported, skipped, failed, remaining, message };
}
