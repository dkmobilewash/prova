import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  INTAKE_MAX_FILE_BYTES,
  isAllowedIntakeType,
  isIntakePathname,
} from "@/lib/intake/upload";

/**
 * The browser uploads each dropped file to Vercel Blob DIRECTLY; this route
 * only says whether it may, and on what terms.
 *
 * WHY THIS EXISTS RATHER THAN A SERVER ACTION, in one line: Next caps a
 * Server Action body at exactly 1MB, multipart file parts included, and a
 * scanned 40-page submittal is not 1MB. `app/api/job-media/upload/route.ts`
 * carries the full account with the line numbers; this is the same shape
 * for a different prefix and everything in that header applies here.
 *
 * WHAT THE CLIENT CANNOT DO. The browser picks the files and calls
 * `upload()` once per file; everything that decides access is here:
 *
 *   - who is asking          `requireCompanyContext()`
 *   - whether they may       `can(context, "MANAGE_JOBS")`
 *   - WHERE IT MAY LAND      `isIntakePathname(pathname, companyId)`
 *   - what may be uploaded   `allowedContentTypes`
 *   - how big                `maximumSizeInBytes`
 *
 * THE PATHNAME CHECK IS NOT DECORATION. The store is one store shared by
 * every tenant, so without it a token could be minted for a pathname in
 * another company's folder — and the URL that came back would then pass
 * every check `recordIntakeDocument` had. This is the only one of the three
 * enforcement points that can stop the token existing in the first place.
 *
 * THE COMPANY IS NEVER TAKEN FROM THE REQUEST. Unlike the job-media route,
 * which reads a job id out of `clientPayload` and then verifies it, there
 * is nothing to verify here: the folder a file may land in is decided by
 * the SESSION, so a caller cannot name one. The `clientPayload` carries only
 * the content type, which is a claim the store itself then enforces —
 * declaring `application/pdf` and sending something else gets the PUT
 * refused with `contentType … is not allowed` (@vercel/blob@2.8.0
 * dist/chunk-YYMLUMXS.js:653). The lie costs the liar an upload.
 *
 * WHY THE ROW IS NOT WRITTEN HERE. `handleUpload` also offers
 * `onUploadCompleted`, which is an inbound webhook FROM Vercel and
 * therefore cannot reach a laptop — building it that way gives you a
 * feature that works in production and silently records nothing in local
 * development. The browser calls `recordIntakeDocument` with the returned
 * URL instead; that payload is a few hundred bytes.
 *
 * `addRandomSuffix` is not optional, for the reason lib/blob.ts spells out:
 * these blobs are `access: "public"`, so the only thing between a GC's
 * executed subcontract and anyone on the internet is that the URL cannot be
 * guessed from an id and a filename. It also means a folder containing two
 * files called `COI.pdf` does not overwrite itself, which a real drop does
 * routinely.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Parsed INSIDE the try: `request.json()` throws on a body that is not
    // JSON, and outside it that is an unhandled rejection — a framework 500
    // from a route whose entire error contract is "400 and a sentence".
    const body = (await request.json()) as HandleUploadBody;

    const result = await handleUpload({
      body,
      request,
      // The first argument IS the pathname the browser asked to write to.
      // Ignoring it is the whole of a cross-tenant hole.
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const context = await requireCompanyContext();
        if (!can(context, "MANAGE_JOBS")) {
          throw new Error("Document intake isn't part of your job function.");
        }

        let declaredType: unknown;
        try {
          const payload = JSON.parse(clientPayload ?? "{}");
          declaredType = payload?.contentType;
        } catch {
          throw new Error("Malformed upload request");
        }
        if (typeof declaredType !== "string" || !isAllowedIntakeType(declaredType)) {
          throw new Error("That is not a file type this app can take in");
        }

        if (!isIntakePathname(pathname, context.companyId)) {
          throw new Error("That upload path does not belong to this company");
        }

        return {
          allowedContentTypes: [declaredType],
          maximumSizeInBytes: INTAKE_MAX_FILE_BYTES,
          addRandomSuffix: true,
          // Nothing reads this — `tokenPayload` is echoed only to
          // `onUploadCompleted`, which this route deliberately does not
          // implement. What actually binds the token is the PATHNAME above:
          // `handleUpload` signs it into the token and the store refuses a
          // PUT whose pathname does not match (the
          // `client_token_pathname_mismatch` case). Kept because it costs
          // nothing and is what an `onUploadCompleted` would need on the day
          // one is added.
          tokenPayload: JSON.stringify({ companyId: context.companyId }),
        };
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    // THE BROWSER NEVER SEES THIS SENTENCE. `@vercel/blob/client` discards
    // the body of any non-2xx response from this route
    // (dist/client.js:398-400) and throws its own "Failed to  retrieve the
    // client token" instead. It is still returned, and still specific,
    // because it is what a server log and a `curl` get; what the person is
    // shown is `intakeUploadErrorMessage`, which says the reason was not
    // passed on rather than inventing one.
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
