import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { openFinders, openItems } from "../lib/finders";

/**
 * ── TODAY'S NEW-JOB PATH, WALKED AS A BRAND-NEW COMPANY ──
 *
 * Not a test of the app's correctness: a RECORD of what a new user meets.
 * Sign up → create a job → upload plans → set the scale → take off → review
 * → estimate → send. Every screen is screenshotted and logged with its URL,
 * heading and visible controls, and every place the next step is not on the
 * screen is written down as STUCK rather than failing the run, because the
 * point is to see the whole path, not the first wall it hits.
 *
 * Run: `pnpm test:e2e -- --real-plans new-job-walkthrough`. The persona is
 * NEW_JOB, which nothing seeds, so on the throwaway database its first
 * sign-in is a company with nothing in it. The drawing is S02, a committed
 * synthetic fixture — no client plan text.
 *
 * Output: e2e/artifacts/new-job-walkthrough/NN-*.png and steps.json, which
 * `coordination/new-job-walkthrough.md` is written from.
 */

const OUT = path.resolve(__dirname, "../artifacts/new-job-walkthrough");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const SIZE = { width: 1440, height: 900 };

type Step = { n: number; name: string; url: string; heading: string; controls: string[]; notes: string[] };
const steps: Step[] = [];
let page: Page;
let jobId = "";
let shot = 0;

/** What a person sees: the URL, the first heading, the controls, a picture. */
async function record(on: Page, name: string, notes: string[] = []): Promise<Step> {
  await on.waitForLoadState("networkidle").catch(() => {});
  shot += 1;
  const file = `${String(shot).padStart(2, "0")}-${name}.png`;
  await on.screenshot({ path: path.join(OUT, file), fullPage: false });
  const heading = (await on.locator("h1, h2").first().innerText().catch(() => "")).trim();
  const controls = await on.evaluate(() =>
    // The page's own controls: the app shell's top nav and side nav are on
    // every page and would bury them. The full-screen workspace has no shell,
    // so its top bar counts.
    Array.from(
      document.querySelectorAll(
        location.pathname.startsWith("/takeoff/") ? "header a, header button, main a, main button" : "main a, main button",
      ),
    )
      .filter((node) => {
        const box = (node as HTMLElement).getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
      .map((node) => ((node as HTMLElement).innerText || node.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "))
      .filter((text) => text.length > 0 && text.length < 80)
      .filter((text, i, all) => all.indexOf(text) === i)
      .slice(0, 30),
  );
  const step = { n: shot, name: file, url: new URL(on.url()).pathname, heading, controls, notes };
  steps.push(step);
  return step;
}
/** Does this come into view within `timeout`? Playwright's visibility check
 *  does not wait, so it answers too early to mean "a person would see it". */
async function seen(target: Locator, timeout = 4000): Promise<boolean> {
  return target.first().waitFor({ state: "visible", timeout }).then(
    () => true,
    () => false,
  );
}
/** Is a link or button with this name on screen within a few seconds? */
async function onScreen(on: Page, name: RegExp, timeout = 4000): Promise<boolean> {
  return seen(on.getByRole("link", { name }).or(on.getByRole("button", { name })), timeout);
}
/** React has attached its handlers: a click before that is a native submit. */
async function hydrated(on: Page, selector: string): Promise<void> {
  await expect
    .poll(() => on.locator(selector).first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))).catch(() => false), {
      timeout: 30_000,
    })
    .toBe(true);
}
/** The sheet is drawn and has stopped resizing, so a click on it lands where it is aimed. */
async function sheetDrawn(on: Page): Promise<void> {
  const port = on.locator('[data-testid="takeoff-plan-port"]');
  await expect.poll(() => port.locator("canvas").first().evaluate((n) => (n as HTMLCanvasElement).width).catch(() => 0), { timeout: 90_000 }).toBeGreaterThan(0);
  await expect(port).toHaveAttribute("data-sheet-ready", "true", { timeout: 90_000 });
  let last = -1;
  for (let steady = 0; steady < 3; ) {
    const width = (await port.locator("svg").first().boundingBox())?.width ?? -1;
    steady = Math.abs(width - last) < 0.5 ? steady + 1 : 0;
    last = width;
    await on.waitForTimeout(150);
  }
}

test.describe.configure({ mode: "serial", timeout: 300_000 });

test.beforeAll(async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({ viewport: SIZE });
  // The upload is stubbed (no blob store here), so the plan route has no real
  // file behind it: answer it with the same drawing that was "uploaded", as
  // takeoff-workspace.spec.ts does. Everything after the bytes is the app's.
  const pdf = readFileSync(S02);
  await context.route("**/api/takeoff/plan/**", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
  page = await context.newPage();
  new HealthMonitor(page);
});
test.afterAll(async () => {
  writeFileSync(path.join(OUT, "steps.json"), JSON.stringify({ jobId, steps }, null, 2));
  await page?.context().close();
});

test("1. sign up, and the first screen after it", async () => {
  await page.goto("/sign-up");
  await expect(page.locator("body")).toBeVisible();
  await page.waitForTimeout(1500);
  await record(page, "sign-up", ["The Clerk sign-up card. The walk signs in as a fresh persona instead of completing it."]);
  await signInAs(page, PERSONAS.newJob.email);
  await page.goto("/dashboard");
  await page.waitForTimeout(1000);
  await record(page, "first-screen", [/\/welcome/.test(page.url()) ? "A new company is sent to /welcome first." : "No welcome screen."]);
});

test("2. the welcome questions, then Home with nothing on it", async () => {
  if (/\/welcome/.test(page.url())) {
    const skip = page.getByRole("button", { name: "Skip for now" });
    const notes = [(await seen(skip)) ? "Skip for now is offered; the walk takes it." : "STUCK: no way past the welcome screen."];
    if (await seen(skip)) await skip.click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 }).catch(() => {});
    steps[steps.length - 1]!.notes.push(...notes);
  }
  const start = await onScreen(page, /new job|start a job|add a job|first job|new bid|start a bid/i);
  await record(page, "home-empty", [start ? "Home offers a way to start a job." : "STUCK: Home has no visible way to start a job."]);
});

