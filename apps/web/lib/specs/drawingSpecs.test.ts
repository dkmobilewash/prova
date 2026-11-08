import { describe, expect, it } from "vitest";
import { drawingSpecNotes, factsFromNote, isTradeRequirement, notesFrom, searchesSheet, sectionForNote, type TextItem } from "./drawingSpecs";

/** Invented sheet text, one item per printed line: [x, y, words]. 8pt type, 11pt leading. */
const sheet = (lines: [number, number, string][]): TextItem[] =>
  lines.map(([x, y, str]) => ({ str, x, y, width: str.length * 4.4, height: 8 }));

describe("notes rebuilt per column from the text layer", () => {
  it("joins a wrapped note in its own column and never glues it to the column beside it", () => {
    const items = sheet([
      [40, 100, "GENERAL NOTES"],
      [40, 115, "1. ALL INTERIOR STUD WALLS TO BE 3-5/8\" 20 GA."],
      [52, 126, "METAL STUDS @ 16\" O.C. UNLESS NOTED OTHERWISE."],
      [40, 140, "2. COORDINATE DOOR HARDWARE WITH THE OWNER."],
      [400, 115, "ACT  ACOUSTIC CEILING TILE"],
      [400, 126, "GWB  GYPSUM WALL BOARD"],
    ]);
    const texts = notesFrom(items).map((n) => n.text);
    expect(texts).toContain('1. ALL INTERIOR STUD WALLS TO BE 3-5/8" 20 GA. METAL STUDS @ 16" O.C. UNLESS NOTED OTHERWISE.');
    expect(texts).toContain("2. COORDINATE DOOR HARDWARE WITH THE OWNER.");
    const kept = drawingSpecNotes(items);
    expect(kept.map((n) => n.sectionNumber)).toEqual(["09 22 16"]);
    expect(kept[0].read.studs).toEqual([{ gauge: "20 GA", depth: '3-5/8"', spacing: '16" O.C.', quote: kept[0].text }]);
  });
});

describe("which notes are this trade's requirements", () => {
  it("keeps a requirement with something to measure, and drops labels, legends, other trades and glued keynotes", () => {
    expect(isTradeRequirement('4. USE TYPE "X" GWB FOR ALL FIRE RATED PARTITIONS')).toBe(true);
    expect(isTradeRequirement("C. LEVEL 5 FINISH SHALL BE PROVIDED AT THE LOBBY WALLS.")).toBe(true);
    // A wall legend's assembly line names no requirement.
    expect(isTradeRequirement('(2) LAYERS 5/8" TYPE X GYP. BOARD EACH SIDE')).toBe(false);
    // "TYP." alone is a detail label, not a requirement.
    expect(isTradeRequirement('8" METAL STUD AT 16" O.C. TYP.')).toBe(false);
    // Carpentry and roofing share the words.
    expect(isTradeRequirement('ALL SHEATHING SHALL BE 5/8" PLYWOOD NAILED AT 6" O.C.')).toBe(false);
    expect(isTradeRequirement('PROVIDE 5/8" PLYWOOD TO 8\'; PROVIDE ABUSE RESISTANT GYP. BD. IN THE OFFICE')).toBe(true);
    // Keynotes glued together.
    expect(isTradeRequirement('KEY NOTES 1 MATCH EXISTING. 2 3 4 PROVIDE 5/8" GYP BD AT SOFFIT. 5 6')).toBe(false);
    // Demolition.
    expect(isTradeRequirement('3. REMOVE GYP. BD. BULKHEAD; PROVIDE NEW 5/8" BOARD TO MATCH.')).toBe(false);
    // Code analysis.
    expect(isTradeRequirement("FIRE PARTITIONS PER IBC CHAPTER 7 SHALL BE 1 HR RATED GYPSUM ASSEMBLIES")).toBe(false);
  });

  it("files a note under the section it prints, else its trade's", () => {
    expect(sectionForNote("(092116) SOUND BLANKETS SHALL EXTEND 4'-0\" OVER THE GRID")).toBe("09 21 16");
    expect(sectionForNote("PROVIDE IMPACT RESISTANT CORNER BEADS AT PLASTER AND GYPSUM BOARD")).toBe("09 21 16");
    expect(sectionForNote("STUCCO SHALL BE 7/8\" THREE COAT OVER METAL LATH")).toBe("09 24 00");
    expect(sectionForNote("SECURE TO MAIN RUNNER WITHIN 2\" OF CROSS RUNNER")).toBe("09 51 13");
    expect(sectionForNote("SPRAY-APPLIED FIREPROOFING SHALL BE 1\" MIN.")).toBe("07 81 00");
    expect(sectionForNote("ALL INTERIOR STUD WALLS TO BE 20 GA.")).toBe("09 22 16");
  });

  it("searches general, architectural and interiors sheets only", () => {
    for (const n of ["G001", "A0.1", "A-101", "AD101", "I201", null]) expect(searchesSheet(n), String(n)).toBe(true);
    for (const n of ["S0.1", "E1.0", "M201", "P301", "FP201", "C800", "T0.01"]) expect(searchesSheet(n), n).toBe(false);
  });
});

describe("facts read out of a note by code", () => {
  it("reads board kinds, finish level, UL design and price drivers, the note as the quote", () => {
    const note = 'B. ALL GYPSUM BOARD SHALL BE 5/8" TYPE X, LEVEL 5 FINISH AT LOBBY; PROVIDE SLOTTED DEFLECTION TRACK PER UL DESIGN U419, 1 HR.';
    const read = factsFromNote(note);
    expect(read.boards).toEqual([{ kind: "Type X", thickness: '5/8"', where: "AT LOBBY", quote: note }]);
    expect(read.finishLevels.map((f) => [f.level, f.where])).toEqual([[5, "LOBBY"]]);
    expect(factsFromNote("6. ALL DRYWALL SHALL RECEIVE LEVEL 5 FINISH, U.N.O.").finishLevels.map((f) => f.where)).toEqual([null]);
    expect(read.fireRatings).toEqual([{ rating: "1 HR", assembly: "UL U419", quote: note }]);
    expect(read.priceDrivers.map((d) => d.label)).toEqual(["Level 5 finish", "Deflection track"]);
  });
});
