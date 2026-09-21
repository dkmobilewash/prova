import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { CRASH_MARKERS, expectHealthy, type HealthMonitor } from "./health";
import { stubDocumentUpload } from "./blobStub";

/**
 * The pilot contractor's path through the product, as reusable steps.
 *
 * Every step here drives the REAL screens through the real controls —
 * the same buttons, by their visible labels, a person presses. Nothing
 * seeds a row through Prisma to skip a screen: the point of the journey
 * is that the screens work in sequence, and a step skipped is a step
 * untested. (specs/known-bad-inputs.spec.ts reuses these to build the
 * contracted job its cases need, which is why they live here rather than
 * inline in journey.spec.ts.)
 *
 * Every step ends in `expectHealthy` — see health.ts for what that
 * catches and why the "rendered something" half of it matters.
 */

// __dirname, not import.meta.url — see playwright.config.ts's comment.
export const EXECUTED_SUBCONTRACT_FIXTURE = path.resolve(__dirname, "../fixtures/executed-subcontract.pdf");

/** The tab rail under a job's summary header (components/JobSectionNav.tsx). */
export function jobTab(page: Page, label: string): Locator {
  return page.getByRole("navigation", { name: "Job sections" }).getByRole("link", { name: label, exact: true });
}

/**
 * /dashboard, from wherever sign-in left us. A brand-new company's OWNER
 * is sent to /welcome first (lib/onboarding-gate.ts — the three
 * business-scope questions, with "Skip for now" as a first-class answer),
 * which is the real first screen a pilot sees, so it is walked rather
 * than avoided. An account that has already answered lands straight on
 * the dashboard; both paths end in the same assertions.
 */
export async function landOnDashboard(page: Page, monitor: HealthMonitor): Promise<void> {
  await page.goto("/dashboard");
  await page.waitForURL(/\/(dashboard|welcome)(\?|$)/);

  if (/\/welcome/.test(page.url())) {
    await expectHealthy(page, "welcome screen", { monitor, signedIn: false });
    await expect(page.getByRole("heading", { name: "A few questions about how you work" })).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await page.waitForURL(/\/dashboard(\?|$)/);
  }

  await expectHealthy(page, "dashboard", { monitor });
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
}

export interface NewJobInput {
  name: string;
  scope?: string;
  /** Used only when the company has no GCs yet, or when `newGc` is true. */
  gcName: string;
  newGc?: boolean;
}

/**
 * Step 1 of the bid wizard (/jobs/new): name the job and pick or add the
 * GC. Resolves to the new job's id, read off the URL of step 2 — the
 * redirect `createJob` performs is the success signal, there is no toast.
 *
 * On a company with no GCs the form shows the new-GC fields by default;
 * with GCs it shows the picker, and this either picks the first real
 * option or, with `newGc`, switches to the add-a-new-one fields.
 */
export async function startJob(page: Page, monitor: HealthMonitor, input: NewJobInput): Promise<string> {
  await page.goto("/jobs/new");
  await expectHealthy(page, "new job, step 1", { monitor });

  await page.locator('input[name="jobName"]').fill(input.name);
  if (input.scope) await page.locator('textarea[name="scope"]').fill(input.scope);

  const picker = page.locator('select[name="contactId"]');
  if ((await picker.count()) > 0 && !input.newGc) {
    // The first non-placeholder option — the GC this company already works with.
    await picker.selectOption({ index: 1 });
  } else {
    const addNew = page.getByRole("button", { name: "+ Add a new GC" });
    if ((await addNew.count()) > 0) await addNew.click();
    await page.locator('input[name="contactName"]').fill(input.gcName);
  }

  await page.getByRole("button", { name: "Continue →" }).click();
  await page.waitForURL(/\/jobs\/new\/[^/]+\/items$/);
  await expectHealthy(page, "new job, step 2 (add work)", { monitor });

  const match = page.url().match(/\/jobs\/new\/([^/]+)\/items$/);
  expect(match, "step 2's URL must carry the new job's id").not.toBeNull();
  return match![1];
}

