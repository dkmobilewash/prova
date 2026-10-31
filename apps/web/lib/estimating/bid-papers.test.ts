import { describe, expect, it } from "vitest";
import {
  acknowledgedOnFor,
  filedUnderLabel,
  paperFiling,
  paperWhere,
  paperWhereForJob,
  paperWhereMany,
  papersFor,
} from "./bid-papers";

/**
 * Which papers an invitation sees — the pure half. The rows-and-transactions half
 * (merge, split, delete, the backfill, company scoping) is `bid-papers.dbtest.ts`.
 */

const A = { id: "inv_a", bidProjectId: "proj_1" };
const B = { id: "inv_b", bidProjectId: "proj_1" };
const C = { id: "inv_c", bidProjectId: "proj_2" };
const LEGACY = { id: "inv_old", bidProjectId: null };

describe("paperWhere", () => {
  it("reads by project, and falls back to the filing invitation only for a paper with no project", () => {
    expect(paperWhere(A)).toEqual({
      OR: [{ bidProjectId: { in: ["proj_1"] } }, { bidProjectId: null, bidInvitationId: { in: ["inv_a"] } }],
    });
  });

  it("an invitation with no project of its own reads only what is filed under it", () => {
    expect(paperWhere(LEGACY)).toEqual({ OR: [{ bidProjectId: null, bidInvitationId: { in: ["inv_old"] } }] });
  });

  it("a page of bids is ONE where, with each project once", () => {
    const where = paperWhereMany([A, B, C, LEGACY]);
    expect(where.OR[0]).toEqual({ bidProjectId: { in: ["proj_1", "proj_2"] } });
    expect(where.OR[1]).toEqual({ bidProjectId: null, bidInvitationId: { in: ["inv_a", "inv_b", "inv_c", "inv_old"] } });
  });
});

describe("papersFor", () => {
  const rows = [
    { id: "q1", bidInvitationId: "inv_a", bidProjectId: "proj_1" },
    { id: "q2", bidInvitationId: "inv_b", bidProjectId: "proj_1" },
    { id: "q3", bidInvitationId: "inv_c", bidProjectId: "proj_2" },
    { id: "old1", bidInvitationId: "inv_old", bidProjectId: null },
    { id: "old2", bidInvitationId: "inv_a", bidProjectId: null },
  ];

  it("every GC on a project sees every paper on it, filed under whichever GC", () => {
    expect(papersFor(A, rows).map((r) => r.id)).toEqual(["q1", "q2", "old2"]);
    expect(papersFor(B, rows).map((r) => r.id)).toEqual(["q1", "q2"]);
  });

  it("a different project sees none of them", () => {
    expect(papersFor(C, rows).map((r) => r.id)).toEqual(["q3"]);
  });

  it("a paper with no project is shown only on the invitation it was filed under", () => {
    expect(papersFor(LEGACY, rows).map((r) => r.id)).toEqual(["old1"]);
    expect(papersFor(B, rows).map((r) => r.id)).not.toContain("old2");
  });
});

describe("paperFiling", () => {
  it("a new paper is filed under the invitation and owned by its project", () => {
    expect(paperFiling(A)).toEqual({ bidInvitationId: "inv_a", bidProjectId: "proj_1" });
    expect(paperFiling(LEGACY)).toEqual({ bidInvitationId: "inv_old", bidProjectId: null });
  });
});

describe("paperWhereForJob", () => {
  it("finds a job's papers through its project OR the invitation linked to it, inside one company", () => {
    expect(paperWhereForJob("job_1", "co_1")).toEqual({
      bidInvitation: { companyId: "co_1" },
      OR: [{ bidProject: { estimateJobId: "job_1" } }, { bidInvitation: { wonJobId: "job_1" } }],
    });
  });
});

describe("acknowledgedOnFor", () => {
  const day = (s: string) => new Date(`${s}T00:00:00Z`);
  const addendum = {
    bidInvitationId: "inv_a",
    acknowledgedOn: day("2026-10-01"),
    acknowledgements: [{ bidInvitationId: "inv_b", acknowledgedOn: day("2026-10-05") }],
  };

  it("the filing invitation's acknowledgement is the addendum's own column", () => {
    expect(acknowledgedOnFor(addendum, "inv_a")).toEqual(day("2026-10-01"));
  });

  it("another GC's is its own row, never the column", () => {
    expect(acknowledgedOnFor(addendum, "inv_b")).toEqual(day("2026-10-05"));
  });

  it("a GC with no row has NOT acknowledged — the column of a different GC does not count", () => {
    expect(acknowledgedOnFor(addendum, "inv_c")).toBeNull();
    expect(acknowledgedOnFor({ ...addendum, acknowledgements: [] }, "inv_b")).toBeNull();
  });

  it("an unacknowledged addendum is null for the filing GC too", () => {
    expect(acknowledgedOnFor({ ...addendum, acknowledgedOn: null }, "inv_a")).toBeNull();
  });
});

describe("filedUnderLabel", () => {
  const names = new Map([
    ["inv_a", "Acme"],
    ["inv_b", "BuildCo"],
  ]);

  it("says nothing for a paper filed under this very invitation", () => {
    expect(filedUnderLabel({ bidInvitationId: "inv_a" }, "inv_a", names)).toBeNull();
  });

  it("names the other GC", () => {
    expect(filedUnderLabel({ bidInvitationId: "inv_b" }, "inv_a", names)).toBe("BuildCo");
  });

  it("says nothing rather than guess when the GC is not known", () => {
    expect(filedUnderLabel({ bidInvitationId: "inv_zzz" }, "inv_a", names)).toBeNull();
  });
});
