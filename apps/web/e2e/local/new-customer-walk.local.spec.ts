import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { prisma } from "@prova/db";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";

/**
 * ── ONE NEW CUSTOMER, SIGN-UP TO A SENDABLE ESTIMATE, TIMED ──
 *
 * Not a test of correctness: a stopwatch and a camera on the path a brand-new
 * framing/drywall sub takes with a real bid set. It follows the screen — the
 * stepper's one Next button wherever there is one — and writes STUCK where the
 * next move is not on the screen, then takes the known way round so the rest
 * of the path is still measured.
 *
 * SKIPS unless WALK_PLAN_DIR (holding WALK_SET) and WALK_OUT (OUTSIDE the
 * repository) are set. Run it against a server you started yourself with
 * ALLOW_LOCAL_PLANS=1, HOSTNAME=localhost and TAKEOFF_LOCAL_PLAN_DIR =
 * WALK_PLAN_DIR, on a fresh `_test` database, and E2E_PORT naming it — the
 * base config reuses a running server. Start it with the model key if the AI
 * steps should be real; the e2e runner blanks it on purpose.
 *
 * One stand-in, named: there is no blob store here, so the browser's upload is
 * answered by the stub and the plan row is pointed at the same file on disk
 * (`local:`) before the app's next action runs. Everything after the bytes is
 * the app's own.
 */
const DIR = process.env.WALK_PLAN_DIR ?? "";
const SET = process.env.WALK_SET ?? "";
const OUT = process.env.WALK_OUT ?? "";
const SIZE = { width: 1440, height: 900 };
const EMAIL = `walk-${Date.now()}+clerk_test@example.com`;

type Row = { step: string; seconds: number; actions: number; url: string; notes: string[]; shots: string[] };
const rows: Row[] = [];
let current: Row | null = null;
let started = 0;
let shotN = 0;
let page: Page;
let jobId = "";
let companyId = "";

test.describe.configure({ mode: "serial" });

