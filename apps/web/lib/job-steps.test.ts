import { describe, expect, it } from "vitest";
import { jobSteps, type JobStepFacts } from "./job-steps";

const base: JobStepFacts = { jobId: "j1", hasPlan: false, scaledSheets: 0, measurements: 0, wallsToConfirm: 0, lineItemCount: 0, signatureStatuses: [] };
const states = (facts: Partial<JobStepFacts>) => jobSteps({ ...base, ...facts }).steps.map((s) => `${s.key}:${s.state}`).join(" ");

describe("a job's estimating steps", () => {
  it("a new job: Job done, Plans current, the rest not started, and Next says upload", () => {
    expect(states({})).toBe("job:done plans:current scale:todo takeoff:todo review:todo estimate:todo send:todo");
    expect(jobSteps(base).next).toEqual({ label: "Upload the plans", href: "/jobs/j1/takeoff", newTab: false });
  });

  it("walks forward one fact at a time", () => {
    expect(jobSteps({ ...base, hasPlan: true }).next?.label).toBe("Set the scale");
    expect(jobSteps({ ...base, hasPlan: true, scaledSheets: 1 }).next).toEqual({ label: "Run the takeoff", href: "/takeoff/j1", newTab: true });
    expect(jobSteps({ ...base, hasPlan: true, scaledSheets: 1, measurements: 3 }).next?.label).toBe("Send the takeoff to the estimate");
    expect(jobSteps({ ...base, hasPlan: true, scaledSheets: 1, measurements: 3, lineItemCount: 2 }).next).toEqual({ label: "Send the proposal", href: "/jobs/j1/proposal", newTab: false });
    expect(jobSteps({ ...base, hasPlan: true, scaledSheets: 1, measurements: 3, lineItemCount: 2, signatureStatuses: ["PENDING"] }).next).toBeNull();
  });

  it("holds Review open while walls wait to be confirmed, and counts them", () => {
    const facts = { ...base, hasPlan: true, scaledSheets: 1, measurements: 3, wallsToConfirm: 2 };
    expect(states(facts)).toBe("job:done plans:done scale:done takeoff:done review:current estimate:todo send:todo");
    expect(jobSteps(facts).next).toEqual({ label: "Review 2 walls to confirm", href: "/takeoff/j1", newTab: true });
    expect(jobSteps({ ...facts, wallsToConfirm: 1 }).next?.label).toBe("Review 1 wall to confirm");
  });

  it("is not a locked wizard: a job priced with no plans is on Send, and the skipped steps say not started", () => {
    expect(states({ lineItemCount: 4 })).toBe("job:done plans:todo scale:todo takeoff:todo review:todo estimate:done send:current");
  });

  it("agrees with the jobs list about sent: a signed proposal is sent too", () => {
    expect(jobSteps({ ...base, lineItemCount: 1, signatureStatuses: ["SIGNED"] }).steps.at(-1)?.state).toBe("done");
    expect(jobSteps({ ...base, lineItemCount: 1, signatureStatuses: ["DECLINED"] }).steps.at(-1)?.state).toBe("current");
  });

  it("takeoff and review open the full-screen workspace in its own tab; nothing else does", () => {
    const tabs = jobSteps(base).steps.filter((s) => s.newTab).map((s) => s.key);
    expect(tabs).toEqual(["takeoff", "review"]);
  });
});
