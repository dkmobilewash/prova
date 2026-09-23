import { isOurBlobStoreUrl, type BlobCredentialEnv } from "@/lib/blob-urls";
import { displayFileName, isAllowedIntakeType, isIntakeBlobUrl } from "@/lib/intake/upload";

/**
 * A file attached to one Ask question.
 *
 * NOT A SECOND PIPELINE. The bytes go up exactly the way a dropped intake
 * document does — the browser uploads straight to the blob store through
 * `/api/intake/upload`, which decides who may and where, into this
 * company's `document-intake/<companyId>/` folder. This module is the
 * policy for the part that is new: which of those files the MODEL can read,
 * how big, and the check that a URL arriving in an Ask request is this
 * company's file before a single byte of it is fetched.
 *
 * WHY A URL AND NOT THE FILE. Vercel caps a request body at ~4.5 MB and a
 * Server Action at 1 MB, and a scanned bid package is bigger than either,
 * so the ask request carries a reference and the server fetches it. That
 * turns the ask route into something that fetches a URL a browser named —
 * which is only safe because of the three checks in `askAttachmentRefusal`,
 * the same three `recordIntakeDocument` makes: is it the blob store at all,
 * is it OUR store (a URL from the store proves "some Vercel store", CLAUDE.md
 * says why that is not enough), and is it THIS company's folder.
 */

/** What the model can read. A strict subset of what intake accepts —
 * Word, Excel, HEIC and TIFF go into the tray fine but no model block
 * reads them, so they are refused HERE with a sentence rather than sent
 * and failed on. */
export const ASK_ATTACHMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
] as const;

export const ASK_ATTACHMENT_ACCEPT = ASK_ATTACHMENT_TYPES.join(",");

/** 10 MB. Below intake's 25 because this file is re-sent to the model on
 * every pass of the tool loop (cached, but still paid for), and base64 adds
 * a third — a 10 MB PDF is a ~13 MB request, well under the API's 32 MB. A
 * whole drawing set is not a question; it belongs on /drawings. */
export const ASK_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Filename prefix inside the intake folder, so a store listing shows
 * which blobs came from the Ask box rather than the tray. */
export const ASK_ATTACHMENT_PREFIX = "ask-";

export function isAskAttachmentType(contentType: string): boolean {
  return (ASK_ATTACHMENT_TYPES as readonly string[]).includes(contentType);
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The plain sentence for a file the Ask box will not take, or null. Run
 * in the browser before the upload AND on the server before anything is
 * fetched — the browser's copy is a courtesy, the server's is the rule. */
export function askAttachmentTypeOrSizeProblem(contentType: string, size: number): string | null {
  if (!isAskAttachmentType(contentType)) {
    return "Ask can read a PDF, a photo (JPEG, PNG or WebP) or a plain text or CSV file. Save a Word or Excel file as PDF first.";
  }
  if (!Number.isFinite(size) || size <= 0) return "That file is empty.";
  if (size > ASK_ATTACHMENT_MAX_BYTES) {
    return `That file is ${megabytes(size)}. Ask takes files up to ${megabytes(ASK_ATTACHMENT_MAX_BYTES)} — attach the pages you're asking about.`;
  }
  return null;
}

/** What an Ask request carries about its file. Browser input: every field
 * is re-checked on the server. */
export type AskAttachmentRef = { url: string; name: string; contentType: string; size: number };

/** Parses the request body's `attachment`, or undefined. Shape only. */
export function attachmentRefOf(value: unknown): AskAttachmentRef | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { url, name, contentType, size } = value as Record<string, unknown>;
  if (typeof url !== "string" || url.length > 1024) return undefined;
  if (typeof name !== "string" || typeof contentType !== "string") return undefined;
  if (typeof size !== "number") return undefined;
  return { url, name: displayFileName(name), contentType, size };
}

/**
 * Why this reference must not be fetched, or null.
 *
 * The ORDER is the security: nothing about size or type is worth reading
 * until the URL is known to be this company's own file.
 */
export function askAttachmentRefusal(
  ref: AskAttachmentRef,
  companyId: string,
  env: BlobCredentialEnv,
): string | null {
  if (!isOurBlobStoreUrl(ref.url, env)) return "That file did not come from this app's storage. Attach it again.";
  if (!isIntakeBlobUrl(ref.url, companyId)) return "That file isn't one of your company's. Attach it again.";
  // Intake's own allowlist first — the token route enforced it on the
  // transfer — and then the narrower list of what a model can read.
  if (!isAllowedIntakeType(ref.contentType)) return "That is not a file type this app can take in.";
  return askAttachmentTypeOrSizeProblem(ref.contentType, ref.size);
}
