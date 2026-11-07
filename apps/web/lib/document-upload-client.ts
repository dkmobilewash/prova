import { completeMultipartUpload, createMultipartUpload, upload, uploadPart } from "@vercel/blob/client";
import { resumableUpload, uploadKey, type MultipartCalls, type Progress, type SavedUpload } from "@/lib/resumableUpload";
import {
  documentDisplayFileName,
  documentFileProblem,
  documentUploadErrorMessage,
  documentUploadPathname,
  planTooLargeProblem,
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
  /** `resumable`: the bytes stopped on the way (Resume can pick up), as against a refusal. */
  | { ok: false; error: string; resumable?: true };

export async function uploadDocumentFile(
  purpose: DocumentUploadPurpose,
  ownerId: string,
  file: File,
): Promise<DocumentUploadOutcome> {
  // THE PURPOSE IS PASSED, and it is the whole point of this line. Without it the
  // browser would refuse a 40MB drawing set against the shared 15MB default while the
  // token the very next call mints allows 250MB — a form that says no to a file the
  // store would have taken, which is a harder failure to diagnose than no check.
  const problem = documentFileProblem(file, purpose);
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

/**
 * ── A PLAN SET: PROGRESS ALWAYS, AND IN RESUMABLE PARTS WHEN IT IS BIG ──
 *
 * Up to 100 MB, the one upload every other form uses, with its progress. Above
 * that (Vercel's own threshold for multipart), the parts `resumableUpload`
 * sends a few at a time and picks up after a dropped connection or a reload:
 * the parts already stored are saved in this browser under the file's identity.
 * Both are minted by the same route, so the type, the size ceiling and the owner
 * check are the token's, as before.
 */
export const RESUMABLE_FROM_BYTES = 100 * 1024 * 1024;

export async function uploadPlanSetFile(
  ownerId: string,
  file: File,
  options: { onProgress?: (progress: Progress) => void; signal?: AbortSignal } = {},
): Promise<DocumentUploadOutcome> {
  const purpose: DocumentUploadPurpose = "plan-takeoff";
  // The size sentence first: for a plan set it says what to do, the generic one does not.
  const problem = planTooLargeProblem(file.size) ?? documentFileProblem(file, purpose);
  if (problem) return { ok: false, error: problem };
  const fresh = documentUploadPathname(purpose, ownerId, file.name);
  if (!fresh) return { ok: false, error: "That record cannot take an attachment." };
  const clientPayload = JSON.stringify({ purpose, ownerId, contentType: file.type });

  if (file.size <= RESUMABLE_FROM_BYTES) {
    try {
      const blob = await upload(fresh, file, {
        access: "public",
        contentType: file.type,
        handleUploadUrl: "/api/documents/upload",
        clientPayload,
        onUploadProgress: (p) => options.onProgress?.({ loaded: p.loaded, total: p.total, percent: Math.floor(p.percentage) }),
        abortSignal: options.signal,
      });
      return { ok: true, fileUrl: blob.url, fileName: documentDisplayFileName(file.name) };
    } catch (err) {
      return { ok: false, error: documentUploadErrorMessage(err), resumable: true };
    }
  }

  const key = uploadKey(ownerId, file);
  const saved = readSaved(key);
  const pathname = saved?.pathname ?? fresh;
  const calls: MultipartCalls = {
    token: async () => {
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "blob.generate-client-token", payload: { pathname, clientPayload, multipart: true } }),
        signal: options.signal,
      });
      if (!res.ok) throw new Error("That file was refused before it was sent.");
      return ((await res.json()) as { clientToken: string }).clientToken;
    },
    create: (token) => createMultipartUpload(pathname, { access: "public", token, contentType: file.type }),
    part: (token, ids, partNumber, body) => uploadPart(pathname, body, { access: "public", token, key: ids.key, uploadId: ids.uploadId, partNumber, abortSignal: options.signal }),
    complete: (token, ids, parts) => completeMultipartUpload(pathname, parts, { access: "public", token, key: ids.key, uploadId: ids.uploadId, contentType: file.type }),
  };
  try {
    const blob = await resumableUpload({ file, pathname, calls, saved, save: (state) => writeSaved(key, state), onProgress: options.onProgress, signal: options.signal });
    return { ok: true, fileUrl: blob.url, fileName: documentDisplayFileName(file.name) };
  } catch (err) {
    // The parts already stored stay saved: Resume, or the same file chosen again, picks up there.
    return { ok: false, error: `${documentUploadErrorMessage(err)} The parts already sent are kept: press Resume to pick up where it stopped.`, resumable: true };
  }
}

// In this browser only, and only as a convenience: a lost entry means the upload starts over.
function readSaved(key: string): SavedUpload | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as SavedUpload);
  } catch {
    return null;
  }
}
function writeSaved(key: string, state: SavedUpload | null): void {
  try {
    if (state === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Private mode or a full store: the upload still runs, it just cannot resume after a reload.
  }
}
