// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JobStepper } from "./JobStepper";
import { jobSteps, type JobStepFacts } from "@/lib/job-steps";

const base: JobStepFacts = { jobId: "j1", hasPlan: true, scaledSheets: 1, floorPlans: 0, floorPlansScaled: 0, measurements: 0, toReview: 0, lineItemCount: 0, unpricedLines: 0, signatureStatuses: [] };
const html = (facts: Partial<JobStepFacts>) => {
  const { steps, next } = jobSteps({ ...base, ...facts });
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(JobStepper, { steps, next }));
  return host;
};

describe("the job stepper, rendered", () => {
  it("draws all seven steps as links, each saying its state in words", () => {
    const host = html({});
    const links = [...host.querySelectorAll("[data-job-step]")];
    expect(links.map((a) => a.textContent?.replace(/[✓↗\d]/g, "").split(",")[0]?.trim())).toEqual(["Job", "Plans", "Scale", "Takeoff", "Review", "Estimate", "Send"]);
    expect(links.every((a) => a.tagName === "A" && a.getAttribute("href"))).toBe(true);
    expect(host.querySelector('[data-job-step="takeoff"]')?.textContent).toContain("current step");
    expect(host.querySelector('[data-job-step="plans"]')?.textContent).toContain("done");
    expect(host.querySelector('[data-job-step="send"]')?.textContent).toContain("not started");
    expect(host.querySelector('[aria-current="step"]')?.getAttribute("data-job-step")).toBe("takeoff");
  });

  it("opens the takeoff in its own tab, from the step and from Next", () => {
    const host = html({});
    const step = host.querySelector('[data-job-step="takeoff"]')!;
    expect(step.getAttribute("href")).toBe("/takeoff/j1");
    expect(step.getAttribute("target")).toBe("_blank");
    expect(step.getAttribute("rel")).toBe("noopener");
    const next = host.querySelector("[data-job-next]")!;
    expect(next.textContent).toContain("Next: Run the takeoff");
    expect(next.getAttribute("target")).toBe("_blank");
    expect(host.querySelector('[data-job-step="estimate"]')?.getAttribute("target")).toBeNull();
  });

  it("has exactly one Next, and none once the proposal is out", () => {
    expect(html({}).querySelectorAll("[data-job-next]")).toHaveLength(1);
    expect(html({ measurements: 2, lineItemCount: 1, signatureStatuses: ["PENDING"] }).querySelectorAll("[data-job-next]")).toHaveLength(0);
  });
});
