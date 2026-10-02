import { prisma } from "@prova/db";
import { createBluebeamSession, listBluebeamSessionFiles, summarizeBluebeamSessionMarkups, uploadFileToBluebeamSession, type BluebeamMarkupSummary } from "@prova/integrations";
import { withBluebeam, type BluebeamDeps } from "@/lib/bluebeam/connection";

/**
 * The business logic behind the Bluebeam card's "Link a job", "Push a
 * PDF" and "Refresh" controls — pulled out of lib/actions/bluebeam.ts the
 * same way lib/companycam/import.ts is pulled out of lib/actions/
 * companycam.ts, so it is testable without a Server Action around it.
 *
 * WHAT THIS DOES NOT DO, stated because it is the headline finding of
 * this integration's own research (see the PR this shipped in): Bluebeam's
 * public Studio API exposes markup STATUS (a count, grouped by whatever
 * string Bluebeam calls a markup's state), never markup GEOMETRY or
 * takeoff QUANTITIES. Nothing here, and nothing that could be added
 * later against this same API, can turn a Bluebeam markup into a
 * JobLineItem quantity. That data exists only inside Revu, locally, and
 * is not part of what Studio syncs to the cloud.
 */

/** A PDF starts with %PDF-. Anything else pushed as "the drawing set"
 * would be an error page or the wrong file wearing the name of one — the
 * same check DocuSign's document download uses in reverse (packages/
 * integrations/src/docusign.ts). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  return Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}

/** 25MB — the same ceiling this app already applies to a photo upload
 * (JOB_MEDIA_PHOTO_MAX_BYTES in lib/job-media.ts), generous for a single
 * drawing sheet or a short spec section and small enough that a Server
 * Action's own time budget does not become the actual limit. */
export const BLUEBEAM_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/**
 * One sentence summarizing a session's markups, for the sync log and the
 * card. Pure and separately tested so the wording is pinned without a
 * database or a fetch.
 */
export function markupSummarySentence(fileCount: number, summary: BluebeamMarkupSummary): string {
  if (fileCount === 0) return "No files in this session yet.";
  if (summary.total === 0) {
    return `${fileCount} file${fileCount === 1 ? "" : "s"} in the session, no markups yet.`;
  }
  const parts = Object.entries(summary.byStatus)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `${count} ${status.toLowerCase()}`);
  return `${fileCount} file${fileCount === 1 ? "" : "s"}, ${summary.total} markup${summary.total === 1 ? "" : "s"} (${parts.join(", ")}).`;
}

async function loadLink(companyId: string, jobId: string) {
  return prisma.bluebeamStudioSession.findFirst({
    where: { jobId, companyId },
    select: { id: true, bluebeamSessionId: true, bluebeamSessionName: true },
  });
}

/**
 * Stamp the link's sync trio — AND STAMP IT ON FAILURE TOO.
 *
 * Until now every call site wrote `SUCCESS` and nothing ever wrote `FAILURE`,
 * so a push or a refresh that threw left the previous success standing. The
 * card would read "synced 2 minutes ago · ok" when the last attempt had in fact
 * failed, which is the precise outcome `bluebeam.prisma` says these three
 * columns exist to prevent: "an integration that fails silently is
 * indistinguishable from one nobody used."
 *
 * `lib/companycam/import.ts` already does this for its own link row; this
 * brings Bluebeam to the same standard.
 */
async function recordSync(
  linkId: string,
  companyId: string,
  status: "SUCCESS" | "FAILURE",
  message: string,
) {
  await prisma.bluebeamStudioSession.updateMany({
    where: { id: linkId, companyId },
    data: { lastSyncedAt: new Date(), lastSyncStatus: status, lastSyncMessage: message },
  });
}

/** The readable half of a thrown error. Bluebeam's own client throws sentences
 *  (see `withBluebeam`'s reconnect message), so this is already user-facing
 *  prose rather than a stack. */
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Create a new Studio Session for a job and link it. One session per
 * job, same shape as ProcoreProjectLink/CompanyCamProjectLink. */
