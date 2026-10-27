import { TITLE_BLOCK_BOTTOM_FRACTION, TITLE_BLOCK_RIGHT_FRACTION } from "../../plan-ingest/planPdf";

/**
 * ── THE SHEET'S OWN NAME, READ BY GLYPH HEIGHT ──
 *
 * `titleBlockText` returns the region's words in reading order, and on a real
 * set that is the wrong thing: `realSheets.eval.ts` first fed it to
 * `sheetSuitability` and got titles like "ITEM DESCRIPTION NYSDOT REF. DEPTH"
 * and "DRAWN BY: MC CHECKED BY: BBL PROJECT #: 23-2637". Nothing matched a
 * title rule, so every sheet defaulted to "floor plan" and the run measured a
 * pavement-item table, a lap-splice schedule and a wall-type detail sheet.
 *
 * A title block is laid out by SIZE: the sheet number is the biggest lettering
 * in it and the drawing's name is the next biggest. Reading it that way, with
 * the boilerplate filtered, named all five real sets correctly — which is how
 * the floor plans in that folder were identified in the first place.
 *
 * ── WHY THIS IS NOT IN `titleBlockText` ──
 *
 * That function feeds the ingest pipeline, and changing what it returns is a
 * separate change with its own blast radius. This reads the same region a
 * different way, for callers that want the sheet's NAME rather than its words.
 *
 * ── AND WHY IT IS ITS OWN MODULE ──
 *
 * It lived inside `realSheets.eval.ts` until 2026-10-16, when a second eval
 * needed it. Copying it would have made two glyph-height readers free to
 * drift, which is this repo's most expensive recurring shape — the
 * `CostCategory` rates had one canonical list and four hand-rolled copies, and
 * Ask reported a bid $1,732.50 under the Estimate screen. One reader, two
 * callers.
 */

/**
 * What a sheet number looks like.
 *
 * ── WIDENED 2026-10-16, AND THE OLD ONE WAS LOSING REAL SHEETS ──
 *
 * It was `^[A-Z]{1,3}[-.]?\d{1,3}(?:[.-]\d{1,2})?[A-Z]?$`, which allows ONE
 * separated group and only digits inside it. That covers `A-101` and dies on
 * every number one real office actually prints:
 *
 *   | sheet | old | why it failed |
 *   | --- | --- | --- |
 *   | `A4.B.1`  | ✗ | two separated groups, and the first is a LETTER |
 *   | `A1.2-1`  | ✗ | two separated groups |
 *   | `A0.003B` | ✗ | three digits in the group, cap was two |
 *   | `A4.B-Y2` | ✗ | letters in the group |
 *   | `H-96037` | ✗ | five digits, cap was three |
 *
 * **The cost was not a missing number, it was a WRONG one.** `nameSheet`
 * takes the largest in-block token that matches, so when the real number did
 * not match, a wall-type tag or a detail bubble that did became "the sheet
 * number" — ELEVEN03 reported `WT-12` for a sheet called `A4.B-Y2`, `S2` for
 * `A1.2-1`, and `U356` for `A0.003B`, and the real number ended up inside the
 * TITLE. That is how 175 sheets produced groups `U(3)` and `WT(2)`.
 *
 * The lookahead is what keeps the widening honest: at least one digit
 * somewhere, so `PLAN`, `CONC`, `TRUE`, `HR` and `LEVEL` — all of which the
 * permissive body alone would accept — stay out.
 */
export const SHEET_NO = /^(?=.*\d)[A-Z]{1,3}\d{0,3}(?:[.-][A-Z0-9]{1,5}){0,3}[A-Z]?$/;

