/**
 * The upload policy for the intake tray: what may be dropped in, how much
 * of it, and where in the blob store it is allowed to land.
 *
 * Pure and session-free, so the two places that ENFORCE these rules — the
 * token route and the recording action — import rather than restate them. A
 * second copy of an allowlist is how `LOCATION_TYPES` came to disagree with
 * its own Prisma enum (CLAUDE.md).
 *
 * EVERY RULE HERE IS `lib/job-media.ts`'s RULE WITH THE COMPANY IN PLACE OF
 * THE JOB, and it is a security boundary rather than filing. The blob store
 * is ONE store shared by every tenant; `recordIntakeDocument` is a Server
 * Action, which is an endpoint any signed-in caller can post to directly.
 * Without a prefix bound to something the server has verified, a caller
 * could hand it a URL for somebody else's file and get a row of their own
 * pointing at it.
 *
 * WHY THE COMPANY ID IS IN THE PATH, when lib/blob.ts records at length
 * that publishing a companyId in a blob path was a mistake for compliance
 * documents. That entry's objection is specific: those links are routinely
 * emailed to GCs and insurers, so the path carried the id to outsiders. An
 * intake URL is never sent anywhere — it is opened from this screen, by
 * somebody already signed in to that company — and unlike a photo, an
 * intake document belongs to no job yet, so there is no narrower thing to
 * scope it by. The alternative is no prefix at all, which is the hole
 * above. `addRandomSuffix` still does the work of making the URL
 * unguessable; this decides who may write where.
 */

/**
 * What a GC's document drop actually contains.
 *
 * PDF first, because almost all of it is: transmittals, returned
 * submittals, COIs, pay applications, executed contracts. Images are here
 * because a superintendent photographs a marked-up drawing as often as they
 * scan it. The two office formats are here because schedules of values and
 * certified-payroll workbooks still arrive as .xls/.xlsx more often than
 * anyone would like, and a file this screen refuses is a file that goes
 * back to living in an inbox.
 *
 * Deliberately NOT a wildcard. The store enforces exactly this list on the
 * transfer itself (the signed token carries it), so it is the difference
 * between a tray and a place anybody can put anything.
 */
const INTAKE_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
  "text/csv",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export const INTAKE_ACCEPT_ATTRIBUTE = INTAKE_CONTENT_TYPES.join(",");

export function isAllowedIntakeType(contentType: string): boolean {
  return (INTAKE_CONTENT_TYPES as readonly string[]).includes(contentType);
}

/**
 * How many files one drop may carry.
 *
 * Sized against the thing this screen exists for: the folder a
 * superintendent hands over after a month of a job, which is tens of files
 * rather than thousands. 120 is comfortably above that and low enough that
 * the browser is not opening an unbounded number of uploads.
 *
 * STATED IN THE UI rather than enforced silently. A drop of 300 files that
 * quietly processes 120 of them is worse than a refusal, because the 180
 * missing ones look exactly like files that were filed.
 */
export const INTAKE_MAX_FILES = 120;

/** 25MB a file. A scanned 40-page submittal is 5-15MB; a drawing set PDF
 * can reach this and anything past it is a full set, which belongs on
 * `/drawings` as a revision rather than in a tray. */
export const INTAKE_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** The public host every Vercel Blob URL sits under. */
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

const INTAKE_ROOT = "document-intake";

/** The ids this schema issues are cuids. Checked rather than assumed
 * because an id carrying a `/` would build a prefix that scopes nothing,
 * and this function's whole job is to be the thing that scopes. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function intakePathPrefix(companyId: string): string | null {
  return SAFE_ID.test(companyId) ? `${INTAKE_ROOT}/${companyId}/` : null;
}

/** At most this much of the person's own filename survives. The store caps
 * a whole pathname at 950 characters; this is far below it and keeps the
 * name readable in the store's own dashboard. */
const MAX_FILE_NAME_LENGTH = 120;

/**
 * The person's filename, reduced to something that cannot change the shape
 * of the path it is appended to.
 *
 * A folder drop DOES hand over directories — `webkitdirectory` gives each
 * file a `webkitRelativePath` — so unlike the photo capture this is not a
 * theoretical input. Runs of dots collapse (no `..` survives), separators
 * and anything outside a conservative set become `-`, and a name that
 * reduces to nothing becomes "document" rather than an empty segment.
 */
