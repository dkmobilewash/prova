import { upload } from "@vercel/blob/client";
import {
  documentDisplayFileName,
  documentFileProblem,
  documentUploadErrorMessage,
  documentUploadPathname,
  type DocumentUploadPurpose,
} from "@/lib/document-uploads";

/**
 * The browser half of a document upload: bytes to the blob store, then a
 * URL for the Server Action to record.
 *
 * ONE HELPER FOR ALL FIVE FORMS, because the alternative is the same
 * fifteen lines copied five times and drifting — which is how five copies
 * of `15 * 1024 * 1024` came to exist in the first place (#27). Every form
 * that attaches a document calls this and then calls its own action with
 * `fileUrl` and `fileName`.
 *
 * IT RETURNS A FAILURE, IT DOES NOT THROW. The callers are forms that
 * render an error beside the field, matching the `ActionResult` shape the
 * actions themselves use, so there is one thing to render whether the
 * upload or the recording refused.
 *
 * WHY THE FORM CHECKS TYPE AND SIZE AT ALL when the store enforces both:
 * so a person on a jobsite connection is told before eight megabytes move
 * rather than after. The enforcement is the signed token — see
 * `app/api/documents/upload/route.ts`.
 */
export type DocumentUploadOutcome =
  | { ok: true; fileUrl: string; fileName: string | null }
  | { ok: false; error: string };

export async function uploadDocumentFile(
  purpose: DocumentUploadPurpose,
  ownerId: string,
  file: File,
): Promise<DocumentUploadOutcome> {
  const problem = documentFileProblem(file);
  if (problem) return { ok: false, error: problem };

  // Null only when the owner id is not one this app could have issued,
  // which is a bug rather than a bad file — refused rather than uploaded
  // to somewhere unscoped.
  const pathname = documentUploadPathname(purpose, ownerId, file.name);
  if (!pathname) return { ok: false, error: "That record cannot take an attachment." };

  try {
    const blob = await upload(pathname, file, {
      access: "public",
      // Declared to the store as well as to the route, so the token is
      // minted for THIS type and the two sides cannot disagree. The store
      // otherwise infers a type from the pathname's extension
      // (@vercel/blob@2.8.0 dist/index.d.ts:461), which is what left site
      // capture with stored files no row pointed at.
      contentType: file.type,
      handleUploadUrl: "/api/documents/upload",
      clientPayload: JSON.stringify({ purpose, ownerId, contentType: file.type }),
    });
    return { ok: true, fileUrl: blob.url, fileName: documentDisplayFileName(file.name) };
  } catch (err) {
    // Not `err.message`: for anything the token route refuses, that is the
    // SDK's own "Failed to  retrieve the client token" and never the
    // sentence the route wrote — it discards the response body
    // (dist/client.js:398-400).
    return { ok: false, error: documentUploadErrorMessage(err) };
  }
}

/** The one file a `<input type="file">` holds, or null. Written once
 * because every caller needs the same three-line dance and `FormData.get`
 * returns `FormDataEntryValue | null`. */
export function singleFileFrom(formData: FormData, key: string): File | null {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}
