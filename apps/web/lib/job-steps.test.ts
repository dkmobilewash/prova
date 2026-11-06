import { describe, expect, it } from "vitest";
import { jobSteps, type JobStepFacts } from "./job-steps";

const base: JobStepFacts = { jobId: "j1", hasPlan: false, scaledSheets: 0, floorPlans: 0, floorPlansScaled: 0, measurements: 0, toReview: 0, lineItemCount: 0, unpricedLines: 0, signatureStatuses: [], markupNeeded: false, clausesReady: true };
const states = (facts: Partial<JobStepFacts>) => jobSteps({ ...base, ...facts }).steps.map((s) => `${s.key}:${s.state}`).join(" ");

describe("a job's estimating steps", () => {
  it("a new job: Job done, Plans current, the rest not started, and Next says upload", () => {
    expect(states({})).toBe("job:done plans:current scale:todo takeoff:todo review:todo estimate:todo send:todo");
    expect(jobSteps(base).next).toEqual({ label: "Upload the plans", href: "/jobs/j1/takeoff#plan-set", newTab: false });
  });

  it("walks forward one fact at a time", () => {
    expect(jobSteps({ ...base, hasPlan: true }).next).toEqual({ label: "Confirm the scales", href: "/jobs/j1/takeoff#plan-set", newTab: false });
    expect(jobSteps({ ...base, hasPlan: true, scaledSheets: 1 }).next).toEqual({ label: "Run the takeoff", href: "/takeoff/j1", newTab: true });
    expect(jobSteps({ ...base, hasPlan: true, scaledSheets: 1, measurements: 3 }).next).toEqual({ label: "Put the takeoff on the estimate", href: "/takeoff/j1", newTab: true });
    expect(jobSteps({ ...base, hasPlan: true, scaledSheets: 1, measurements: 3, lineItemCount: 2 }).next).toEqual({ label: "Send it for signature", href: "/jobs/j1#contract-signature", newTab: false });
    expect(jobSteps({ ...base, hasPlan: true, scaledSheets: 1, measurements: 3, lineItemCount: 2, signatureStatuses: ["PENDING"] }).next).toBeNull();
  });

  it("holds Review open while the review queue has items, and counts them", () => {
    const facts = { ...base, hasPlan: true, scaledSheets: 1, measurements: 3, toReview: 2 };
    expect(states(facts)).toBe("job:done plans:done scale:done takeoff:done review:current estimate:todo send:todo");
    expect(jobSteps(facts).next).toEqual({ label: "Review 2 items", href: "/takeoff/j1?open=review", newTab: true });
    expect(jobSteps({ ...facts, toReview: 1 }).next?.label).toBe("Review 1 item");
  });

  it("SCALE IS DONE WHEN EVERY FLOOR PLAN HAS A SCALE, not when one sheet does", () => {
    const facts = { ...base, hasPlan: true, scaledSheets: 2, floorPlans: 3, floorPlansScaled: 2 };
    expect(states(facts)).toBe("job:done plans:done scale:current takeoff:todo review:todo estimate:todo send:todo");
    expect(jobSteps(facts).next?.label).toBe("Scale 1 more floor plan");
    // None scaled yet, though the sure sheets may be: still the floor plans by name.
    expect(jobSteps({ ...facts, floorPlans: 4, floorPlansScaled: 0 }).next?.label).toBe("Scale 4 floor plans");
    expect(states({ ...facts, floorPlansScaled: 3 })).toBe("job:done plans:done scale:done takeoff:current review:todo estimate:todo send:todo");
    // A set nothing has sorted yet falls back to any sheet with a scale.
    expect(states({ ...base, hasPlan: true, scaledSheets: 1 })).toContain("scale:done");
  });

  it("REVIEW COMES BEFORE ESTIMATE AND SEND: what is left to review is never jumped over", () => {
    // Plain walls now reach the estimate on their own, so a line can exist
    // while walls still wait — that job is on Review, not on Send.
    const facts = { ...base, hasPlan: true, scaledSheets: 1, measurements: 3, toReview: 2, lineItemCount: 1 };
    expect(states(facts)).toBe("job:done plans:done scale:done takeoff:done review:current estimate:done send:todo");
    expect(jobSteps({ ...facts, signatureStatuses: ["PENDING"] }).next?.label).toBe("Review 2 items");
  });

  it("AN UNPRICED LINE IS NOT AN ESTIMATE: Estimate stays current and Next says what to price", () => {
    const facts = { ...base, hasPlan: true, scaledSheets: 1, measurements: 3, lineItemCount: 2, unpricedLines: 1 };
    expect(states(facts)).toBe("job:done plans:done scale:done takeoff:done review:done estimate:current send:todo");
    expect(jobSteps(facts).next).toEqual({ label: "Price 1 line on the estimate", href: "/jobs/j1/estimate", newTab: false });
    expect(jobSteps({ ...facts, unpricedLines: 2 }).next?.label).toBe("Price 2 lines on the estimate");
  });

  it("is not a locked wizard: a job priced with no plans is on Send, and the skipped steps say not started", () => {
    expect(states({ lineItemCount: 4 })).toBe("job:done plans:todo scale:todo takeoff:todo review:todo estimate:done send:current");
  });

  it("agrees with the jobs list about sent: a signed proposal is sent too", () => {
    expect(jobSteps({ ...base, lineItemCount: 1, signatureStatuses: ["SIGNED"] }).steps.at(-1)?.state).toBe("done");
    expect(jobSteps({ ...base, lineItemCount: 1, signatureStatuses: ["DECLINED"] }).steps.at(-1)?.state).toBe("current");
  });

  it("takeoff and review open the full-screen workspace in its own tab, on their own sheet; nothing else does", () => {
    const steps = jobSteps(base).steps.filter((s) => s.newTab);
    expect(steps.map((s) => [s.key, s.href])).toEqual([
      ["takeoff", "/takeoff/j1"],
      ["review", "/takeoff/j1?open=review"],
    ]);
  });

  it("ESTIMATE IS NOT DONE WHILE A NEW COMPANY'S MARKUP IS UNSET, and Next says so once every line is priced", () => {
    const priced = { ...base, hasPlan: true, scaledSheets: 1, measurements: 3, lineItemCount: 2 };
    expect(states({ ...priced, markupNeeded: true })).toContain("estimate:current");
    expect(jobSteps({ ...priced, markupNeeded: true }).next).toEqual({ label: "Set your markup", href: "/jobs/j1/estimate", newTab: false });
    // Unpriced lines still come first: pricing is the bigger job.
    expect(jobSteps({ ...priced, unpricedLines: 1, markupNeeded: true }).next?.label).toBe("Price 1 line on the estimate");
    // The control: the same job with markup set is past Estimate.
    expect(states({ ...priced, markupNeeded: false })).toContain("estimate:done");
  });

  it("SEND ASKS FOR INCLUSIONS AND EXCLUSIONS FIRST: Next goes to the proposal's clauses, the step still to the signing link", () => {
    const priced = { ...base, hasPlan: true, scaledSheets: 1, measurements: 3, lineItemCount: 2 };
    const without = jobSteps({ ...priced, clausesReady: false });
    expect(without.next).toEqual({ label: "Add inclusions and exclusions", href: "/jobs/j1/proposal#clauses", newTab: false });
    expect(without.steps.find((s) => s.key === "send")).toMatchObject({ state: "current", href: "/jobs/j1#contract-signature" });
    expect(jobSteps({ ...priced, clausesReady: true }).next?.label).toBe("Send it for signature");
    // A nudge, not a lock: a link sent without them still counts as sent.
    expect(states({ ...priced, clausesReady: false, signatureStatuses: ["PENDING"] })).toContain("send:done");
  });
});
