import { describe, expect, it } from "vitest";
import { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import { pageLines } from "@/lib/takeoff/planTextRead";
import { buildSpecBookFixture } from "./fixtures/specBookFixture";
import { findSpecSections, isTradeSection, normaliseSectionNumber } from "./specBookSections";

describe("finding a trade's sections in a whole spec book", () => {
  it("reads the fixture PDF's own text: five sections, three skipped trades, the TOC never a section", async () => {
    const pdf = await openPlanPdf(Buffer.from(await buildSpecBookFixture()));
    const pages = [];
    for (let page = 1; page <= pdf.pageCount; page++) pages.push({ page, lines: await pageLines(pdf, page) });
    await pdf.close();

    const scan = findSpecSections(pages);
    expect(scan.pagesWithText).toBe(14);
    expect(scan.sections.map((s) => [s.number, s.pageFrom, s.pageTo, s.trade])).toEqual([
      ["07 81 00", 3, 4, true],
      ["08 71 00", 5, 6, false],
      ["09 21 16", 7, 9, true],
      ["09 22 16", 10, 11, true],
      ["09 51 13", 12, 13, true],
      ["26 05 00", 14, 14, false],
    ]);
    const titles = Object.fromEntries(scan.sections.map((s) => [s.number, s.title]));
    expect(titles["09 21 16"]).toBe("GYPSUM BOARD ASSEMBLIES");
    // "SECTION 095113" with its title on the next line.
    expect(titles["09 51 13"]).toBe("ACOUSTICAL PANEL CEILINGS");
  });

  it("takes a title from the table of contents when the heading has none, and splits on page labels alone", () => {
    const scan = findSpecSections([
      { page: 1, lines: ["CONTENTS", "09 21 16 Gypsum Board Assemblies 4", "09 22 16 Metal Framing 9", "09 29 00 Gypsum Board 12", "09 91 23 Painting 14"] },
      { page: 2, lines: ["SECTION 092116", "PART 1 - GENERAL", "092116 - 1"] },
      { page: 3, lines: ["2.1 BOARD", "092116 - 2"] },
      { page: 4, lines: ["2.1 STUDS", "092216 - 1"] },
    ]);
    expect(scan.sections).toEqual([
      { number: "09 21 16", title: "Gypsum Board Assemblies", pageFrom: 2, pageTo: 3, trade: true },
      { number: "09 22 16", title: "Metal Framing", pageFrom: 4, pageTo: 4, trade: true },
    ]);
  });

  it("knows the 1995 numbers and the trade list", () => {
    expect(normaliseSectionNumber("09-21-16")).toBe("09 21 16");
    expect(normaliseSectionNumber("092116.13")).toBe("09 21 16");
    expect(normaliseSectionNumber("09250")).toBe("09250");
    expect(normaliseSectionNumber("0925")).toBeNull();
    for (const n of ["09 21 16", "09 22 16", "09 51 13", "07 81 00", "09 24 00", "07 24 00", "09250", "07810"]) {
      expect(isTradeSection(n), n).toBe(true);
    }
    for (const n of ["09 91 23", "26 05 00", "08 71 00", "07 21 00", "09900"]) expect(isTradeSection(n), n).toBe(false);
  });

  it("a scanned book has no text and no sections", () => {
    expect(findSpecSections([{ page: 1, lines: [] }, { page: 2, lines: [] }])).toEqual({ sections: [], pagesWithText: 0 });
  });
});
