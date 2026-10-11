import { describe, expect, it } from "vitest";
import { changeOrderPaperworkLink, jobStages, selectedStageKey, type JobStageInput } from "@/components/job/jobStages";

const base: JobStageInput = {
  jobId: "job-1",
  status: "IN_PROGRESS",
  lifecycleStage: "in_progress",
  showsJobMoney: true,
  showsBilling: true,
  showsField: true,
  canReachPunchList: true,
  canReachCloseout: true,
  crewSize: 14,
  contractSigned: true,
  approvedChangeOrders: 2,
  invoiceCount: 4,
  latestPayApp: { number: 4, dueAt: new Date("2026-10-17T00:00:00.000Z"), status: "SUBMITTED" },
};

/** The rail as `(tabs)/layout.tsx` built it before the stages existed —
 * copied, not imported, so a change to the stage mapping cannot quietly
 * change the thing it is checked against. */
function oldRail(i: JobStageInput): string[] {
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

describe("jobStages", () => {
  it("files every old tab under exactly one stage, for every viewer and job stage", () => {
    let combos = 0;
    for (const status of ["ESTIMATE", "CONTRACTED", "IN_PROGRESS", "COMPLETE"])
      for (const showsJobMoney of [true, false])
        for (const showsBilling of [true, false])
          for (const showsField of [true, false]) {
            const input = { ...base, status, showsJobMoney, showsBilling, showsField };
            const inJob = jobStages(input)
              .flatMap((s) => s.links.map((l) => l.href))
              .filter((href) => href.startsWith("/jobs/"));
            expect(new Set(inJob).size, "a tab filed under two stages").toBe(inJob.length);
            expect([...inJob].sort()).toEqual(oldRail(input).sort());
            combos++;
          }
    expect(combos).toBe(32);
  });

  it("shows the mockup's job in its real words", () => {
    const stages = jobStages(base);
    expect(stages.map((s) => [s.label, s.state, s.status])).toEqual([
      ["Estimate", "done", "Won"],
      ["Contract", "done", "Signed · 2 COs"],
      ["Crew", "done", "14 on crew"],
      ["Billing", "current", "Pay app #4 due Oct 17"],
      ["Closeout", "upcoming", "Not started"],
    ]);
  });

  it("an estimate is on step one with the estimate under it", () => {
    const stages = jobStages({ ...base, status: "ESTIMATE", lifecycleStage: "bidding", invoiceCount: 0, latestPayApp: null });
    expect(stages[0]).toMatchObject({ state: "current", status: "Bidding" });
    expect(stages[0].links.map((l) => l.label)).toEqual(["Estimate", "Takeoff"]);
    expect(stages[3]).toMatchObject({ state: "upcoming", status: "Not started", links: [] });
  });

  it("is on Crew while working with nothing billed, and on Billing after the first bill", () => {
    expect(jobStages({ ...base, invoiceCount: 0, latestPayApp: null }).find((s) => s.state === "current")?.key).toBe("crew");
    expect(jobStages(base).find((s) => s.state === "current")?.key).toBe("billing");
  });

  it("ticks every stage once the GC has accepted closeout", () => {
    const stages = jobStages({ ...base, status: "COMPLETE", lifecycleStage: "closed" });
    expect(stages.every((s) => s.state === "done")).toBe(true);
    expect(stages[4].status).toBe("Closed");
  });

  it("says nothing about billing to a viewer without billing", () => {
    const stages = jobStages({ ...base, showsBilling: false });
    expect(stages[3]).toMatchObject({ status: null, links: [] });
  });

  it("points Closeout at the job-filtered punch list, and only where the viewer can go", () => {
    expect(jobStages(base)[4].links[0].href).toBe("/punch-lists?job=job-1");
    expect(jobStages({ ...base, canReachPunchList: false, canReachCloseout: false })[4].links).toEqual([]);
  });

  it("selects the stage holding the open page", () => {
    const stages = jobStages(base);
    expect(selectedStageKey(stages, "/jobs/job-1/retainage")).toBe("billing");
    expect(selectedStageKey(stages, "/jobs/job-1")).toBe("contract");
    expect(selectedStageKey(stages, "/jobs/job-1/estimate")).toBe("contract");
    expect(selectedStageKey(stages, "/jobs/job-1/photos")).toBe("crew");
    expect(selectedStageKey(stages, "/jobs/job-1/pay-applications/x")).toBeNull();
  });
});

describe("changeOrderPaperworkLink", () => {
  it("leads with change orders still waiting on the GC", () => {
    expect(changeOrderPaperworkLink("job-1", 2, 1).detail).toBe("1 waiting · 2 approved");
    expect(changeOrderPaperworkLink("job-1", 2, 0).detail).toBe("2 approved");
  });
});
