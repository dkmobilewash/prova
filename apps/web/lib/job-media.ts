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
 * to OURS. Pinning to our own store id means deriving it from
 * `BLOB_READ_WRITE_TOKEN` and is a tighter check worth making later. The
 * residual hole today needs a caller who already holds a session AND
 * MANAGE_FIELD in the company — i.e. someone who could simply upload the
 * image legitimately — so it is a provenance weakness, not an access one.
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
 * Whether a stored row is a still or a moving picture, DERIVED from its
 * content type rather than stored beside it.
 *
 * A `kind` column would be a second source of truth for something the
 * content type already answers, and this schema's standing rule is that a
 * stored flag eventually disagrees with what it was derived from. Video
 * cannot be uploaded yet; this reads correctly on the day it can, with no
 * backfill for the rows written before then.
 */
export function jobMediaKind(contentType: string): "PHOTO" | "VIDEO" | "OTHER" {
  if (contentType.startsWith("image/")) return "PHOTO";
  if (contentType.startsWith("video/")) return "VIDEO";
  return "OTHER";
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
