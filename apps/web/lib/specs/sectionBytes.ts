import { PDFDocument } from "pdf-lib";
import { documentUrlProblem, type DocumentUploadContentType } from "@/lib/document-uploads";
import { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import { readJobFileBytes } from "@/lib/plan-ingest/planBytes";
import { pageLines } from "@/lib/takeoff/planTextRead";
import { readStoredSpecSection } from "./read-stored-section";

/**
 * ONE SECTION'S PDF, wherever it lives: its own uploaded file, or its pages of a
 * whole spec book (`SpecBook`), sliced out with pdf-lib so the book is never copied.
 * Every spec reader goes through here, so a section found in a book reads exactly
 * like one uploaded by hand. Returns a sentence, never throws.
 */
export type SectionForBytes = {
  fileUrl: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  specBook: { fileUrl: string; jobId: string } | null;
};

export type SectionPdf = { ok: true; buffer: Buffer; mediaType: DocumentUploadContentType } | { ok: false; error: string };

export async function sectionPdf(section: SectionForBytes, companyId: string): Promise<SectionPdf> {
  if (section.specBook !== null && section.pageFrom !== null && section.pageTo !== null) {
    const book = await readJobFileBytes(section.specBook.fileUrl, section.specBook.jobId, "spec-book");
    if (!book.ok) return book;
    try {
      return { ok: true, buffer: await slicePages(book.bytes, section.pageFrom, section.pageTo), mediaType: "application/pdf" };
    } catch {
      return { ok: false, error: "That section's pages couldn't be read out of the spec book." };
    }
  }
  if (!section.fileUrl) return { ok: false, error: "There's no document on that section yet. Attach the PDF first." };
  const problem = documentUrlProblem(section.fileUrl, "bid-spec-section", companyId, process.env);
  if (problem) return { ok: false, error: problem };
  return readStoredSpecSection(section.fileUrl);
}

/** Pages `from`–`to` (1-based, inclusive) as their own PDF. */
export async function slicePages(bytes: Uint8Array, from: number, to: number): Promise<Buffer> {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const last = Math.min(to, source.getPageCount());
  const indices = Array.from({ length: Math.max(0, last - from + 1) }, (_, i) => from - 1 + i);
  for (const page of await out.copyPages(source, indices)) out.addPage(page);
  return Buffer.from(await out.save());
}

/** Every page's lines, for the finder and the trade reader. Numbered from `firstPage`. */
export async function pdfPageLines(bytes: Buffer, firstPage = 1): Promise<{ page: number; lines: string[] }[]> {
  // pdfjs detaches the buffer it is handed (`planPdf.ts`), so it gets a copy.
  const pdf = await openPlanPdf(Buffer.from(bytes));
  try {
    const pages = [];
    for (let n = 1; n <= pdf.pageCount; n++) pages.push({ page: firstPage + n - 1, lines: await pageLines(pdf, n) });
    return pages;
  } finally {
    await pdf.close();
  }
}
