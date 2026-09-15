import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  DOCUMENT_UPLOAD_MAX_BYTES,
  DOCUMENT_UPLOAD_TARGETS,
  documentUploadPurpose,
  isAllowedDocumentType,
  isDocumentUploadPathname,
} from "@/lib/document-uploads";

/**
 * The browser uploads a DOCUMENT to Vercel Blob DIRECTLY; this route only
 * says whether it may, and on what terms.
 *
 * WHY THIS EXISTS — issue #27, and it is the same mechanism
 * `app/api/job-media/upload/route.ts` already runs for site capture,
 * generalised rather than reinvented. Five Server Actions carried the file
 * itself and each declared a 15MB guard that could never fire, because
 * Next caps a Server Action body at exactly 1MB — multipart file parts
 * included:
 *
 *     // next@15.5.23 dist/server/app-render/action-handler.js:479
 *     const bodySizeLimitBytes = bodySizeLimit !== defaultBodySizeLimit
 *       ? bytes.parse(bodySizeLimit) : 1024 * 1024 // 1 MB
 *
 * A real contract PDF is several megabytes, so every one of them was
 * rejected by the framework before a line of ours ran. lib/document-uploads.ts
 * carries the rest of that account, including why raising the config value
 * was considered and not taken.
 *
 * WHAT THE CLIENT CANNOT DO. The browser picks the file and calls
 * `upload()`; everything that decides access is here, on the server:
 *
 *   - who is asking          `requireCompanyContext()`
 *   - what they are doing    the PURPOSE, matched against a closed list
 *   - whether they may       the capability that purpose's ACTION asserts
 *   - which owner it lands   a job re-read and checked against their
 *     against                company, or — for a compliance document —
 *                            their own company id, taken from the session
 *   - WHERE IT MAY LAND      `isDocumentUploadPathname(pathname, …)`
 *   - what may be uploaded   `allowedContentTypes`
 *   - how big                `maximumSizeInBytes`
 *
 * THE PATHNAME CHECK IS NOT DECORATION. One blob store serves every
 * tenant, so a URL from it is never proof of whose file it is. Without
 * this check a token could be minted for a pathname in another company's
 * folder, and the URL that came back would then pass every check the
 * recording action has. This is enforcement point 2 of the three
 * lib/document-uploads.ts describes, and the ONLY one that can stop the
 * token existing in the first place.
 *
 * THE clientPayload IS A CLAIM, NEVER AN INSTRUCTION. It names a purpose,
 * an owner and a content type. The purpose must be on the list; the job is
 * re-read from the database and rejected unless it belongs to the caller's
 * company; the company-scoped case does not read the client's id at all,
 * so naming somebody else's company produces a pathname mismatch rather
 * than a check that happens to pass. A token is minted only after all of
 * that, and it authorises exactly one upload.
 *
 * WHY THE ROW IS NOT WRITTEN HERE. `handleUpload` also offers
 * `onUploadCompleted`, which is the obvious place to insert the row and is
 * the wrong one: it is an inbound webhook FROM Vercel's infrastructure, so
 * it cannot reach a laptop. Building it that way gives a feature that works
 * in production and silently records nothing in local development. The
 * browser calls the recording Server Action with the returned URL instead;
 * that payload is a few hundred bytes and nowhere near the limit this
 * route exists to avoid.
 *
 * `addRandomSuffix` is NOT optional, for the reason lib/blob.ts spells out:
 * these blobs are `access: "public"`, and the only thing between a
 * certified payroll report and anyone on the internet is that the URL
 * cannot be guessed from an id and a filename. It is set here now rather
 * than in `putDocument`, which is what the five actions used to call — the
 * property is unchanged and the place it is set moved with the upload.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Parsed INSIDE the try: `request.json()` throws on a body that is not
    // JSON, and on its own line above this that is an unhandled rejection
    // — a framework 500 from the one kind of route whose entire error
    // contract is "400 and a sentence". The job-media route learned this
    // the hard way; this one is written with it.
    const body = (await request.json()) as HandleUploadBody;

    const result = await handleUpload({
      body,
      request,
      // The first argument IS the pathname the browser asked to write to.
      // Ignoring it was the whole of the cross-tenant hole in the photo
      // route before #195.
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const context = await requireCompanyContext();

        let claimedPurpose: unknown;
        let claimedOwnerId: unknown;
        let declaredType: unknown;
        try {
          const payload = JSON.parse(clientPayload ?? "{}");
          claimedPurpose = payload?.purpose;
          claimedOwnerId = payload?.ownerId;
          declaredType = payload?.contentType;
        } catch {
          throw new Error("Malformed upload request");
        }

        const purpose = documentUploadPurpose(claimedPurpose);
        if (!purpose) throw new Error("That is not a kind of document this app files");
        const target = DOCUMENT_UPLOAD_TARGETS[purpose];

        // The capability the ACTION behind this purpose asserts — mirrored
        // rather than invented, and null for four of the five. See the
        // `capability` field's own note in lib/document-uploads.ts for why
        // a stricter token would not close the debt it looks like it
        // closes.
        if (target.capability && !can(context, target.capability)) {
          throw new Error(target.refusal);
        }

        if (typeof declaredType !== "string" || !isAllowedDocumentType(declaredType)) {
          throw new Error("Upload a PDF, PNG, JPEG, or WEBP file");
        }

        // WHOSE FILE THIS IS, established before the path is judged —
        // because "is this path this owner's" is only worth asking once
        // the owner has been proved to be the caller's.
        let ownerId: string;
        if (target.scope === "job") {
          if (typeof claimedOwnerId !== "string" || !claimedOwnerId) {
            throw new Error("A job is required");
          }
          const job = await prisma.job.findUnique({
            where: { id: claimedOwnerId },
            select: { id: true, companyId: true },
          });
          if (!job || job.companyId !== context.companyId) {
            throw new Error("Job not found");
          }
          ownerId = job.id;
        } else {
          // NOT read from the payload. The owner of a compliance document
          // is the company the session belongs to, so there is nothing to
          // verify and nothing to trust: a caller naming another company
          // gets a token for THEIR OWN folder, which will not match the
          // pathname they asked to write to, and the mint fails below.
          ownerId = context.companyId;
        }

        if (!isDocumentUploadPathname(pathname, purpose, ownerId)) {
          throw new Error("That upload path does not belong to this record");
        }

        return {
          // ONE TYPE, at the one cap. The store enforces the signed list
          // and refuses a PUT whose content type is not on it
          // (@vercel/blob@2.8.0 dist/chunk-YYMLUMXS.js:653 maps exactly
          // that response), so a client that declares a PDF and sends
          // something else costs itself an upload and nothing more. Unlike
          // site capture there is no per-kind ceiling to choose between:
          // all four document types share one number.
          allowedContentTypes: [declaredType],
          maximumSizeInBytes: DOCUMENT_UPLOAD_MAX_BYTES,
          addRandomSuffix: true,
          // Echoed ONLY to `onUploadCompleted`, which this route
          // deliberately does not implement, so nothing reads it today.
          // What actually binds the token is the pathname above:
          // `handleUpload` signs it (dist/client.js:274-278 -> :481-487)
          // and the store refuses a PUT that does not match
          // (`client_token_pathname_mismatch`, dist/chunk-YYMLUMXS.js:656).
          // Kept because it costs nothing and is what a future
          // `onUploadCompleted` would need on the day somebody adds one.
          tokenPayload: JSON.stringify({ purpose, ownerId }),
        };
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    // Everything above throws into here: a body that is not JSON, an
    // unknown purpose, a missing capability, a job that is not theirs, a
    // pathname that is not this record's.
    //
    // THE BROWSER NEVER SEES THIS SENTENCE. `@vercel/blob/client` discards
    // the body of any non-2xx response from this route —
    // `if (!res.ok) { throw new BlobError("Failed to  retrieve the client
    // token"); }`, dist/client.js:398-400 — so the person gets that string
    // and nothing else. It is still returned, and still specific, because
    // it is what a server log, a `curl` and any future non-SDK caller get.
    // What the person is shown instead is `documentUploadErrorMessage`,
    // which says the reason was not passed on rather than inventing one.
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
