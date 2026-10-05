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
