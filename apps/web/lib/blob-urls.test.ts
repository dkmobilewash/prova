import { describe as group, expect, it } from "vitest";
import { blobStoreId, isBlobStorageUrl, isOurBlobStoreUrl } from "./blob-urls";
import { isJobMediaBlobUrl } from "./job-media";

/**
 * The two groups below MOVED HERE, UNCHANGED, from lib/job-media.test.ts
 * when the three functions they cover moved to lib/blob-urls.ts (#27).
 * Same cases, same wording, same count: 20 before the move and 20 after,
 * which is the only property worth asserting about a move.
 *
 * `isJobMediaBlobUrl` is still imported, in one case, on purpose — the
 * point of that case is a URL that passes BOTH shape checks and is still
 * not ours, and deleting the half that makes it convincing would leave a
 * test that proves less than it reads as proving.
 */

group("proving the store is OURS, not merely a Vercel one", () => {
  // The gap both other checks leave open: they are about the SHAPE of a
  // URL — a blob host, a path under this job — and anyone can create a
  // Vercel blob store and put any path they like in it. `recordJobMedia`
  // is a Server Action, so a caller who knows a job id can post directly.
  const OURS = "abc123xyz";
  const ENV = { BLOB_READ_WRITE_TOKEN: `vercel_blob_rw_${OURS}_s3cr3tPart` };
  const url = (store: string) =>
    `https://${store}.public.blob.vercel-storage.com/job-media/job_1/site-Xk92.jpg`;

  it("reads the store id out of a read-write token", () => {
    // vercel_blob_rw_<storeId>_<secret> — the SDK's own parse is
    // token.split("_")[3] (chunk-YYMLUMXS.js:120).
    expect(blobStoreId(ENV)).toBe(OURS);
  });

  it("reads it from BLOB_STORE_ID under OIDC, where no token exists", () => {
    // Not hypothetical: resolveBlobAuth (:161-205) takes this path when
    // there is no read-write token. Deriving only from the token would
    // fail CLOSED on such a deployment and stop every upload.
    expect(blobStoreId({ BLOB_STORE_ID: OURS })).toBe(OURS);
  });

  it("strips the store_ prefix BLOB_STORE_ID may carry, as normalizeStoreId does", () => {
    expect(blobStoreId({ BLOB_STORE_ID: `store_${OURS}` })).toBe(OURS);
  });

  it("prefers the token when both are set, matching resolveBlobAuth's order", () => {
    expect(blobStoreId({ ...ENV, BLOB_STORE_ID: "someotherstore" })).toBe(OURS);
  });

  it("derives nothing from a token that is not a read-write token", () => {
    // Fewer than five segments cannot be vercel_blob_rw_<id>_<secret>.
    expect(blobStoreId({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_onlyfour" })).toBeNull();
    expect(blobStoreId({ BLOB_READ_WRITE_TOKEN: "" })).toBeNull();
    expect(blobStoreId({})).toBeNull();
  });

  it("accepts a URL from our own store", () => {
    expect(isOurBlobStoreUrl(url(OURS), ENV)).toBe(true);
  });

  it("REFUSES a well-formed URL from somebody else's Vercel store", () => {
    // The whole point. This URL passes isBlobStorageUrl and, for job_1,
    // isJobMediaBlobUrl too — it is a real blob host and a correct path.
    expect(isBlobStorageUrl(url("attackerstore"))).toBe(true);
    expect(isJobMediaBlobUrl(url("attackerstore"), "job_1")).toBe(true);
    expect(isOurBlobStoreUrl(url("attackerstore"), ENV)).toBe(false);
  });

  it("refuses a store id that merely starts with ours", () => {
    expect(isOurBlobStoreUrl(url(`${OURS}evil`), ENV)).toBe(false);
  });

  it("refuses ours pushed down into a longer host", () => {
    expect(isOurBlobStoreUrl(url(`evil.${OURS}`), ENV)).toBe(false);
    expect(isOurBlobStoreUrl(url(`${OURS}.evil`), ENV)).toBe(false);
  });

  it("compares case-insensitively, because URL lowercases a hostname", () => {
    expect(isOurBlobStoreUrl(url(OURS), { BLOB_READ_WRITE_TOKEN: `vercel_blob_rw_${OURS.toUpperCase()}_x_y` })).toBe(
      true,
    );
  });

  it("FAILS CLOSED with no credentials at all", () => {
    // Safe rather than merely cautious: without credentials the upload
    // route cannot mint a token, so no legitimate URL exists to record.
    expect(isOurBlobStoreUrl(url(OURS), {})).toBe(false);
  });

  it("still refuses everything isBlobStorageUrl refuses", () => {
    expect(isOurBlobStoreUrl("https://evil.test/photo.jpg", ENV)).toBe(false);
    expect(isOurBlobStoreUrl(`http://${OURS}.public.blob.vercel-storage.com/x.jpg`, ENV)).toBe(false);
    expect(isOurBlobStoreUrl(`https://${OURS}.public.blob.vercel-storage.com@evil.test/x.jpg`, ENV)).toBe(false);
    expect(isOurBlobStoreUrl("not a url", ENV)).toBe(false);
  });
});

group("proving a URL came from the blob store", () => {
  const real = "https://abc123xyz.public.blob.vercel-storage.com/photos/site-Xk92.jpg";

  it("accepts a real store URL", () => {
    expect(isBlobStorageUrl(real)).toBe(true);
  });

  it("refuses an arbitrary host", () => {
    expect(isBlobStorageUrl("https://evil.test/photo.jpg")).toBe(false);
  });

  // The two cases a substring or loose-regex check gets wrong, which is
  // the entire reason this parses instead. Both of these CONTAIN the
  // hostname and neither is served by it.
  it("refuses a host that merely mentions the store in its query string", () => {
    expect(
      isBlobStorageUrl("https://evil.test/x.jpg?y=.public.blob.vercel-storage.com"),
    ).toBe(false);
  });

  it("refuses the userinfo trick, where the real host is after the @", () => {
    expect(
      isBlobStorageUrl("https://x.public.blob.vercel-storage.com@evil.test/photo.jpg"),
    ).toBe(false);
  });

  it("refuses a lookalike domain", () => {
    expect(isBlobStorageUrl("https://public.blob.vercel-storage.com.evil.test/x.jpg")).toBe(false);
  });

  it("refuses plain http, so a stored URL is never downgraded", () => {
    expect(isBlobStorageUrl(real.replace("https:", "http:"))).toBe(false);
  });

  it("refuses javascript: and data:, which are not fetches at all", () => {
    expect(isBlobStorageUrl("javascript:alert(1)")).toBe(false);
    expect(isBlobStorageUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(false);
  });

  it("refuses nonsense rather than throwing on it", () => {
    expect(isBlobStorageUrl("")).toBe(false);
    expect(isBlobStorageUrl("not a url")).toBe(false);
  });
});
