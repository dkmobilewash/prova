import type { PageTextItem } from "../takeoff/wallTags";

/**
 * THE SHEET NUMBER AND TITLE, READ WITHOUT A MODEL.
 *
 * ── WHY THIS EXISTS WHEN `titleBlock.ts` ALREADY DOES IT ──
 *
 * `titleBlock.ts` is the `TITLE_BLOCK` ingest stage: it hands the page's text to
 * the model and gets back `sheetNumber`, `title`, `pageType`, `scale`, revision
 * and date, with a confidence and a reason. That is the right tool for the
 * values that need judgement — what KIND of drawing a sheet is, whether "NTS"
 * means anything here — and it stays.
 *
 * Two of those values need no judgement at all, and `sheetSuitability.ts` wants
 * exactly those two:
 *
 *     sheetSuitability(sheetNumber, title, pageType)
 *
 * It works off the first two alone, and its own header says why the third is the
 * weakest: *"an office that numbers its ceiling plans A-101 still writes
 * REFLECTED CEILING PLAN on them."* So the sheet filter — the thing that decides
 * whether a wall takeoff belongs on a page at all — currently cannot run until a
 * model has been paid to read a title block. This reads the same two fields
 * deterministically, free, and offline.
 *
 * ── THE RULE, AND IT WAS MEASURED BEFORE IT WAS WRITTEN ──
 *
 * **The sheet number is the largest piece of text in the bottom-right corner.**
 * Nothing else about it is reliable, and two cheaper rules were tried on real
 * drawings and failed:
 *
 *   - *pattern-match the page for `A-101`.* West Herr's A-101 sheet carries
 *     `A1`, `A3`, `A5`, `A-301`, `A-302` as detail and section references all
 *     over the drawing — 14 candidates on one page.
 *   - *take the largest such match on the page.* Naples' first-floor sheets
 *     print room tags `A100`-`A108` at 12.5pt in the middle of the plan, which
 *     is LARGER than some offices set their sheet number. The real number there
 *     is `M011A`, which a `LETTER-DIGITS` pattern rejects outright for its
 *     trailing letter.
 *
 * Inside the title block there is no such competition. Measured on three offices
 * with three layouts and three numbering conventions:
 *
 *   | set       | number           | its height | the next largest |
 *   | --------- | ---------------- | ---------- | ---------------- |
 *   | West Herr | `A-101`, `A-604` | 38.7       | 25.8 (job number) |
 *   | Naples    | `M011A`, `FP201A`| 88.0       | 24.9 (sheet title) |
 *   | Augusta   | `A5.11`, `M1.12` | 50.5       | 25.0 ("PERMIT SET") |
 *
 * ── AND THE TITLE IS THE REGION, NOT A TIER ──
 *
 * The obvious follow-on rule — "the title is the second-largest tier" — is
 * FALSE, and Augusta is the counter-example: its sheet title (`WALL SECTIONS`,
 * `HVAC - LEVEL 01 ENLARGED DEMO`) is set at 19pt while `PERMIT SET` sits above
 * it at 25pt. So no tier is the title.
 *
 * What is safe is the whole region's text, because `sheetSuitability`'s title
 * rules are unanchored substring tests and the title block contains the sheet's
 * own name and nothing else. Handing it the WHOLE PAGE would not be safe —
 * measured: a floor plan with a note reading "SEE REFLECTED CEILING PLAN"
 * classifies as a ceiling plan, and across 218 pages that disagreed with the
 * sheet-number reading on 163 of them.
 *
 * Pure. No database, no model, no PDF — it takes text items somebody already
 * extracted.
 */

/**
 * The bottom-right corner, as fractions of the page.
 *
 * Generous rather than tight: every sheet number measured sat at x > 0.89 and
 * y > 0.95, so this has a wide margin, and the cost of including more of the
 * title block is nothing — the number is the largest thing in it either way,
 * and the extra text only helps the title. The cost of being too tight is a
 * number that falls outside the box on the next office's template.
 */
export const TITLE_BLOCK_X = 0.82;
export const TITLE_BLOCK_Y = 0.72;

/**
 * A sheet designation, permissively.
 *
 * Letters then a digit, with no space, which admits every real convention seen
 * — `A-101`, `M011A`, `A5.11`, `FP201A` — and rejects what shares the corner
 * with it: `PERMIT SET` (a space), `07231.14` and `01-12-18` (they start with a
 * digit, so they are job numbers and dates).
 */
const SHEET_DESIGNATION = /^[A-Z]{1,3}[-.]?\d[\dA-Z.\-]{0,6}$/i;

/** How far down the type sizes to look before giving up. A template whose
 *  largest corner text is a logo's wordmark should not cost the reading. */
const TIERS_TO_TRY = 5;

export type TitleBlockText = {
  /** As printed — `A-101`, `M011A`, `A5.11`. Null when the corner holds no
   *  designation at all, which is a cover sheet or an unnumbered page. */
  sheetNumber: string | null;
  /**
   * Every string in the title-block corner, joined.
   *
   * NOT "the title" and deliberately not called that: it is the corner's text,
   * which contains the sheet's own name along with the project name, the issue
   * and the architect's address. `sheetSuitability` tests substrings, so that is
   * exactly the right shape for it and the wrong shape for showing to anybody.
   */
  cornerText: string;
};

/**
 * Read the two fields a sheet filter needs.
 *
 * `items` are page text items in viewport points — `planPdf.ts`'s `pageText`
 * shape, where y grows DOWNWARD from the top-left, so the bottom-right corner
 * is high x and high y. That convention was confirmed against a page whose
 * sheet number was already known.
 */
export function titleBlockText(
  items: readonly PageTextItem[],
  widthPt: number,
  heightPt: number,
): TitleBlockText {
  if (!(widthPt > 0) || !(heightPt > 0)) return { sheetNumber: null, cornerText: "" };

  const corner = items
    .filter((item) => item.x / widthPt > TITLE_BLOCK_X && item.y / heightPt > TITLE_BLOCK_Y)
    .map((item) => ({ str: item.str.trim(), height: item.height }))
    .filter((item) => item.str.length > 0);

  if (corner.length === 0) return { sheetNumber: null, cornerText: "" };

  const biggestFirst = [...corner].sort((a, b) => b.height - a.height);
  let sheetNumber: string | null = null;
  for (const candidate of biggestFirst.slice(0, TIERS_TO_TRY)) {
    if (SHEET_DESIGNATION.test(candidate.str)) {
      sheetNumber = candidate.str;
      break;
    }
  }

  return { sheetNumber, cornerText: corner.map((item) => item.str).join(" ") };
}