test("3. create the job", async () => {
  const start = page.getByRole("link", { name: /new job|start a job|add a job|first job|new bid|start a bid/i }).first();
  if (await seen(start)) await start.click();
  else await page.goto("/jobs/new");
  await page.waitForURL(/\/jobs\/new/, { timeout: 30_000 });
  await record(page, "new-job-step-1");
  await page.locator('input[name="jobName"]').fill("ZZ Walkthrough — Bungalow");
  const addNew = page.getByRole("button", { name: "+ Add a new GC" });
  if (await seen(addNew, 2000)) await addNew.click();
  await page.locator('input[name="contactName"]').fill("ZZ Walkthrough GC");
  await page.getByRole("button", { name: /Start the job/ }).click();
  await page.waitForURL(/\/jobs\/new\/[^/]+\/items$/, { timeout: 30_000 });
  jobId = page.url().match(/\/jobs\/new\/([^/]+)\/items$/)![1]!;
  const plans = await onScreen(page, /plan|drawing|takeoff|upload/i, 2000);
  await record(page, "new-job-step-2", [plans ? "Step 2 mentions plans or takeoff." : "Step 2 is about typing line items; nothing here says plans can be uploaded or taken off."]);
  await page.getByRole("link", { name: /Done — open the job/ }).click();
  await page.waitForURL(new RegExp(`/jobs/${jobId}(\\?|$)`), { timeout: 30_000 });
  const toTakeoff = await onScreen(page, /takeoff|plans|drawing|upload/i, 3000);
  await record(page, "job-overview", [toTakeoff ? "The overview points at plans/takeoff somewhere." : "STUCK: the job overview does not say what to do next with plans."]);
});

test("4. upload the plans", async () => {
  await page.goto(`/jobs/${jobId}/takeoff`);
  await record(page, "takeoff-tab-empty");
  await stubDocumentUpload(page);
  await hydrated(page, 'input[type="file"]');
  await page.locator('input[type="file"]').first().setInputFiles(S02);
  const asked = await seen(page.getByRole("button", { name: "Which revision is this?" }), 60_000);
  await sheetDrawn(page).catch(() => {});
  await record(page, "plans-uploaded", [asked ? "After upload the tab asks which revision this is." : "STUCK: no sign the upload took after 60 s."]);
});

