import type { Capability } from "@/lib/permissions";
import { isBlobStorageUrl, isOurBlobStoreUrl, type BlobCredentialEnv } from "@/lib/blob-urls";

/**
 * Where a DOCUMENT is allowed to live in the blob store, what may be
 * uploaded, how big it may be, and who may ask for a token to put one
 * there.
 *
 * WHY THIS EXISTS — issue #27. Five Server Actions took the file itself
 * through a `FormData`, each declaring its own `15 * 1024 * 1024` guard,
 * and not one of those guards had ever fired for the case it describes:
 * Next caps a Server Action body at exactly 1MB unless
 * `experimental.serverActions.bodySizeLimit` says otherwise, and
 * `next.config.mjs` does not.
 *
 *     // next@15.5.23 dist/server/app-render/action-handler.js:479
 *     const bodySizeLimitBytes = bodySizeLimit !== defaultBodySizeLimit
 *       ? bytes.parse(bodySizeLimit) : 1024 * 1024 // 1 MB
 *
 * That ceiling covers MULTIPART FILE BODIES TOO — the size-counting
 * `Transform` is piped INTO busboy (`:614-640`) rather than placed after
 * it — so a scanned subcontract, which is the normal case, was rejected by
 * the framework with an opaque error before a line of ours ran. A 15MB
 * limit sitting behind a 1MB one is not a limit; it is a sentence nobody
 * could reach.
 *
 * THE ALTERNATIVE AND WHY IT IS NOT TAKEN. Raising `bodySizeLimit` to 15MB
 * is one line and would make all five guards reachable today. It also
 * buffers every uploaded file in server memory on the way through, and
 * this repo had already built and proved the other path for site capture
 * (`app/api/job-media/upload/route.ts`, #195). So this module is that
 * mechanism generalised rather than a second way to upload a file: the
 * browser PUTs the bytes straight to Vercel Blob under a one-shot token,
 * and the Server Action records the URL that comes back.
 *
 * PURE AND SESSION-FREE, the same split `lib/job-media.ts` uses: the rules
 * are decidable and testable here, and the three places that enforce them
 * — the token route, the recording action, and the browser — import rather
 * than restate. A second copy of an allowlist is how `LOCATION_TYPES` came
 * to disagree with its own Prisma enum (CLAUDE.md).
 */

/**
 * What may be uploaded as a document.
 *
 * The same four types all five actions already accepted, unchanged and now
 * written once. PDFs because that is what a GC emails; the three image
 * types because half of these arrive as a phone photograph of a piece of
 * paper on a truck bonnet.
 *
 * HEIC is deliberately NOT here even though `lib/job-media.ts` accepts it
 * for photographs, and the reason is downstream rather than aesthetic:
 * `extractComplianceDocument` hands the bytes to Anthropic, whose document
 * and image blocks take exactly this list
 * (`packages/integrations/src/anthropic.ts:108`). Accepting a format the
 * extractor cannot read would store a file and then fail on it.
 */
export const DOCUMENT_UPLOAD_CONTENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type DocumentUploadContentType = (typeof DOCUMENT_UPLOAD_CONTENT_TYPES)[number];

export function isAllowedDocumentType(
  contentType: string,
): contentType is DocumentUploadContentType {
  return (DOCUMENT_UPLOAD_CONTENT_TYPES as readonly string[]).includes(contentType);
}

/**
 * 15MB — the number the five actions already declared, kept exactly, and
 * for the first time ENFORCEABLE.
 *
 * It is handed to the store as `maximumSizeInBytes` when the token is
 * minted, so the store refuses the transfer itself rather than a function
 * refusing bytes it has already received. That is the whole difference
 * between this number and the five copies it replaces.
 *
 * Why not raise it while we are here: a bigger cap is a product decision
 * about what a jobsite connection can finish, and #27 is about a limit
 * that never ran rather than about the limit being wrong. Changing the
 * number in the same change that makes it work would make it impossible to
 * tell which one a later problem came from.
 */
export const DOCUMENT_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

