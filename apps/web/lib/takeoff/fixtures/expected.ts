/**
 * ── THE ANSWER KEY FOR A DRAWING NOBODY HERE DREW ──
 *
 * `reports/takeoff-bench` grades the finder against sheets OUR OWN generator
 * drew, and `wallCases.ts` says in its header what that is worth: *"a pass here
 * is a FLOOR"*. Twice this week the bench reported "no change" on a fix that a
 * real drawing proved was doing real work, and three separate defects — a
 * split-path reader bug, an existing-work layer convention, a prompt rule that
 * ate curved walls — were found by pointing instruments at drawings this repo
 * did not author. One generator cannot surprise itself.
 *
 * These twenty sheets were drawn by a different generator, with different
 * conventions, and this file is the key for them.
 *
 * ── NULL MEANS NOT SCORED, AND MOST OF THE EXPENSIVE FIELDS ARE NULL ──
 *
 * The rule is the one a real plan forces: **only what the drawing PRINTS can be
 * ground truth.** A room tag that says `361 SF` is an answer the architect
 * published and a scorer may hold us to it. A wall length nobody printed is
 * not, and inventing one by measuring the drawing with the very detector under
 * test would be marking our own homework.
 *
 * So, on this set:
 *
 *   scale          scoreable — printed in the title block on most sheets
 *   room count     scoreable — one tag per room, counted from the text
 *   room names     scoreable
 *   room areas     scoreable on THREE sheets. Null on the rest.
 *   wall LF        **NULL EVERYWHERE. Not printed on any of the twenty.**
 *   door/window    **NULL EVERYWHERE. No schedules on these sheets.**
 *
 * **The number this product exists to get right is the one these fixtures
 * cannot score.** Said here rather than discovered later: for wall footage the
 * bench remains the only key, and this set measures the stages BEFORE it —
 * whether we read the right scale, find the right rooms, and survive another
 * office's conventions. Those are the stages a wrong wall number usually starts
 * in.
 *
 * ── WHY THE SCALE CHECK IS NOT CIRCULAR ──
 *
 * The pipeline's primary scale reader is `scaleFromDimensions`, which measures
 * LINES and reads the dimension strings printed beside them. The expected value
 * here comes from the title block's printed scale NOTE, which that reader does
 * not consult — `scaleFromPrinted` is a fallback used only when the dimensions
 * decline. So scoring one against the other is the cross-check the plan asks
 * for, not a tautology. Where the pipeline FELL BACK to the printed note, the
 * scorer says so and does not count it as an independent pass.
 */

/** One room the drawing tags, as printed. */
export type ExpectedRoom = {
  /** As printed — `KITCHEN`, `KITCHEN / DINING`. */
  name: string;
  /** The tag number — `101` on an imperial sheet, `01` on a metric one. */
  number: string;
  /**
   * The area the tag prints, IN THE UNIT IT PRINTS IT, or null.
   *
   * NOT converted here. A key stores what the architect published; turning
   * `32.6 m2` into square feet is arithmetic, and arithmetic belongs in the
   * scorer where it can be seen and argued with. A converted number in a key
   * is a number nobody can check against the drawing.
   */
  area: { value: number; unit: "sf" | "m2" } | null;
};

export type ExpectedSheet = {
  /** The fixture's file stem — `S01`. */
  id: string;
  /** What the sheet calls itself, for a human reading the table. */
  title: string | null;
  /** 1-based. These are all single-page sheets. */
  page: number;
  sheetNumber: string | null;
  /** True when the page carries no text layer and no vector strokes. */
  raster: boolean;
  /**
   * The scale as PRINTED, normalised — `1/4" = 1'-0"`. Null when the sheet
   * prints none, which is itself a case worth having: the app must decline
   * rather than guess.
   */
  scale: string | null;
  /** Every scale printed on the sheet, when it carries more than one view. */
  scalesPrinted: string[];
  /** The page as displayed, in points. */
  widthPt: number;
  heightPt: number;
  rooms: ExpectedRoom[];
  /** Printed dimension strings, for the scale cross-check. */
  dimensions: string[];
  /**
   * Which reading of the scale this sheet's own content supports.
   *
   * ── A SHEET CAN CONTRADICT ITSELF, AND ONE OF THESE DOES ──
   *
   * `printed` is the ordinary case: the title block's note and the geometry
   * agree, so the note is a fair thing to score against.
   *
   * `dimensions-disagree` means the sheet's DIMENSION STRINGS measure something
   * the title block does not claim. On S11 the printed note says `1/8" = 1'-0"`
   * and the drawing's own `31'-0"` dimension is **7.75 inches long on a
   * 17-inch sheet** — 31 feet in 7.75 inches is a quarter-inch to the foot, and
   * all six of its dimensions agree on that. The title block is wrong.
   *
   * That is not an exotic case. A copied title block with a stale scale is one
   * of the commonest defects on a real bid set, and it is why the app reads
   * dimensions FIRST and treats the printed note as a fallback — and why
   * `calibrationNotices` warns when the two disagree rather than silently
   * picking one.
   *
   * **A sheet marked this way is not scored on scale.** The key would have to
   * re-measure the drawing to adjudicate, and re-measuring with the code under
   * test is not an answer key. What IS scored is that the app notices.
   */
  scaleAuthority: "printed" | "dimensions-disagree" | "none";
  /** NOT PRINTED on this set. Kept so the shape matches the day a fixture has
   *  them, and so the scorer's skip is explicit rather than an omission. */
  wallLfTotal: number | null;
  doorCount: number | null;
  windowCount: number | null;
  /** Anything a reader should know before trusting a row. */
  notes: string[];
};

