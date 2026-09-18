/**
 * The gallery's tick boxes: what stays picked while a person works, and
 * what a bulk action is allowed to act on.
 *
 * EVERY ASSERTION CHECKS THE SIZE OF THE SET, not only its members, and
 * that is the rule this repo learned the hard way rather than a style.
 * `scratch-cleanup-order.test.ts` passed thirteen assertions while parsing
 * 180 of 181 foreign keys, because nothing is ever missing from a set that
 * shrank quietly. Here the same shape would be a bulk action that carried
 * four captures out of five: `toContain` would be satisfied by all five of
 * its members and would never notice the one that went. So each test says
 * how many, and then which.
 */
import { describe, expect, it } from "vitest";
import {
  bulkReportTarget,
  pruneSelected,
  selectEveryVisible,
  toggleSelected,
  type SelectableCapture,
} from "@/components/jobMediaSelection";

/** A gallery of five captures on one job, in the order the page renders
 *  them (newest first, which is what both galleries read). */
const oneJob: SelectableCapture[] = [
  { id: "a", jobId: "job-1" },
  { id: "b", jobId: "job-1" },
  { id: "c", jobId: "job-1" },
  { id: "d", jobId: "job-1" },
  { id: "e", jobId: "job-1" },
];

/** What `/photos` looks like with no job chip lit. */
const manyJobs: SelectableCapture[] = [
  { id: "a", jobId: "job-1" },
  { id: "b", jobId: "job-2" },
  { id: "c", jobId: "job-1" },
];

describe("toggleSelected", () => {
  it("adds a capture that was not picked, and touches nothing else", () => {
    const after = toggleSelected(["a", "c"], "e");
    expect(after).toHaveLength(3);
    expect(after).toEqual(["a", "c", "e"]);
  });

  it("removes one that was, and leaves the rest of the selection alone", () => {
    const after = toggleSelected(["a", "c", "e"], "c");
    expect(after).toHaveLength(2);
    expect(after).toEqual(["a", "e"]);
  });

  it("does not mutate the selection it was handed", () => {
    const before = ["a", "b"];
    toggleSelected(before, "c");
    expect(before).toHaveLength(2);
    expect(before).toEqual(["a", "b"]);
  });

  it("survives being toggled back and forth, which is what a person does", () => {
    let picked: string[] = [];
    for (const id of ["b", "d", "b", "d", "b"]) picked = toggleSelected(picked, id);
    // b on, d on, b off, d off, b on.
    expect(picked).toHaveLength(1);
    expect(picked).toEqual(["b"]);
  });
});

describe("pruneSelected", () => {
  it("keeps every pick that is still on the page", () => {
    const pruned = pruneSelected(["a", "d"], oneJob);
    expect(pruned).toHaveLength(2);
    expect(pruned).toEqual(["a", "d"]);
  });

  it("drops exactly the capture that left, and nothing else with it", () => {
    // What a delete, a filter chip or the 60-capture cap does to a page.
    const remaining = oneJob.filter((item) => item.id !== "c");
    const pruned = pruneSelected(["a", "c", "e"], remaining);
    expect(pruned).toHaveLength(2);
    expect(pruned).toEqual(["a", "e"]);
  });

  it("returns the page's order, not the order things were ticked in", () => {
    const pruned = pruneSelected(["e", "a", "c"], oneJob);
    expect(pruned).toHaveLength(3);
    expect(pruned).toEqual(["a", "c", "e"]);
  });

  it("collapses a duplicate rather than counting it twice", () => {
    const pruned = pruneSelected(["b", "b"], oneJob);
    expect(pruned).toHaveLength(1);
    expect(pruned).toEqual(["b"]);
  });

  it("empties a selection whose whole page has gone", () => {
    expect(pruneSelected(["a", "b"], [])).toHaveLength(0);
  });

  it("survives a re-render that changed nothing", () => {
    // Every share, caption edit and router.refresh hands the gallery a
    // fresh array of freshly built objects. Ids are what carries across.
    const reRendered = oneJob.map((item) => ({ ...item }));
    const pruned = pruneSelected(["a", "c"], reRendered);
    expect(pruned).toHaveLength(2);
    expect(pruned).toEqual(["a", "c"]);
  });
});