/**
 * WHAT IS BEING UPLOADED, which is not the same question as where it goes.
 *
 * Two purposes share the `contracts/<jobId>/` folder — an ordinary
 * contract document and a recorded executed subcontract — and they do NOT
 * share a guard: `recordExecutedSubcontract` asserts MANAGE_JOBS and
 * `uploadContractDocument` asserts nothing beyond company membership. So
 * the token route cannot key on the folder; it keys on the purpose, and
 * each purpose carries the guard of the ACTION it feeds. A route that
 * guarded the folder would have to pick one of the two, and either choice
 * is wrong: the loose one hands a MANAGE_JOBS-less caller a token the
 * executed-subcontract action would refuse, the strict one refuses a
 * caller the contract-document action admits and leaves them with a form
 * that cannot work.
 */
export const DOCUMENT_UPLOAD_PURPOSES = [
  "dispatch-slip",
  "prevailing-wage",
  "contract-document",
  "executed-subcontract",
  "compliance-document",
] as const;

export type DocumentUploadPurpose = (typeof DOCUMENT_UPLOAD_PURPOSES)[number];

/** Who the file belongs to. A job for four of the five; the COMPANY for
 * compliance documents, which is the one that needed its own reasoning —
 * see `DOCUMENT_UPLOAD_TARGETS`. */
export type DocumentUploadScope = "job" | "company";

export type DocumentUploadTarget = {
  /** The store folder, without the owner id and without a trailing slash. */
  readonly root: string;
  readonly scope: DocumentUploadScope;
  /**
   * The capability the ACTION this token feeds asserts, or null when that
   * action asserts none beyond company membership.
   *
   * MIRRORED, NEVER INVENTED, and that is a deliberate choice rather than
   * laziness. Four of these five actions are recorded in
   * `lib/action-capability-guards.test.ts` as open — three because the job
   * page they are reached from is itself open to every signed-in member,
   * and `compliance.uploadComplianceDocument` as a listed, counted debt
   * behind a guarded page. Making the TOKEN stricter than the ACTION would
   * not close that debt; it would produce a form whose upload step refuses
   * somebody the recording step would have admitted, which is a harder
   * failure to diagnose than the open action and does not fix it. Closing
   * it means closing the action, in the action's own module, and this line
   * follows it when somebody does.
   */
  readonly capability: Capability | null;
  /** What the person is told when that capability is missing. Never
   * reaches the browser through the SDK (see `documentUploadErrorMessage`),
   * but it is what a server log and any non-SDK caller get. */
  readonly refusal: string;
};

export const DOCUMENT_UPLOAD_TARGETS: Record<DocumentUploadPurpose, DocumentUploadTarget> = {
  "dispatch-slip": {
    root: "dispatch-slips",
    scope: "job",
    capability: null,
    refusal: "Dispatch slips aren't part of your job function.",
  },
  "prevailing-wage": {
    root: "prevailing-wage",
    scope: "job",
    capability: null,
    refusal: "Wage determinations aren't part of your job function.",
  },
  "contract-document": {
    root: "contracts",
    scope: "job",
    capability: null,
    refusal: "Contract documents aren't part of your job function.",
  },
  "executed-subcontract": {
    root: "contracts",
    scope: "job",
    // The one that is not null, because `recordExecutedSubcontract`
    // asserts it (lib/actions/jobs.ts). Same folder as the line above and
    // a different guard, which is why purpose rather than folder is the
    // key of this table.
    capability: "MANAGE_JOBS",
    refusal: "Managing jobs isn't part of your job function.",
  },
  "compliance-document": {
    root: "compliance",
    scope: "company",
    capability: null,
    refusal: "Compliance documents aren't part of your job function.",
  },
};

/** The purpose a client claimed, or null. A claim to check, never an
 * instruction — the caller is a browser and the value arrives as a string
 * in a JSON blob. */
export function documentUploadPurpose(value: unknown): DocumentUploadPurpose | null {
  return typeof value === "string" &&
    (DOCUMENT_UPLOAD_PURPOSES as readonly string[]).includes(value)
    ? (value as DocumentUploadPurpose)
    : null;
}

