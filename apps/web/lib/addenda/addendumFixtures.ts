import { quotePdf } from "@/lib/quote-read/quoteFixtures";
import { ADDENDUM_CASES, type AddendumCase } from "./addendumCases";

/**
 * Synthetic addenda, written as real PDFs at run time.
 *
 * THE WRITER IS IMPORTED RATHER THAN COPIED, and that is worth a sentence
 * because copying it would have been easy and slightly tidier. `quotePdf` is
 * forty lines of minimal-PDF plumbing — a catalog, a page, a font, a content
 * stream, and a cross-reference table of byte offsets built in latin-1 so a byte
 * offset and a string index are the same number. Its own header records that the
 * offsets are the part that is easy to get wrong, and that `quoteFixtures.test.ts`
 * reads every fixture back with pdfjs for exactly that reason.
 *
 * A second copy here would be a second place for those offsets to be wrong, and
 * only one of the two would have a test proving they are not. The name says
 * "quote" and the bytes do not care: it takes lines and returns a letter-size
 * page. `addendumCases.test.ts` reads these back independently anyway, so both
 * callers of that writer are checked rather than one.
 *
 * The synthetic marking rides along with it — `Ref: ZZ SYNTHETIC 0001`, appended
 * by the writer at the foot of the page. That form is not decoration either: the
 * quote eval's header records that this marking corrupted its own measurement
 * TWICE by being a SENTENCE in the document body, which a competent reader is
 * right to react to and then spends part of its answer resolving. A reference
 * code at the foot reads as what it is — a document number — and asks nothing of
 * the reader.
 */

/** One case, rendered. */
export function addendumPdf(lines: string[]): Buffer {
  return quotePdf(lines);
}

/** Every case, rendered, keyed by id — what the eval sends and what the free
 *  fixture test reads back. */
export function renderedCases(): { kase: AddendumCase; pdf: Buffer }[] {
  return ADDENDUM_CASES.map((kase) => ({ kase, pdf: addendumPdf(kase.lines) }));
}
