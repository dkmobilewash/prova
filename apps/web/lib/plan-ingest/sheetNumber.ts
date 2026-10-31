import {
  titleBlockRegion,
  TITLE_BLOCK_RIGHT_FRACTION,

  type PlanPageText,
} from "./planPdf";

/**
 * THE SHEET NUMBER, READ OFF A TITLE BLOCK WITHOUT A MODEL.
 *
 * ── TWO CORRECTIONS TO THE PR THAT FIRST SHIPPED THIS (#782), BOTH MINE ──
 *
 * **It was called `titleBlockText` and that name was already taken.**
 * `planPdf.ts:354` exports a `titleBlockText(page)` — same name, same folder —
 * which returns the title block as text in reading order FOR THE MODEL. Two
 * exported functions with one name, one of which nothing imported. Renamed.
 *
 * **It invented a second title-block region**, 0.82/0.72, while `planPdf.ts`
 * had already decided where a title block is and argued it better:
 *
 *   > *"the right 40% of the width, OR the bottom 25% of the height… A filter
 *   > assuming one convention would silently drop the sheet number on every set
 *   > drawn the other way — and a dropped sheet number reads as the model
 *   > failing, which is the most expensive kind of wrong."*
 *
 * Mine was an INTERSECTION of a tighter box; that module's is a UNION of two
 * conventions. Its warning predicted my own miss rate: the first version read a
 * number on 149 of 218 real pages, and a title block in a bottom band with its
 * number at x=0.3 is invisible to a right-hand corner. So the corner is now a
 * first attempt that falls back to that module's region, and the constants below
 * are declared as a NARROWING of its two rather than a rival pair —
 * `sheetNumber.test.ts` asserts they stay inside it.
 *
 * ── AND WHAT IT DOES NOT DO, WHICH THAT PR CLAIMED ──
 *
 * It does **not** remove a paid model call. `TITLE_BLOCK` calls the model for
 * the scale, the revision, the issue date and the page type as well, so the
 * sheet number is a by-product of a call that happens anyway. Reading it here
 * saves nothing on a page the stage has already read.
 *
 * What it is actually for: `effectiveSheetNumber` returns **null when there is
 * no proposal row at all** (`sheetIndex.ts:63`). On such a page
 * `sheetSuitability` gets nothing to judge and the duplicate-walls caution —
 * the thing that keeps 13,767 invented feet off a mechanical plan — cannot
 * fire. This reads the two fields that need no judgement, so that caution can
 * work on a plan the model stage has not reached, is switched off for, or has
 * run out of allowance on.
 *
 * ── IT HAS NO PRODUCTION CALLER YET, SAID OUT LOUD ──
 *
 * The takeoff page reads DB rows, not the PDF, so it cannot call this where it
 * needs it. The honest home is the `PAGE_INVENTORY` stage, which already opens
 * the PDF, calls no model, and persists `planSheetText` and
 * `planSheetScaleReading` — a sheet-number reading belongs beside those. That
 * is a schema decision (a column, or a read-time derivation off the stored
 * text), announced in Slack before the push, and deliberately not smuggled in
 * here. Until then this is a tested pure function and nothing more, which is
 * what `scaleFromBar.ts` says about itself for the same reason.
 *
 * ── THE RULE, MEASURED BEFORE IT WAS WRITTEN ──
 *
 * **The sheet number is the largest piece of text in the title block.** Two
 * cheaper rules were tried on real drawings and both failed:
 *
 *   - *pattern-match the page.* West Herr's A-101 carries `A1`, `A3`, `A5`,
 *     `A-301`, `A-302` as detail references across the drawing — 14 candidates
 *     on one page.
 *   - *take the largest such match on the page.* Naples prints room tags
 *     `A100`-`A108` at 12.5pt in the middle of the plan. Its real number is
 *     `M011A`, which a `LETTER-DIGITS` pattern rejects for its trailing letter.
 *
 * Inside a title block there is no such competition. Measured on three offices
 * with three layouts and three conventions: West Herr `A-101` at 38.7pt against
 * 25.8 for the job number; Naples `M011A` at 88 against 24.9; Augusta `A5.11` at
 * 50.5 against 25.0 for `PERMIT SET`.
 *
 * **And the type-size sort turns out not to be load-bearing on any of them.** A
 * mutation replacing it with document order leaves every case green, because
 * inside the corner the PATTERN already disambiguates — a job number and a date
 * start with a digit, `PERMIT SET` has a space, `DRAWING NUMBER` has no digit.
 * The sort would earn its place on a corner holding two designations, which has
 * not been seen on a real sheet here. It stays as the stated tiebreak and
 * `sheetNumber.test.ts` records that it is unproven, rather than a fixture being
 * invented to make the mutation red. What IS load-bearing is the region, the
 * pattern, and the fallback.
 *
 * The obvious follow-on rule is FALSE and Augusta is why: its sheet title is set
 * at 19pt BELOW a 25pt issue stamp, so no type tier is the title. What is safe
 * is the region's whole text, because `sheetSuitability`'s title rules are
 * unanchored substring tests and a title block holds the sheet's own name.
 * Handing them the WHOLE PAGE is not safe — measured: a floor plan carrying
 * "SEE REFLECTED CEILING PLAN" as a note classifies as a ceiling plan, and
 * across 218 pages that disagreed with the number on 163 of them, in the
 * direction that flatters coverage.
 *
 * Pure. No database, no model, no PDF — it takes a page somebody already read.
 */

