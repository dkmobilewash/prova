/**
 * The job header's tile grid, chosen by how many tiles this viewer gets.
 *
 * It was `grid-cols-2 sm:grid-cols-4` for everyone. An owner has FIVE tiles
 * (contract value, billed, retainage, crew, dates), so on every job "Dates"
 * sat alone on a second row beside three blank cells — the header looked
 * broken on the first screen of every job. The tiles have no borders, so a
 * lone tile is not rescued by stretching it: its text stays at the left and
 * the hole stays beside it. The only fix is a column count that divides the
 * tiles, or a last tile that spans what is left of its row.
 *
 * Whole literals, because Tailwind reads class names out of source text and
 * an interpolated one is not in the stylesheet. The last tile (always
 * "Dates", the longest text) is the one that spans, via an arbitrary
 * variant on the grid itself, so the header's tile markup is untouched.
 *
 * `jobSummaryGrid.test.ts` parses these strings and checks, at every
 * breakpoint, that each row is full.
 */
export const JOB_SUMMARY_GRID: Record<2 | 3 | 4 | 5, string> = {
  // Crew, Dates — a field role.
  2: "grid grid-cols-2 gap-3 text-sm",
  // Contract value, Crew, Dates. Two on a phone, Dates across the row.
  3: "grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 max-sm:[&>:last-child]:col-span-2",
  // Billed, Retainage, Crew, Dates.
  4: "grid grid-cols-2 gap-3 text-sm sm:grid-cols-4",
  // The owner's five. Phone: 2+2, Dates across. Tablet and a laptop with the
  // rail open: 3, then Crew beside a two-wide Dates. From `lg` up: one row.
  5: "grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5 max-lg:[&>:last-child]:col-span-2",
};

export function jobSummaryTileCount(showsJobMoney: boolean, showsBilling: boolean): 2 | 3 | 4 | 5 {
  return (2 + (showsJobMoney ? 1 : 0) + (showsBilling ? 2 : 0)) as 2 | 3 | 4 | 5;
}
