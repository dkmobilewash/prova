/**
 * ── WHICH SCALES A SHEET PRINTS, AND WHY IT LIVES IN ITS OWN FILE ──
 *
 * Moved out of `scaleAudit.ts` on 2026-10-15, and the reason is a build break
 * rather than tidiness. That module imports `node:fs` and `node:path` because
 * it walks a directory of plans offline — so importing ANYTHING from it into a
 * client component drags those in, and webpack fails with
 * `UnhandledSchemeError: Reading from "node:fs" is not handled by plugins`.
 *
 * Typecheck, lint and the whole unit suite were green on exactly that mistake:
 * the viewer needs this one pure function, it imported it from where it lived,
 * and only `pnpm build` said so. This repo's own rule, arriving from the side
 * it warns about least — a module boundary that is invisible until a bundler
 * reads it.
 *
 * Nothing here touches a file or a path. It is text in, scale names out, so it
 * is safe in a browser and in a Node script alike.
 */
import { standardScaleFromText } from "../takeoff-plan";

/**
 * EVERY STANDARD SCALE PRINTED ANYWHERE ON THE PAGE, distinct, in reading order.
 *
 * ── THIS LOOKED IN THE TITLE BLOCK ONLY, AND A REAL SHEET PROVED THAT WRONG ──
 *
 * The second export this was pointed at reported `NO_TITLE_SCALE` while printing
 * `1/4" = 1'-0"` in plain text — at x=958 on a 3,024pt page, under the drawing
 * rather than in the title-block corner. Its title block says **`SCALE: AS
 * NOTED`**, which is not a missing answer but the ordinary convention: each view
 * is captioned with its own scale beneath it, and the block defers to them.
 *
 * So the answer key was on the sheet and this function was looking past it,
 * which would have read as an unverifiable derivation forever. Whole page now.
 *
 * ── AND WHY IT RETURNS ALL OF THEM RATHER THAN THE FIRST ──
 *
 * A sheet carrying a plan and an enlarged detail prints TWO scales, both
 * correct. Taking the first would silently cherry-pick, and taking whichever
 * matched would turn an unverifiable page into a false `AGREES` — the one
 * outcome an audit must not manufacture. Several distinct scales is a fact about
 * the sheet, reported as such, and it is the same multi-scale sheet `#640`
 * already warns about.
 *
 * `standardScaleFromText` is what decides whether a candidate IS a scale, so
 * `AS NOTED`, `NTS` and a metric `1:100` all yield nothing — and that is reused
 * rather than re-decided here.
 */
/** A scale caption and where it sits, in the items' own coordinates. */
export type PrintedScaleAt = {
  name: string;
  feetPerInch: number;
  x: number;
  y: number;
};

/**
 * ── ONE SCANNER, TWO READINGS OF IT ──
 *
 * `printedScalesOnPage` wants the distinct NAMES and nothing else;
 * `printedScalesAt` wants every occurrence WITH its position, because a sheet
 * carrying two drawings captions each one under its own, and the position is
 * the only thing that says which scale belongs to which drawing.
 *
 * They share this loop rather than each owning a copy of the pattern, which is
 * the second half of the rule the Tailwind-rate census in CLAUDE.md records: a
 * canonical list needs a guard that it is complete AND a guard that there is
 * only one of it. Two regexes drifting apart here would put a scale on one
 * reading and not the other, and nothing would be missing from either.
 */
function scanScales<T extends { str: string }>(
  items: readonly T[],
  emit: (name: string, feetPerInch: number, item: T) => void,
): void {
  // The quote class must carry the TRUE PRIME MARKS as well as the ASCII and
  // curly ones — `′` and `″`, which is what a CAD title block actually
  // letters a scale with. `standardScaleFromText` normalises them, but it never
  // sees a candidate this pattern did not find first, and a first version of
  // this omitted them: `1/4″ = 1′-0″` came back null.
  const QUOTES = "\"'’“”′″";
  const pattern = new RegExp(`[0-9][0-9/\\-\\s]*[${QUOTES}]?\\s*=\\s*[0-9][0-9\\s${QUOTES}-]*`, "g");
  for (const item of items) {
    // A PARAGRAPH IS NOT A CAPTION. One real sheet carries a disclaimer reading
    // "Do not scale dimensions from prints… not always drawn to scale" — which
    // this filter is not needed for, since it holds no `X = Y` figure. What it
    // IS needed for is the general note that does: "DETAILS ARE DRAWN AT
    // 1/2\" = 1'-0\" UNLESS NOTED OTHERWISE" is an ordinary sentence on an
    // ordinary sheet, and without this it becomes a second printed scale and
    // turns a checkable page into `MANY_PRINTED`.
    if (item.str.length > 60) continue;
    for (const candidate of item.str.match(pattern) ?? []) {
      const match = standardScaleFromText(candidate.trim());
      if (match !== null) emit(match.name, match.feetPerInch, item);
    }
  }
}

export function printedScalesOnPage(items: readonly { str: string }[]): string[] {
  const found: string[] = [];
  scanScales(items, (name) => {
    if (!found.includes(name)) found.push(name);
  });
  return found;
}

/**
 * EVERY scale caption with its position — occurrences, not distinct names, so
 * the same scale captioned under two drawings yields two entries. That is the
 * point: each drawing needs its own, and collapsing them would leave one view
 * without a caption to be nearest to.
 */
export function printedScalesAt(
  items: readonly { str: string; x: number; y: number }[],
): PrintedScaleAt[] {
  const found: PrintedScaleAt[] = [];
  scanScales(items, (name, feetPerInch, item) => {
    found.push({ name, feetPerInch, x: item.x, y: item.y });
  });
  return found;
}