/**
 * THE PATHNAME IS THE SECURITY, NOT THE FILING, and everything below this
 * line exists for one reason: ONE VERCEL BLOB STORE SERVES EVERY TENANT.
 *
 * A URL from it proves the file is in our store. It proves nothing about
 * whose file it is. `lib/job-media.ts` records what that cost for site
 * photos — a signed-in user of company A recorded company B's photo as a
 * row they legitimately owned, and deleting their own row handed B's URL
 * to `del()` — and the document paths need exactly the same treatment,
 * with one difference that has to be reasoned about separately and is,
 * below.
 *
 * THREE ENFORCEMENT POINTS, which must agree:
 *
 *   1. the browser uploads to `<root>/<ownerId>/<file>` and nowhere else
 *      (`documentUploadPathname`, called by the form);
 *   2. `/api/documents/upload` refuses to MINT a token for any other
 *      pathname, AFTER it has proved the owner is the caller's — and this
 *      is the only one of the three that can stop the token existing. The
 *      signed client token carries the pathname (@vercel/blob@2.8.0
 *      dist/client.js:274-278 -> :481-487) and the store rejects a PUT
 *      that does not match it (`client_token_pathname_mismatch`,
 *      dist/chunk-YYMLUMXS.js:656);
 *   3. the recording action requires the STORED URL's own path to sit
 *      under the same prefix. A Server Action is an endpoint anyone with a
 *      session can post to directly, so it is not entitled to assume the
 *      caller came through step 2 at all.
 *
 * THE COMPANY-SCOPED ONE IS DIFFERENT AND IS NOT AN EXCEPTION. For the
 * four job-scoped purposes the id in the path is a JOB, and the job is
 * re-read from the database and checked against the caller's company
 * before the path is judged — so `contracts/<job>/` cannot be another
 * company's. For `compliance/<companyId>/` the owner IS the company, so
 * there is nothing to look up and nothing to compare: the id is taken from
 * the SESSION and never from the request. A caller who names another
 * company's id gets a pathname built from their own and a mismatch against
 * the one they asked for, which is a refusal rather than a check that
 * happens to pass.
 *
 * NO companyId IN A JOB PATH, deliberately — lib/blob.ts records that the
 * compliance path publishing the companyId put it in front of every GC and
 * insurer a link was emailed to, and the jobId alone is enough because
 * job -> company is verified server-side first. The compliance path keeps
 * its companyId because it is what identifies the owner and because
 * changing it would strand every document already stored under it.
 *
 * WHAT IS NOT PROVEN FROM SOURCE, said plainly: `addRandomSuffix: true` is
 * applied by the STORE, so no file under node_modules shows where the
 * suffix lands. The evidence that it lands on the FILENAME and leaves the
 * folders alone is the SDK's description of a pathname as what "will
 * influence the URL of your blob" (dist/index.d.ts:455) and this repo's
 * own fake for the same API. If that is ever wrong these checks FAIL
 * CLOSED — the record is refused and no row is written — rather than
 * admitting a file they should not.
 */

/** The ids this schema issues are cuids. Checked rather than assumed
 * because an id carrying a `/` would build a prefix that scopes nothing,
 * and scoping is this function's whole job. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** At most this much of the person's own filename survives into the store
 * pathname. The store caps a whole pathname at 950 characters
 * (dist/chunk-YYMLUMXS.js:541); this is far below it and keeps the name
 * readable in the store's own dashboard. */
const MAX_FILE_NAME_LENGTH = 120;

function documentPathPrefix(purpose: DocumentUploadPurpose, ownerId: string): string | null {
  if (!SAFE_ID.test(ownerId)) return null;
  return `${DOCUMENT_UPLOAD_TARGETS[purpose].root}/${ownerId}/`;
}

