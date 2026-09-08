import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { JOB_MEDIA_CONTENT_TYPES, JOB_MEDIA_MAX_BYTES, isJobMediaPathname } from "@/lib/job-media";

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
 *   - WHERE IT MAY LAND      `isJobMediaPathname(pathname, job.id)`
 *   - what may be uploaded   `allowedContentTypes`
 *   - how big                `maximumSizeInBytes`
 *
 * THE PATHNAME CHECK IS NOT DECORATION. The store is one store shared by
 * every tenant, so without it a token could be minted for a pathname in
 * another company's folder — and the URL that came back would then pass
 * every check `recordJobMedia` had. lib/job-media.ts carries the whole
 * account of what that cost; this route is enforcement point 2 of the
 * three described there, and the ONLY one that can stop the token existing
 * in the first place.
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
 * that the URL cannot be guessed from a job id and a filename. The store
 * applies that suffix to the FILENAME and leaves the folders alone, which
 * is what lets the prefix check above survive it — see the note in
 * lib/job-media.ts for exactly how far that is proven and what happens if
 * it is ever wrong (it fails closed).
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Parsed INSIDE the try. `request.json()` throws on a body that is not
    // JSON, and out on its own line above this it was an unhandled
    // rejection — a framework 500, from the one route in this app whose
    // entire error contract is "400 and a sentence". The catch below has
    // always claimed it handled "a malformed body"; until now nothing was
    // catching one.
    const body = (await request.json()) as HandleUploadBody;

    const result = await handleUpload({
      body,
      request,
      // The first argument IS the pathname the browser asked to write to,
      // and ignoring it was the whole of the cross-tenant hole.
      onBeforeGenerateToken: async (pathname, clientPayload) => {
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

        // ONLY NOW is the requested path judged, because "is this path
        // this job's" is only worth asking once the job has been proved to
        // be the caller's. A token for anything else is never minted.
        if (!isJobMediaPathname(pathname, job.id)) {
          throw new Error("That upload path does not belong to this job");
        }

        return {
          allowedContentTypes: [...JOB_MEDIA_CONTENT_TYPES],
          maximumSizeInBytes: JOB_MEDIA_MAX_BYTES,
          addRandomSuffix: true,
          // WHAT ACTUALLY BINDS THE TOKEN TO A JOB IS THE PATHNAME ABOVE,
          // not this payload. This used to claim "the token is scoped to
          // one job either way, so a token minted for job A cannot be
          // replayed against job B", and that was false twice over:
          // `tokenPayload` is echoed only to `onUploadCompleted`
          // (@vercel/blob@2.8.0 dist/client.js:258, :279-281), which this
          // route deliberately does not implement, so nothing ever read
          // it; and the value the token IS scoped to is the pathname,
          // which at the time was a bare filename naming no job at all.
          //
          // With the check above in place the claim is true, for the real
          // reason: `handleUpload` signs the requested pathname into the
          // token (dist/client.js:274-278 -> :481-487) and the store
          // refuses a PUT whose pathname does not match what it signed —
          // the `client_token_pathname_mismatch` case at
          // dist/chunk-YYMLUMXS.js:656. A token minted for
          // `job-media/<A>/…` cannot write into `job-media/<B>/…`.
          //
          // Kept anyway because it costs nothing and is the one thing an
          // `onUploadCompleted` would need on the day one is added.
          tokenPayload: JSON.stringify({ jobId: job.id }),
        };
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    // Everything above throws into here: a body that is not JSON, a
    // rejected token, a pathname that is not this job's.
    //
    // THE BROWSER NEVER SEES THIS SENTENCE, and saying otherwise is why
    // this comment used to be wrong. `@vercel/blob/client` discards the
    // body of any non-2xx response from this route —
    // `if (!res.ok) { throw new BlobError("Failed to  retrieve the client
    // token"); }`, dist/client.js:398-400 — so the person gets that string
    // and nothing else. Nothing redacts this the way a Server Action would;
    // the library simply never reads it.
    //
    // It is still returned, and still specific, because it is what a
    // server log, a `curl`, and any future non-SDK caller get. What the
    // person on the phone is shown instead is
    // `jobMediaUploadErrorMessage`, which says the reason was not passed
    // on rather than inventing one.
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