describe("selectEveryVisible", () => {
  it("picks everything on the page and nothing beyond it", () => {
    const all = selectEveryVisible(oneJob);
    expect(all).toHaveLength(oneJob.length);
    expect(all).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("gives an empty selection for an empty page", () => {
    expect(selectEveryVisible([])).toHaveLength(0);
  });

  it("is one untick away from all-but-one", () => {
    const after = toggleSelected(selectEveryVisible(oneJob), "c");
    expect(after).toHaveLength(oneJob.length - 1);
    expect(after).not.toContain("c");
  });
});

describe("bulkReportTarget", () => {
  it("has nothing to act on when nothing is picked", () => {
    expect(bulkReportTarget([], oneJob)).toEqual({ kind: "none" });
  });

  it("carries EXACTLY the picked captures, and no others from the page", () => {
    const target = bulkReportTarget(["b", "d"], oneJob);
    expect(target.kind).toBe("one-job");
    if (target.kind !== "one-job") throw new Error("expected one job");
    // The size first: a report built from three captures when two were
    // ticked is the failure this whole module exists to make impossible,
    // and a members-only assertion cannot see it.
    expect(target.ids).toHaveLength(2);
    expect(target.ids).toEqual(["b", "d"]);
    expect(target.jobId).toBe("job-1");
  });

  it("never carries a capture that has left the page", () => {
    const remaining = oneJob.filter((item) => item.id !== "d");
    const target = bulkReportTarget(["b", "d"], remaining);
    expect(target.kind).toBe("one-job");
    if (target.kind !== "one-job") throw new Error("expected one job");
    expect(target.ids).toHaveLength(1);
    expect(target.ids).toEqual(["b"]);
  });

  it("carries a capture the page has but nobody ticked no further than the page", () => {
    const target = bulkReportTarget(["a"], oneJob);
    if (target.kind !== "one-job") throw new Error("expected one job");
    expect(target.ids).toHaveLength(1);
    expect(target.ids).toEqual(["a"]);
  });

  it("refuses to name one job when the picks span two", () => {
    const target = bulkReportTarget(["a", "b"], manyJobs);
    expect(target.kind).toBe("many-jobs");
    if (target.kind !== "many-jobs") throw new Error("expected many jobs");
    expect(target.jobIds).toHaveLength(2);
    expect(target.jobIds).toEqual(["job-1", "job-2"]);
    // The count is still carried, because the bar says how many are in the
    // way of the report as well as how many jobs.
    expect(target.ids).toHaveLength(2);
  });

  it("is one job again once the odd one out is unticked", () => {
    const target = bulkReportTarget(toggleSelected(["a", "b", "c"], "b"), manyJobs);
    expect(target.kind).toBe("one-job");
    if (target.kind !== "one-job") throw new Error("expected one job");
    expect(target.ids).toHaveLength(2);
    expect(target.ids).toEqual(["a", "c"]);
    expect(target.jobId).toBe("job-1");
  });

  it("counts a job once however many of its captures are picked", () => {
    const target = bulkReportTarget(["a", "c"], manyJobs);
    expect(target.kind).toBe("one-job");
    if (target.kind !== "one-job") throw new Error("expected one job");
    expect(target.ids).toHaveLength(2);
  });

  it("ignores an id that is on no page at all rather than passing it on", () => {
    // A stale render, or a selection carried across a filter change. The
    // link this feeds puts ids in a URL; an id nothing on screen matches
    // must never reach it.
    const target = bulkReportTarget(["a", "ghost"], oneJob);
    expect(target.kind).toBe("one-job");
    if (target.kind !== "one-job") throw new Error("expected one job");
    expect(target.ids).toHaveLength(1);
    expect(target.ids).toEqual(["a"]);
  });

  it("is none, not one-job, when every pick has gone", () => {
    expect(bulkReportTarget(["ghost"], oneJob)).toEqual({ kind: "none" });
  });
});