/**
 * The person's filename, reduced to something that cannot change the shape
 * of the path it is appended to.
 *
 * A file input never hands over a directory, but the token route is an
 * endpoint and the remainder rule in `isDocumentUploadPathname` is strict —
 * so the name is made to satisfy it here rather than discovered to violate
 * it after 8MB has been transferred. Runs of dots collapse (no `..`
 * survives), separators and anything outside a conservative set become
 * `-`, and a name that reduces to nothing becomes "document" rather than
 * an empty segment.
 */
export function documentUploadFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/\.{2,}/g, ".")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, MAX_FILE_NAME_LENGTH);
  return cleaned || "document";
}

/** Where the browser is told to put this file. Null when the owner id is
 * not one this app could have issued, which is a refusal, not a fallback. */
export function documentUploadPathname(
  purpose: DocumentUploadPurpose,
  ownerId: string,
  fileName: string,
): string | null {
  const prefix = documentPathPrefix(purpose, ownerId);
  return prefix ? `${prefix}${documentUploadFileName(fileName)}` : null;
}

/**
 * Does this store pathname belong to this purpose and this owner — and
 * only to them?
 *
 * The trailing `/` in the prefix is load-bearing: without it job `abc`
 * would match a blob under `contracts/abc123/`, which is a different
 * company's job that merely starts with the same characters.
 *
 * The remainder must be ONE segment. No `/` (so nothing can climb out into
 * another owner's folder), no `..`, and no percent-encoded `/` or `.`
 * either — `new URL()` normalises a literal `../` but leaves `%2e%2e`
 * alone, and what the store does with an encoded separator is not
 * something this repo can verify, so it is refused rather than reasoned
 * about.
 */
export function isDocumentUploadPathname(
  pathname: string,
  purpose: DocumentUploadPurpose,
  ownerId: string,
): boolean {
  const prefix = documentPathPrefix(purpose, ownerId);
  if (!prefix || !pathname.startsWith(prefix)) return false;

  const rest = pathname.slice(prefix.length);
  if (!rest || rest.includes("/") || rest.includes("..")) return false;
  const lowered = rest.toLowerCase();
  return !lowered.includes("%2f") && !lowered.includes("%2e");
}

/**
 * Is this stored URL a file uploaded for THIS purpose, against THIS owner?
 *
 * The one check each recording action needs, and the only thing standing
 * between a signed-in caller and another company's file: the URL recorded
 * is the URL `deleteDocument` later hands to `del()`.
 *
 * Exactly one leading slash is stripped, not all of them. A path of
 * `//contracts/<jobId>/x.pdf` is a different store key than
 * `/contracts/<jobId>/x.pdf`, and collapsing the two would let a caller
 * name a blob this prefix does not actually cover.
 *
 * Deliberately does NOT answer "is this our store" — that is
 * `isOurBlobStoreUrl` in lib/blob-urls.ts, and the two are separate
 * because the path is exactly the part an attacker with a store of their
 * own gets to choose. Every caller runs both; a caller that runs only this
 * one is the bug `recordJobMedia` shipped before #195 fixed it.
 */
