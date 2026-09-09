/**
 * The upload policy for site capture, and the read-time facts derived from
 * a stored row.
 *
 * Pure and session-free on purpose, the same split lib/permissions.ts uses
 * against lib/authz.ts: the rules are decidable and testable here, and the
 * two places that enforce them — the token route and the recording action
 * — import rather than restate. A second copy of the allowed-types list is
 * how `LOCATION_TYPES` came to disagree with its own Prisma enum and
 * silently rejected a dropdown option that the UI offered (see CLAUDE.md).
 */

/** What a phone or a laptop may upload today.
 *
 * PHOTOS ONLY, deliberately. Video is a later step and is not merely a
 * bigger number here: it needs multipart upload, a poster frame, and a
 * storage budget nobody has signed off. Leaving `video/*` out of this list
 * means an accidental video upload fails at the token with a sentence,
 * rather than succeeding and rendering as a broken image.
 *
 * HEIC/HEIF are included because that is what an iPhone shoots by default.
 * Safari usually transcodes to JPEG on its way through a file input, but
 * "usually" is not a guarantee worth a failed upload on a roof. */
export const JOB_MEDIA_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type JobMediaContentType = (typeof JOB_MEDIA_CONTENT_TYPES)[number];

/** 25MB. Comfortably above a 12-megapixel phone photo (3-6MB) and a
 * 48-megapixel one (8-12MB), while still refusing something that is
 * obviously not a photo.
 *
 * Unlike the four 15MB constants in lib/actions/*.ts, this one is
 * ENFORCEABLE: it is handed to the blob store as `maximumSizeInBytes` when
 * the upload token is minted, so it is applied to the transfer itself
 * rather than checked after a file that already arrived. Those four are
 * checked after a body that the framework rejects at 1MB, which is why
 * they have never once fired for the case they describe (#27). */
export const JOB_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

export function isAllowedJobMediaType(contentType: string): boolean {
  return (JOB_MEDIA_CONTENT_TYPES as readonly string[]).includes(contentType);
}

/** The public host every Vercel Blob URL sits under. */
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

/**
 * Is this a URL the blob store actually issued?
 *
 * `recordJobMedia` is a Server Action, which means it is an endpoint any
 * signed-in caller can post to directly rather than only through the form.
 * Without this check it would record an arbitrary URL and the gallery
 * would render it — pulling an attacker-chosen image from an
 * attacker-controlled host into the tenant's own job page.
 *
 * PARSED, NOT PATTERN-MATCHED, and the difference is the security. A
 * substring test for the hostname passes on
 * `https://evil.test/?x=.public.blob.vercel-storage.com` and, worse, on
 * `https://x.public.blob.vercel-storage.com@evil.test/photo.jpg`, where
 * everything before the `@` is userinfo and the real host is `evil.test`.
 * `URL` resolves both correctly; a regex over the raw string is exactly
 * the class of check that reads as airtight and is not.
 *
 * WHAT THIS DOES NOT DO, stated because the gap is real rather than
 * hypothetical: it proves the URL belongs to SOME Vercel blob store, not
 * to OURS, and says nothing at all about WHOSE photo it is. Our store is
 * shared by every tenant, so a host check alone let a signed-in user of
 * company A record company B's photo as their own row — and
 * `deleteJobMedia` then handed that URL to `del()` and destroyed B's file.
 * That is what `isJobMediaBlobUrl` below closes, and it is why nothing
 * should call this one on its own to decide anything but "is this a store
 * URL at all".
 *
 * Pinning to OUR store is `isOurBlobStoreUrl` below, which is the check
 * this paragraph used to say was "worth making later".
 */
export function isBlobStorageUrl(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname.endsWith(BLOB_HOST_SUFFIX);
}

/**
 * The two environment variables a store id can come from.
 *
 * The INDEX SIGNATURE is what lets `process.env` be passed directly. Node
 * types it as `ProcessEnv`, which is an index signature plus `TZ`, and a
 * parameter listing only optional named keys rejects it outright —
 * `TS2559: Type 'ProcessEnv' has no properties in common`. The named keys
 * are kept alongside it so the two this actually reads are still written
 * down rather than hidden behind a bare `Record<string, string>`.
 */
type BlobCredentialEnv = {
  readonly BLOB_READ_WRITE_TOKEN?: string;
  readonly BLOB_STORE_ID?: string;
  readonly [key: string]: string | undefined;
};

