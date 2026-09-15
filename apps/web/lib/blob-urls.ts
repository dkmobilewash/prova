/**
 * What a Vercel Blob URL is, and whether a given one came out of OUR store.
 *
 * MOVED HERE, VERBATIM, FROM lib/job-media.ts (issue #27). Nothing about
 * these three functions is about photographs: they are about the store,
 * which one store id owns it, and how a URL string can lie about both.
 * They stayed in the photo module only because site capture was the first
 * feature that needed them — and then the five DOCUMENT uploads needed the
 * same three checks, at which point the choice was a second copy or a
 * shared home. A second copy of a security predicate is how `LOCATION_TYPES`
 * came to disagree with its own Prisma enum (CLAUDE.md), so it is a shared
 * home.
 *
 * The bodies and their comments are unchanged; only the file they live in
 * moved, and `BlobCredentialEnv` gained an `export` so a caller can name
 * the type in its own signature. lib/blob-urls.test.ts holds the cases,
 * moved out of lib/job-media.test.ts in the same commit and unchanged with
 * them.
 */

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
export type BlobCredentialEnv = {
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
