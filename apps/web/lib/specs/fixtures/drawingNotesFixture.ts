import { PDFDocument, StandardFonts } from "pdf-lib";

/**
 * AN INVENTED THREE-SHEET PLAN SET whose specs are printed on the drawings, for the
 * drawing-notes finder. Every word is made up. G001 carries general notes in a column
 * beside an abbreviations column; A101 repeats the stud note and adds a carpentry note
 * that must be dropped; E101 is an electrical sheet whose words must not be read.
 */
type Sheet = { number: string; columns: { x: number; lines: string[] }[] };

export const DRAWING_NOTES_SHEETS: Sheet[] = [
  {
    number: "G001",
    columns: [
      {
        x: 60,
        lines: [
          "GENERAL NOTES",
          '1. ALL INTERIOR STUD WALLS TO BE 3-5/8" 25 GA.',
          '   METAL STUDS @ 16" O.C. UNLESS NOTED OTHERWISE.',
          '2. USE TYPE "X" GWB FOR ALL FIRE RATED PARTITIONS.',
          "3. LEVEL 5 FINISH SHALL BE PROVIDED AT THE LOBBY.",
          "4. COORDINATE DOOR HARDWARE WITH THE OWNER.",
        ],
      },
      { x: 520, lines: ["ABBREVIATIONS", "ACT  ACOUSTIC CEILING TILE", "GWB  GYPSUM WALL BOARD", "GA  GAUGE"] },
    ],
  },
  {
    number: "A101",
    columns: [
      {
        x: 60,
        lines: [
          "PLAN NOTES",
          '1. ALL INTERIOR STUD WALLS TO BE 3-5/8" 25 GA.',
          '   METAL STUDS @ 16" O.C. UNLESS NOTED OTHERWISE.',
          '2. ALL WOOD SHEATHING SHALL BE 5/8" PLYWOOD NAILED AT 6" O.C.',
        ],
      },
    ],
  },
  { number: "E101", columns: [{ x: 60, lines: ["ELECTRICAL NOTES", "1. PROVIDE 12 GA. WIRE ABOVE THE CEILING GRID MIN. 6\" FROM DUCTS."] }] },
];

/** The set as a PDF: 24x18 in sheets, the number in the bottom-right corner. */
export async function buildDrawingNotesFixture(sheets: Sheet[] = DRAWING_NOTES_SHEETS): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const sheet of sheets) {
    const page = doc.addPage([1728, 1296]);
    for (const column of sheet.columns) {
      column.lines.forEach((line, i) => {
        const indent = line.startsWith("   ") ? 12 : 0;
        page.drawText(line.trimStart(), { x: column.x + indent, y: 1200 - i * 11, size: 8, font });
      });
    }
    page.drawText(sheet.number, { x: 1600, y: 30, size: 24, font: bold });
  }
  return doc.save();
}
