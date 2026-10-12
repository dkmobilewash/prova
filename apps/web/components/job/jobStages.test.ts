import { describe, expect, it } from "vitest";
import { changeOrderPaperworkLink, isCurrentLink, lienWaiverPaperworkLink, jobStages, selectedStageKey, type JobStageInput } from "@/components/job/jobStages";
import { todayInZone } from "@/lib/viewer-timezone";

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
  asOf: new Date("2026-10-10T00:00:00.000Z"),
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

  /* ------------------------------------------------ 2026-10-10 fixes -- */

  it("the owner's job: working, contract never signed — Contract is amber, not ticked", () => {
    // Seen in the running app: IN_PROGRESS, no executed contract, one CO.
    // The Contract step showed a green tick beside "Not signed · 1 CO".
    const stages = jobStages({ ...base, contractSigned: false, approvedChangeOrders: 1, invoiceCount: 0, latestPayApp: null });
    expect(stages[1]).toMatchObject({ key: "contract", state: "attention", tone: "warn", status: "Not signed · 1 CO" });
    expect(stages[0].state).toBe("done");
    expect(stages[2].state).toBe("current");
  });

  it("never ticks a stage whose own status line says something is missing — any job, any viewer", () => {
    const MISSING = /Not signed|No one yet|Nothing billed yet/;
    let checked = 0;
    for (const lifecycleStage of ["in_progress", "substantially_complete", "closed"] as const)
      for (const contractSigned of [true, false])
        for (const crewSize of [0, 3])
          for (const invoiceCount of [0, 2])
            for (const showsBilling of [true, false]) {
              const stages = jobStages({ ...base, lifecycleStage, contractSigned, crewSize, invoiceCount, showsBilling, latestPayApp: null });
              for (const stage of stages) {
                if (stage.status && MISSING.test(stage.status)) {
                  expect(stage.state, `${stage.label}: "${stage.status}"`).not.toBe("done");
                  checked++;
                }
              }
            }
    // Not vacuous: the combinations above do reach the missing states.
    expect(checked).toBeGreaterThan(20);
  });

  it("a pay app past its due date reads 'overdue N days' in the danger tone", () => {
    const stages = jobStages({
      ...base,
      latestPayApp: { number: 2, dueAt: new Date("2026-10-02T00:00:00.000Z"), status: "SUBMITTED" },
      asOf: new Date("2026-10-10T00:00:00.000Z"),
    });
    expect(stages[3]).toMatchObject({ status: "Pay app #2 overdue 8 days", tone: "danger" });
  });

  it("due today is not overdue, and a paid pay app is never overdue", () => {
    const due = { number: 2, dueAt: new Date("2026-10-02T00:00:00.000Z"), status: "SUBMITTED" };
    const today = jobStages({ ...base, latestPayApp: due, asOf: new Date("2026-10-02T00:00:00.000Z") })[3];
    expect(today.status).toBe("Pay app #2 due Oct 2");
    expect(today.tone).toBeUndefined();
    const paid = jobStages({ ...base, latestPayApp: { ...due, status: "PAID" } })[3];
    expect(paid).toMatchObject({ status: "Pay app #2 paid" });
    expect(paid.tone).toBeUndefined();
  });

  it("an evening in Los Angeles: due today on the viewer's calendar, though the server's UTC day is tomorrow", () => {
    // 19:00 PDT on Oct 2 is 02:00 UTC on Oct 3. Deriving overdue from the
    // server's day would call this "overdue 1 day" all evening.
    const instant = new Date("2026-10-03T02:00:00.000Z");
    const viewerDay = todayInZone("America/Los_Angeles", instant);
    expect(viewerDay).toBe("2026-10-02");
    const due = { number: 2, dueAt: new Date("2026-10-02T00:00:00.000Z"), status: "SUBMITTED" };
    const evening = jobStages({ ...base, latestPayApp: due, asOf: new Date(`${viewerDay}T00:00:00.000Z`) })[3];
    expect(evening.status).toBe("Pay app #2 due Oct 2");
    // CONTROL: the server's UTC day is the wrong answer this file exists to avoid.
    const serverDay = instant.toISOString().slice(0, 10);
    const wrong = jobStages({ ...base, latestPayApp: due, asOf: new Date(`${serverDay}T00:00:00.000Z`) })[3];
    expect(wrong.status).toBe("Pay app #2 overdue 1 day");
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

  // Guidelines review 2026-10-10: `pathname === href` could never match a
  // link carrying a query, so the punch list could never read as current.
  it("matches a link with a query on its path AND its params", () => {
    expect(isCurrentLink("/punch-lists?job=job-1", "/punch-lists", "job=job-1")).toBe(true);
    expect(isCurrentLink("/punch-lists?job=job-1", "/punch-lists", "job=job-2")).toBe(false);
    expect(isCurrentLink("/punch-lists?job=job-1", "/punch-lists", "")).toBe(false);
    expect(isCurrentLink("/jobs/job-1", "/jobs/job-1", "tab=x")).toBe(true);
    expect(selectedStageKey(jobStages(base), "/punch-lists", "job=job-1")).toBe("closeout");
  });

  it("marks the two links that leave the job, and only those", () => {
    const leaving = jobStages(base)
      .flatMap((s) => s.links)
      .filter((l) => l.leavesJob)
      .map((l) => l.href);
    expect(leaving).toEqual(["/punch-lists?job=job-1", "/closeout"]);
  });
});

describe("changeOrderPaperworkLink", () => {
  it("leads with change orders still waiting on the GC", () => {
    expect(changeOrderPaperworkLink("job-1", 2, 1).detail).toBe("1 waiting · 2 approved");
    expect(changeOrderPaperworkLink("job-1", 2, 0).detail).toBe("2 approved");
  });
});

describe("lienWaiverPaperworkLink", () => {
  it("lands on the lien-waiver section of the job's Billing tab", () => {
    expect(lienWaiverPaperworkLink("job-1", 3)).toEqual({
      href: "/jobs/job-1/billing#lien-waivers",
      label: "Lien waivers",
      detail: "3",
    });
  });
});
