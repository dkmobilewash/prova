import { isAllowedDocumentType, uploadMaxBytesFor, type DocumentUploadContentType } from "@/lib/document-uploads";

/** Fetches a spec section's stored file for a reader. A plain module, because
 * an exported function in a "use server" file is a public action. */
export async function readStoredSpecSection(
  fileUrl: string,
): Promise<{ ok: true; buffer: Buffer; mediaType: DocumentUploadContentType } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(fileUrl);
  } catch {
    return { ok: false, error: "That section couldn't be fetched from storage. Try again in a moment." };
  }
  if (!response.ok) {
    return { ok: false, error: "That section couldn't be fetched from storage. Try again in a moment." };
  }

  // THE MEDIA TYPE FROM THE STORE, never from anything a caller claimed.
  const served = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!isAllowedDocumentType(served)) {
    return { ok: false, error: "That file isn't a PDF or an image, so it can't be read." };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  // The signed token already bound the transfer to this ceiling. This is the
  // second look, taken before the bytes are base64'd and sent on — and the
  // ceiling is the SPEC one, 50MB, not the 15MB default.
  if (buffer.byteLength === 0 || buffer.byteLength > uploadMaxBytesFor("bid-spec-section")) {
    return { ok: false, error: "That file is empty or too big to read." };
  }
  return { ok: true, buffer, mediaType: served as DocumentUploadContentType };
}