/**
 * The bottom-right corner, tried FIRST.
 *
 * A NARROWING of `planPdf.ts`'s region, not a rival to it: both numbers are
 * tighter than its pair, which `sheetNumber.test.ts` asserts so the two cannot
 * drift apart. Every sheet number measured sat at x > 0.89 and y > 0.95, so this
 * has a wide margin — and where it finds nothing, the wider region runs.
 */
export const CORNER_X = 0.82;
export const CORNER_Y = 0.72;

/**
 * A sheet designation, permissively.
 *
 * Letters then a digit, no space, which admits every convention seen — `A-101`,
 * `M011A`, `A5.11`, `FP201A` — and rejects what shares the corner with it:
 * `PERMIT SET` has a space, `07231.14` and `01-12-18` start with a digit, so
 * they are job numbers and dates.
 */
export const SHEET_DESIGNATION = /^[A-Z]{1,3}[-.]?[A-Z]?\d[\dA-Z.\-]{0,6}$/i;

/** `C0.10 (2 OF 29)`: Eleven03 prints the sheet's place in the set after its number. */
const PLACE_IN_SET = /\s*\(\s*\d+\s+OF\s+\d+\s*\)$/i;
/** The dashes a set can print between a letter and a number. */
const DASHES = /[\u2010-\u2015\u2212]/g;
/** How far apart, in type heights, two pieces of one number can sit. */
const PIECE_GAP = 0.8;


/** How far down the type sizes to look before giving up, so a template whose
 *  largest corner text is a logo's wordmark does not cost the reading. */
const TIERS_TO_TRY = 5;

export type SheetNumberReading = {
  /** As printed — `A-101`, `M011A`, `A5.11`. Null when neither the corner nor
   *  the wider region holds a designation: a cover sheet, or an unnumbered page. */
  sheetNumber: string | null;
  /**
   * The text of whichever region produced the reading, joined.
   *
   * NOT "the title", and deliberately not named that: it carries the project
   * name, the issue and the architect's address alongside the sheet's own name.
   * `sheetSuitability` tests substrings, which is exactly the right shape for
   * it and the wrong shape for showing anybody.
   */
  regionText: string;
  /** Which attempt answered, so a reader can tell a clean corner read from a
   *  fallback over a much larger area. */
  source: "corner" | "region" | "none";
};

type Candidate = { str: string; height: number };
type Placed = Candidate & { x: number; y: number; width: number };

/**
 * A number set as separate text items, `I` `-` `000` on HPL and `G` `−` `001` on
 * Topeka, read as one. Pieces share a line and a type size and nearly touch, and
 * the joined text must itself be a designation, or the pieces stay as they were.
 * A piece that already is one is left alone: Murray prints each number twice,
 * one over the other.
 */