export interface LineItemInput {
  description: string;
  quantity: string;
  unit?: string;
  unitPrice?: string;
}

/** The "Add a line" form on step 2 (components/BidWizardLineItems.tsx). */
export function addLineForm(page: Page): Locator {
  return page.locator("form").filter({ has: page.getByRole("heading", { name: "Add a line" }) });
}

/** Fills and submits "Add a line" on step 2. Asserts nothing about the
 * outcome — callers decide, because the known-bad cases need to observe a
 * refusal as well as a success. */
export async function submitLineItem(page: Page, line: LineItemInput): Promise<void> {
  const form = addLineForm(page);
  await form.locator('input[name="description"]').fill(line.description);
  await form.locator('input[name="quantity"]').fill(line.quantity);
  if (line.unit !== undefined) await form.locator('input[name="unit"]').fill(line.unit);
  if (line.unitPrice !== undefined) await form.locator('input[name="unitPrice"]').fill(line.unitPrice);
  await form.getByRole("button", { name: "Add line" }).click();
}

/** A row in step 2's "On this estimate" list carrying this description. */
export function estimateRow(page: Page, description: string): Locator {
  return page.locator("li").filter({ hasText: description });
}

/**
 * From step 2 to the job's own page. The wizard has been two steps on one
 * branch and three on another (#413 removes the Review step), so this
 * follows whatever the page offers: a link that opens the job, or a
 * "Continue →" to a Review step that then offers one.
 */
export async function finishWizard(page: Page, monitor: HealthMonitor, jobId: string): Promise<void> {
  const openJob = page.getByRole("link", { name: /open the job/i });
  if ((await openJob.count()) === 0) {
    await page.getByRole("link", { name: "Continue →" }).click();
    await page.waitForURL(/\/jobs\/new\/[^/]+\/review$/);
    await expectHealthy(page, "new job, review step", { monitor });
  }
  await page.getByRole("link", { name: /open the job/i }).click();
  await page.waitForURL(new RegExp(`/jobs/${jobId}(\\?|$)`));
  await expectHealthy(page, "job overview after the wizard", { monitor });
}

/**
 * Overview tab -> "The GC already sent the executed subcontract" -> attach
 * the signed file, enter the GC's date, record. The upload is answered in
 * the browser by lib/blobStub.ts; the ACTION's checks on the returned URL
 * run for real. Success is the green "Executed — GC signed …" badge the
 * overview renders from the ContractDocument row.
 */
export async function recordExecutedSubcontract(page: Page, monitor: HealthMonitor, jobId: string): Promise<void> {
  await page.goto(`/jobs/${jobId}`);
  await expectHealthy(page, "job overview", { monitor });
  await stubDocumentUpload(page);

  await page.getByRole("button", { name: "The GC already sent the executed subcontract" }).click();
  // Scoped to THIS form: the overview also carries the "Subcontract
  // agreement" upload form, which has its own `input[name="file"]`.
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Record executed subcontract" }) });
  await form.locator('input[name="file"]').setInputFiles(EXECUTED_SUBCONTRACT_FIXTURE);
  await form.locator('input[name="executedSignedDate"]').fill("2026-09-15");
  await form.locator('input[name="note"]').fill("ZZ-E2E fully executed copy from the GC");
  await form.getByRole("button", { name: "Record executed subcontract" }).click();

  await expect(page.getByText(/Executed — GC signed/).first()).toBeVisible();
  await expectHealthy(page, "job overview after recording the executed subcontract", { monitor });
}

/**
 * Estimate tab -> "Mark as contracted". The button only renders once an
 * executed contract exists (estimate/page.tsx `isContractExecuted`), and
 * the tab rail only grows Billing and Retainage once the job has left
 * ESTIMATE ((tabs)/layout.tsx) — so those two tabs appearing is the
 * observable proof the status write happened.
 */
