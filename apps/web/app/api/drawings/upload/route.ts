import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { MAX_DRAWING_BYTES } from "@/lib/sheet-pins";

export const dynamic = "force-dynamic";

/**
 * THE TOKEN THAT LETS THE BROWSER PUT A DRAWING IN OUR STORE DIRECTLY.
 *
 * **WHY THE FILE DOES NOT GO THROUGH A SERVER ACTION, which is the whole
 * reason this route exists.** The first version posted the PDF to an action as
 * FormData. That cannot work and the ceiling is not ours to raise:
 *
 *   - a Next Server Action body defaults to **1 MB**;
 *   - and Vercel caps a serverless request body at **4.5 MB** whatever Next is
 *     configured to allow.
 *
 * A single architectural sheet is bigger than that and a full set is 10-100MB,
 * so there is no value of `bodySizeLimit` that makes the old shape work. Diego
 * hit it on the first real drawing he tried, and the error said "could not be
 * read as a PDF" — see `SheetPinSurface` for why it said the wrong thing.
 *
 * `upload()` in the browser asks this route for a short-lived token and then
 * sends the bytes straight to blob storage. Nothing large touches a function.
 *
 * **THIS ROUTE IS THE ONLY PLACE THE UPLOAD IS AUTHORISED**, so it does the
 * whole check rather than trusting anything the client said: the caller must
 * be signed in, must hold MANAGE_JOBS, and the revision they name must be on
 * their own company. A token is minted for one pathname and one content type.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const context = await requireCompanyContext();
        if (!can(context, "MANAGE_JOBS")) {
          throw new Error("You do not have permission to add drawings.");
        }

        // The client says which revision it is uploading for. Checked against
        // this company rather than believed: a token is a capability, and one
        // minted for somebody else's revision would be exactly the provenance
        // hole #195 closed on photos.
        const revisionId = typeof clientPayload === "string" ? clientPayload : "";
        const revision = await prisma.drawingRevision.findFirst({
          where: { id: revisionId, set: { companyId: context.company.id } },
          select: { id: true },
        });
        if (!revision) throw new Error("That drawing revision is not on this account.");

        // And the path has to be one of ours. `addRandomSuffix` already stops
        // an overwrite; this keeps a caller from scattering files across the
        // store under names that mean nothing.
        if (!pathname.startsWith(`drawings/${revision.id}/`) && !pathname.startsWith(`sheets/${revision.id}/`)) {
          throw new Error("That upload path is not one this app issues.");
        }

        return {
          allowedContentTypes: ["application/pdf", "image/png"],
          maximumSizeInBytes: MAX_DRAWING_BYTES,
          addRandomSuffix: true,
          tokenPayload: revision.id,
        };
      },
      // Vercel calls this when the upload lands. We do NOT record the drawing
      // here: this callback cannot reach a localhost dev server, so making it
      // the recording step would mean the feature only works in production.
      // The browser tells us the URL instead, through an ordinary action.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(result);
  } catch (error) {
    // A readable sentence rather than a digest: this is the one failure the
    // person will see if their session or permission is wrong.
    const message = error instanceof Error ? error.message : "That upload could not be authorised.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