export async function linkJobToBluebeamStudio(companyId: string, jobId: string, jobName: string, linkedByUserId: string, deps: BluebeamDeps = {}) {
  const existing = await loadLink(companyId, jobId);
  if (existing) throw new Error("This job already has a Bluebeam Studio Session. Unlink it first.");

  const session = await withBluebeam(
    companyId,
    (target) => createBluebeamSession(target, jobName, deps.fetchImpl),
    deps,
  );

  try {
    return await prisma.bluebeamStudioSession.create({
      data: {
        companyId,
        jobId,
        bluebeamSessionId: session.id,
        bluebeamSessionName: session.name,
        linkedByUserId,
      },
    });
  } catch (cause) {
    /* THE SESSION ALREADY EXISTS AT BLUEBEAM AND WE ARE ABOUT TO FORGET ITS ID.
       Two steps that cannot be one: the session is created remotely, then the
       row is written here. If the write loses, an empty Studio Session is left
       in the owner's Bluebeam account that this app has no record of and no way
       to reach — it will not appear in any list here, and nothing will ever
       clean it up.
       DocuSign handles the same hazard by naming the envelope id and telling
       the user to void it by hand (`lib/actions/docusign.ts`). Do the same
       rather than swallow it: the id is the only thing that makes the orphan
       findable. */
    throw new Error(
      `The Studio Session was created in Bluebeam (“${session.name}”, id ${session.id}) but ` +
        `linking it to this job failed, so C Stream has no record of it. Delete that session ` +
        `in Bluebeam Studio by hand before trying again, or you will collect empty sessions.`,
      { cause },
    );
  }
}

/** Push one PDF into the job's linked session. Nothing about the file is
 * stored in C Stream — this is a pass-through, exactly like handing
 * someone a printed set, except it lands in Bluebeam Studio. */
export async function pushDocumentToBluebeamSession(
  companyId: string,
  jobId: string,
  file: { name: string; bytes: Uint8Array; contentType: string },
  deps: BluebeamDeps = {},
): Promise<{ fileId: string; sessionName: string }> {
  if (!looksLikePdf(file.bytes)) throw new Error("That file isn't a PDF.");
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > BLUEBEAM_UPLOAD_MAX_BYTES) {
    throw new Error("That file is empty or too large (25MB limit).");
  }
  const link = await loadLink(companyId, jobId);
  if (!link) throw new Error("This job has no Bluebeam Studio Session. Link one first.");

  let uploaded: Awaited<ReturnType<typeof uploadFileToBluebeamSession>>;
  try {
    uploaded = await withBluebeam(
      companyId,
      (target) => uploadFileToBluebeamSession(target, link.bluebeamSessionId, file, deps.fetchImpl),
      deps,
    );
  } catch (error) {
    await recordSync(link.id, companyId, "FAILURE", `Couldn't push “${file.name}”. ${reasonOf(error)}`);
    throw error;
  }

  await recordSync(link.id, companyId, "SUCCESS", `Pushed “${file.name}” to the session.`);

  return { fileId: uploaded.fileId, sessionName: link.bluebeamSessionName };
}

/** Pull the session's file count and markup status summary. Read-only:
 * nothing in Bluebeam changes. */
export async function refreshBluebeamStudioSession(companyId: string, jobId: string, deps: BluebeamDeps = {}): Promise<{ message: string }> {
  const link = await loadLink(companyId, jobId);
  if (!link) throw new Error("This job has no Bluebeam Studio Session. Link one first.");

  let files: Awaited<ReturnType<typeof listBluebeamSessionFiles>>;
  let markups: Awaited<ReturnType<typeof summarizeBluebeamSessionMarkups>>;
  try {
    ({ files, markups } = await withBluebeam(
      companyId,
      async (target) => {
        const files = await listBluebeamSessionFiles(target, link.bluebeamSessionId, deps.fetchImpl);
        const markups = await summarizeBluebeamSessionMarkups(target, link.bluebeamSessionId, deps.fetchImpl);
        return { files, markups };
      },
      deps,
    ));
  } catch (error) {
    await recordSync(link.id, companyId, "FAILURE", `Couldn't read the session. ${reasonOf(error)}`);
    throw error;
  }

  const message = markupSummarySentence(files.length, markups);
  await recordSync(link.id, companyId, "SUCCESS", message);
  return { message };
}
