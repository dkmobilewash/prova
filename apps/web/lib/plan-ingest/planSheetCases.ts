import { sheetOf, type SyntheticSheet } from "./planFixtures";
import type { SheetTitleBlock } from "@prova/integrations";

/**
 * The sheets the title-block eval reads, in a plain module so a FREE test can check
 * them before a paid one measures anything against them.
 *
 * THIS SPLIT IS NOT TIDINESS. `quoteFixtures.ts` + `quoteFixtures.test.ts` is the
 * same shape and its header gives the reason: an eval run costs real money and is
 * only worth running if the thing handed to the model is what the case claims. Here
 * that went wrong immediately and in the most expensive way possible — see
 * `reference-in-block` below.
 */

export type SheetCase = {
  id: string;
  sheet: SyntheticSheet;
  /** The sheet's own number as printed, or null when it prints none. */
  sheetNumber: string | null;
  /** What a correct reading looks like beyond the number, where it matters. */
  expect?: Partial<Pick<SheetTitleBlock, "discipline" | "scale" | "issueDate">>;
  /** The highest confidence an honest reading could claim. */
  ceiling?: "HIGH" | "MEDIUM" | "LOW";
  /** Strings that MUST reach the model, or the case is not the case it says it is.
   *  Checked for free by `planSheetCases.test.ts`. */
  mustSend: string[];
  why: string;
};

export const SHEET_CASES: SheetCase[] = [
  {
    id: "plain",
    sheet: sheetOf({
      drawing: ["PARTITION TYPE A", "GYP BD BOTH SIDES"],
      block: ["ZZ ARCHITECTS", "NORTHGATE MEDICAL OFFICE", "FIRST FLOOR PLAN", 'SCALE: 1/4" = 1\'-0"', "A-101"],
    }),
    sheetNumber: "A-101",
    expect: { scale: '1/4" = 1\'-0"' },
    mustSend: ["A-101", "FIRST FLOOR PLAN"],
    why: "an unambiguous title block — the easy half, and the control",
  },
  {
    id: "reference-in-block",
    /**
     * THE CASE THIS EVAL EXISTS FOR, AND THE FIRST VERSION OF IT MEASURED NOTHING.
     *
     * It put four references to other sheets in the DRAWING area — "SEE A-501",
     * "DETAIL 3/A-301" — reasoning that a reader might grab one instead of the
     * sheet's own number. Then the free check printed what actually reaches the
     * model and the answer was three lines: the title block alone. The region
     * filter had removed every reference, so the trap was never presented and the
     * case would have passed for the wrong reason, in the one eval written to catch
     * exactly that.
     *
     * So the references are IN THE BLOCK now, which is where a real sheet often
     * carries them — a "reference drawings" list beside the sheet number is ordinary
     * on a large set. `mustSend` pins them, so a later change to the region filter
     * that quietly removes them again fails for free instead of costing a run.
     */
    sheet: sheetOf({
      block: [
        "ZZ ARCHITECTS",
        "SECOND FLOOR PLAN",
        "REFERENCE DRAWINGS: A-501, A-601",
        "SEE DETAIL 3/A-301",
        "A-102",
      ],
    }),
    sheetNumber: "A-102",
    mustSend: ["A-102", "A-501", "A-301"],
    why: "three other sheets named in the block; the sheet's own number is the quiet one",
  },
  {
    id: "no-number",
    sheet: sheetOf({
      block: ["ZZ ARCHITECTS", "NORTHGATE MEDICAL OFFICE", "ENLARGED PLANS", "ISSUED 03/04/26"],
    }),
    sheetNumber: null,
    mustSend: ["ENLARGED PLANS"],
    why: "a title block with no sheet number on it — the invention case",
  },
  {
    id: "not-a-sheet",
    sheet: sheetOf({
      block: [
        "SECTION 09 21 16",
        "GYPSUM BOARD ASSEMBLIES",
        "PART 1 - GENERAL",
        "1.1 SUMMARY",
        "A. Section includes gypsum board assemblies.",
      ],
    }),
    sheetNumber: null,
    ceiling: "LOW",
    mustSend: ["SECTION 09 21 16"],
    why: "a specification page, not a drawing — nothing here identifies a sheet",
  },
  {
    id: "structural-prefix",
    sheet: sheetOf({
      block: ["ZZ ENGINEERS", "FRAMING PLAN - LEVEL 2", "SEE A-101 FOR PARTITIONS", "S2.1"],
    }),
    sheetNumber: "S2.1",
    expect: { discipline: "STRUCTURAL" },
    mustSend: ["S2.1", "A-101"],
    why: "no discipline word anywhere, an architectural sheet named in the block, and the S prefix is the only evidence",
  },
  {
    id: "scale-as-noted",
    sheet: sheetOf({
      block: ["ZZ ARCHITECTS", "EXTERIOR ELEVATIONS", "SCALE: AS NOTED", "A-201"],
    }),
    sheetNumber: "A-201",
    expect: { scale: "AS NOTED" },
    mustSend: ["AS NOTED", "A-201"],
    why: "a scale that is not a ratio and must not be turned into one",
  },
  {
    id: "date-as-printed",
    sheet: sheetOf({
      block: ["ZZ ARCHITECTS", "ROOF PLAN", "ISSUED: 03/04/26", "A-105"],
    }),
    sheetNumber: "A-105",
    expect: { issueDate: "03/04/26" },
    mustSend: ["03/04/26", "A-105"],
    why: "a date printed ambiguously; reformatting it invents a reading of it",
  },
  {
    id: "rotated",
    sheet: sheetOf({
      block: ["ZZ ARCHITECTS", "REFLECTED CEILING PLAN", "SEE A-501", "A-131"],
      rotation: 90,
    }),
    sheetNumber: "A-131",
    mustSend: ["A-131", "A-501"],
    why: "a /Rotate 90 sheet, so the extraction is on trial as well as the reading",
  },
  {
    id: "revision-beside-the-date",
    sheet: sheetOf({
      block: ["ZZ ARCHITECTS", "INTERIOR ELEVATIONS", "REV 2  03/18/26", "REVISED PER A-104", "A-401"],
    }),
    sheetNumber: "A-401",
    expect: { issueDate: "03/18/26" },
    mustSend: ["A-401", "A-104", "REV 2"],
    why: "a revision label sharing a line with the date, and another sheet named in the revision note",
  },
];

/**
 * Loose on punctuation and case, strict on content.
 *
 * CURLY QUOTES ARE THE REASON THIS IS NOT `===`, and it is a fixture artefact rather
 * than a model one. Helvetica's standard encoding maps a straight apostrophe to `’`,
 * so a scale written into the fixture as `1/4" = 1'-0"` comes back out of pdfjs as
 * `1/4" = 1’-0"`. A correct reading would then fail an exact comparison against what
 * the case asked for — the eval marking the model wrong for the font's decision.
 * Caught by the free check before a run, not by reading an odd verdict afterwards.
 */
export function sameish(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const norm = (value: string) =>
    value
      .trim()
      .toUpperCase()
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, " ");
  return norm(a) === norm(b);
}
