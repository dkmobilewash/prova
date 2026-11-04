import { PDFDocument } from "pdf-lib";

/**
 * How many pages a plan set has, or why it could not be read — never a throw.
 *
 * `ignoreEncryption`: an owner-encrypted PDF (print/copy restrictions, no
 * open password) still has readable page objects, and counting them is all
 * the ingest asks for. Without it pdf-lib refuses the file outright — "Input
 * document to PDFDocument.load is encrypted" — which is what stopped a whole
 * round-10 ingest on one Winnipeg appendix. Anything still unreadable comes
 * back as a reason, so the caller reports that one file and carries on.
 */
export async function readPlanPageCount(bytes) {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    return { ok: true, pageCount: doc.getPageCount() };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
