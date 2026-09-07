import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { JOB_MEDIA_CONTENT_TYPES, JOB_MEDIA_MAX_BYTES } from "@/lib/job-media";

/**
 * The browser uploads the file to Vercel Blob DIRECTLY; this route only
 * says whether it may, and on what terms.
 *
 * WHY THIS EXISTS RATHER THAN A SERVER ACTION. Every other upload in this
 * app posts the file through a Server Action (`uploadComplianceDocument`,
 * `uploadContractDocument`, `uploadDispatchSlip`,
 * `uploadPrevailingWageDetermination`) and all four are broken above 1MB —
 * issue #27. Next caps a Server Action body at exactly 1MB unless
 * `experimental.serverActions.bodySizeLimit` says otherwise, and
 * `next.config.mjs` does not:
 *
 *     // next@15.5.23 dist/server/app-render/action-handler.js:479
 *     const bodySizeLimitBytes = bodySizeLimit !== defaultBodySizeLimit
 *       ? bytes.parse(bodySizeLimit) : 1024 * 1024 // 1 MB
 *
 * That ceiling applies to MULTIPART FILE BODIES TOO, which is the part
 * worth knowing — the size-counting `Transform` is piped INTO busboy
 * (`:614-640`), not placed after it, so file parts are counted like
 * anything else. A phone photo is 3-12MB. There is no version of this
 * feature that goes through a Server Action.
 *
 * WHAT THE CLIENT CANNOT DO. The browser picks the file and calls
 * `upload()`; everything that decides access is here, on the server:
 *
 *   - who is asking          `requireCompanyContext()`
 *   - whether they may       `can(context, "MANAGE_FIELD")`
 *   - which job it lands on  looked up and checked against THEIR company
 *   - what may be uploaded   `allowedContentTypes`
 *   - how big                `maximumSizeInBytes`
 *
 * The client sends a `clientPayload` naming the job, and it is treated as
 * a claim to verify, never as an instruction — the job is re-read from the
 * database and rejected unless it belongs to the caller's company. A token
 * is only minted after all of that passes, and it authorises exactly one
 * upload.
 *
 * WHY THE ROW IS NOT WRITTEN HERE. `handleUpload` also offers
 * `onUploadCompleted`, which is the obvious place to insert the JobMedia
 * row and is the wrong one: it is an inbound webhook FROM Vercel's
 * infrastructure, so it cannot reach a laptop. Building it that way gives
 * you a feature that works in production and silently records nothing in
 * local development — the worst of the three possible behaviours. The
 * browser calls `recordJobMedia` (a Server Action) with the returned URL
 * instead; that payload is a few hundred bytes and is nowhere near the
 * limit this whole route exists to avoid.
 *
 * `addRandomSuffix` is NOT optional here, for the reason lib/blob.ts
 * spells out at length: these blobs are `access: "public"`, so the only
 * thing standing between a jobsite photo and anyone on the internet is
 * that the URL cannot be guessed from a job id and a filename.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const context = await requireCompanyContext();
        if (!can(context, "MANAGE_FIELD")) {
          throw new Error("Site photos aren't part of your job function.");
        }

        // The client says which job. We check it rather than trust it.
        let jobId: unknown;
        try {
          jobId = JSON.parse(clientPayload ?? "{}")?.jobId;
        } catch {
          throw new Error("Malformed upload request");
        }
        if (typeof jobId !== "string" || !jobId) {
          throw new Error("A job is required");
        }
        const job = await prisma.job.findUnique({
          where: { id: jobId },
          select: { id: true, companyId: true },
        });
        if (!job || job.companyId !== context.companyId) {
          throw new Error("Job not found");
        }

        return {
          allowedContentTypes: [...JOB_MEDIA_CONTENT_TYPES],
          maximumSizeInBytes: JOB_MEDIA_MAX_BYTES,
          addRandomSuffix: true,
          // Carried through to onUploadCompleted, which this route does
          // not use — but the token is scoped to one job either way, so a
          // token minted for job A cannot be replayed against job B.
          tokenPayload: JSON.stringify({ jobId: job.id }),
        };
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    // handleUpload throws for a rejected token AND for a malformed body.
    // Either way the browser gets the sentence, not a digest: this is a
    // route handler, so nothing redacts it the way a Server Action would.
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
