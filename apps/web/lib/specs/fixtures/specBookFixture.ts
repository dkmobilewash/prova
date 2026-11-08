import { PDFDocument, StandardFonts } from "pdf-lib";

/**
 * A SMALL INVENTED PROJECT MANUAL for the spec-book finder and reader. Every word is
 * made up for this file — no client's specification text is in the repo — but it is
 * laid out the way real books are: a table of contents, a running heading on each
 * section's first page, a "09 21 16 - 2" label at the foot of every page, END OF
 * SECTION, one heading written "SECTION 095113" with its title on the next line, and
 * two sections of other trades that must be skipped.
 */
const footer = (number: string, n: number) => `RIVERBEND CLINIC FIT-OUT    ${number} - ${n}`;

export const SPEC_BOOK_FIXTURE_PAGES: string[][] = [
  ["PROJECT MANUAL", "RIVERBEND CLINIC FIT-OUT", "ISSUED FOR BID"],
  [
    "TABLE OF CONTENTS",
    "07 81 00 Applied Fireproofing",
    "08 71 00 Door Hardware",
    "09 21 16 Gypsum Board Assemblies",
    "09 22 16 Non-Structural Metal Framing",
    "09 51 13 Acoustical Panel Ceilings",
    "26 05 00 Common Work Results for Electrical",
  ],
  [
    "SECTION 07 81 00 - APPLIED FIREPROOFING",
    "PART 1 - GENERAL",
    "1.1 SUMMARY",
    "A. Sprayed fire-resistive materials on structural steel to achieve the ratings indicated.",
    footer("07 81 00", 1),
  ],
  [
    "2.1 MANUFACTURERS",
    "A. Basis of design: Isolatek International, Cafco 300.",
    "B. Thickness as required by UL Design X772 for a 2-hour beam rating.",
    "END OF SECTION 07 81 00",
    footer("07 81 00", 2),
  ],
  ["SECTION 08 71 00 - DOOR HARDWARE", "PART 1 - GENERAL", "A. Hinges, locksets and closers.", footer("08 71 00", 1)],
  ["END OF SECTION 08 71 00", footer("08 71 00", 2)],
  [
    "SECTION 09 21 16 - GYPSUM BOARD ASSEMBLIES",
    "PART 1 - GENERAL",
    "1.1 SUMMARY",
    "A. Interior gypsum board partitions and ceilings.",
    footer("09 21 16", 1),
  ],
  [
    "2.1 MANUFACTURERS",
    "A. USG Corporation; CertainTeed Gypsum; National Gypsum Company.",
    "2.2 GYPSUM BOARD",
    "A. Type X: ASTM C1396, 5/8 inch thick, at all fire-rated assemblies.",
    "B. Abuse-resistant gypsum board: ASTM C1629 Level 2, 5/8 inch, at corridors to 8 feet above floor.",
    footer("09 21 16", 2),
  ],
  [
    "3.4 FINISHING",
    "A. Level 4 finish at all exposed surfaces unless otherwise indicated.",
    "B. Level 5 finish at the main lobby and at walls receiving gloss paint.",
    "C. Fire-rated partitions: UL Design U419, 1-hour.",
    "END OF SECTION 09 21 16",
    footer("09 21 16", 3),
  ],
  [
    "SECTION 09 22 16 - NON-STRUCTURAL METAL FRAMING",
    "2.1 STUDS",
    "A. Steel studs: 20 gauge (33 mil) minimum, 3-5/8 inch unless otherwise indicated.",
    "B. Space studs at 16 inches on center maximum.",
    footer("09 22 16", 1),
  ],
  [
    "2.2 DEFLECTION TRACK",
    "A. Slotted deflection track at all partitions extending to structure above: ClarkDietrich MaxTrak.",
    "B. Deflection limit L/240 at 5 psf lateral load.",
    "END OF SECTION 09 22 16",
    footer("09 22 16", 2),
  ],
  [
    "SECTION 095113",
    "ACOUSTICAL PANEL CEILINGS",
    "2.1 PANELS",
    "A. Mineral fiber panels, 24 by 24 inches, Armstrong Ultima, square tegular edge.",
    footer("09 51 13", 1),
  ],
  [
    "2.2 SUSPENSION",
    "A. 15/16 inch exposed tee grid, Armstrong Prelude XL, white.",
    "B. Seismic perimeter clips as required by ASTM E580.",
    "END OF SECTION 09 51 13",
    footer("09 51 13", 2),
  ],
  [
    "SECTION 26 05 00 - COMMON WORK RESULTS FOR ELECTRICAL",
    "A. Conduit, boxes and fittings.",
    "END OF SECTION 26 05 00",
    footer("26 05 00", 1),
  ],
];

/** The fixture as a PDF, one line of text per string, top to bottom. */
export async function buildSpecBookFixture(pages: string[][] = SPEC_BOOK_FIXTURE_PAGES): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    lines.forEach((line, i) => {
      // The footer sits at the bottom of the page, as printed.
      const y = i === lines.length - 1 && /- \d+$/.test(line) ? 40 : 740 - i * 22;
      page.drawText(line, { x: 54, y, size: 10, font });
    });
  }
  return doc.save();
}
