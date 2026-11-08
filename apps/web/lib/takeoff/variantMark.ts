/**
 * ── A PRINTED VARIANT MARK: "C6*" ──
 *
 * Hutto tags some partitions C6* and prints beside them "TYP AT TUB/SHOWER
 * LOCATIONS"; its legend says "AT *C, PROVIDE ADDITIONAL FR GYP BOARD ON
 * TUB/SHOWER SIDE". Diego's rule: for scoring, C6* is the same type as C6. For
 * pricing it is not quite, so the product keeps the mark and says what it means,
 * "C6 (C6* at tub/shower locations, see legend)", and the estimator prices the
 * extra board.
 *
 * The tag keeps the mark ("C6*"); everything that compares designations
 * (`sameDesignation`) already ignores punctuation, so the group still types and
 * prices as C6. The words travel separately, per sheet (`VARIANT_NOTES`).
 */
export const VARIANT_MARK = /^(.*[A-Z0-9])(\*+)$/i;

/** A word as a code and its trailing mark: "C6*" → C6 and "*"; "C6" → C6 and "". */
export function splitVariant(word: string): { code: string; mark: string } {
  const clean = word.trim();
  const m = VARIANT_MARK.exec(clean);
  return m === null ? { code: clean, mark: "" } : { code: m[1]!, mark: m[2]! };
}

/** The `TakeoffPlanTextRead` kind holding a sheet's notes: `{ "C6*": "at tub/shower locations" }`. */
export const VARIANT_NOTES = "variant-notes";

/** How far from a starred tag its note may be printed, in paper inches. */
const NOTE_REACH_IN = 1.5;
const MARKED_TAG = /^[A-Z]{1,3}-?\d{1,2}[A-Z]?\*+$/i;

type Text = { str: string; x: number; y: number; width: number; height: number };

/**
 * The words printed with each starred tag on a sheet, in points: the lines just
 * below or beside it, in reading order, "TYP" dropped. A starred tag with no
 * words near it is left out; its label then says "see legend" alone.
 */
export function variantNotes(text: readonly Text[]): Record<string, string> {
  const out: Record<string, string> = {};
  const reach = NOTE_REACH_IN * 72;
  for (const tag of text) {
    const name = tag.str.trim().toUpperCase();
    if (!MARKED_TAG.test(name) || out[name] !== undefined) continue;
    const words = text
      .filter((t) => t !== tag && /[A-Z]{2}/i.test(t.str) && !MARKED_TAG.test(t.str.trim()))
      // Beside (to the right) or below, never above or behind: a note follows its tag.
      .filter((t) => t.x >= tag.x - tag.width && t.y >= tag.y - tag.height && Math.hypot(t.x - (tag.x + tag.width), t.y - tag.y) <= reach)
      .sort((a, b) => (Math.abs(a.y - b.y) < Math.max(a.height, b.height) / 2 ? a.x - b.x : a.y - b.y))
      .map((t) => t.str.trim())
      .filter((s) => s !== "");
    const note = words.join(" ").replace(/\s+/g, " ").replace(/^TYP(ICAL)?\.?\s+/i, "").toLowerCase().trim();
    if (note !== "") out[name] = note.length > 60 ? `${note.slice(0, 57).trimEnd()}…` : note;
  }
  return out;
}

/**
 * The label for a type read off a marked tag: "C6 (C6* at tub/shower locations,
 * see legend)". Null for a tag with no mark, which shows as the code it is.
 */
export function variantLabel(code: string, tag: string, notes: Readonly<Record<string, string>> = {}): string | null {
  const { mark } = splitVariant(tag);
  if (mark === "") return null;
  const marked = tag.trim().toUpperCase();
  const note = notes[marked];
  return `${code} (${marked}${note ? ` ${note}` : ""}, see legend)`;
}