export function intakeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/\.{2,}/g, ".")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, MAX_FILE_NAME_LENGTH);
  return cleaned || "document";
}

/** Where the browser is told to put this file, or null when the company id
 * is not one this app could have issued — a refusal, not a fallback. */
export function intakeUploadPathname(companyId: string, fileName: string): string | null {
  const prefix = intakePathPrefix(companyId);
  return prefix ? `${prefix}${intakeFileName(fileName)}` : null;
}

/**
 * Does this store pathname belong to this company — and only to it?
 *
 * The trailing `/` in the prefix is load-bearing: without it a company id
 * would match a blob under another company's folder whose id merely starts
 * with the same characters.
 *
 * The remainder must be ONE segment. No `/` (so nothing can climb out into
 * another company's folder), no `..`, and no percent-encoded `/` or `.`
 * either — `new URL()` normalises a literal `../` but leaves `%2e%2e`
 * alone, and what the store does with an encoded separator is not something
 * this repo can verify, so it is refused rather than reasoned about.
 */
export function isIntakePathname(pathname: string, companyId: string): boolean {
  const prefix = intakePathPrefix(companyId);
  if (!prefix || !pathname.startsWith(prefix)) return false;

  const rest = pathname.slice(prefix.length);
  if (!rest || rest.includes("/") || rest.includes("..")) return false;
  const lowered = rest.toLowerCase();
  return !lowered.includes("%2f") && !lowered.includes("%2e");
}

/**
 * Is this stored URL a file uploaded into THIS company's tray?
 *
 * PARSED, NOT PATTERN-MATCHED, and the difference is the security. A
 * substring test for the hostname passes on
 * `https://x.public.blob.vercel-storage.com@evil.test/…`, where everything
 * before the `@` is userinfo and the real host is `evil.test`.
 *
 * Exactly one leading slash is stripped, not all of them: `//document-intake/…`
 * is a different store key than `/document-intake/…`, and collapsing the
 * two would let a caller name a blob this prefix does not cover.
 */
export function isIntakeBlobUrl(candidate: string, companyId: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(BLOB_HOST_SUFFIX)) return false;
  return isIntakePathname(url.pathname.replace(/^\//, ""), companyId);
}

/** Human file size for a table cell. Coarse on purpose — "4.2 MB" reads at
 * a glance and nobody needs the bytes. */
export function formatIntakeSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * What to tell someone whose upload was refused before the bytes moved.
 *
 * `@vercel/blob/client` NEVER READS THE BODY of a non-2xx response from a
 * token route — `dist/client.js:398-400` throws "Failed to  retrieve the
 * client token" with the body untouched — so every sentence the route wrote
 * is discarded in the browser. Rather than show a library's internal
 * phrasing for a refusal it did not explain, this says what the route can
 * actually have refused for, and says the reason was not passed on.
 */
export function intakeUploadErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  if (/retrieve the client token/i.test(raw)) {
    return "Storage would not authorise this upload, and does not pass on the reason. Reload the page — a signed-out session, or access that has changed, is what this usually is.";
  }
  return raw || "Upload failed";
}


/**
 * The person's own filename, fit to show in a table.
 *
 * DELIBERATELY NOT `intakeFileName`. That one builds a STORE PATH and so
 * replaces every run of non-`[A-Za-z0-9._-]` with a hyphen — correct for a
 * URL, wrong for a label. Using it on the display name turned
 * `Nevada contractor's license C-4.pdf` into
 * `Nevada-contractor-s-license-C-4.pdf` on screen, and — because the same
 * string was handed to the classifier — cost that file its HIGH confidence,
 * since the compliance pattern needs the apostrophe and the space that the
 * sanitiser had just removed.
 *
 * So this keeps the characters and only does what a label needs:
 *
 *   - drops any directory part, because a dropped FOLDER gives
 *     `webkitRelativePath`-style names and the row wants the leaf;
 *   - strips control characters, which have no business in a cell;
 *   - collapses whitespace, so a name that wrapped oddly does not;
 *   - bounds the length, since this is unvalidated input rendered into a page.
 *
 * NOT an escaping function and not a security boundary: React escapes what it
 * renders, and nothing here ever becomes a path. The store path is built by
 * `intakeUploadPathname` and enforced by `isIntakePathname` on the token
 * route, which are the two places that DO need sanitising.
 */
export function displayFileName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/).pop() ?? "";
  const cleaned = leaf
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH);
  return cleaned || "document";
}
