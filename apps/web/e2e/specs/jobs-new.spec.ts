import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";

/**
 * /jobs/new end to end: the JOB_CREATE persona has its own empty company
 * (see lib/personas.ts) specifically so this spec's write can never race
 * dashboard-empty.spec.ts's "zero jobs" assumption on the EMPTY persona.
 *
 * REWRITTEN 2026-09-21. This spec pressed a "Create job" button that never
 * existed; the step-1 button was "Continue →" and, since #413, is "Start
 * the job — add the work next →". It then waited for a redirect to
 * /jobs/[id], when step 1 has always gone to /jobs/new/[id]/items. It failed
 * on its first click and checked nothing after it. And its last step
 * opened /dashboard as the OWNER of a brand-new company, which
 * lib/onboarding-gate.ts sends to /welcome.
 *
 * It now drives the wizard through journey.ts's helpers, the same ones
 * journey.spec.ts and known-bad-inputs.spec.ts use, so the button labels
 * and URLs live in one place. The next change to the wizard then updates
 * one file, not four. `finishWizard` also asserts that step 2 is the last
 * step. JOB_CREATE has zero contacts, so `startJob` fills the new-GC
 * fields rather than a picker.
 *
 * The dashboard is reached through `landOnDashboard`, which walks the
 * welcome questions ("Skip for now") on the first visit. JOB_CREATE is
 * DELIBERATELY left brand new by seedDatabase.ts, so this is the real
 * first-run path, not a detour around it.
 */
test("create a job end to end; it appears on the dashboard", async ({ page }) => {
  const monitor = new HealthMonitor(page);
  await signInAs(page, PERSONAS.jobCreate.email);

  const jobName = `ZZ-E2E Created Job ${Date.now()}`;
  const gcName = "ZZ-E2E New GC";
  const jobId = await startJob(page, monitor, { name: jobName, gcName });
  // Step 2 names the job it is adding work to, so a redirect to some
  // other job's step 2 cannot pass.
  await expect(page.getByText(`${jobName} · ${gcName}`)).toBeVisible();

  await finishWizard(page, monitor, jobId);
  await expect(page.getByRole("heading", { name: jobName }).first()).toBeVisible();

  await landOnDashboard(page, monitor);
  await expect(page.getByText(jobName).first()).toBeVisible();
});