/**
 * A room tag's number: TWO OR THREE digits.
 *
 * ── THREE WAS WRONG, AND THE FIXTURE SET CAUGHT IT ──
 *
 * The first version of this matched three digits only, because every sheet I
 * had looked at used `101`. Two of the twenty are drawn to METRIC conventions
 * and number their rooms `01`, `02` — so the key reported **zero rooms** on
 * both, which is not a null (unscored) but a confident wrong answer, the worst
 * kind a key can hold.
 *
 * Two digits is the floor rather than one, because a single digit is a grid
 * bubble (`1`, `2`) and a scale-bar tick (`0`, `8`, `16`) on these same sheets.
 */
export const ROOM_NUMBER = /^\d{2,3}$/;

/** A room NAME as these sheets print one: capitals, possibly with a slash or a
 *  hyphen, at least two characters so a stray `N` north arrow cannot match. */
export const ROOM_NAME = /^[A-Z][A-Z]+(?:[ /&-]+[A-Z]+)*$/;

/** `361 SF` and `32.6 m2` — the two forms this set prints. */
export const AREA_PRINTED = /^(\d+(?:\.\d+)?)\s*(SF|M2|M²)$/i;

/**
 * A printed scale note, in the forms a title block uses.
 *
 * Deliberately NOT reusing `scaleFromPrinted`'s parser: an answer key that
 * parses with the code under test cannot disagree with it, and disagreeing is
 * the key's whole job.
 */
export const PRINTED_SCALE = /\b(\d+(?:\/\d+)?")\s*=\s*(\d+'(?:\s*-\s*\d+")?)/;

/** `1:100`, the metric form. */
export const RATIO_SCALE = /\b1\s*:\s*(\d{1,4})\b/;

/**
 * The printed scale on a line of title-block text, normalised, or null.
 *
 * Normalising matters because the same scale is printed `1/4" = 1'-0"` and
 * `1/4"=1'` on different sheets, and a key that stored both spellings would
 * fail a correct pipeline for punctuation.
 */
export function printedScaleIn(text: string): string | null {
  const imperial = PRINTED_SCALE.exec(text);
  if (imperial) {
    const feet = imperial[2].replace(/\s*-\s*/, "-");
    return `${imperial[1]} = ${feet.includes("-") ? feet : `${feet}-0"`}`;
  }
  const ratio = RATIO_SCALE.exec(text);
  if (ratio) return `1:${ratio[1]}`;
  if (/\bN\.?T\.?S\.?\b/i.test(text)) return "NTS";
  return null;
}

/**
 * Rooms read out of a page's words IN ORDER.
 *
 * These sheets print a tag as `NAME`, then `NUMBER`, then optionally `### SF`,
 * as consecutive text items — so the sequence is the structure and no
 * geometry is involved. That independence is the point: the detector finds
 * rooms by polygonising wall geometry, and this finds them by reading what the
 * architect typed.
 */
export function roomsFromWords(words: readonly string[]): ExpectedRoom[] {
  const out: ExpectedRoom[] = [];
  for (let i = 0; i < words.length - 1; i += 1) {
    const name = words[i].trim();
    const number = words[i + 1].trim();
    if (!ROOM_NAME.test(name) || !ROOM_NUMBER.test(number)) continue;
    const after = (words[i + 2] ?? "").trim();
    const printed = AREA_PRINTED.exec(after);
    out.push({
      name,
      number,
      area: printed
        ? { value: Number(printed[1]), unit: /sf/i.test(printed[2]) ? "sf" : "m2" }
        : null,
    });
    i += printed ? 2 : 1;
  }
  return out;
}

/** A printed dimension string — `24'-6 1/2"`, `16'-4"`. */
export const DIMENSION = /^\d+'\s*-\s*\d+(?:\s+\d+\/\d+)?"$|^\d+'-\d+"$/;

/**
 * A metric dimension: bare millimetres, `7150`.
 *
 * ONLY READ ON A SHEET WHOSE PRINTED SCALE IS A RATIO, because a bare four-digit
 * number on an imperial sheet is a room area, a job number or a year. The unit
 * is not in the string, so the sheet has to supply it — which is why this takes
 * the scale rather than guessing from the digits.
 */
export const DIMENSION_MM = /^\d{3,5}$/;

export function dimensionsFromWords(words: readonly string[], scale: string | null): string[] {
  const metric = scale !== null && scale.startsWith("1:");
  return words
    .map((w) => w.trim())
    .filter((w) => (metric ? DIMENSION_MM.test(w) || DIMENSION.test(w) : DIMENSION.test(w)));
}
