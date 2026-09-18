import { describe, expect, it } from "vitest";
import { firstRowBy, groupRowsBy, rowsFor } from "./group-rows";

/**
 * The flattened loaders (alerts-query, company-financials-query) rebuild a
 * nested read's shape from flat child rows. What they rely on here: rows
 * stay in the order the query returned them, a parent with no children
 * gets [] rather than undefined, and "newest per parent" keeps the FIRST
 * row of an already newest-first list — which is how Prisma resolved the
 * nested `orderBy …, take: 1` they replaced.
 */
describe("groupRowsBy / rowsFor", () => {
  const rows = [
    { jobId: "b", n: 1 },
    { jobId: "a", n: 2 },
    { jobId: "b", n: 3 },
    { jobId: null, n: 4 },
  ];

  it("keeps each group in the order the rows arrived", () => {
    const groups = groupRowsBy(rows, (row) => row.jobId);
    expect(rowsFor(groups, "b").map((row) => row.n)).toEqual([1, 3]);
    expect(rowsFor(groups, "a").map((row) => row.n)).toEqual([2]);
  });

  it("answers [] for a parent with no rows, as a nested relation does", () => {
    expect(rowsFor(groupRowsBy(rows, (row) => row.jobId), "z")).toEqual([]);
  });

  it("does not file a null key under any parent", () => {
    const groups = groupRowsBy(rows, (row) => row.jobId);
    expect(rowsFor(groups, "a").some((row) => row.jobId === null)).toBe(false);
    expect(rowsFor(groups, null).map((row) => row.n)).toEqual([4]);
  });
});

describe("firstRowBy", () => {
  it("keeps the first row per key of an ordered list, not the last", () => {
    const newestFirst = [
      { jobId: "a", attempt: 3 },
      { jobId: "b", attempt: 1 },
      { jobId: "a", attempt: 2 },
      { jobId: "a", attempt: 1 },
    ];
    const latest = firstRowBy(newestFirst, (row) => row.jobId);
    expect(latest.get("a")?.attempt).toBe(3);
    expect(latest.get("b")?.attempt).toBe(1);
    expect(latest.has("c")).toBe(false);
  });
});
