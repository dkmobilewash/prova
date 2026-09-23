/**
 * The store id and read-write token the server under test is handed, so
 * it can never write to a real Vercel Blob store.
 *
 * Plain `.mjs` rather than `.ts` for the same reason
 * packages/db/scripts/connection-target.mjs is: two consumers that cannot
 * share a TypeScript loader need it — e2e/run.mjs (plain Node, sets the
 * child environment) and e2e/playwright.config.ts / lib/blobStub.ts
 * (Playwright's loader). One constant, two importers, no copy to drift.
 *
 * The SHAPE is load-bearing, not decoration. `apps/web/lib/blob-urls.ts`'s
 * `blobStoreId()` reads the store id as `token.split("_")[3]` from a token
 * of at least five `_`-separated segments — `vercel_blob_rw_<storeId>_<secret>`
 * — and `isOurBlobStoreUrl` then accepts only URLs whose first hostname
 * label equals that id. So a fake token with this shape makes the app's
 * OWN provenance check pass for `https://e2estore.public.blob.vercel-storage.com/…`
 * and fail for anything else, which is exactly the check a real upload goes
 * through. Nothing in the app is told it is under test.
 */
export const E2E_BLOB_STORE_ID = "e2estore";

/** Five segments, so `split("_")[3]` is the store id. The secret half is
 * literally the words "not a real secret" — a real store rejects it. */
export const E2E_FAKE_BLOB_TOKEN = `vercel_blob_rw_${E2E_BLOB_STORE_ID}_notarealsecret`;
