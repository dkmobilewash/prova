import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JOB_SUMMARY_GRID, jobSummaryTileCount } from "@/components/jobSummaryGrid";

/**
 * No tile in the job header sits alone beside blank cells, at any width.
 *
 * The grid was `grid-cols-2 sm:grid-cols-4` for everyone, and an owner has
 * five tiles, so "Dates" had a row to itself on every job. This reads the
 * ACTUAL class strings, works out the column count and the last tile's span
 * at each Tailwind breakpoint the way the browser would, and requires every
 * row to be full. happy-dom does no layout, so the arithmetic is the check.
 */

const BREAKPOINTS = ["base", "sm", "md", "lg", "xl", "2xl"] as const;
type Breakpoint = (typeof BREAKPOINTS)[number];
const ORDER: Record<Breakpoint, number> = { base: 0, sm: 1, md: 2, lg: 3, xl: 4, "2xl": 5 };

/** Columns at a breakpoint: the widest `grid-cols-N` whose prefix applies. */
function columnsAt(classes: string[], at: Breakpoint): number {
  let cols = 1;
  let best = -1;
  for (const cls of classes) {
    const m = cls.match(/^(?:(sm|md|lg|xl|2xl):)?grid-cols-(\d+)$/);
    if (!m) continue;
    const bp = (m[1] ?? "base") as Breakpoint;
    if (ORDER[bp] <= ORDER[at] && ORDER[bp] > best) {
      best = ORDER[bp];
      cols = Number(m[2]);
    }
  }
  return cols;
}

/** The last tile's span: `max-<bp>:[&>:last-child]:col-span-N` applies below <bp>. */
function lastSpanAt(classes: string[], at: Breakpoint): number {
  for (const cls of classes) {
    const m = cls.match(/^max-(sm|md|lg|xl|2xl):\[&>:last-child\]:col-span-(\d+)$/);
    if (m && ORDER[at] < ORDER[m[1] as Breakpoint]) return Number(m[2]);
  }
  return 1;
}

describe("job header grid", () => {
  it("has a layout for every tile count a viewer can get", () => {
    const counts = new Set<number>();
    for (const money of [false, true]) for (const billing of [false, true]) counts.add(jobSummaryTileCount(money, billing));
    expect([...counts].sort()).toEqual([2, 3, 4, 5]);
    expect(Object.keys(JOB_SUMMARY_GRID).map(Number).sort()).toEqual([2, 3, 4, 5]);
  });

  for (const [count, classString] of Object.entries(JOB_SUMMARY_GRID)) {
    const tiles = Number(count);
    const classes = classString.split(/\s+/);

    it(`${tiles} tiles: the parse found a column count (not a vacuous pass)`, () => {
      expect(classes.some((cls) => /^grid-cols-\d+$/.test(cls))).toBe(true);
    });

    for (const at of BREAKPOINTS) {
      it(`${tiles} tiles fill every row at ${at}`, () => {
        const cols = columnsAt(classes, at);
        const span = Math.min(lastSpanAt(classes, at), cols);
        const cells = tiles - 1 + span;
        expect(cells % cols, `${tiles} tiles in ${cols} columns (last spans ${span}) leave a hole`).toBe(0);
      });
    }
  }

  it("reaches the header — the grid is what JobSummaryHeader renders", () => {
    const source = readFileSync(fileURLToPath(new URL("./JobSummaryHeader.tsx", import.meta.url)), "utf8");
    expect(source).toMatch(/JOB_SUMMARY_GRID\[jobSummaryTileCount\(showsJobMoney, showsBilling\)\]/);
    expect(source).not.toMatch(/sm:grid-cols-4/);
  });

  it("the owner's five sit in one row from lg up", () => {
    const classes = JOB_SUMMARY_GRID[5].split(/\s+/);
    expect(columnsAt(classes, "lg")).toBe(5);
    expect(lastSpanAt(classes, "lg")).toBe(1);
  });
});
