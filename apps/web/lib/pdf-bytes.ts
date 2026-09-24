/**
 * Is this actually a PDF?
 *
 * A SECOND COPY OF A FIVE-BYTE CHECK, and the duplication is deliberate.
 * `lib/bluebeam/session.ts` already has one, but it reads the bytes through
 * `Buffer`, which is Node's and not reliably present in a client bundle — and
 * that module imports prisma, so a `"use client"` component cannot touch it at
 * all. This one takes a `Uint8Array` and compares numbers, so the uploader can
 * run it in the browser before spending a token on a file that was never going
 * to open.
 *
 * It is a sanity check, not a security boundary: the extension and the
 * declared content type are both trivially wrong, and this at least catches
 * the ordinary case of somebody picking a DWG or a scanned JPEG. The real
 * boundary is the upload token route, which pins the content type, the size
 * and the path.
 */

/** `%PDF-` */
const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC.length) return false;
  return MAGIC.every((byte, i) => bytes[i] === byte);
}

/** How many bytes the check needs — so a caller can slice a 40MB file rather
 * than read all of it into memory to look at five bytes. */
export const PDF_MAGIC_BYTES = MAGIC.length;
