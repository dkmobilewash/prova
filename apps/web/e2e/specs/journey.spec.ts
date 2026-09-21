import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import {
  addLineForm,
  estimateRow,
  finishWizard,
  invoiceForm,
  jobTab,
  landOnDashboard,
  markContracted,
  recordExecutedSubcontract,
  retainageForm,
  startJob,
  submitInvoice,
  submitLineItem,
} from "../lib/journey";

/**
 * THE PILOT CONTRACTOR'S JOURNEY, in order, in a real browser.
 *
 * On 2026-09-21 CI was green, 5,800+ unit tests were green, every census
 * was green, and creating one invoice made every authenticated page in
 * the product render an error boundary — dashboard, jobs list, every job
 * tab — with no way back from the UI. A person found it by clicking,
 * hours before real contractors were due to log in. CLAUDE.md's prime
 * directive already said so: "Real bugs here have only ever been found by
 * loading the page and doing the thing." This file is a machine doing the
 * thing.
 *
 * SERIAL ON PURPOSE. Step 7 (the first invoice) needs a contracted job,
 * which needs an executed subcontract, which needs a job — so the steps
 * share one signed-in page and run in order, and a failure at step N
 * skips N+1 onward rather than letting them fail for a reason that is
 * really step N's. The report then reads "7. Create the first invoice —
 * failed", which is the sentence somebody needs. (Playwright's serial
 * mode is exactly this; retries are off for the file for the same
 * reason.) The JOURNEY persona exists only for this file — see
 * lib/personas.ts — so nothing else can move the rows under it.
 *
 * AFTER EVERY NAVIGATION AND EVERY ACTION: `expectHealthy` (lib/health.ts)
 * — no crash sentence on the page, no uncaught exception, and the page
 * actually rendered content. That last one is what keeps this from being
 * the vacuous green this repo has paid for repeatedly.
 *
 * WHAT IS NOT HERE: the known-bad inputs (`2,800`, `12,500`, `0.10`).
 * They are their own independent cases in known-bad-inputs.spec.ts, so a
 * refusal there — right or wrong — never changes what this journey sees,
 * and so this spine stays green when the product is right while the
 * cases say, separately and by name, which fix has not landed yet.
 */