export async function markContracted(page: Page, monitor: HealthMonitor, jobId: string): Promise<void> {
  await page.goto(`/jobs/${jobId}/estimate`);
  await expectHealthy(page, "estimate tab", { monitor });

  await page.getByRole("button", { name: "Mark as contracted" }).click();

  await expect(jobTab(page, "Billing")).toBeVisible();
  await expect(jobTab(page, "Retainage")).toBeVisible();
  await expectHealthy(page, "estimate tab after marking contracted", { monitor });
}

/** The retainage-terms form on the Retainage tab. */
export function retainageForm(page: Page): Locator {
  return page.locator("form").filter({ has: page.locator('input[name="retainagePercent"]') });
}

/** The invoice form on the Billing tab — the one with a "Create invoice" button. */
export function invoiceForm(page: Page): Locator {
  return page.locator("form").filter({ has: page.getByRole("button", { name: "Create invoice" }) });
}

/**
 * Fills and submits the Billing tab's invoice form. Asserts nothing about
 * the outcome, for the same reason as submitLineItem.
 */
export async function submitInvoice(
  page: Page,
  input: { description: string; amount: string; dueAt?: string },
): Promise<void> {
  const form = invoiceForm(page);
  await form.locator('input[name="description"]').fill(input.description);
  await form.locator('input[name="amount"]').fill(input.amount);
  if (input.dueAt) await form.locator('input[name="dueAt"]').fill(input.dueAt);
  await form.getByRole("button", { name: "Create invoice" }).click();
}

/**
 * Something a person can read and act on, rendered where a form's
 * refusal goes. `role="alert"` is what this app's ActionResult-rendering
 * forms use; the phrases are the parsers' own wording (lib/actions/shared.ts
 * and lib/numeric-input.ts on the branch that fixes the comma). Deliberately
 * NOT matched: the redacted production sentence, which health.ts already
 * treats as a crash.
 */
export function readableRefusal(page: Page): Locator {
  return page
    .locator('[role="alert"]')
    .or(page.getByText(/must be a number|doesn't take|isn't a number|not a number|Type the figure|between 0 and 100/));
}

export type SubmitOutcome = "accepted" | "refused" | "crashed" | "neither";

/**
 * What happened after a submit: the accepted state appeared, a readable
 * refusal appeared, a crash sentence appeared, or — within the deadline —
 * none of those. Polls state rather than sleeping a fixed time.
 *
 * A REFUSAL HAS TO BE VISIBLE AND SAY SOMETHING. The first version of this
 * asked only `count() > 0`, and every known-bad case passed on `main` with
 * the fix unmerged — some `role="alert"` slot with nothing in it was in
 * the DOM, and an empty string is not the redacted sentence, so "refused"
 * it was. The outcome annotation the cases record is what exposed it: the
 * attached page text showed no refusal anywhere. That is the
 * needle-already-on-the-page trap from CLAUDE.md, wearing an ARIA role. A
 * refusal now has to be a visible element with non-blank text; the crash
 * sentences are checked here too, so a page that fell over is reported as
 * "crashed" the moment it does rather than as "neither" fifteen seconds
 * later.
 */
export async function settleOutcome(
  page: Page,
  accepted: Locator,
  refusal: Locator,
  deadlineMs = 15_000,
): Promise<SubmitOutcome> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if ((await accepted.count()) > 0) return "accepted";

    const bodyText = await page.locator("body").innerText();
    if (CRASH_MARKERS.some((marker) => bodyText.includes(marker))) return "crashed";

    for (const candidate of await refusal.all()) {
      if (!(await candidate.isVisible())) continue;
      const text = (await candidate.innerText()).trim();
      if (text.length === 0) continue;
      if (/Server Components render|omitted in production|digest/i.test(text)) continue;
      return "refused";
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return "neither";
}