/** One timed step. `act` counts what a person does (a click, a field typed). */
async function step(name: string, body: () => Promise<void>): Promise<void> {
  current = { step: name, seconds: 0, actions: 0, url: "", notes: [], shots: [] };
  const t0 = Date.now();
  try {
    await body();
  } finally {
    current.seconds = Math.round((Date.now() - t0) / 100) / 10;
    current.url = new URL(page.url()).pathname;
    rows.push(current);
    flush();
  }
}
const act = (n = 1) => {
  if (current) current.actions += n;
};
const note = (line: string) => {
  current?.notes.push(line);
  console.log(`[walk] ${current?.step}: ${line}`);
};
const stuck = (line: string) => note(`STUCK: ${line}`);
async function shot(name: string, on: Page = page): Promise<void> {
  shotN += 1;
  const file = `${String(shotN).padStart(2, "0")}-${name}.png`;
  await on.screenshot({ path: path.join(OUT, file) }).catch(() => {});
  current?.shots.push(file);
}
async function seen(target: Locator, timeout = 5000): Promise<boolean> {
  return target.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);
}
async function hydrated(on: Page, selector: string): Promise<void> {
  await expect
    .poll(() => on.locator(selector).first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))).catch(() => false), { timeout: 60_000 })
    .toBe(true);
}
const text = async (target: Locator) => ((await target.first().innerText({ timeout: 5000 }).catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
function flush(): void {
  writeFileSync(path.join(OUT, "walk.json"), JSON.stringify({ email: EMAIL, jobId, total: (Date.now() - started) / 1000, rows }, null, 2));
}
const stepper = (on: Page) => on.locator("[data-job-stepper]");
const next = (on: Page) => on.locator("[data-job-next]");
async function states(on: Page): Promise<string> {
  return on.locator("[data-job-step]").evaluateAll((links) => links.map((a) => `${a.getAttribute("data-job-step")}:${a.getAttribute("data-state")}`).join(" ")).catch(() => "(no stepper)");
}

test.describe("a new customer, sign-up to a sendable estimate", () => {
  test.skip(DIR === "" || SET === "" || OUT === "", "WALK_PLAN_DIR, WALK_SET and WALK_OUT name the set and where the pictures go");
  test.setTimeout(3_600_000);

  test.beforeAll(async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    page = await (await browser.newContext({ viewport: SIZE })).newPage();
    new HealthMonitor(page);
    started = Date.now();
  });
  test.afterAll(async () => {
    flush();
    await page?.context().close();
  });

  test("the walk", async () => {
    // ── 1. SIGN UP ──
    await step("Sign up", async () => {
      await setupClerkTestingToken({ page });
      await page.goto("/sign-up");
      await hydrated(page, 'input[name="emailAddress"]');
      await shot("sign-up");
      await page.locator('input[name="emailAddress"]').fill(EMAIL);
      act();
      const password = page.locator('input[name="password"]');
      if (await seen(password, 1000)) {
        await password.fill(`Walk-${Date.now()}-pw!`);
        act();
      }
      for (const [name, value] of [["firstName", "Dana"], ["lastName", "Walker"], ["username", `walk${Date.now()}`]] as const) {
        const box = page.locator(`input[name="${name}"]`);
        if (await seen(box, 300)) {
          await box.fill(value);
          act();
        }
      }
      const phone = page.locator('input[name="phoneNumber"]');
      if (await seen(phone, 300)) {
        await phone.fill(`20155501${String(1 + Math.floor(Math.random() * 99)).padStart(2, "0")}`);
        act();
        note("The sign-up form asks for a phone number.");
      }
      await page.getByRole("button", { name: /^Continue/ }).first().click();
      act();
      // Clerk's test numbers (555-0100…0199) stay taken in the development
      // instance; a collision is the harness's, so try another quietly.
      for (let retry = 0; retry < 10 && (await seen(page.getByText(/phone number is taken/), 3000)); retry += 1) {
        await phone.fill(`20155501${String(1 + Math.floor(Math.random() * 99)).padStart(2, "0")}`);
        await page.getByRole("button", { name: /^Continue/ }).first().click();
      }
      // The emailed code; Clerk's test addresses take 424242.
      const code = page.locator('input[autocomplete="one-time-code"], input[name="code"]').first();
      for (let round = 0; round < 2; round += 1) {
        if (!(await seen(code, 15_000))) break;
        await shot(`sign-up-code-${round + 1}`);
        await code.click();
        await page.keyboard.type("424242");
        act(2);
        await page.waitForTimeout(3000);
      }
      await page.waitForURL(/\/(welcome|dashboard)/, { timeout: 90_000 });
      // The dashboard sends a company that has not answered on to /welcome.
      await page.waitForURL(/\/welcome/, { timeout: 30_000 }).catch(() => {});
      note(`Lands on ${new URL(page.url()).pathname} after sign-up.`);
    });

    // ── 2. PICK THE TRADE ──
    await step("Pick the trade", async () => {
      if (!/\/welcome/.test(page.url())) {
        stuck("no welcome screen after sign-up, so no trade question");
        return;
      }
      const trades = page.locator('[data-setup="trades"]');
      await expect(trades).toBeVisible({ timeout: 30_000 });
      await hydrated(page, '[data-setup="trades"] button');
      await shot("welcome-trade");
      await trades.getByRole("button", { name: /Framing and drywall/ }).click();
      act();
      // The markup question, answered here: with the four rates set the review
      // queue asks each line's COST and prices it with the markup (#994), so
      // the price the GC sees carries it. Later would leave the queue asking
      // for sale prices and the markup out of the bid.
      const later = page.getByRole("button", { name: "Later" });
      await expect(later).toBeVisible({ timeout: 30_000 });
      await shot("welcome-markup");
      for (const [name, value] of [["materialMarkupPercent", "10"], ["laborMarkupPercent", "10"], ["overheadPercent", "8"], ["profitPercent", "10"]] as const) {
        await page.locator(`input[name="${name}"]`).fill(value);
        act();
      }
      await page.getByRole("button", { name: "Save", exact: true }).click();
      act();
      note("Markup set at signup: 10% material, 10% labor, 8% overhead, 10% profit.");
      const skip = page.getByRole("button", { name: "Skip for now" });
      if (await seen(skip, 15_000)) {
        await shot("welcome-questions");
        await skip.click();
        act();
      }
      await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
      const company = await prisma.user.findFirstOrThrow({ where: { email: EMAIL }, select: { companyId: true } });
      companyId = company.companyId;
      const types = await prisma.wallType.count({ where: { companyId } });
      const templates = await prisma.estimateTemplate.count({ where: { companyId } });
      note(`The preset left ${types} wall types and ${templates} estimate template(s).`);
    });

    // ── 3. CREATE THE JOB ──
    await step("Create the job", async () => {
      await shot("home");
      const start = page.getByRole("link", { name: /new job|start a job|add a job|first job|new bid|start a bid/i }).first();
      if (await seen(start, 5000)) {
        note(`Home's way in: "${await text(start)}".`);
        await start.click();
        act();
      } else {
        stuck("Home shows no link to start a job; went to /jobs/new");
        await page.goto("/jobs/new");
      }
      await page.waitForURL(/\/jobs\/new/, { timeout: 30_000 });
      await hydrated(page, 'input[name="jobName"]');
      await shot("new-job");
      await page.locator('input[name="jobName"]').fill("Baker EOC");
      act();
      const addNew = page.getByRole("button", { name: "+ Add a new GC" });
      if (await seen(addNew, 2000)) {
        await addNew.click();
        act();
      }
      await page.locator('input[name="contactName"]').fill("Walker Builders");
      act();
      await page.getByRole("button", { name: /Start the job/ }).click();
      act();
      await page.waitForURL(/\/jobs\/new\/[^/]+\/items$/, { timeout: 30_000 });
      jobId = page.url().match(/\/jobs\/new\/([^/]+)\/items$/)![1]!;
      await shot("new-job-work");
      const toPlans = page.getByRole("link", { name: /plan|drawing|upload/i });
      if (await seen(toPlans, 3000)) {
        note(`Step 2 offers: "${await text(toPlans)}".`);
        await toPlans.first().click();
        act();
      } else {
        await page.getByRole("link", { name: /Done — open the job/ }).click();
        act();
        note("Step 2 has no plans link; Done opens the job.");
      }
      await page.waitForLoadState("networkidle").catch(() => {});
      await shot("after-create");
      note(`Stepper: ${await states(page)} · ${await text(next(page))}`);
    });

    // ── 4. UPLOAD BAKER ──
    await step("Upload the plans", async () => {
      if (!/\/takeoff/.test(page.url())) {
        if (await seen(next(page), 5000)) {
          note(`Follows "${await text(next(page))}".`);
          await next(page).click();
          act();
        } else {
          stuck("no Next button on the job; opened the Takeoff tab");
          await page.goto(`/jobs/${jobId}/takeoff`);
        }
      }
      await page.waitForURL(new RegExp(`/jobs/${jobId}/takeoff`), { timeout: 30_000 });
      await stubDocumentUpload(page);
      // Hold the app's NEXT server action until the stored plan points at the
      // file on disk, so the inventory reads Baker rather than the stub's URL.
      let pointed!: () => void;
      const ready = new Promise<void>((resolve) => (pointed = resolve));
      let actions = 0;
      await page.route("**/*", async (route) => {
        const request = route.request();
        if (request.method() === "POST" && request.headers()["next-action"]) {
          actions += 1;
          if (actions > 1) await ready;
        }
        // fallback, not continue: continue would skip the blob stub's handlers.
        await route.fallback();
      });
      await hydrated(page, 'input[type="file"]');
      await shot("upload");
      await page.locator('input[type="file"]').first().setInputFiles(path.join(DIR, SET));
      act(2);
      await page.getByRole("button", { name: "Add a drawing" }).click();
      act();
      await expect.poll(async () => prisma.takeoffPlan.count({ where: { jobId } }), { timeout: 60_000 }).toBe(1);
      await prisma.takeoffPlan.updateMany({ where: { jobId }, data: { fileUrl: `local:${SET}` } });
      pointed();
      await page.unroute("**/*");
      await page.waitForTimeout(2000);
      await shot("uploaded");
    });

    // ── 5. CONFIRM SCALES ──
    await step("Read the set and confirm scales", async () => {
      // The page inventory runs on its own; the plan-set section waits for it.
      const panel = page.locator('[data-plan-ingest="panel"]');
      if (await seen(panel, 30_000)) note(`Reading the set: "${(await text(panel)).slice(0, 200)}"`);
      const titles = page.getByRole("button", { name: /Read the title blocks/ });
      if (await seen(titles, 900_000)) {
        note(`Offered: "${await text(titles)}" — pressed, as a new user following the panel would.`);
        await shot("ingest-inventory-done");
        await titles.click();
        act();
      }
      // Stay on the page while it reads: the read is driven from this tab, and
      // a read left mid-way waits as "Paused" for Keep reading (or the nightly
      // run). A person here sees the panel count up.
      const t0 = Date.now();
      const keep = page.getByRole("button", { name: /Keep reading/ });
      let pauses = 0;
      for (;;) {
        const done = await prisma.planIngestJob.count({ where: { plan: { jobId }, stage: "TITLE_BLOCK", finishedAt: { not: null } } });
        if (done > 0) break;
        if (Date.now() - t0 > 1_200_000) {
          stuck("the title-block read had not finished after 20 minutes");
          break;
        }
        if (await keep.isVisible().catch(() => false)) {
          pauses += 1;
          await keep.click();
          act();
        }
        await page.waitForTimeout(3000);
      }
      const read = await prisma.planSheetProposal.count({ where: { plan: { jobId } } });
      note(`Title blocks: ${read} pages read in ${Math.round((Date.now() - t0) / 1000)} s on this page${pauses > 0 ? `, Keep reading pressed ${pauses} times` : ""}.`);
      await shot("ingest-title-blocks-done");
      const confirm = page.locator('[data-takeoff="confirm-scales"]');
      await page.reload();
      await expect(confirm).toBeVisible({ timeout: 60_000 });
      await hydrated(page, '[data-takeoff="confirm-scales"]');
      const set = page.locator('[data-takeoff="plan-set"]');
      await set.scrollIntoViewIfNeeded();
      await shot("plan-set-before");
      note(`Plan set: "${(await text(set)).slice(0, 500)}"`);
      note(`Stepper: ${await states(page)} · ${await text(next(page))}`);
      await confirm.click();
      act();
      await page.waitForTimeout(3000);
      await page.reload();
      await page.locator('[data-takeoff="plan-set"]').scrollIntoViewIfNeeded().catch(() => {});
      await shot("plan-set-after");
      note(`After confirming: "${(await text(page.locator('[data-takeoff="plan-set"]'))).slice(0, 300)}"`);
      // What a person does next while Next still says "Confirm the scales":
      // the floor plans that need a look, each with its printed-scale button.
      const fixes = page.locator('[data-takeoff="plan-set-fix"]').getByRole("button", { name: /Use the printed scale/ });
      let pressed = 0;
      while ((await fixes.count()) > 0 && pressed < 12) {
        const before = await fixes.count();
        await fixes.first().click();
        act();
        pressed += 1;
        await expect.poll(() => fixes.count(), { timeout: 60_000 }).toBeLessThan(before).catch(() => {});
      }
      if (pressed > 0) {
        stuck(`"Confirm 4 scales" scaled no floor plan; the floor plans each needed "Use the printed scale" (${pressed} presses)`);
        await page.reload();
        await page.locator('[data-takeoff="plan-set"]').scrollIntoViewIfNeeded().catch(() => {});
        await shot("plan-set-printed-used");
        note(`After the printed scales: "${(await text(page.locator('[data-takeoff="plan-set-summary"]'))).slice(0, 200)}"`);
      }
      note(`Stepper: ${await states(page)} · ${await text(next(page))}`);
    });

    // ── 6. RUN TAKEOFF ──
    let tab!: Page;
    await step("Run takeoff", async () => {
      const nextText = await text(next(page));
      if (!/Run the takeoff/.test(nextText)) stuck(`Next says "${nextText}", not Run the takeoff`);
      [tab] = await Promise.all([page.context().waitForEvent("page"), (/Run the takeoff/.test(nextText) ? next(page) : page.locator('[data-job-step="takeoff"]')).click()]);
      act();
      new HealthMonitor(tab);
      await tab.setViewportSize(SIZE);
      await expect(tab.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 120_000 });
      const run = tab.locator('[data-takeoff="find-walls"]');
      await expect(run).toBeEnabled({ timeout: 300_000 });
      await shot("workspace", tab);
      note(`Run button: "${await text(run)}"`);
      await run.click();
      act();
      await tab.waitForTimeout(3000);
      await shot("takeoff-running", tab);
      await expect(run).toBeEnabled({ timeout: 1_800_000 });
      await expect(run).toHaveText(/^(Find the walls|Run takeoff)/, { timeout: 1_800_000 });
      await tab.waitForTimeout(2000);
      await shot("takeoff-done", tab);
      const found = await text(tab.locator("body").getByText(/^Walls on this sheet/));
      const sheet = await text(tab.locator("header").first());
      let measured = await prisma.takeoffMeasurement.count({ where: { page: { plan: { jobId } } } });
      note(`Workspace Run takeoff, on "${sheet.slice(0, 60)}": ${found || "(no total)"}; ${measured} measurements on the job — each group still asks "What are these?" before Add these.`);
      if (measured === 0) {
        stuck("Run takeoff in the workspace proposes groups on ONE sheet (the one it opened on) and adds nothing to the job; the whole-set run that does is a different button on the job's Takeoff tab");
        // The way round a person finds: back on the tab, the whole-set panel.
        await tab.close();
        await page.goto(`/jobs/${jobId}/takeoff`);
        const everywhere = page.locator('[data-takeoff="find-walls-everywhere"]');
        await expect(everywhere).toBeVisible({ timeout: 60_000 });
        await hydrated(page, '[data-takeoff="find-walls-everywhere"]');
        await everywhere.scrollIntoViewIfNeeded();
        await shot("whole-set-before");
        note(`Takeoff tab offers: "${await text(everywhere)}"`);
        await everywhere.click();
        act();
        const t0 = Date.now();
        for (;;) {
          const done = await prisma.planIngestJob.count({ where: { plan: { jobId }, stage: "WALLS", finishedAt: { not: null } } });
          if (done > 0) break;
          if (Date.now() - t0 > 1_500_000) {
            stuck("the whole-set wall run had not finished after 25 minutes");
            break;
          }
          if (/Continue finding walls/.test(await text(everywhere)) && (await everywhere.isEnabled())) {
            await everywhere.click();
            act();
            note("Pressed Continue finding walls (the run had stopped asking).");
          }
          await page.waitForTimeout(3000);
        }
        await page.waitForTimeout(2000);
        await page.locator('[data-takeoff="whole-set"]').scrollIntoViewIfNeeded().catch(() => {});
        await shot("whole-set-done");
        note(`Whole set: ${Math.round((Date.now() - t0) / 1000)} s. "${(await text(page.locator('[data-takeoff="whole-set"]'))).slice(0, 700)}"`);
        measured = await prisma.takeoffMeasurement.count({ where: { page: { plan: { jobId } } } });
      }
      if (measured === 0) {
        stuck("neither button put a wall on the job: the whole-set run skipped every sheet as \"already found\" (the workspace's Run takeoff had stored them as proposals)");
        // What is left to a person: open the floor plan of the work in the
        // workspace and add each group. A100 is the overall plan of the same
        // floor, so the walk works A101.
        tab = await page.context().newPage();
        new HealthMonitor(tab);
        await tab.setViewportSize(SIZE);
        await tab.goto(`/takeoff/${jobId}`);
        act();
        const picker = tab.locator('[data-takeoff="sheet-picker"]');
        await expect(picker).toBeVisible({ timeout: 120_000 });
        const a101 = await picker.locator("option").evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent ?? "" })));
        const target = a101.find((o) => /^A101\b/.test(o.t.trim()))?.v ?? "13";
        await picker.selectOption(target);
        act();
        const port = tab.locator('[data-testid="takeoff-plan-port"]');
        await expect(port).toHaveAttribute("data-sheet-ready", "true", { timeout: 300_000 });
        await tab.waitForTimeout(3000);
        if (!(await seen(tab.locator('[data-takeoff="found-group"]'), 10_000))) {
          note("A101's found walls are not shown on opening it; pressed Run takeoff again on this sheet.");
          const run = tab.locator('[data-takeoff="find-walls"]');
          await expect(run).toBeEnabled({ timeout: 120_000 });
          await run.click();
          act();
          await expect(tab.locator('[data-takeoff="found-group"]').first()).toBeVisible({ timeout: 600_000 });
        }
        await shot("a101-groups", tab);
        let added = 0;
        let plain = 0;
        for (let round = 0; round < 40; round += 1) {
          const row = tab.locator('[data-takeoff="found-group"]').first();
          if ((await row.count()) === 0) break;
          const headline = (await text(row)).slice(0, 40);
          const chooser = row.locator('[data-takeoff="group-choice"]');
          if ((await chooser.count()) === 1) {
            const values = await chooser.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
            const firstType = values.find((v) => v !== "" && v !== "create" && v !== "plain");
            await chooser.selectOption(firstType ?? "plain");
            act();
            if (!firstType) plain += 1;
          }
          const height = row.locator('[data-takeoff="group-height"]');
          if ((await height.count()) === 1) {
            await height.fill("15");
            act();
          }
          const add = row.locator('[data-takeoff="add-group"]');
          if (!(await add.isEnabled())) {
            stuck(`Add these stayed disabled on: ${headline}`);
            break;
          }
          await add.click();
          act();
          const gone = await expect
            .poll(async () => !(await text(tab.locator('[data-takeoff="found-group"]').first())).startsWith(headline), { timeout: 20_000 })
            .toBe(true)
            .then(() => true, () => false);
          if (!gone) {
            stuck(`a group would not add: ${headline} — ${await text(tab.locator('[data-takeoff="find-error"]'))}`);
            break;
          }
          added += 1;
        }
        await shot("a101-added", tab);
        measured = await prisma.takeoffMeasurement.count({ where: { page: { plan: { jobId } } } });
        note(`On A101: added ${added} groups by hand (${plain} as plain measurements, the rest to a starter type), ${await tab.locator('[data-takeoff="found-group"]').count()} left.`);
        await tab.close();
      }
      const lines = await prisma.jobLineItem.count({ where: { jobId, isDeleted: false } });
      note(`After the takeoff: ${measured} measurements, ${lines} estimate lines.`);
    });

    // ── 7. THE REVIEW QUEUE ──
    await step("Review queue", async () => {
      await page.goto(`/jobs/${jobId}`);
      note(`Stepper: ${await states(page)} · ${await text(next(page))}`);
      await shot("job-after-takeoff");
      const nextText = await text(next(page));
      if (/Review/.test(nextText)) {
        [tab] = await Promise.all([page.context().waitForEvent("page"), next(page).click()]);
        act();
        new HealthMonitor(tab);
        await tab.setViewportSize(SIZE);
      } else {
        stuck(`after the takeoff, Next says "${nextText}", not Review`);
        tab = await page.context().newPage();
        await tab.setViewportSize(SIZE);
        await tab.goto(`/takeoff/${jobId}?open=review`);
      }
      const queue = tab.locator('[data-takeoff="review-queue"]');
      await expect(queue).toBeVisible({ timeout: 120_000 });
      const left = queue.locator('[data-takeoff="review-queue-left"]');
      note(`Queue opens: "${await text(left)}"`);
      await shot("review-queue", tab);
      const item = queue.locator('[data-takeoff="review-queue-item"]');
      const seenKinds: Record<string, number> = {};
      for (let round = 0; round < 400; round += 1) {
        if (/Nothing left/.test(await text(left))) break;
        if (!(await seen(item, 10_000))) break;
        const kind = (await item.getAttribute("data-kind")) ?? "?";
        seenKinds[kind] = (seenKinds[kind] ?? 0) + 1;
        const before = await text(left);
        if (seenKinds[kind] === 1) {
          await shot(`review-${kind}`, tab);
          note(`First ${kind}: "${(await text(item)).slice(0, 300)}"`);
        }
        if (kind === "wall") {
          const keep = item.locator('[data-takeoff="review-queue-keep"]');
          await ((await keep.count()) > 0 ? keep : item.getByRole("button", { name: /Keep|It is a wall|Yes/ })).first().click();
        } else if (kind === "type" || kind === "height") {
          // One row per group (#992): the suggested type and height pre-filled,
          // Enter accepts; with no suggestion, 1 picks the legend's first type.
          const row = item.locator('[data-takeoff="queue-group"]');
          if ((await row.count()) === 0) {
            stuck(`an untyped group offers no type to set: "${(await text(item)).slice(0, 200)}"`);
            await item.locator('[data-takeoff="review-queue-next"]').click();
            act();
            continue;
          }
          await tab.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          if (kind === "type" && (await text(row.locator('[data-takeoff="queue-type"]'))) === "—") {
            await tab.keyboard.press("1");
            act();
          }
          if (kind === "height" && (await row.locator('[data-takeoff="queue-height"]').inputValue()) === "") {
            await row.locator('[data-takeoff="queue-height"]').fill("10");
            act(2);
          }
          await tab.keyboard.press("Enter");
        } else if (kind === "scale") {
          const printed = item.locator('[data-takeoff="review-queue-confirm-scale"], [data-takeoff="review-queue-printed"]');
          if ((await printed.count()) === 0) {
            stuck(`a floor plan with no printed scale to take: "${(await text(item)).slice(0, 200)}"`);
            await item.locator('[data-takeoff="review-queue-next"]').click();
            act();
            continue;
          }
          await printed.first().click();
        } else if (kind === "price" && (await item.locator('[data-takeoff="review-queue-cost"]').count()) > 0) {
          // With markup set the queue asks the line's cost (#994). What a
          // framing sub pays, roughly, by what the line is.
          const costForm = item.locator('[data-takeoff="review-queue-cost"]');
          const said = (await text(item)).toLowerCase();
          const cost = /hang|tape|finish/.test(said) ? "1.10" : /stud/.test(said) ? "4.10" : /track|plate/.test(said) ? "0.95" : /sheet|board/.test(said) ? "14.00" : /insulation|batt/.test(said) ? "0.60" : "1.00";
          const picker = costForm.locator('[data-takeoff="review-queue-cost-category"]');
          if ((await picker.count()) > 0) {
            await picker.selectOption(/hang|tape|finish|install/.test(said) ? "LABOR" : "MATERIAL");
            act();
          }
          if (seenKinds.price === 1) await shot("review-cost", tab);
          await costForm.locator('[data-takeoff="review-queue-cost-input"]').fill(cost);
          await costForm.locator('[data-takeoff="review-queue-cost-save"]').click();
          act(2);
          if (seenKinds.price === 1) note(`First price from cost: ${await text(queue.locator('[data-takeoff="review-queue-priced"]'))}`);
        } else if (kind === "price") {
          // Pricing opens the estimate on that line, in another tab.
          const link = item.locator('[data-takeoff="review-queue-line"]');
          const [estimate] = await Promise.all([tab.context().waitForEvent("page"), link.click()]);
          act();
          const id = new URL(estimate.url()).searchParams.get("line");
          const line = estimate.locator(`details[id="line-${id}"]`);
          await expect(line.locator('input[name="unitPrice"]').first()).toBeVisible({ timeout: 60_000 });
          if (seenKinds.price === 1) await shot("review-price-line", estimate);
          await line.locator('input[name="unitPrice"]').first().fill("4.25");
          await line.getByRole("button", { name: "Save", exact: true }).click();
          act(2);
          await expect.poll(async () => (await prisma.jobLineItem.findUnique({ where: { id: id! }, select: { unitPrice: true } }))?.unitPrice?.toString() ?? "", { timeout: 30_000 }).not.toBe("");
          await estimate.close();
          await tab.bringToFront();
          await tab.evaluate(() => window.dispatchEvent(new Event("focus")));
        } else {
          stuck(`an item of kind "${kind}" the walk does not know how to answer`);
          await item.locator('[data-takeoff="review-queue-next"]').click();
        }
        act();
        await expect.poll(async () => text(left), { timeout: 30_000 }).not.toBe(before).catch(() => note(`the count did not move after answering a ${kind}`));
      }
      note(`Answered: ${Object.entries(seenKinds).map(([k, n]) => `${n} ${k}`).join(", ")}. Queue ends: "${await text(left)}"`);
      await shot("review-done", tab);
    });

    // ── 8. THE ESTIMATE ──
    await step("Estimate", async () => {
      await page.goto(`/jobs/${jobId}`);
      note(`Stepper: ${await states(page)} · ${await text(next(page))}`);
      await page.locator('[data-job-step="estimate"]').click();
      act();
      await page.waitForURL(new RegExp(`/jobs/${jobId}/estimate`));
      await page.waitForLoadState("networkidle").catch(() => {});
      await shot("estimate");
      await page.screenshot({ path: path.join(OUT, "estimate-full.png"), fullPage: true });
      const lines = await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false }, select: { description: true, quantity: true, unit: true, unitPrice: true } });
      note(`${lines.length} lines: ${lines.map((l) => `${l.description} ${l.quantity ?? ""} ${l.unit ?? ""} @ ${l.unitPrice ?? "—"}`).join(" | ").slice(0, 900)}`);
      const unpriced = lines.filter((l) => l.unitPrice === null).length;
      if (unpriced > 0) note(`${unpriced} lines still unpriced after the queue.`);
    });

    // ── 9. SET MARKUP ──
    await step("Set markup", async () => {
      const banner = page.locator("[data-estimate=set-markup]");
      if (!(await seen(banner, 10_000))) {
        note("No Set your markup banner: the markup was set at signup, so this step costs nothing.");
        await shot("estimate-markup-already-set");
        return;
      } else {
        await banner.getByRole("link").first().click();
        act();
      }
      await page.waitForURL(/\/settings/, { timeout: 30_000 });
      const form = page.locator("#bid-defaults");
      await expect(form).toBeVisible({ timeout: 30_000 });
      await hydrated(page, "#bid-defaults input");
      await form.scrollIntoViewIfNeeded();
      await shot("markup-form");
      for (const [name, value] of [["materialMarkupPercent", "10"], ["laborMarkupPercent", "10"], ["overheadPercent", "8"], ["profitPercent", "10"]] as const) {
        await form.locator(`input[name="${name}"]`).fill(value);
        act();
      }
      await form.getByRole("button", { name: /^Save/ }).first().click();
      act();
      await expect.poll(async () => (await prisma.companyBidDefaults.findUnique({ where: { companyId }, select: { profitPercent: true } }))?.profitPercent?.toString() ?? "", { timeout: 30_000 }).toBe("10");
      await shot("markup-saved");
      await page.goto(`/jobs/${jobId}/estimate`);
      note(`Banner gone: ${!(await seen(page.locator("[data-estimate=set-markup]"), 3000))}. Stepper: ${await states(page)} · ${await text(next(page))}`);
      await shot("estimate-after-markup");
    });

    // ── 10. SEND ──
    await step("Send", async () => {
      await page.goto(`/jobs/${jobId}`);
      if (/Add inclusions and exclusions/.test(await text(next(page)))) {
        note("Next asks for inclusions and exclusions before sending.");
        await next(page).click();
        act();
        await page.waitForURL(new RegExp(`/jobs/${jobId}/proposal`), { timeout: 30_000 });
        await shot("proposal-before-clauses");
        for (const [kind, words] of [
          ["INCLUSION", "Metal stud framing, Type X board, hang, tape and finish per the wall types listed"],
          ["EXCLUSION", "Fire caulking, insulation not listed, paint, and work on existing walls to remain"],
        ] as const) {
          const form = page.locator("form").filter({ has: page.locator('input[name="text"]') }).last();
          await hydrated(page, 'input[name="text"]');
          await form.locator('select[name="kind"]').selectOption(kind);
          await form.locator('input[name="text"]').fill(words);
          await form.getByRole("button", { name: "Add", exact: true }).click();
          act(3);
          await expect(page.getByText(words)).toBeVisible({ timeout: 30_000 });
        }
        // The GC added in the job wizard has no terms; the proposal says so.
        const missing = page.locator('[data-proposal="terms-missing"]');
        if (await seen(missing, 3000)) {
          note(`Proposal: "${await text(missing)}"`);
          await missing.getByRole("link").click();
          act();
          await page.waitForURL(/\/contacts\//, { timeout: 30_000 });
          await hydrated(page, 'input[name="paymentTermsDays"]');
          await page.locator('input[name="paymentTermsDays"]').fill("30");
          await page.locator('input[name="defaultRetainagePercent"]').fill("10");
          await page.getByRole("button", { name: "Save", exact: true }).first().click();
          act(3);
          const gcId = (await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { contactId: true } })).contactId;
          await expect.poll(async () => (await prisma.contact.findUniqueOrThrow({ where: { id: gcId }, select: { paymentTermsDays: true } })).paymentTermsDays, { timeout: 30_000 }).toBe(30);
          await shot("gc-terms-set");
        }
        await page.goto(`/jobs/${jobId}`);
      }
      const nextText = await text(next(page));
      if (!/Send/.test(nextText)) stuck(`Next says "${nextText}", not Send`);
      await (/Send/.test(nextText) ? next(page) : page.locator('[data-job-step="send"]')).click();
      act();
      await page.waitForLoadState("networkidle").catch(() => {});
      await shot("send-target");
      const create = page.getByRole("button", { name: /Create (a new )?signing link/ });
      if (!(await seen(create, 10_000))) {
        stuck(`no Create signing link where Send landed (${new URL(page.url()).pathname})`);
        return;
      }
      const form = create.locator("xpath=ancestor::form[1]");
      for (const [name, value] of [["signerName", "Pat Owner"], ["signerEmail", "pat+clerk_test@example.com"]] as const) {
        const box = form.locator(`input[name="${name}"]`);
        if ((await box.count()) > 0) {
          await box.fill(value);
          act();
        }
      }
      await create.click();
      act();
      const made = await expect.poll(async () => prisma.signatureRequest.count({ where: { jobId } }), { timeout: 30_000 }).toBeGreaterThan(0).then(() => true, () => false);
      await shot("sent");
      if (!made) stuck(`Create signing link made nothing: "${(await text(form)).slice(0, 300)}"`);
      // What the GC gets: the link, opened signed out in their own browser.
      const token = (await prisma.signatureRequest.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { token: true } })).token;
      const gc = await (await page.context().browser()!.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
      await gc.goto(`/esign/${token}`);
      await expect(gc.getByRole("button", { name: "Sign contract" })).toBeVisible({ timeout: 60_000 });
      const scopeRows = await gc.locator('[data-proposal="scope-row"]').allInnerTexts();
      note(`The GC's page — scope by wall type: ${scopeRows.map((r) => r.replace(/\s+/g, " ")).join(" | ") || "NONE"}`);
      for (const [what, selector] of [["Inclusions", '[data-proposal="clauses-inclusion"]'], ["Exclusions", '[data-proposal="clauses-exclusion"]'], ["Terms", '[data-proposal="terms"]']] as const) {
        const found = await text(gc.locator(selector));
        if (found === "") stuck(`the GC's page has no ${what}`);
        else note(`${what}: ${found.slice(0, 200)}`);
      }
      note(`Price: ${await text(gc.getByText(/^Total: /))}`);
      if (scopeRows.length === 0) stuck("the GC's page has no scope by wall type");
      await gc.screenshot({ path: path.join(OUT, "proposal-the-gc-gets.png"), fullPage: true });
      current?.shots.push("proposal-the-gc-gets.png");
      await gc.context().close();
      await page.goto(`/jobs/${jobId}`);
      note(`Stepper: ${await states(page)} · ${await text(next(page))}`);
      await shot("job-end");
    });
  });
});