test.describe("the pilot contractor's journey", () => {
  test.describe.configure({ mode: "serial", retries: 0, timeout: 120_000 });

  const JOB_NAME = "ZZ-E2E Journey — Building C level 3 drywall";
  const GC_NAME = "ZZ-E2E Journey GC";
  const LINE = { description: '5/8" Type X drywall, level 3 corridor', quantity: "2800", unit: "SF", unitPrice: "1.25" };
  /** 2800 SF x $1.25 — what the estimate, and so the contract, is worth. */
  const CONTRACT_VALUE = "$3,500.00";
  const INVOICE_AMOUNT = "12500";
  const INVOICE_RENDERED = "$12,500.00";

  let page: Page;
  let monitor: HealthMonitor;
  let jobId: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    monitor = new HealthMonitor(page);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("1. sign in", async () => {
    await signInAs(page, PERSONAS.journey.email);
    // Clerk's helper resolves once its session is set; the first protected
    // page is what proves it stuck.
    await page.goto("/dashboard");
    await page.waitForURL(/\/(dashboard|welcome)(\?|$)/);
    expect(page.url(), "sign-in did not leave us on a signed-in page").not.toMatch(/sign-in/);
  });

  test("2. land on the dashboard (through the welcome questions, first time)", async () => {
    await landOnDashboard(page, monitor);
  });

  test("3. create a job with a GC", async () => {
    jobId = await startJob(page, monitor, {
      name: JOB_NAME,
      scope: "Metal stud framing, hang, tape and finish, level 3.",
      gcName: GC_NAME,
    });
    await expect(page.getByText(`${JOB_NAME} · ${GC_NAME}`)).toBeVisible();
  });

  test("4. add an estimate line item, then open the job", async () => {
    await submitLineItem(page, LINE);
    const row = estimateRow(page, LINE.description);
    await expect(row).toBeVisible();
    await expect(row).toContainText("2800 SF");
    await expect(row).toContainText(CONTRACT_VALUE);
    await expectHealthy(page, "step 2 after adding a line", { monitor });
    // The form reset is the component's success path — a refused save
    // leaves what was typed (failed-save invariant); an accepted one clears it.
    await expect(addLineForm(page).locator('input[name="description"]')).toHaveValue("");

    await finishWizard(page, monitor, jobId);
    await expect(page.getByRole("heading", { name: JOB_NAME }).first()).toBeVisible();
  });

  test("5. record the executed subcontract and mark the job contracted", async () => {
    await recordExecutedSubcontract(page, monitor, jobId);
    await markContracted(page, monitor, jobId);
  });

  test("6. set a retainage percentage", async () => {
    await jobTab(page, "Retainage").click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/retainage$`));
    await expectHealthy(page, "retainage tab", { monitor });

    const form = retainageForm(page);
    const percent = form.locator('input[name="retainagePercent"]');
    await percent.fill("10");
    const saved = page.waitForResponse((response) => response.request().method() === "POST");
    await form.getByRole("button", { name: "Save" }).click();
    await saved;

    // Read it back from the server, not from the input we just typed in.
    await page.reload();
    await expectHealthy(page, "retainage tab after saving 10%", { monitor });
    await expect(retainageForm(page).locator('input[name="retainagePercent"]')).toHaveValue("10");
  });

  test("7. create the first invoice", async () => {
    await jobTab(page, "Billing").click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/billing$`));
    await expectHealthy(page, "billing tab", { monitor });

    await submitInvoice(page, { description: "Deposit", amount: INVOICE_AMOUNT, dueAt: "2026-10-15" });

    await expect(page.locator("main").getByText(INVOICE_RENDERED).first()).toBeVisible();
    await expectHealthy(page, "billing tab after creating the invoice", { monitor });
    // Accepted saves clear the form; a stale amount here means the row
    // above came from somewhere else.
    await expect(invoiceForm(page).locator('input[name="amount"]')).toHaveValue("");
  });

  test("7b. every authenticated page still loads after the invoice", async () => {
    // 2026-09-21's catastrophe, as a sentence: the invoice existed and the
    // dashboard, the jobs list and every job tab rendered an error
    // boundary. Each of these would have gone red that day.
    for (const target of ["/dashboard", "/jobs", `/jobs/${jobId}`, `/jobs/${jobId}/billing`]) {
      await page.goto(target);
      await expectHealthy(page, `after the first invoice: ${target}`, { monitor });
    }
    await expect(page.getByRole("heading", { name: JOB_NAME }).first()).toBeVisible();
  });

  test("8. open every job tab that now exists", async () => {
    await page.goto(`/jobs/${jobId}`);
    await expectHealthy(page, "job overview", { monitor });

    const rail = page.getByRole("navigation", { name: "Job sections" });
    const links = rail.getByRole("link");
    const labels = (await links.allInnerTexts()).map((label) => label.trim());
    expect(labels, "a contracted job, viewed by its owner, shows all eight tabs").toEqual(
      expect.arrayContaining(["Overview", "Estimate", "Crew & time", "Compliance", "Billing", "Retainage", "Field reports", "Photos"]),
    );

    const hrefs = await links.evaluateAll((anchors) =>
      anchors.map((anchor) => (anchor as HTMLAnchorElement).getAttribute("href") ?? ""),
    );
    expect(hrefs.length).toBe(labels.length);

    for (let i = 0; i < hrefs.length; i++) {
      await page.goto(hrefs[i]);
      await expectHealthy(page, `job tab "${labels[i]}"`, { monitor });
      await expect(
        rail.getByRole("link", { name: labels[i], exact: true }),
        `tab "${labels[i]}" should mark itself current`,
      ).toHaveAttribute("aria-current", "page");
    }
  });

  test("9. return to the dashboard and the jobs list", async () => {
    await page.goto("/dashboard");
    await expectHealthy(page, "dashboard", { monitor });
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();

    await page.goto("/jobs");
    await expectHealthy(page, "jobs list", { monitor });
    await expect(page.locator("main").getByText(JOB_NAME).first()).toBeVisible();
  });

  test("10. open every main nav destination", async () => {
    test.setTimeout(300_000);
    await page.goto("/dashboard");
    await expectHealthy(page, "dashboard", { monitor });

    const nav = page.getByRole("navigation", { name: "Main" });

    // The sidebar's groups are collapsible (components/Sidebar.tsx: a
    // heading <button aria-expanded> per group), and a COLLAPSED group's
    // links are not in the DOM at all — the first run of this step found
    // ten links, all from the one group the current page lives in. So every
    // closed group is opened first, the way a person exploring the product
    // would, and only then are the destinations read.
    const closedGroups = nav.locator('button[aria-expanded="false"]');
    const groupCount = await closedGroups.count();
    for (let i = 0; i < groupCount; i++) {
      // Re-query each time: opening one group re-renders the list.
      await nav.locator('button[aria-expanded="false"]').first().click();
    }
    await expect(nav.locator('button[aria-expanded="false"]'), "every nav group should be open").toHaveCount(0);

    const hrefs = await nav.locator('a[href^="/"]').evaluateAll((anchors) =>
      anchors.map((anchor) => (anchor as HTMLAnchorElement).getAttribute("href") ?? ""),
    );
    const destinations = [...new Set(hrefs)].filter((href) => href.length > 1);
    // A nav with a handful of links is a nav that lost its groups; the
    // sidebar carries thirty-odd destinations for an owner.
    expect(destinations.length, "the main nav should offer a real set of destinations").toBeGreaterThanOrEqual(20);

    const broken: string[] = [];
    for (const href of destinations) {
      await page.goto(href);
      try {
        await expectHealthy(page, `nav destination ${href}`, { monitor });
      } catch (error) {
        broken.push(`${href}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      }
    }
    expect(broken, `${broken.length} of ${destinations.length} nav destinations failed the health check`).toEqual([]);
  });

  test("11. the browser threw nothing, anywhere along the way", async () => {
    // Real crashes already failed the step they happened on. This is the
    // hydration-mismatch half — see HealthMonitor.hydrationMismatches for
    // why it is asserted here, at the end, rather than mid-spine: it fired
    // on /jobs/<id>/billing in one run and /jobs/<id>/retainage in the
    // next, and aborting the journey there hid the steps that matter most.
    // It still fails the run; it just fails it after the spine has spoken.
    expect(
      monitor.hydrationMismatches,
      "the server's HTML and the browser's first render disagreed on these pages — a real defect, likely something rendered from \"now\" (CLAUDE.md, Dates)",
    ).toEqual([]);
    expect(monitor.crashes).toEqual([]);
  });
});
