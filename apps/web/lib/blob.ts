import { put, type PutBlobResult } from "@vercel/blob";

/**
 * The one way this app uploads a document, and the one place the upload
 * policy lives.
 *
 * WHY IT EXISTS. `@vercel/blob@2.8.0` defaults `addRandomSuffix` to FALSE
 * (its own `dist/index.d.ts:459` says so, and recommends the opposite in the
 * same sentence). Four call sites took that default while passing
 * `access: "public"`, so every uploaded document sat at a URL that was
 * entirely derivable from an id plus a filename:
 *
 *     compliance/<companyId>/COI.pdf
 *     contracts/<jobId>/subcontract.pdf
 *     dispatch-slips/<jobId>/<name>
 *     prevailing-wage/<jobId>/<name>
 *
 * Certified payroll, lien waivers, COIs and W-9s were therefore readable by
 * anyone who guessed a filename — permanently, unauthenticated, including by
 * someone removed from the team who once held a link. Worse, the compliance
 * path PUBLISHED the companyId, and those links are routinely emailed to GCs
 * and insurers; the companyId reaches a client nowhere else in the app.
 *
 * The random suffix does not make the blob private — it is still
 * `access: "public"`, which is what lets a GC open the link without an
 * account. It makes the URL unguessable, which is the property the app was
 * relying on and did not have. Genuinely private storage is a bigger change
 * (signed URLs, an authenticated download route) and is not this.
 *
 * WHY A WRAPPER RATHER THAN THE OPTION AT EACH CALL SITE. The dangerous
 * value is the DEFAULT, so the failure mode is a future fifth call site that
 * simply doesn't mention `addRandomSuffix` — it would look exactly like
 * every line around it and be wrong. There is nothing to remember here: the
 * options are not a parameter, so a caller cannot opt out of them by
 * omission or by choice.
 *
 * IT ALSO FIXES A FUNCTIONAL BUG. `allowOverwrite` defaults false too, and
 * `put` THROWS when a pathname already exists. `uploadContractDocument`
 * exists to version amendments — it computes `versionNumber + 1` — so the
 * second upload of a same-named PDF died at the blob store before any row
 * was written. Version 2 of "subcontract.pdf" was impossible. A random
 * suffix means two uploads never collide, so nothing is overwritten and the
 * full history stays retrievable, which is what the schema comment on
 * ContractDocument already promised.
 *
 * CALLERS MUST STORE THE RETURNED `url`. The pathname that comes back is not
 * the one that went in, so any code that rebuilt a URL from its parts would
 * now be wrong. Nothing does — all four call sites already persist
 * `blob.url` — and `lib/blob-uploads.test.ts` asserts the stored URL is the
 * returned one rather than the requested path.
 *
 * Existing blobs are untouched: their stored URLs keep working. This changes
 * only where new uploads land, so the documents already exposed stay
 * exposed. Rotating those means re-uploading them, which is a data task,
 * not a code one.
 */
export function putDocument(
  pathname: string,
  body: Buffer,
  contentType: string,
): Promise<PutBlobResult> {
  return put(pathname, body, {
    access: "public",
    addRandomSuffix: true,
    contentType,
  });
}
