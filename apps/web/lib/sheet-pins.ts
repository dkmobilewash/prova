import { pointInSheet } from "@/lib/sheet-geometry";

/**
 * WHAT MAY BE PUT ON A SHEET, AND WHAT MUST BE REFUSED.
 *
 * Pure. No database, no React, no pdfjs — the whole point is that every rule
 * below can be checked on a laptop with no drawing in front of you, which is
 * the same bargain `takeoff-plan.ts` makes and for the same reason.
 *
 * Coordinates are in the page-width box: `x` 0..1, `y` 0..H/W, BOTH divided by
 * the width. `lib/sheet-geometry.ts` explains why, and why a photo annotation
 * uses a different one on purpose.
 *
 * THE REFUSALS ARE THE CONTENT. A pin that lands off the page, a cloud that
 * crosses itself, an arrow with one end — each of those renders as something
 * plausible and wrong, and a plausible wrong mark on a drawing is how a crew
 * frames the wrong wall. Every function here returns a SENTENCE a foreman can
 * act on rather than a boolean, because the caller is a Server Action whose
 * thrown messages production redacts to a digest.
 */

export type SheetPinKind = "PHOTO" | "PUNCH" | "NOTE";


/** The longest a note or a text markup may be. Long enough for a real
 * instruction, short enough that it cannot become a document nobody reads on a
 * phone in the sun. */
export const MAX_NOTE_LENGTH = 280;

/**
 * Is this point on the page at all?
 *
 * `pointInSheet` bounds `y` at 2 because it does not know the sheet. Here we
 * DO: `heightPt/widthPt` is the page's own aspect, so the real ceiling is that
 * — and a pin at y = 1.1 on a landscape sheet is off the bottom even though the
 * generic bound would allow it.
 */
export function pinPlacementProblem(
  x: number,
  y: number,
  page: { widthPt: number; heightPt: number },
): string | null {
  if (!pointInSheet(x, y)) return "That mark is off the sheet. Tap on the drawing itself.";
  if (!(page.widthPt > 0) || !(page.heightPt > 0)) {
    return "This page has no size recorded yet, so a mark cannot be placed on it.";
  }
  const maxY = page.heightPt / page.widthPt;
  // A hair of tolerance: a tap on the very bottom edge rounds past the bound and
  // refusing it would read as the app ignoring a deliberate tap.
  if (y > maxY + 1e-6) return "That mark is below the bottom of the sheet.";
  return null;
}

/** What a pin of this kind must carry, and must not. */
export function pinContentProblem(
  kind: SheetPinKind,
  target: { mediaId?: string | null; punchItemId?: string | null; note?: string | null },
): string | null {
  const note = target.note?.trim() ?? "";
  if (kind === "PHOTO") {
    if (!target.mediaId) return "Pick the photo this pin points at.";
    return null;
  }
  if (kind === "PUNCH") {
    if (!target.punchItemId) return "Pick the punch item this pin points at.";
    return null;
  }
  // NOTE
  if (note.length === 0) return "A note pin needs something written on it.";
  if (note.length > MAX_NOTE_LENGTH) {
    return `That note is ${note.length} characters. Keep it under ${MAX_NOTE_LENGTH}.`;
  }
  return null;
}



/**
 * The one-line label for a pin, for a list that is not the drawing.
 *
 * A pin whose target was deleted says so rather than disappearing — the
 * SetNull on `mediaId`/`punchItemId` is deliberate (see `operations.prisma`),
 * and this is the sentence that makes it legible instead of looking like a bug.
 */
export function describePin(pin: {
  kind: SheetPinKind;
  note?: string | null;
  mediaId?: string | null;
  punchItemId?: string | null;
  punchItem?: { description: string } | null;
}): string {
  if (pin.kind === "NOTE") return pin.note?.trim() || "Note";
  if (pin.kind === "PUNCH") {
    if (pin.punchItem) return pin.punchItem.description;
    return pin.punchItemId ? "Punch item" : "Punch item (removed)";
  }
  return pin.mediaId ? "Photo" : "Photo (removed)";
}

/** The largest drawing set we will take. A full architectural set runs to tens
 * of megabytes; past this it is not an upload problem, it is somebody sending
 * the whole project.
 *
 * IT LIVES HERE RATHER THAN BESIDE THE ACTION THAT USES IT, and not by
 * preference: a `"use server"` file may export ONLY async functions, so a
 * `const` in `lib/actions/sheetPins.ts` fails the BUILD — and nothing before
 * the build sees it. Typecheck and 8,926 tests were green when this was in
 * the wrong file. Same family as the `export *` trap CLAUDE.md records for the
 * actions barrel. */
export const MAX_DRAWING_BYTES = 100_000_000;

/** One page of an uploaded drawing, as the browser measured it. */
export type SheetPageInput = { pageNumber: number; widthPt: number; heightPt: number };

/**
 * The page list the browser read out of the PDF it is uploading, as JSON.
 *
 * **IT REFUSES THE WHOLE LIST RATHER THAN SKIPPING A BAD ENTRY**, and that is
 * the decision worth stating: a skipped page becomes a sheet that silently
 * does not exist, or worse a `SheetPage` with no size — and a pin needs
 * `widthPt`/`heightPt` to mean anything at all, because `y` is a fraction of
 * the WIDTH. A drawing that half-uploaded is harder to notice than one that
 * refused.
 *
 * Returns null rather than throwing: the caller is a Server Action, and
 * production redacts a thrown message to a digest.
 */
export function parseSheetPages(raw: unknown): SheetPageInput[] | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const pages: SheetPageInput[] = [];
  const seen = new Set<number>();
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) return null;
    const { pageNumber, widthPt, heightPt } = entry as Record<string, unknown>;
    if (typeof pageNumber !== "number" || !Number.isInteger(pageNumber) || pageNumber < 1) return null;
    if (typeof widthPt !== "number" || !Number.isFinite(widthPt) || widthPt <= 0) return null;
    if (typeof heightPt !== "number" || !Number.isFinite(heightPt) || heightPt <= 0) return null;
    // Two entries for one page would make `skipDuplicates` silently drop one,
    // which is the same half-upload wearing a success.
    if (seen.has(pageNumber)) return null;
    seen.add(pageNumber);
    pages.push({ pageNumber, widthPt, heightPt });
  }
  return pages;
}
