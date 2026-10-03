import { quotePdf } from "@/lib/quote-read/quoteFixtures";
import { SPEC_CASES, type SpecCase } from "./specCases";

/**
 * Synthetic spec sections, written as real PDFs at run time.
 *
 * THE WRITER IS IMPORTED, NOT COPIED, and `addendumFixtures.ts` already made
 * this argument for the second caller: `quotePdf` is forty lines of minimal-PDF
 * plumbing whose cross-reference table of byte offsets is the part that is easy
 * to get wrong, and a third copy would be a third place for those offsets to be
 * wrong with only one of them under test. The name says "quote" and the bytes do
 * not care — it takes lines and returns a letter-size page.
 *
 * It also brings the synthetic marking with it (`Ref: ZZ SYNTHETIC 0001` at the
 * foot), and that form is load-bearing rather than cosmetic: the quote eval's
 * header records that this marking corrupted its own measurement TWICE by being
 * a SENTENCE in the document body, which a competent reader is right to react to
 * and then spends part of its answer resolving. A reference code at the foot
 * reads as a document number and asks nothing of the reader.
 */

/** One case, rendered. */
export function specSectionPdf(lines: string[]): Buffer {
  return quotePdf(lines);
}

/** Every case, rendered, keyed by case — what the eval sends and what the free
 *  fixture test reads back. */
export function renderedSpecCases(): { kase: SpecCase; pdf: Buffer }[] {
  return SPEC_CASES.map((kase) => ({ kase, pdf: specSectionPdf(kase.lines) }));
}
