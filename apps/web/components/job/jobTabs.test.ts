import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JOB_TAB_ROUTES, jobDocumentLinks, jobTabs } from "@/components/job/jobTabs";

const owner = { jobId: "job-1", status: "IN_PROGRESS", showsJobMoney: true, showsBilling: true, showsField: true };

/** The rail as `(tabs)/layout.tsx` built it at `b204ab9c~1` — copied, not
 * imported, so a change to `jobTabs` cannot change what it is checked against. */
function oldRail(i: typeof owner): string[] {
  const id = i.jobId;
  const isEstimate = i.status === "ESTIMATE";
  return [
    `/jobs/${id}`,
    ...(i.showsJobMoney ? [`/jobs/${id}/estimate`, `/jobs/${id}/takeoff`] : []),
    `/jobs/${id}/crew`,
    `/jobs/${id}/compliance`,
    ...(!isEstimate && i.showsBilling ? [`/jobs/${id}/billing`, `/jobs/${id}/retainage`] : []),
    `/jobs/${id}/field-reports`,
    ...(i.showsField ? [`/jobs/${id}/photos`] : []),
  ];
}

describe("jobTabs", () => {
  it("is the pre-#748 rail, in order, for every viewer and job stage", () => {
    let combos = 0;
    for (const status of ["ESTIMATE", "CONTRACTED", "IN_PROGRESS", "COMPLETE"])
      for (const showsJobMoney of [true, false])
        for (const showsBilling of [true, false])
          for (const showsField of [true, false]) {
            const input = { ...owner, status, showsJobMoney, showsBilling, showsField };
            expect(jobTabs(input).map((t) => t.href)).toEqual(oldRail(input));
            combos++;
          }
    expect(combos).toBe(32);
  });

  it("keeps billing and retainage off a bid, and gates money and photos", () => {
    const hrefs = (i: Partial<typeof owner>) => jobTabs({ ...owner, ...i }).map((t) => t.href.replace("/jobs/job-1", ""));
    expect(hrefs({ status: "ESTIMATE" })).not.toContain("/billing");
    expect(hrefs({ status: "ESTIMATE" })).not.toContain("/retainage");
    expect(hrefs({ showsBilling: false })).not.toContain("/billing");
    expect(hrefs({ showsJobMoney: false })).not.toContain("/estimate");
    expect(hrefs({ showsJobMoney: false })).not.toContain("/takeoff");
    expect(hrefs({ showsField: false })).not.toContain("/photos");
    // Always there, whoever is looking.
    const bare = hrefs({ status: "ESTIMATE", showsJobMoney: false, showsBilling: false, showsField: false });
    expect(bare).toEqual(["", "/crew", "/compliance", "/field-reports"]);
  });

  it("calls the estimate route Estimate on a bid and on a contracted job alike", () => {
    for (const status of ["ESTIMATE", "IN_PROGRESS"]) {
      const estimate = jobTabs({ ...owner, status }).find((t) => t.href === "/jobs/job-1/estimate");
      expect(estimate?.label, status).toBe("Estimate");
    }
  });

  it("JOB_TAB_ROUTES is exactly what an owner sees on a contracted job, in order", () => {
    const patterns = jobTabs(owner).map((t) => t.href.replace("/jobs/job-1", "/jobs/[id]"));
    expect(patterns).toEqual([...JOB_TAB_ROUTES]);
    expect(JOB_TAB_ROUTES).toHaveLength(9);
  });
});

describe("jobDocumentLinks", () => {
  const labels = (role: string, jobFunction: string | null) =>
    jobDocumentLinks({ role, jobFunction }, "job-1").map((l) => l.label);

  it("offers each document only to whoever its page lets in", () => {
    expect(labels("OWNER", null)).toEqual(["Proposal", "Certified payroll"]);
    // proposal/page.tsx: MANAGE_ESTIMATING. certified-payroll/page.tsx: MANAGE_COMPLIANCE.
    expect(labels("MEMBER", "ESTIMATOR")).toEqual(["Proposal"]);
    expect(labels("MEMBER", "PAYROLL_COMPLIANCE")).toEqual(["Certified payroll"]);
    // ACCOUNTING sees job money but cannot open the proposal page.
    expect(labels("MEMBER", "ACCOUNTING")).toEqual([]);
    expect(labels("MEMBER", "FIELD")).toEqual([]);
  });

  it("links the job's own proposal and certified payroll", () => {
    expect(jobDocumentLinks({ role: "OWNER", jobFunction: null }, "job-1").map((l) => l.href)).toEqual([
      "/jobs/job-1/proposal",
      "/jobs/job-1/certified-payroll",
    ]);
  });
});

// The layout is an async server component no render test here can mount,
// so read its source: a tab row nothing draws is the "written, documented
// and never called" shape CLAUDE.md warns about.
describe("the job layout", () => {
  const source = readFileSync(fileURLToPath(new URL("../../app/(app)/jobs/[id]/(tabs)/layout.tsx", import.meta.url)), "utf8");

  it("draws the tab row directly under the stage boxes", () => {
    expect(source).toMatch(/<JobStageNav stages=\{stages\} \/>\s*<JobSectionNav tabs=\{tabs\} \/>/);
    expect(source).toContain("jobTabs({");
  });

  it("puts the proposal and certified payroll in the Paperwork panel", () => {
    expect(source).toMatch(/const paperwork = \[[^\]]*\.\.\.jobDocumentLinks\(principal, id\)/);
  });
});