/**
 * The id of the store our own credentials name, or null if they name none.
 *
 * WHY THIS IS DERIVABLE AT ALL. The store id is not a secret and is not a
 * separate setting — it is already inside the credentials the app has, and
 * the SDK reads it out of them the same two ways:
 *
 *   - a read-write token is `vercel_blob_rw_<storeId>_<secret>`, parsed as
 *     `token.split("_")[3]` (@vercel/blob@2.8.0
 *     dist/chunk-YYMLUMXS.js:120), NOT normalised;
 *   - under OIDC auth there is no such token and the id comes from
 *     `BLOB_STORE_ID`, normalised by stripping a leading `store_` (:158,
 *     read at :184-190).
 *
 * BOTH ARE ACCEPTED DELIBERATELY. Reading only the token would be correct
 * today and would fail CLOSED — no uploads recordable at all — the day a
 * deployment moves to OIDC, which `resolveBlobAuth` (:161-205) already
 * supports. A guard that silently turns a working feature off when the
 * platform changes underneath it is worse than the gap it closes.
 *
 * Lowercased because the comparison is against a HOSTNAME, and `URL`
 * lowercases those. Null rather than a throw: the caller is a guard that
 * must refuse, and a thrown Server Action message is redacted in
 * production.
 */
export function blobStoreId(env: BlobCredentialEnv): string | null {
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) {
    const parts = token.split("_");
    // `vercel_blob_rw_<storeId>_<secret>` is five segments at minimum; a
    // secret containing `_` makes more, never fewer. Fewer means this is
    // not a read-write token and nothing should be derived from it.
    const fromToken = parts.length >= 5 ? parts[3] : "";
    if (fromToken) return fromToken.toLowerCase();
  }
  const storeId = env.BLOB_STORE_ID?.trim();
  if (storeId) {
    const bare = storeId.startsWith("store_") ? storeId.slice("store_".length) : storeId;
    if (bare) return bare.toLowerCase();
  }
  return null;
}

/**
 * Is this URL from the store WE hold credentials for?
 *
 * THE GAP THIS CLOSES, which `isBlobStorageUrl` and `isJobMediaBlobUrl`
 * together still leave open. Both prove things about the shape of a URL:
 * that its host is a Vercel blob host, and that its path sits under this
 * job's folder. Neither says the store is ours. So a caller who knows a
 * job id — and `recordJobMedia` is a Server Action, an endpoint any
 * signed-in user can post to directly — could create `job-media/<jobId>/x`
 * in a blob store of THEIR OWN, post that URL, and have the gallery render
 * an image they control inside someone else's job, fetched by every
 * viewer's browser from their host.
 *
 * The pathname rule cannot reach that: it is about the path, and the path
 * is exactly the part an attacker with their own store gets to choose.
 *
 * FAILS CLOSED when no store id can be derived, and that is safe rather
 * than merely cautious: without credentials the upload route cannot mint a
 * token at all (`handleUpload` throws, :204), so there is no legitimate
 * URL to record in that state. Refusing costs nothing that was working.
 *
 * The host is compared by its FIRST LABEL rather than by `includes`,
 * because `constructBlobUrl` (:339) builds
 * `https://<storeId>.<access>.blob.vercel-storage.com/<pathname>` — the id
 * is that label and nothing else. `isBlobStorageUrl` has already proved
 * the suffix and the protocol, so what remains is exactly the label.
 */
export function isOurBlobStoreUrl(candidate: string, env: BlobCredentialEnv): boolean {
  const ours = blobStoreId(env);
  if (!ours) return false;
  if (!isBlobStorageUrl(candidate)) return false;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  const label = url.hostname.slice(0, url.hostname.length - BLOB_HOST_SUFFIX.length);
  return label !== "" && label === ours;
}

