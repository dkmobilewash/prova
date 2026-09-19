import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";

/**
 * /jobs/new end to end: the JOB_CREATE persona has its own empty company
 * (see lib/personas.ts) specifically so this spec's write can never race
 * dashboard-empty.spec.ts's "zero jobs" assumption on the EMPTY persona.
 *
 * JOB_CREATE has zero contacts, so NewJobForm defaults straight to the
 * new-GC fields (no picker) — this spec fills those rather than a
 * contactId select.
 */
test("create a job end to end; it appears on the dashboard", async ({ page }) => {
  await signInAs(page, PERSONAS.jobCreate.email);
  await page.goto("/jobs/new");

  const jobName = `ZZ-E2E Created Job ${Date.now()}`;
  await page.getByLabel("Job name").fill(jobName);
  await page.getByLabel("GC name").fill("ZZ-E2E New GC");

  await page.getByRole("button", { name: "Create job" }).click();

  // Success is a redirect to /jobs/[id] — no toast (lib/actions/jobs.ts's
  // createJob calls revalidatePath then redirect()).
  await page.waitForURL(/\/jobs\/[^/]+$/);

  await page.goto("/dashboard");
  await expect(page.getByText(jobName)).toBeVisible();
});