function withSplitNumbers(items: readonly Placed[]): Placed[] {
  const pieces = items.filter((i) => !/\s/.test(i.str)).sort((a, b) => a.x - b.x);
  const used = new Set<Placed>();
  const joined: Placed[] = [];
  for (const start of pieces) {
    if (used.has(start) || SHEET_DESIGNATION.test(start.str)) continue;
    const chain = [start];
    for (let at = start; ; ) {
      const end = at.x + at.width;
      const next = pieces.find((p) => !used.has(p) && !chain.includes(p) && p.x >= at.x && Math.abs(p.height - start.height) <= 0.1 * start.height && Math.abs(p.y - start.y) <= 0.3 * start.height && p.x - end <= PIECE_GAP * start.height);
      if (!next) break;
      chain.push(next);
      at = next;
    }
    if (chain.length < 2) continue;
    const str = chain.map((p) => p.str).join("");
    if (!SHEET_DESIGNATION.test(str)) continue;
    for (const p of chain) used.add(p);
    joined.push({ ...start, str, width: chain[chain.length - 1]!.x + chain[chain.length - 1]!.width - start.x });
  }
  return [...items.filter((i) => !used.has(i)), ...joined];
}

function designationIn(items: readonly Candidate[]): string | null {
  const biggestFirst = [...items].sort((a, b) => b.height - a.height);
  for (const candidate of biggestFirst.slice(0, TIERS_TO_TRY)) {
    if (SHEET_DESIGNATION.test(candidate.str)) return candidate.str;
  }
  return null;
}

/**
 * Read the two fields a sheet filter needs.
 *
 * Takes `planPdf.ts`'s own page shape, so it reuses that module's region rather
 * than re-deciding where a title block is. y grows DOWNWARD from the top-left
 * there — confirmed against a page whose sheet number was already known — so
 * the bottom-right corner is high x and high y.
 */
export function sheetNumberFrom(page: PlanPageText): SheetNumberReading {
  if (!(page.widthPt > 0) || !(page.heightPt > 0)) {
    return { sheetNumber: null, regionText: "", source: "none" };
  }

  const clean = (items: readonly { str: string; height: number; x: number; y: number; width: number }[]): Candidate[] =>
    withSplitNumbers(
      items
        .map((item) => ({ str: item.str.trim().replace(DASHES, "-").replace(PLACE_IN_SET, ""), height: item.height, x: item.x, y: item.y, width: item.width }))
        .filter((item) => item.str.length > 0),
    );

  // FIRST the corner, where the number has no competition.
  const corner = clean(
    page.items.filter(
      (item) => item.x / page.widthPt > CORNER_X && item.y / page.heightPt > CORNER_Y,
    ),
  );
  const fromCorner = designationIn(corner);
  if (fromCorner !== null) {
    return {
      sheetNumber: fromCorner,
      regionText: corner.map((item) => item.str).join(" "),
      source: "corner",
    };
  }

  // THEN the union `planPdf.ts` argues for: a right-hand strip OR a bottom
  // band, with its own whole-page fallback. Wider, so the largest text is less
  // certainly the number — which is why it runs second and says it did.
  const wider = clean(titleBlockRegion(page).items);
  const fromRegion = designationIn(wider);
  return {
    sheetNumber: fromRegion,
    regionText: (fromRegion !== null ? wider : corner).map((item) => item.str).join(" "),
    source: fromRegion !== null ? "region" : "none",
  };
}

/**
 * Proof the corner is a SUBSET of `planPdf.ts`'s region rather than a rival to
 * it — so the first attempt can only ever narrow the second, never look
 * somewhere it does not.
 *
 * ── THE Y CONSTANT IS NOT PART OF THIS, AND MY FIRST VERSION SAID IT WAS ──
 *
 * I asserted `CORNER_Y >= TITLE_BLOCK_BOTTOM_FRACTION` and the guard went red:
 * 0.72 is LOOSER than 0.75, so by that reading the corner reached above the
 * bottom band. The assertion was wrong, not the constants. That module's region
 * is a UNION — `x >= 0.6 OR y >= 0.75` — so every point with `x > 0.82`
 * satisfies it through the x clause alone, whatever its y. The y constant only
 * decides how much of the right-hand strip the first attempt looks at.
 *
 * Kept as a derived constant rather than a comment because that is the mistake
 * it exists to stop somebody repeating.
 */
export const CORNER_IS_INSIDE_REGION = CORNER_X >= TITLE_BLOCK_RIGHT_FRACTION;
