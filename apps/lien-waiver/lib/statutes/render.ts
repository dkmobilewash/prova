import type { BlankStyle, BuiltForm, FormParagraph, ParagraphRole, SlotId } from "./types";

/**
 * Turning a form plus what a person typed into the text that is printed.
 *
 * THE ONE INVARIANT: take a rendered form, put each blank's original
 * characters back where the fill went, and you get the statute's form text
 * back exactly. `unfill` does that and the tests assert it for every form;
 * the PDF test asserts the same of the text pdf.js reads out of the file.
 * Nothing else in this file is allowed to change a character.
 */

/** A run of underscores; a dot leader. Three underscores and five dots are
 * the shortest runs any of the four statutes uses for a blank, and nothing
 * else in their form text comes close (an ellipsis is three dots). */
const BLANK_PATTERNS: Record<Exclude<BlankStyle, "label">, RegExp> = {
  underscore: /_{3,}/g,
  dots: /\.{5,}/g,
};

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "blank"; original: string; slot: SlotId; blankIndex: number; trailing: boolean };

export interface RenderedParagraph {
  index: number;
  role: ParagraphRole;
  segments: Segment[];
}

export type Fills = Partial<Record<SlotId, string>>;

/** Blanks in one paragraph, as [start, end) offsets. A `label` paragraph's
 * blank is the empty string at its end. */
export function blankRanges(text: string, style: BlankStyle, isLabel: boolean): Array<[number, number]> {
  if (style === "label") return isLabel ? [[text.length, text.length]] : [];
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(BLANK_PATTERNS[style])) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/** Split each paragraph into fixed text and blanks, numbering blanks in
 * document order against the form's slot list. */
export function segmentForm(form: Pick<BuiltForm, "paragraphs" | "blankStyle" | "slots"> & { labelIndices?: number[] }): RenderedParagraph[] {
  let blankIndex = 0;
  const labels = new Set(form.labelIndices ?? []);
  const out = form.paragraphs.map((paragraph: FormParagraph & { label?: boolean }) => {
    const isLabel = paragraph.label === true || labels.has(paragraph.index);
    const ranges = blankRanges(paragraph.text, form.blankStyle, isLabel);
    const segments: Segment[] = [];
    let cursor = 0;
    for (const [start, end] of ranges) {
      if (start > cursor) segments.push({ kind: "text", text: paragraph.text.slice(cursor, start) });
      const ref = form.slots[blankIndex];
      if (!ref) throw new Error(`blank ${blankIndex} in paragraph ${paragraph.index} has no slot`);
      segments.push({
        kind: "blank",
        original: paragraph.text.slice(start, end),
        slot: ref.slot,
        blankIndex,
        trailing: start === paragraph.text.length,
      });
      blankIndex += 1;
      cursor = end;
    }
    if (cursor < paragraph.text.length) segments.push({ kind: "text", text: paragraph.text.slice(cursor) });
    return { index: paragraph.index, role: paragraph.role, segments };
  });
  if (blankIndex !== form.slots.length) {
    throw new Error(`form has ${blankIndex} blanks and ${form.slots.length} slots`);
  }
  return out;
}

/** What one blank prints as. An empty fill prints the statute's own blank,
 * so the form can still be completed by hand.
 *
 * A fill that would otherwise touch the word before it gets one space in
 * front -- Nevada's "Property Name:" runs straight into its dot leader, and
 * California's labels end at the colon -- except straight after a "$". That
 * space is part of the FILL, which replaces the blank; it is not inserted
 * into the statute's text, and `unfill` puts the blank's own characters
 * back in its place. */
export function fillText(segment: Extract<Segment, { kind: "blank" }>, value: string | undefined, before: string): string {
  const trimmed = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!trimmed) return segment.original;
  if (before.length > 0 && !/[\s$]$/.test(before)) return ` ${trimmed}`;
  return trimmed;
}

export interface PrintedRun {
  text: string;
  /** True for what the person typed, so it can be set apart on the page. */
  filled: boolean;
  /** A blank left empty: printed as the statute's own blank. */
  emptyBlank: boolean;
}

export function printRuns(paragraph: RenderedParagraph, fills: Fills, fillable: (slot: SlotId) => boolean): PrintedRun[] {
  const runs: PrintedRun[] = [];
  let before = "";
  for (const segment of paragraph.segments) {
    if (segment.kind === "text") {
      runs.push({ text: segment.text, filled: false, emptyBlank: false });
      before = segment.text;
      continue;
    }
    const value = fillable(segment.slot) ? fills[segment.slot] : undefined;
    const text = fillText(segment, value, before);
    const empty = text === segment.original;
    if (empty && segment.trailing) {
      // A label with nothing after it: nothing to print.
      before = "";
      continue;
    }
    runs.push({ text, filled: !empty, emptyBlank: empty });
    before = text;
  }
  return runs;
}

export function printedText(paragraph: RenderedParagraph, fills: Fills, fillable: (slot: SlotId) => boolean): string {
  return printRuns(paragraph, fills, fillable)
    .map((run) => run.text)
    .join("");
}

/**
 * The inverse of printing: given the printed text of a paragraph and the
 * fills that went into it, put the statute's blanks back. Used only by the
 * tests -- it is the check that printing changed nothing but the blanks.
 */
export function unfill(paragraph: RenderedParagraph, printed: string, fills: Fills, fillable: (slot: SlotId) => boolean): string {
  let out = "";
  let rest = printed;
  let before = "";
  for (const segment of paragraph.segments) {
    if (segment.kind === "text") {
      if (!rest.startsWith(segment.text)) {
        throw new Error(`printed text diverges from the statute at "${rest.slice(0, 40)}" (expected "${segment.text.slice(0, 40)}")`);
      }
      out += segment.text;
      rest = rest.slice(segment.text.length);
      before = segment.text;
      continue;
    }
    const value = fillable(segment.slot) ? fills[segment.slot] : undefined;
    const text = fillText(segment, value, before);
    const empty = text === segment.original;
    const printedHere = empty && segment.trailing ? "" : text;
    if (!rest.startsWith(printedHere)) {
      throw new Error(`printed blank ${segment.blankIndex} reads "${rest.slice(0, 40)}", expected "${printedHere}"`);
    }
    rest = rest.slice(printedHere.length);
    out += segment.original;
    before = printedHere;
  }
  if (rest.length) throw new Error(`printed text has extra characters: "${rest.slice(0, 40)}"`);
  return out;
}