/**
 * Title-block BOILERPLATE. Every office prints a different set of it and all of
 * it crowds out the one line that names the drawing.
 *
 * ── THREE OF THESE NEVER MATCHED, BECAUSE OF A `\b` AFTER PUNCTUATION ──
 *
 * The old pattern ended `)\b/i` for every alternative, and `\b` needs a word
 * character on one side. `project #:`, `no.` and `©` all end in punctuation,
 * so the boundary could never be satisfied and those three branches were dead
 * — written, listed, and never once matching. Camp Bow Wow paid for it in
 * full: every title on that set read like
 *
 *   "COVER SHEET project #: drawing number: drawing title: 09 PLU"
 *
 * `drawing number` / `drawing title` were simply absent from the list as well.
 *
 * ── AND THE BRANCH IS BARE `sheet`, NOT `sheet title|number|name|no` ──
 *
 * 89 of 283 real titles across five sets LED with a standalone "SHEET" — the
 * label printed beside the title, which the narrower branch could never match
 * on its own. Anchored at `^`, so a title that merely CONTAINS the word is
 * untouched and `COVER SHEET` still reads as itself. The cost is a real title
 * beginning "Sheet metal…", which loses one word and stays legible; the
 * saving is a third of every title on these sets.
 * The three punctuation branches now sit OUTSIDE the `\b` group, which is the
 * only structural way to express "this one ends in punctuation" — and
 * `projection` and `drawings` still do not match, which is what the boundary
 * was protecting in the first place.
 */
export const BOILER =
  /^(?:(?:issued for|date|drawn by|checked|designed|job no|sheet|drawing\s*(?:title|number|name)|scale|revision|rev|by|description|approved|copyright|all rights|exp|issue|of)\b|project\s*(?:#|no|number)|no\.|©)/i;

/**
 * How close to the largest qualifying word a word must be to count as part of
 * the title. 0.8 rather than 1.0 because a wrapped title's second line is
 * sometimes set a hair smaller, and because glyph heights measured off a PDF
 * vary by a percent or two within one run of type.
 */
const TITLE_TIER = 0.8;
/** A title has to be this much taller than the block's typical lettering before it is proposed as one. */
const DISTINCT_TITLE = 1.3;

export type TitleBlockItem = { str: string; x: number; y: number; height: number };

export function nameSheet(
  items: readonly TitleBlockItem[],
  page: { widthPt: number; heightPt: number },
): { number: string; title: string; /** The title's lettering is distinctly taller than the block's — a title to believe, not boilerplate at the same size. */ distinct: boolean } {
  const inBlock = items.filter(
    (i) => i.x >= page.widthPt * TITLE_BLOCK_RIGHT_FRACTION && i.y >= page.heightPt * TITLE_BLOCK_BOTTOM_FRACTION,
  );
  const bySize = [...inBlock].sort((a, b) => b.height - a.height);
  const numbered = bySize.filter((i) => SHEET_NO.test(i.str.trim().replace(/\s+/g, "")));
  const number = (numbered[0]?.str ?? "").trim().replace(/\s+/g, "");
  /**
   * ── THE TITLE IS ONE TYPE SIZE, NOT THE NEXT SIX WORDS ──
   *
   * This took `.slice(0, 6)` off the size-ordered list, which is six words
   * from wherever they happened to fall. Once the boilerplate stopped
   * crowding them out (see BOILER above) what filled the gap was the DRAWING:
   *
   *   `FLOOR PLAN True OUTDOOR PLAY YARD 1`
   *   `COVER SHEET 09 PLUMBING PLUMBING SYMBOLS & ABBREVIATIONS`
   *
   * In both the real title is the leading part and the rest is smaller
   * lettering from the sheet. A title block sets its title in ONE size, so
   * the tier is the discriminator the old slice was missing — keep what is
   * within `TITLE_TIER` of the largest qualifying word and the noise drops
   * off on its own, without a word list anybody has to maintain.
   *
   * Still capped at six, because a wrapped title is several items and a
   * run-on is worse than a truncation in a 232px rail.
   */
  const qualifies = (w: string) =>
    w.length > 2 && !/^[\d.\-/'"_ ]+$/.test(w) && !BOILER.test(w) && !SHEET_NO.test(w.replace(/\s+/g, ""));
  const titleItems = bySize.slice(0, 24).filter((i) => qualifies(i.str.trim()));
  const tallest = titleItems[0]?.height ?? 0;
  const heights = inBlock.map((i) => i.height).sort((a, b) => a - b);
  const median = heights.length === 0 ? 0 : heights[Math.floor(heights.length / 2)];
  const distinct = tallest > 0 && tallest >= median * DISTINCT_TITLE;
  const title = titleItems
    .filter((i) => i.height >= tallest * TITLE_TIER)
    .slice(0, 6)
    .map((i) => i.str.trim())
    .join(" ");
  return { number, title, distinct };
}