/**
 * WHERE A SITE PHOTO IS ALLOWED TO LIVE IN THE STORE, and the check that
 * proves a stored URL is one of this job's.
 *
 * THE BUG THIS EXISTS FOR. The blob store is ONE store shared by every
 * tenant, and `recordJobMedia` is a Server Action — an endpoint any
 * signed-in caller can post to directly. It used to take the URL on trust
 * once `isBlobStorageUrl` said the host was a blob host, so a user of
 * company A could post company B's photo URL, get a row they legitimately
 * own (their own companyId, their own job), and then delete it: the row
 * check passes, and `deleteJobMedia` hands `blobUrl` to `del()`, which
 * destroys B's file. Irreversible, cross-tenant, and invisible to every
 * row-level companyId check in this codebase, because the row really was
 * theirs.
 *
 * THE FIX IS THE PATHNAME, in three places that must agree:
 *
 *   1. the browser uploads to `job-media/<jobId>/<file>` rather than to a
 *      bare filename (`JobMediaCapture`);
 *   2. the token route refuses to mint a token for any other prefix, AFTER
 *      it has checked the job belongs to the caller's company. The signed
 *      client token carries that pathname
 *      (@vercel/blob@2.8.0 dist/client.js:274-278 passes it into
 *      `generateClientTokenFromReadWriteToken`, which base64s it into the
 *      payload it signs at :481-487) and the store rejects a PUT that does
 *      not match it — that is the `client_token_pathname_mismatch` case at
 *      dist/chunk-YYMLUMXS.js:656;
 *   3. `recordJobMedia` requires the STORED URL's own path to sit under the
 *      same prefix. Since the job has already been proved to belong to the
 *      caller's company, a URL under `job-media/<that job>/` cannot be
 *      another company's file.
 *
 * NO companyId IN THE PATH, deliberately. lib/blob.ts records what that
 * cost the compliance documents: their path published the companyId, and
 * those links are routinely emailed to GCs and insurers, so the id reached
 * outsiders when it reaches a client nowhere else in the app. The jobId is
 * enough — job -> company is verified server-side before either check runs.
 *
 * WHAT IS NOT PROVEN FROM SOURCE, said plainly because the feature depends
 * on it: `addRandomSuffix: true` is applied by the STORE, not by the SDK,
 * so no file under node_modules can show where the suffix lands. The
 * evidence that it lands on the FILENAME and leaves the folders alone is
 * the SDK's own description of a pathname as what "will influence the URL
 * of your blob like https://$storeId.public.blob.vercel-storage.com/
 * $pathname" (dist/index.d.ts:455) plus this repo's existing fake for the
 * same API (lib/blob-uploads.test.ts:42-44), which models it that way and
 * is what `compliance/<companyId>/COI-r4nd0m1.pdf` is asserted against.
 * If that is ever wrong the prefix check FAILS CLOSED — the upload is
 * refused at `recordJobMedia` and no row is written — rather than
 * admitting a file it should not.
 */
const JOB_MEDIA_ROOT = "job-media";

/** The ids this schema issues are cuids. Checked rather than assumed
 * because an id carrying a `/` would build a prefix that scopes nothing,
 * and this function's whole job is to be the thing that scopes. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The folder this job's photos live in, or null if the id is not one this
 * app issued. Null rather than a throw: every caller is a guard that must
 * refuse, and a thrown Server Action message is redacted in production.
 *
 * Not exported. The two functions below are the whole of its observable
 * behaviour, and an export nothing outside this file calls is the shape
 * this same commit had to delete twice. */
function jobMediaPathPrefix(jobId: string): string | null {
  return SAFE_ID.test(jobId) ? `${JOB_MEDIA_ROOT}/${jobId}/` : null;
}

/** At most this much of the person's own filename survives. The store caps
 * a whole pathname at 950 characters (dist/chunk-YYMLUMXS.js:541); this is
 * far below it and keeps the name readable in the store's own dashboard. */
const MAX_FILE_NAME_LENGTH = 120;

/**
 * The person's filename, reduced to something that cannot change the shape
 * of the path it is appended to.
 *
 * A file input never hands over a directory, but `recordJobMedia` is not
 * the only thing that can call the upload route, and the remainder rule in
 * `isJobMediaPathname` is strict — so the name is made to satisfy it here
 * rather than discovered to violate it after 8MB has been transferred.
 * Runs of dots collapse (no `..` can survive), separators and anything
 * outside a conservative set become `-`, and a name that reduces to nothing
 * becomes "photo" rather than an empty segment.
 */
export function jobMediaFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/\.{2,}/g, ".")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, MAX_FILE_NAME_LENGTH);
  return cleaned || "photo";
}

/** Where the browser is told to put this file. Null when the job id is not
 * one this app could have issued, which is a refusal, not a fallback. */
export function jobMediaUploadPathname(jobId: string, fileName: string): string | null {
  const prefix = jobMediaPathPrefix(jobId);
  return prefix ? `${prefix}${jobMediaFileName(fileName)}` : null;
}

/**
 * Does this store pathname belong to this job — and only to this job?
 *
 * The trailing `/` in the prefix is load-bearing: without it job `abc`
 * would match a blob under `job-media/abc123/`, which is a different
 * company's job that merely starts with the same characters.
 *
 * The remainder must be ONE segment. No `/` (so nothing can climb back out
 * into another job's folder), no `..`, and no percent-encoded `/` or `.`
 * either — `new URL()` normalises a literal `../` but leaves `%2e%2e`
 * alone, and what the store does with an encoded separator is not
 * something this repo can verify, so it is refused rather than reasoned
 * about.
 */
export function isJobMediaPathname(pathname: string, jobId: string): boolean {
  const prefix = jobMediaPathPrefix(jobId);
  if (!prefix || !pathname.startsWith(prefix)) return false;

  const rest = pathname.slice(prefix.length);
  if (!rest || rest.includes("/") || rest.includes("..")) return false;
  const lowered = rest.toLowerCase();
  return !lowered.includes("%2f") && !lowered.includes("%2e");
}

