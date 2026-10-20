import type { PlanTextItem } from "@/lib/plan-ingest/planPdf";

/**
 * A PDF PAGE'S POSITIONED TEXT ITEMS, TURNED INTO THE LINES A PERSON READS.
 *
 * pdf.js hands back fragments with coordinates (`openPlanPdf().pageText`, which
 * plan ingestion owns and this module only imports). A contract is prose, and a
 * quote taken from it has to be found again in what this function returns — so
 * the job here is to rebuild reading order faithfully enough that a sentence the
 * model copies is a sentence this text contains.
 *
 * Three things it has to get right, each one a way a correct quote would
 * otherwise fail the citation check and be DROPPED (which is safe — nothing
 * wrong is shown — but hides a clause):
 *
 *   1. Fragments on one baseline are one line, in x order. pdf.js splits a line
 *      wherever the font or kerning changes, so a word can arrive in pieces;
 *      a gap narrower than a space is joined with no space.
 *   2. TWO-COLUMN LAYOUTS. Many subcontract forms set general conditions in two
 *      columns. Joining by baseline alone interleaves them — left line 1, right
 *      line 1, left line 2 — and every sentence is broken. A gutter is detected
 *      when most lines split at a wide gap near the same x, and the page is then
 *      read left column top-to-bottom, then right.
 *   3. Nothing is normalised here beyond whitespace. Typographic quotes, dashes
 *      and case are `quoteMatch.ts`'s job, on both sides of the comparison, so
 *      the stored text stays the document's own.
 */

/** A baseline within this fraction of the item's height counts as the same line. */
const SAME_LINE_FRACTION = 0.5;
/** A horizontal gap wider than this many points splits a line into segments. */
const SEGMENT_GAP_PT = 24;
/** Fraction of multi-segment lines that must share a gutter to call it columns. */
const COLUMN_LINE_SHARE = 0.4;
/** How far apart gutter positions may be and still be the same gutter. */
const GUTTER_TOLERANCE_PT = 30;

type Segment = { x: number; y: number; text: string };

/** The lines of one page, in reading order. Empty array for a page with no text. */
export function linesFromItems(items: readonly PlanTextItem[]): string[] {
  const usable = items.filter((item) => item.str.trim() !== "");
  if (usable.length === 0) return [];

  // Group by baseline. The viewport transform makes y grow DOWN the page.
  const sorted = [...usable].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: PlanTextItem[][] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    const tolerance = Math.max(2, (item.height || 10) * SAME_LINE_FRACTION);
    if (row && Math.abs(row[0]!.y - item.y) <= tolerance) row.push(item);
    else rows.push([item]);
  }

  // Each row into segments split at wide gaps.
  const rowSegments: Segment[][] = rows.map((row) => {
    const ordered = [...row].sort((a, b) => a.x - b.x);
    const segments: Segment[] = [];
    let current: { x: number; y: number; parts: string[]; end: number } | null = null;
    for (const item of ordered) {
      const charWidth = item.str.length > 0 ? item.width / item.str.length : 0;
      if (current && item.x - current.end <= SEGMENT_GAP_PT) {
        const gap = item.x - current.end;
        const needsSpace = gap > Math.max(0.5, charWidth * 0.25);
        const last = current.parts[current.parts.length - 1] ?? "";
        current.parts.push(needsSpace && !last.endsWith(" ") && !item.str.startsWith(" ") ? ` ${item.str}` : item.str);
        current.end = Math.max(current.end, item.x + item.width);
      } else {
        if (current) segments.push({ x: current.x, y: current.y, text: current.parts.join("") });
        current = { x: item.x, y: item.y, parts: [item.str], end: item.x + item.width };
      }
    }
    if (current) segments.push({ x: current.x, y: current.y, text: current.parts.join("") });
    return segments.map((segment) => ({ ...segment, text: segment.text.replace(/\s+/g, " ").trim() }));
  });

  const gutter = detectGutter(rowSegments);
  if (gutter === null) {
    return rowSegments.map((segments) => segments.map((s) => s.text).join("  ")).filter((line) => line !== "");
  }

  const left: string[] = [];
  const right: string[] = [];
  for (const segments of rowSegments) {
    const l = segments.filter((s) => s.x < gutter).map((s) => s.text).join("  ");
    const r = segments.filter((s) => s.x >= gutter).map((s) => s.text).join("  ");
    if (l) left.push(l);
    if (r) right.push(r);
  }
  return [...left, ...right];
}

/** The x a two-column page's right column starts at, or null for one column. */
export function detectGutter(rowSegments: readonly (readonly Segment[])[]): number | null {
  const splits = rowSegments.filter((segments) => segments.length === 2).map((segments) => segments[1]!.x);
  const multiLine = rowSegments.filter((segments) => segments.length >= 1).length;
  if (multiLine === 0 || splits.length / multiLine < COLUMN_LINE_SHARE || splits.length < 4) return null;
  const sortedSplits = [...splits].sort((a, b) => a - b);
  const median = sortedSplits[Math.floor(sortedSplits.length / 2)]!;
  const near = splits.filter((x) => Math.abs(x - median) <= GUTTER_TOLERANCE_PT);
  if (near.length / multiLine < COLUMN_LINE_SHARE) return null;
  return Math.min(...near) - 1;
}

/** Fewer letters and digits than this and a page is treated as unread — a
 *  scanned page often carries a stamped page number and nothing else, and
 *  "Page 4" is not a page anybody has read. */
export const MIN_READABLE_CHARACTERS = 20;

export function pageIsReadable(lines: readonly string[]): boolean {
  return lines.join("").replace(/[^A-Za-z0-9]/g, "").length >= MIN_READABLE_CHARACTERS;
}

/** Per page: its lines, or null when it has no readable text layer. */
export type PageTexts = (string[] | null)[];

/** Read every page of a PDF. pdf.js is loaded lazily inside `openPlanPdf`. */
export async function extractPdfPages(bytes: Buffer): Promise<PageTexts> {
  const { openPlanPdf } = await import("@/lib/plan-ingest/planPdf");
  const pdf = await openPlanPdf(bytes);
  try {
    const pages: PageTexts = [];
    for (let n = 1; n <= pdf.pageCount; n++) {
      const text = await pdf.pageText(n);
      const lines = linesFromItems(text.items);
      pages.push(pageIsReadable(lines) ? lines : null);
    }
    return pages;
  } finally {
    await pdf.close();
  }
}

/** 1-based numbers of the pages with no readable text. */
export function unreadPageNumbers(pages: PageTexts): number[] {
  return pages.flatMap((lines, index) => (lines === null ? [index + 1] : []));
}

/** Narrow the stored `pageText` JSON back into `PageTexts`. */
export function pageTextsFromJson(value: unknown): PageTexts {
  if (!Array.isArray(value)) return [];
  return value.map((page) =>
    Array.isArray(page) ? page.filter((line): line is string => typeof line === "string") : null,
  );
}

/** "3–5, 9" — for "pages 3–5 and 9 couldn't be read". */
export function describePageRuns(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const runs: string[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const page of sorted) {
    if (start !== null && prev !== null && page === prev + 1) {
      prev = page;
      continue;
    }
    if (start !== null && prev !== null) runs.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = page;
    prev = page;
  }
  if (start !== null && prev !== null) runs.push(start === prev ? `${start}` : `${start}–${prev}`);
  return runs.join(", ");
}
