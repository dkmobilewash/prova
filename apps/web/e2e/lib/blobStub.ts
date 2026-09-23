import type { Page } from "@playwright/test";
import { E2E_BLOB_STORE_ID } from "./fakeBlobToken.mjs";

/**
 * Answers a document upload IN THE BROWSER, so the executed-subcontract
 * step of the journey never reaches a real blob store.
 *
 * Why this is needed at all: `RecordExecutedSubcontract` requires a file,
 * and the file goes straight from the browser to the store via
 * `@vercel/blob/client`'s `upload()` (lib/document-upload-client.ts —
 * #27, a Server Action body is capped at 1MB). The server under test holds
 * a FAKE token (see fakeBlobToken.mjs), so a real upload would fail; and a
 * real upload from a test would be the blob-store half of the "browser
 * testing must not write real things" rule CLAUDE.md applies to the
 * database.
 *
 * What the SDK does, read out of @vercel/blob@2.8.0's compiled client
 * (dist/client.js `retrieveClientToken`, dist/chunk-YYMLUMXS.js `put` /
 * `requestApi` / `resolveBlobAuth`), and what this stub answers:
 *
 *   1. POST `/api/documents/upload` with
 *      `{ type: "blob.generate-client-token", payload: { pathname, … } }`,
 *      expecting `{ clientToken }` back. The SDK reads the store id out of
 *      that token as `split("_")[3]`, so the fake one carries the same id
 *      the server's fake token does.
 *   2. PUT `https://vercel.com/api/blob/?pathname=<pathname>` with the
 *      bytes, expecting the `PutBlobResult` JSON (`url`, `downloadUrl`,
 *      `pathname`, `contentType`, `contentDisposition`, `etag`).
 *
 * The URL returned is
 * `https://<E2E_BLOB_STORE_ID>.public.blob.vercel-storage.com/<pathname>`
 * — the exact shape `constructBlobUrl` builds — so the app's
 * `documentUrlProblem` (lib/document-uploads.ts) runs both of its real
 * checks against it: our store's id as the first hostname label, and
 * `contracts/<jobId>/<one segment>` as the path. NOTHING IN THE APP IS
 * TOLD IT IS UNDER TEST; it is handed a URL and decides for itself.
 *
 * Step 1 is intercepted rather than allowed through on purpose: the real
 * route would try to mint a token against the fake credential and fail,
 * and the SDK discards that failure's body (documentUploadErrorMessage's
 * own comment) — a confusing sentence that says nothing about what this
 * suite is checking.
 */
export async function stubDocumentUpload(page: Page): Promise<{ uploadedUrls: () => string[] }> {
  const uploaded: string[] = [];

  await page.route("**/api/documents/upload", async (route) => {
    let body: { type?: string } = {};
    try {
      body = JSON.parse(route.request().postData() ?? "{}") as { type?: string };
    } catch {
      body = {};
    }
    if (body.type !== "blob.generate-client-token") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "blob.generate-client-token",
        clientToken: `vercel_blob_client_${E2E_BLOB_STORE_ID}_notarealsecret`,
      }),
    });
  });

  await page.route(
    (url) => url.hostname === "vercel.com" && url.pathname.startsWith("/api/blob"),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const pathname = url.searchParams.get("pathname") ?? url.pathname.replace(/^\/api\/blob\/?/, "");
      const fileUrl = `https://${E2E_BLOB_STORE_ID}.public.blob.vercel-storage.com/${pathname}`;
      uploaded.push(fileUrl);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: fileUrl,
          downloadUrl: `${fileUrl}?download=1`,
          pathname,
          contentType: request.headers()["x-content-type"] ?? request.headers()["content-type"] ?? "application/pdf",
          contentDisposition: `attachment; filename="${pathname.split("/").pop() ?? "document"}"`,
          etag: "e2e-stub",
        }),
      });
    },
  );

  return { uploadedUrls: () => [...uploaded] };
}