/**
 * Is this stored URL a file that was uploaded to THIS job?
 *
 * The one check `recordJobMedia` needs, and the only thing standing
 * between a signed-in caller and another company's file: the URL recorded
 * here is the URL `deleteJobMedia` later hands to `del()`.
 *
 * Exactly one leading slash is stripped, not all of them. A path of
 * `//job-media/<jobId>/x.jpg` is a different store key than
 * `/job-media/<jobId>/x.jpg`, and collapsing the two would let a caller
 * name a blob this prefix does not actually cover.
 */
export function isJobMediaBlobUrl(candidate: string, jobId: string): boolean {
  if (!isBlobStorageUrl(candidate)) return false;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  return isJobMediaPathname(url.pathname.replace(/^\//, ""), jobId);
}

/**
 * What to tell someone whose upload was refused before the bytes moved.
 *
 * `@vercel/blob/client` NEVER READS THE BODY OF A NON-2XX RESPONSE from
 * the token route: `if (!res.ok) { throw new BlobError("Failed to  retrieve
 * the client token"); }` — dist/client.js:398-400, double space and all,
 * with the body untouched. So every carefully worded sentence
 * `/api/job-media/upload` returns is discarded in the browser and replaced
 * by that string. There is no option to change it and no field it survives
 * in.
 *
 * Rather than show a person a library's internal phrasing for a refusal it
 * did not explain, this says what the route can actually have refused for
 * — and says the reason was not passed on, because a message that pretends
 * to know more than it does is how someone ends up retrying a thing that
 * will never work.
 */
export function jobMediaUploadErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  if (/retrieve the client token/i.test(raw)) {
    return "Storage would not authorise this upload, and does not pass on the reason. Reload the page — a signed-out session, or access to this job that has changed, is what this usually is.";
  }
  return raw || "Upload failed";
}

/** Human file size for a caption line. Deliberately coarse — nobody on a
 * jobsite needs bytes, and "4.2 MB" reads at arm's length. */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * When a photo was taken, written for someone standing on the job.
 *
 * `capturedAt` is an INSTANT, not the UTC-midnight calendar date this
 * schema stores elsewhere, so the "render in UTC" rule that covers those
 * does not apply and would actively mislead: a photo taken at 3pm in
 * Nevada would read 22:00. It is formatted in the VIEWER's zone instead,
 * resolved server-side by `lib/viewerToday.ts` and passed in — never read
 * from the browser during render, which is the hydration trap
 * `components/localToday.ts` documents.
 *
 * Takes the zone as an argument rather than reaching for it so this stays
 * pure and testable without a request.
 */
export function formatCapturedAt(capturedAt: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(capturedAt);
}

/**
 * The same instant as the `YYYY-MM-DDTHH:mm` a `datetime-local` input
 * wants, in the viewer's zone.
 *
 * Built from `formatToParts` rather than a locale that happens to format
 * this way, for the same reason `todayInZone` is: the output is a wire
 * format the input parses, not prose, so a locale's choices are not a
 * contract.
 */
export function formatCapturedAtInputValue(capturedAt: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(capturedAt);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/**
 * How far apart the device clock and the server clock may be before the UI
 * says so.
 *
 * `JobMedia` stores both `capturedAt` (the device's idea of when the photo
 * was taken) and `createdAt` (when the server received it), because a
 * phone's clock is set by its owner and is routinely wrong. Six hours is
 * wide enough to absorb an honest time-zone mistake and a day's worth of
 * uploading Friday's photos on Monday morning, and narrow enough to catch
 * a device that is simply lying.
 *
 * NOTE the asymmetry: only a capture claimed in the FUTURE, or far in the
 * past relative to receipt, is worth flagging. A photo legitimately taken
 * last week and uploaded today is the normal case this feature is for, so
 * lateness alone is never suspicious — see `jobMediaClockWarning`.
 */
export const JOB_MEDIA_CLOCK_SKEW_MS = 6 * 60 * 60 * 1000;

/** Returns a sentence when a row's own two timestamps disagree in a way a
 * person should see, and null when they don't.
 *
 * Computed at read time from the two stored values, never persisted — the
 * answer changes if either is corrected, and a stored warning would not. */
export function jobMediaClockWarning(capturedAt: Date, createdAt: Date): string | null {
  const skew = capturedAt.getTime() - createdAt.getTime();
  if (skew > JOB_MEDIA_CLOCK_SKEW_MS) {
    return "The device that took this reported a time in the future — its clock is probably wrong.";
  }
  return null;
}