test("5. set the scale", async () => {
  const offer = page.locator('[data-takeoff="toolbar-scale-offer"]');
  const offered = await seen(offer, 10_000);
  await record(page, "scale-before", [
    offered ? `A printed-scale offer is shown: "${(await offer.innerText()).trim()}".` : "No printed scale offered; the user must find Set scale and click two points on a known dimension.",
  ]);
  if (offered) {
    await offer.click();
    const use = page.getByRole("button", { name: "Use the printed scale" });
    if (await seen(use, 5000)) await use.click();
    const save = page.getByRole("button", { name: "Set the scale" });
    if (await seen(save, 3000)) await save.click();
  } else {
    await hydrated(page, '[data-testid="takeoff-plan-port"]');
    await page.getByRole("button", { name: "Set scale", exact: true }).click();
    const overlay = page.locator('[data-testid="takeoff-plan-port"] svg').first();
    const box = (await overlay.boundingBox())!;
    await overlay.click({ position: { x: box.width * 0.2, y: box.width * 0.5 } });
    await overlay.click({ position: { x: box.width * 0.7, y: box.width * 0.5 } });
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Set the scale" }) });
    await form.locator('input[name="declaredDistanceFeet"]').fill("48");
    await form.locator('input[name="pageLabel"]').fill("sheet 1");
    await form.getByRole("button", { name: "Set the scale" }).click();
  }
  const set = await seen(page.getByText(/^Scale set/), 30_000);
  await record(page, "scale-set", [set ? "The tab says the scale is set." : "STUCK: no confirmation that the scale took."]);
});

test("6. take off: the full-screen workspace, Run takeoff", async () => {
  const open = page.locator('[data-takeoff="open-workspace"]');
  const [tab] = await Promise.all([page.context().waitForEvent("page"), open.click()]);
  await tab.waitForLoadState();
  await expect(tab.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 60_000 });
  await sheetDrawn(tab);
  await record(tab, "workspace-open", ["Opens in a new browser tab; the job tab stays behind it."]);
  const run = tab.locator('[data-takeoff="find-walls"]');
  await expect(run).toBeEnabled({ timeout: 60_000 });
  await run.click();
  await expect(run).toHaveText(/^(Find the walls|Run takeoff)$/, { timeout: 180_000 });
  await record(tab, "takeoff-found", ["Run takeoff fills the layer panel; each group asks 'What are these?' before it can be added to the job."]);

  const choice = tab.locator('[data-takeoff="group-choice"]').first();
  if (await seen(choice, 10_000)) {
    const options = await choice.locator("option").allInnerTexts();
    await choice.selectOption({ index: Math.max(1, options.findIndex((o) => /plain measurements/i.test(o))) });
  }
  await tab.locator('[data-takeoff="add-group"]').first().click();
  await tab.waitForTimeout(2500);
  await record(tab, "takeoff-group-added", ["A first group added. A new company has no wall types, so it goes on as plain (unpriced) measurements unless one is created."]);

  // REVIEW: what the finder menu offers once walls are found.
  await openFinders(tab);
  await record(tab, "review-menu", ["Review walls and Check these are walls live behind Run takeoff's arrow."]);
  await tab.keyboard.press("Escape");

  // ESTIMATE, from here: the item's Send to estimate.
  await openItems(tab);
  const pick = tab.locator('[data-takeoff="pick-item"]').first();
  let sent = false;
  if (await seen(pick, 10_000)) {
    await pick.click();
    const send = tab.locator('[data-takeoff="send-to-estimate"]');
    if (await seen(send, 10_000)) {
      await send.click();
      sent = await seen(tab.locator('[data-takeoff="send-result"]'), 30_000);
    }
  }
  await record(tab, "send-to-estimate", [sent ? "Send to estimate is on the picked item's panel, in the Items rail (closed by default)." : "STUCK: no Send to estimate found for the added group."]);
  await tab.close();
});

test("7. the estimate", async () => {
  await page.goto(`/jobs/${jobId}/estimate`);
  const lines = await page.locator("table tbody tr").count().catch(() => 0);
  await record(page, "estimate", [`${lines} table rows on the estimate after Send to estimate.`]);
});

test("8. send", async () => {
  await page.goto(`/jobs/${jobId}/proposal`);
  const send = await onScreen(page, /send|signature|sign/i, 5000);
  await record(page, "proposal", [send ? "The proposal page offers a send or signature control." : "STUCK: no visible way to send the proposal from here."]);
  await page.goto(`/jobs/${jobId}`);
  await record(page, "job-after", ["Where the job page leaves a new user after the whole path."]);
});
