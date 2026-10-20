import { describe, expect, it } from "vitest";
import { locateQuote } from "./citations";
import { planChunks } from "./chunks";
import { extractPdfPages, unreadPageNumbers } from "./pageText";
import { contractPdf, SUBCONTRACT_CASES, SYNTHETIC_MARK } from "./subcontractFixtures";

/**
 * The eval's fixtures, checked for free on every push: each case renders to a
 * real PDF, pdf.js reads it back page by page, the scanned page comes back
 * unread, and EVERY planted clause is locatable by code on exactly the pages
 * the eval will require — including the indemnity that crosses a page break.
 *
 * Without this, a fixture typo would surface as a model "miss" on a paid run,
 * which is the most expensive possible way to find a typo.
 */
describe("synthetic subcontract fixtures", () => {
  for (const kase of SUBCONTRACT_CASES) {
    it(`${kase.name}: renders, reads back, and every planted clause is on the page it claims`, async () => {
      const pages = await extractPdfPages(await contractPdf(kase.pages));
      expect(pages).toHaveLength(kase.pages.length);
      expect(unreadPageNumbers(pages)).toEqual(kase.unread ?? []);
      for (const lines of pages) if (lines) expect(lines.join(" ")).toContain(SYNTHETIC_MARK);

      const chunkPages = pages.flatMap((lines, index) => (lines ? [{ page: index + 1, lines }] : []));
      for (const clause of kase.planted) {
        const located = locateQuote(clause.phrase, chunkPages);
        expect(located, `${kase.name}/${clause.name}`).toEqual({
          ok: true,
          location: { pageStart: clause.pages[0], pageEnd: clause.pages[clause.pages.length - 1] },
        });
      }
      // Every readable page is in some chunk; no unread page is in any.
      const chunked = new Set(planChunks(pages).flat());
      expect([...chunked].sort((a, b) => a - b)).toEqual(chunkPages.map((page) => page.page));
    });
  }
});
