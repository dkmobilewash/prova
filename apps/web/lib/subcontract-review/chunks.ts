import type { PageTexts } from "./pageText";

/**
 * WHICH PAGES GO TO THE MODEL TOGETHER.
 *
 * A chunk is consecutive READABLE pages, small enough that one call finishes
 * inside the 60-second function limit (`SubcontractReview` advances one chunk
 * per request, driven by the open page — plan ingestion's shape) and large
 * enough that a clause is usually read with its neighbours.
 *
 * Consecutive chunks OVERLAP BY ONE PAGE, because a clause that starts at the
 * foot of page 8 and ends on page 9 must be wholly inside some chunk to be
 * quotable at all. The overlap means such a clause can be found twice; the
 * finding key (category + quote) collapses the duplicate.
 *
 * Unread pages are never in a chunk — nothing is sent for them and nothing is
 * charged for them. A chunk may straddle one (pages 4, 6, 7 with 5 scanned);
 * the page markers carry the real numbers either way.
 */

export const CHUNK_MAX_PAGES = 8;
/** Roughly 8k tokens of contract prose — the size the 60-second budget was set against. */
export const CHUNK_MAX_CHARACTERS = 30_000;
export const CHUNK_OVERLAP_PAGES = 1;

/** 1-based page numbers, in order. */
export type ChunkPlan = number[][];

export function planChunks(
  pages: PageTexts,
  limits: { maxPages?: number; maxCharacters?: number; overlap?: number } = {},
): ChunkPlan {
  const maxPages = limits.maxPages ?? CHUNK_MAX_PAGES;
  const maxCharacters = limits.maxCharacters ?? CHUNK_MAX_CHARACTERS;
  const overlap = limits.overlap ?? CHUNK_OVERLAP_PAGES;
  if (maxPages < 1 || overlap < 0 || overlap >= maxPages) throw new Error("planChunks: impossible limits");

  const readable = pages.flatMap((lines, index) =>
    lines === null ? [] : [{ page: index + 1, size: lines.join("\n").length }],
  );
  const chunks: ChunkPlan = [];
  let start = 0;
  while (start < readable.length) {
    let end = start;
    let size = readable[start]!.size;
    // Always take at least one page, however long; then grow while both limits hold.
    while (
      end + 1 < readable.length &&
      end + 1 - start + 1 <= maxPages &&
      size + readable[end + 1]!.size <= maxCharacters
    ) {
      end++;
      size += readable[end]!.size;
    }
    chunks.push(readable.slice(start, end + 1).map((entry) => entry.page));
    if (end + 1 >= readable.length) break;
    // Step forward, keeping `overlap` pages — but always move at least one page.
    start = Math.max(start + 1, end + 1 - overlap);
  }
  return chunks;
}

/** Pages a plan charges: each readable page ONCE, even though overlapped pages
 *  are sent twice. A contractor is billed for pages read, not for our overlap. */
export function chargeablePages(plan: ChunkPlan): number {
  return new Set(plan.flat()).size;
}

/** Pages the chunk at `index` charges: the ones no earlier chunk already had. */
export function newPagesInChunk(plan: ChunkPlan, index: number): number {
  const seen = new Set(plan.slice(0, index).flat());
  return (plan[index] ?? []).filter((page) => !seen.has(page)).length;
}
