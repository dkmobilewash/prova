import { del } from "@vercel/blob";

/**
 * Deleting the file behind a document row.
 *
 * THIS FILE USED TO OWN THE UPLOAD TOO, as `putDocument`, and the reason
 * it no longer does is issue #27 rather than a change of mind about any of
 * what it said. All five callers posted the file through a Server Action,
 * which Next caps at 1MB — so every real contract PDF was rejected by the
 * framework before reaching either `putDocument` or the 15MB guard in
 * front of it. The bytes now go from the browser straight to the store
 * under a one-shot token (`app/api/documents/upload/route.ts`), and with
 * the last caller gone `putDocument` was deleted rather than left as a
 * function nothing calls — the "written, documented, and never called"
 * shape CLAUDE.md names.
 *
 * WHAT IT ARGUED, KEPT, because the property still has to hold and now
 * holds somewhere else. `@vercel/blob@2.8.0` defaults `addRandomSuffix` to
 * FALSE (its own `dist/index.d.ts:459` says so, and recommends the
 * opposite in the same sentence). Four call sites took that default while
 * passing `access: "public"`, so every uploaded document sat at a URL
 * derivable from an id plus a filename:
 *
 *     compliance/<companyId>/COI.pdf
 *     contracts/<jobId>/subcontract.pdf
 *     dispatch-slips/<jobId>/<name>
 *     prevailing-wage/<jobId>/<name>
 *
 * Certified payroll, lien waivers, COIs and W-9s were therefore readable
 * by anyone who guessed a filename — permanently, unauthenticated,
 * including by someone removed from the team who once held a link. The
 * random suffix does not make a blob private; it is still
 * `access: "public"`, which is what lets a GC open the link without an
 * account. It makes the URL unguessable, which is the property the app was
 * relying on and did not have.
 *
 * The wrapper existed because the dangerous value is the DEFAULT — the
 * failure mode was a future call site that simply did not mention the
 * option. That argument survives the move: `addRandomSuffix: true` is now
 * returned by the token route, once, for every document purpose, and a
 * caller cannot opt out of it because the client never sets it. The
 * functional half survives too: `allowOverwrite` also defaults false and
 * `put` THROWS on an existing pathname, which made version 2 of
 * "subcontract.pdf" impossible; a random suffix means two uploads never
 * collide.
 *
 * Existing blobs are untouched and their stored URLs keep working. This
 * changed where new uploads are authorised, not where old ones live.
 */

/**
 * Deletes the actual file behind a document row. Issue #106 finding 3:
 * `deleteContractDocument` removed the `ContractDocument` row and left the
 * PDF sitting at its public, unguessable-but-permanent URL forever —
 * `del` was never imported from `@vercel/blob` anywhere in this repo. A
 * document deleted because it was uploaded by mistake, or superseded by a
 * corrected version, or pulled because it should never have been shared,
 * stayed downloadable by anyone who had ever held the link.
 *
 * BEST-EFFORT ON PURPOSE. `del` is documented as idempotent — deleting an
 * already-gone or never-existed blob does not throw — but this still
 * swallows any failure rather than let a storage-API blip block the
 * document row from being removed. The alternative is worse: a person
 * asking to delete a document (often because it should not be public)
 * would be told the deletion failed while the row stays, exactly wrong
 * for the case that matters most. A failure here leaves a blob orphaned
 * rather than a row un-deletable, and is logged so it isn't silent.
 */
export async function deleteDocument(url: string): Promise<void> {
  try {
    await del(url);
  } catch (error) {
    console.error("[blob] failed to delete", url, error);
  }
}