export function isDocumentBlobUrl(
  candidate: string,
  purpose: DocumentUploadPurpose,
  ownerId: string,
): boolean {
  if (!isBlobStorageUrl(candidate)) return false;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  return isDocumentUploadPathname(url.pathname.replace(/^\//, ""), purpose, ownerId);
}

/**
 * THE CHECK EVERY RECORDING ACTION RUNS, as one call, and the reason it is
 * one call rather than two.
 *
 * A stored document URL has to satisfy two independent things, and each of
 * them is worthless alone:
 *
 *   - it came from OUR store. `isBlobStorageUrl` proves only "some Vercel
 *     blob store", and anyone can create one — so a caller who knows a job
 *     id could put `contracts/<jobId>/x.pdf` in a store of their own, post
 *     that URL, and have the job page link somebody to a file they
 *     control. The path cannot catch that: the path is exactly the part
 *     they choose;
 *   - it sits under THIS purpose's folder for THIS owner. The store is
 *     shared by every tenant, so a URL from it says nothing about whose
 *     file it is — and the URL recorded here is the URL `deleteDocument`
 *     later hands to `del()`.
 *
 * They are one function because running only the second is precisely the
 * bug `recordJobMedia` shipped with, and a helper that can be half-called
 * invites it back. Returns the sentence to show, or null when the URL is
 * good.
 */
export function documentUrlProblem(
  candidate: string,
  purpose: DocumentUploadPurpose,
  ownerId: string,
  env: BlobCredentialEnv,
): string | null {
  if (!isOurBlobStoreUrl(candidate, env)) {
    return "That file did not come from this app's storage.";
  }
  if (!isDocumentBlobUrl(candidate, purpose, ownerId)) {
    return DOCUMENT_UPLOAD_TARGETS[purpose].scope === "job"
      ? "That file was not uploaded to this job."
      : "That file was not uploaded to this company.";
  }
  return null;
}

/** How much of a person's own filename is kept as the DISPLAY name on the
 * row — the link text in a list, and nothing else. Longer than the
 * pathname allowance because nothing downstream is a path here, short
 * enough that a pasted name cannot wreck a list. */
const MAX_DISPLAY_NAME_LENGTH = 200;

/**
 * The filename to STORE beside the row, from what the browser reported.
 *
 * Deliberately not derived from the blob pathname: the store appends a
 * random suffix, so the stored URL's last segment reads
 * `subcontract-r4nd0m1.pdf` and showing that to a person is worse than
 * showing them what they picked. It is the same value the old
 * `File`-carrying actions stored (`file.name`), arriving by a different
 * route and now bounded — directory parts dropped, control characters
 * removed, length capped. Null when nothing usable is left, which every
 * caller stores as a null `fileName` rather than inventing one.
 */
export function documentDisplayFileName(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  return cleaned || null;
}

/**
 * What to tell someone whose upload was refused before the bytes moved.
 *
 * `@vercel/blob/client` NEVER READS THE BODY OF A NON-2XX RESPONSE from a
 * token route: `if (!res.ok) { throw new BlobError("Failed to  retrieve
 * the client token"); }` — dist/client.js:398-400, double space and all,
 * with the body untouched. So every carefully worded sentence
 * `/api/documents/upload` returns is discarded in the browser and replaced
 * by that string. There is no option to change it and no field it survives
 * in.
 *
 * The twin of `jobMediaUploadErrorMessage`, worded for documents rather
 * than shared with it: the wording is the whole content of both functions,
 * and a shared one would have to say "file" where each says what the
 * person was actually doing.
 */
export function documentUploadErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  if (/retrieve the client token/i.test(raw)) {
    return "Storage would not authorise this upload, and does not pass on the reason. Reload the page — a signed-out session, or access to this job that has changed, is what this usually is.";
  }
  return raw || "Upload failed";
}

/** Human file size for a refusal sentence. Coarse on purpose: "18.4 MB"
 * is what a person needs to hear, not a byte count. */
export function formatDocumentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The refusal for a file the browser can already tell will not work, or
 * null when it will.
 *
 * Checked in the browser BEFORE any bytes move, and it is not the
 * enforcement — the token's `allowedContentTypes` and `maximumSizeInBytes`
 * are, and the store applies both to the transfer itself. This exists so a
 * person on a slow connection is told in the form rather than after a
 * failed PUT, and so the two numbers are stated in one place instead of
 * being retyped into five components.
 */
export function documentFileProblem(file: { type: string; size: number }): string | null {
  if (!isAllowedDocumentType(file.type)) {
    return `That file type isn't supported (${file.type || "the browser did not say what it is"}) — upload a PDF, PNG, JPEG, or WEBP.`;
  }
  if (file.size > DOCUMENT_UPLOAD_MAX_BYTES) {
    return `That file is ${formatDocumentSize(file.size)}, over the ${formatDocumentSize(DOCUMENT_UPLOAD_MAX_BYTES)} limit.`;
  }
  if (file.size === 0) {
    return "That file is empty.";
  }
  return null;
}
