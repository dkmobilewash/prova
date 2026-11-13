import { WalkClock } from "../lib/walkClock";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { deleteThrowaway, throwawayEmail } from "../lib/throwawayUsers.mjs";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/backend";
import { prisma } from "@prova/db";
import { CRASH_MARKERS, HealthMonitor, MIN_VISIBLE_CHARS } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { openItems } from "../lib/finders";

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
/**
 * WALK_NO_AI=1: the customer runs without plan reading — the owner turns AI off
 * under Settings → Assistant before the first set, so the walk uses the trade's
 * preset types and the sheets' printed scales, and never waits on a model.
 * WALK_RENO=1: a renovation set — the walk records and takes the suggested
 * demolition pairing, and what is set aside as existing, on the way.
 */
const NO_AI = process.env.WALK_NO_AI === "1";
const RENO = process.env.WALK_RENO === "1";
// "Doors and frames" at the trade pick (FRAMES or DOORS_AND_FRAMES; unset leaves the default, by others).
// With it, the walk also types its crew's rate and door rates on Wall types, so the door labor is priced.
const DOORS = process.env.WALK_DOORS ?? "";
const DOOR_RATES = { crewRatePerHr: "85", doorFramesPerHr: "2", doorsPerHr: "1.5", windowFramesPerHr: "3" };
/**
 * WALK_KNOWN_PRICES=1: a company that already holds the four costs the walk would type into the
 * queue, written in before the job as earlier work would have left them (not counted as presses):
 * studs and track on an imported supplier list in the supplier's words, board and hang-and-finish
 * in the price book under the part's own words. Same costs, so the same total.
 */
const KNOWN_PRICES = process.env.WALK_KNOWN_PRICES === "1";
/**
 * WALK_PLAN_COMPARE=1: the owner turns on "Compare renovation sheets with their demolition plan" (no model).
 * WALK_PLAN_COMPARE=0: the owner turns it OFF (it is on for a new company, #1087) — the set nobody compared,
 * which the bid check's existing-walls check is for.
 */
const PLAN_COMPARE = process.env.WALK_PLAN_COMPARE === "1" || process.env.WALK_PLAN_COMPARE === "0";
const COMPARE_ON = process.env.WALK_PLAN_COMPARE !== "0";
const SIZE = { width: 1440, height: 900 };
const EMAIL = throwawayEmail("walk");
// Pass or fail: the dev Clerk instance caps at 100 users (e2e/lib/throwawayUsers.mjs).
test.afterAll(async () => { await deleteThrowaway(EMAIL); });

/** `seconds` is what a person spends (`WalkClock`); `wallSeconds` includes the walk waiting for itself. */
type Row = { step: string; seconds: number; wallSeconds: number; walkSeconds: number; actions: number; url: string; notes: string[]; shots: string[] };
const clock = new WalkClock();
const rows: Row[] = [];
let current: Row | null = null;
let started = 0;
let shotN = 0;
let page: Page;
let jobId = "";
let companyId = "";

/**
 * A Clerk test number (201-555-0100…0199, code 424242) nobody on the
 * development instance holds yet. They stay taken once used, and after a
 * "taken" refusal Clerk keeps the box disabled, so the number is checked
 * against the instance BEFORE it is typed rather than retried on the form.
 */
async function freeTestPhone(): Promise<string> {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY ?? "" });
  const candidates = Array.from({ length: 99 }, (_, i) => `20155501${String(i + 1).padStart(2, "0")}`).sort(() => Math.random() - 0.5);
  for (const digits of candidates) {
    const { totalCount } = await clerk.users.getUserList({ phoneNumber: [`+1${digits}`] });
    if (totalCount === 0) return digits;
  }
  throw new Error("every Clerk test number 201-555-0100…0199 is taken on the development instance; delete some walk users");
}

test.describe.configure({ mode: "serial" });
// A click on something that never becomes clickable (a button inside a closed list) waited forever
// and held the run to its 25-minute hard limit (USU ASPIRE). Bounded, it fails as that step's FAILED.
test.use({ actionTimeout: 60_000 });

/**
 * ── WHAT WENT WRONG ON SCREEN, RECORDED, NEVER THROWN ──
 * Every page and tab the walk opens is watched; after each step the walk notes, as "HEALTH: …", any
 * uncaught exception or console error since the last step, any page showing a crash or error banner
 * (`CRASH_MARKERS`), and any page that renders next to nothing. A robustness run reads these; a step
 * that cannot be finished records its error before the walk stops ("FAILED: …").
 */
const watched: { page: Page; monitor: HealthMonitor; crashes: number; console: number }[] = [];
function watch(on: Page): HealthMonitor {
  const monitor = new HealthMonitor(on);
  watched.push({ page: on, monitor, crashes: 0, console: 0 });
  return monitor;
}
async function health(): Promise<void> {
  for (const w of watched) {
    for (const crash of w.monitor.crashes.slice(w.crashes)) note(`HEALTH: uncaught exception ${crash.slice(0, 300)}`);
    for (const line of w.monitor.consoleErrors.slice(w.console)) if (!/Clerk|clerk|favicon|Download the React DevTools/.test(line)) note(`HEALTH: console error ${line.slice(0, 300)}`);
    w.crashes = w.monitor.crashes.length;
    w.console = w.monitor.consoleErrors.length;
    if (w.page.isClosed()) continue;
    const body = await w.page.locator("body").innerText({ timeout: 2000 }).catch(() => null);
    if (body === null) continue;
    const marker = CRASH_MARKERS.find((m) => body.includes(m));
    if (marker) note(`HEALTH: "${marker}" on ${w.page.url()}`);
    else if (body.replace(/\s+/g, " ").trim().length < MIN_VISIBLE_CHARS) note(`HEALTH: a blank page (${body.trim().length} characters) on ${w.page.url()}`);
  }
}

/** One timed step. `act` counts what a person does (a click, a field typed). */
async function step(name: string, body: () => Promise<void>): Promise<void> {
  current = { step: name, seconds: 0, wallSeconds: 0, walkSeconds: 0, actions: 0, url: "", notes: [], shots: [] };
  clock.reset();
  const t0 = Date.now();
  try {
    await body();
  } catch (error) {
    note(`FAILED: ${(error instanceof Error ? error.message : String(error)).split("\n").slice(0, 3).join(" ").slice(0, 400)}`);
    throw error;
  } finally {
    const wall = Date.now() - t0;
    current.seconds = clock.personSeconds(wall);
    current.wallSeconds = Math.round(wall / 100) / 10;
    current.walkSeconds = Math.round(clock.walk / 100) / 10;
    // After the clock is read: the health check is the walk's own looking, never a person's wait.
    await health().catch(() => {});
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
/** A look for something that may not be there: if it never shows, the wait was the walk's (`WalkClock`). */
async function seen(target: Locator, timeout = 5000): Promise<boolean> {
  return clock.look(() => target.first().waitFor({ state: "visible", timeout }).then(() => true, () => false), timeout);
}
/** A fixed wait nobody makes (a screenshot, a settle): off a step's seconds. */
async function pause(on: Page, ms: number): Promise<void> { await clock.pause((t) => on.waitForTimeout(t), ms); }
/** Work a person waits on (the sheets reading, a run going): on a step's seconds. */
async function workWait(on: Page, ms: number): Promise<void> { await on.waitForTimeout(ms); }
async function hydrated(on: Page, selector: string): Promise<void> {
  await expect
    .poll(() => on.locator(selector).first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))).catch(() => false), { timeout: 60_000 })
    .toBe(true);
}
/** A thing's words; one that is not there costs the walk its wait, not the person (`WalkClock`). */
const text = async (target: Locator) => {
  const t0 = Date.now();
  const words = await target.first().innerText({ timeout: 5000 }).catch(() => null);
  if (words === null) clock.gaveUp(Date.now() - t0);
  return (words ?? "").replace(/\s+/g, " ").trim();
};
function flush(): void {
  const person = Math.round(rows.reduce((sum, r) => sum + r.seconds, 0) * 10) / 10;
  writeFileSync(path.join(OUT, "walk.json"), JSON.stringify({ email: EMAIL, jobId, total: (Date.now() - started) / 1000, personSeconds: person, rows }, null, 2));
}
const next = (on: Page) => on.locator("[data-job-next]");
async function states(on: Page): Promise<string> {
  return on.locator("[data-job-step]").evaluateAll((links) => links.map((a) => `${a.getAttribute("data-job-step")}:${a.getAttribute("data-state")}`).join(" ")).catch(() => "(no stepper)");
}

/** The wall-legend read (#1025): its run's progress and whether a proposal is stored. */
async function legendState(): Promise<string> {
  const run = await prisma.planIngestJob.findFirst({ where: { plan: { jobId }, stage: "WALL_LEGEND" }, orderBy: { createdAt: "desc" }, select: { pageCount: true, finishedAt: true, _count: { select: { tasks: { where: { finishedAt: { not: null } } } } } } });
  const proposals = await prisma.planLegendProposal.count({ where: { plan: { jobId } } });
  return `${run ? `run ${run._count.tasks}/${run.pageCount}${run.finishedAt ? " done" : ""}` : "no run queued"}, ${proposals} proposal(s), ${Math.round((Date.now() - started) / 1000)} s after sign-up`;
}

/**
 * The bid check on the Send step (`bidCheck.ts`): every check's state, words and fix link, and
 * the count beside Create signing link. With WALK_GROSS_SF it follows the floor-area check's own
 * link, types the building's area (read off the set's cover sheet by whoever runs the walk) and
 * comes back, so the wall-footage ratio is shown and the fix link is proved to land.
 */
const GROSS_SF = process.env.WALK_GROSS_SF ?? "";
async function readBidCheck(when: string): Promise<void> {
  const panel = page.locator('[data-bid-check=""]');
  if (!(await seen(panel, 20_000))) {
    stuck(`no bid check on the Send step (${when})`);
    return;
  }
  note(`Bid check ${when}: ${await text(panel.locator('[data-bid-check="summary"]'))} · beside Send: "${await text(page.locator('[data-bid-check="beside-send"]'))}"`);
  for (const item of await panel.locator("[data-bid-check-item]").all()) {
    const fix = item.locator("[data-bid-check-fix]");
    const href = (await fix.count()) > 0 ? ` → ${await fix.getAttribute("href")}` : "";
    note(`  ${await item.getAttribute("data-bid-check-item")} ${(await item.getAttribute("data-state"))!.toUpperCase()}: ${(await text(item)).slice(0, 500)}${href}`);
  }
  await panel.scrollIntoViewIfNeeded();
  await shot(`bid-check-${when}`);
}
async function bidCheck(): Promise<void> {
  await readBidCheck("on-arrival");
  const fix = page.locator('[data-bid-check-fix="quantities"]');
  if (GROSS_SF === "" || !/floor area/.test(await text(fix))) return;
  await fix.click();
  act();
  await hydrated(page, "#job-details button");
  const section = page.locator("#job-details");
  await section.getByRole("button", { name: "Edit details" }).click();
  act();
  await section.locator('input[name="grossAreaSqFt"]').fill(GROSS_SF);
  act();
  await section.getByRole("button", { name: /^Save/ }).first().click();
  act();
  await expect.poll(async () => (await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { grossAreaSqFt: true } })).grossAreaSqFt?.toString() ?? "", { timeout: 30_000 }).toBe(String(Number(GROSS_SF)));
  note(`Typed the building's floor area through the check's own link: ${GROSS_SF} SF`);
  await page.goto(`/jobs/${jobId}#contract-signature`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await readBidCheck("with-floor-area");
}

test.describe("a new customer, sign-up to a sendable estimate", () => {
  test.skip(DIR === "" || SET === "" || OUT === "", "WALK_PLAN_DIR, WALK_SET and WALK_OUT name the set and where the pictures go");
  test.setTimeout(3_600_000);

  test.beforeAll(async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    page = await (await browser.newContext({ viewport: SIZE })).newPage();
    watch(page);
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
        await phone.fill(await freeTestPhone());
        act();
        note("The sign-up form asks for a phone number.");
      }
      await page.getByRole("button", { name: /^Continue/ }).first().click();
      act();
      // Clerk's test numbers (555-0100…0199) stay taken in the development
      // instance; a collision is the harness's, so try another quietly.
      if (await seen(page.getByText(/phone number is taken/), 3000)) stuck("Clerk refused the test phone as taken after it was checked free");
      // The emailed code; Clerk's test addresses take 424242.
      const code = page.locator('input[autocomplete="one-time-code"], input[name="code"]').first();
      for (let round = 0; round < 2; round += 1) {
        if (!(await seen(code, 15_000))) break;
        await shot(`sign-up-code-${round + 1}`);
        await code.click();
        await page.keyboard.type("424242");
        act(2);
        await pause(page, 3000);
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
      // AI plan reading is on for a new company (2026-11-06), said with its cost
      // and an off switch; left on, so the legend is read and the queue suggests.
      const reading = page.locator('[data-setup="plan-reading"]');
      await expect(reading).toContainText(/title blocks and wall legends with AI; about \$\d+\.\d\d per plan set/);
      await expect(reading.getByRole("switch", { name: "AI plan reading" })).toHaveAttribute("aria-checked", "true");
      if (DOORS !== "") {
        await page.locator(`[data-setup="door-scope"] input[value="${DOORS}"]`).check();
        act();
        note(`Doors and frames at the trade pick: ${DOORS}.`);
      }
      await trades.getByRole("button", { name: /Framing and drywall/ }).click();
      act();
      await page.locator('[data-setup="skip-sample"]').click(); // the sample offer after the trade (#1120): not now
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
      if (DOORS !== "") {
        expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { doorScope: true } })).doorScope).toBe(DOORS);
        await page.goto("/wall-types");
        // The rates sit behind their own button on Wall types.
        await page.getByRole("button", { name: "Production rates", exact: true }).click();
        act();
        await expect(page.locator('[data-rates="crewRatePerHr"]')).toBeVisible({ timeout: 30_000 });
        await hydrated(page, '[data-rates="crewRatePerHr"]');
        for (const [name, value] of Object.entries(DOOR_RATES)) {
          await page.locator(`[data-rates="${name}"]`).fill(value);
          act();
        }
        await page.getByRole("button", { name: "Save rates" }).click();
        act();
        await expect.poll(async () => JSON.stringify((await prisma.companyBidDefaults.findUnique({ where: { companyId }, select: { productionRates: true } }))?.productionRates ?? {}), { timeout: 30_000 }).toContain('"windowFramesPerHr":3');
        note(`Production rates typed on Wall types: crew ${DOOR_RATES.crewRatePerHr} $/hr, ${DOOR_RATES.doorFramesPerHr} frames/hr, ${DOOR_RATES.doorsPerHr} doors/hr, ${DOOR_RATES.windowFramesPerHr} window frames/hr (the wall rates left blank).`);
        await page.goto("/dashboard");
      }
      const types = await prisma.wallType.count({ where: { companyId } });
      const templates = await prisma.estimateTemplate.count({ where: { companyId } });
      note(`The preset left ${types} wall types and ${templates} estimate template(s).`);
      if (KNOWN_PRICES) {
        const vendor = await prisma.vendor.create({ data: { companyId, name: "Northgate Supply" } });
        const listed = async (description: string, unit: string, cost: string) => {
          const entry = await prisma.lineItemCatalogEntry.create({ data: { companyId, description, unit, defaultBudgetedUnitCost: cost } });
          await prisma.vendorPriceQuote.create({ data: { companyId, vendorId: vendor.id, catalogEntryId: entry.id, description, unit, unitPrice: cost, quotedOn: new Date(), source: "PRICE_LIST" } });
        };
        await listed('3-5/8" 20ga steel stud', "EA", "4.10");
        await listed('3-5/8" 20ga track', "LF", "0.95");
        await prisma.lineItemCatalogEntry.create({ data: { companyId, description: "⅝″ Type X board, 4x8 sheets", unit: "sheet", defaultBudgetedUnitCost: "14.00" } });
        await prisma.lineItemCatalogEntry.create({ data: { companyId, description: "Hang, tape and finish ⅝″ board", unit: "sf", defaultBudgetedUnitCost: "1.10", costCategory: "LABOR" } });
        note("The company already holds: Northgate Supply's list (3-5/8\" 20ga stud $4.10 EA, track $0.95 LF); price book (⅝″ Type X board $14.00/sheet, hang and finish $1.10/sf labor).");
      }
    });

    // ── 3. CREATE THE JOB ──
    if (NO_AI) {
      await step("Turn plan reading off", async () => {
        await page.goto("/settings/assistant");
        act();
        const box = page.locator('input[name="aiEnabled"]');
        await hydrated(page, 'input[name="aiEnabled"]');
        await shot("ai-settings-before");
        if (await box.isChecked()) {
          await box.uncheck();
          act();
          await page.getByRole("button", { name: /Save AI settings/ }).click();
          act();
          await pause(page, 2000);
        }
        await page.reload();
        await hydrated(page, 'input[name="aiEnabled"]');
        if (await page.locator('input[name="aiEnabled"]').isChecked()) stuck("AI is still on after unticking Use AI and saving");
        await shot("ai-settings-off");
        note(`Settings → Assistant: "${(await text(page.locator("main").first())).replace(/\s+/g, " ").slice(0, 260)}"`);
      });
    }

    if (PLAN_COMPARE) {
      await step(`Turn plan comparison ${COMPARE_ON ? "on" : "off"}`, async () => {
        await page.goto("/settings?tab=estimating#plan-compare");
        act();
        const form = page.locator('[data-settings="plan-compare"]');
        await hydrated(page, '[data-settings="plan-compare"]');
        const box = form.locator('input[name="planCompareOn"]');
        if ((await box.isChecked()) !== COMPARE_ON) {
          await box.setChecked(COMPARE_ON);
          act();
          await form.getByRole("button", { name: "Save" }).click();
          act();
          await expect(form.getByText("Saved.")).toBeVisible({ timeout: 30_000 }).catch(() => stuck("plan comparison did not say Saved."));
        }
        await shot(`plan-compare-${COMPARE_ON ? "on" : "off"}`);
        note(`Settings → Estimating: "${(await text(form)).replace(/\s+/g, " ").slice(0, 300)}"`);
      });
    }

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
      // Named after the set, so a renovation walk on Green Bay does not read "Baker EOC" in every header.
      await page.locator('input[name="jobName"]').fill(SET.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").slice(0, 60));
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
      // "New job" carries ?then=plans since #1084: Start the job opens the job's Takeoff tab
      // directly. Without it the wizard's second step (`/items`) comes first.
      await page.waitForURL(/\/jobs\/(new\/[^/]+\/items|[^/]+\/takeoff)$/, { timeout: 30_000 });
      const landed = page.url().match(/\/jobs\/new\/([^/]+)\/items$/) ?? page.url().match(/\/jobs\/([^/]+)\/takeoff$/);
      jobId = landed![1]!;
      await shot("new-job-work");
      const toPlans = page.getByRole("link", { name: /plan|drawing|upload/i });
      if (/\/takeoff$/.test(page.url())) {
        note("Start the job opened the Takeoff tab, ready for the plans.");
      } else if (await seen(toPlans, 3000)) {
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
      // Before the pick started the upload, a separate "Add a drawing" press sent it.
      const addButton = page.getByRole("button", { name: "Add a drawing" });
      if ((await addButton.count()) > 0) {
        await addButton.click();
        act();
        note('"Add a drawing" pressed after picking the file.');
      } else note("The upload started on the pick.");
      await expect.poll(async () => prisma.takeoffPlan.count({ where: { jobId } }), { timeout: 60_000 }).toBe(1);
      await prisma.takeoffPlan.updateMany({ where: { jobId }, data: { fileUrl: `local:${SET}` } });
      pointed();
      await page.unroute("**/*");
      await pause(page, 2000);
      await shot("uploaded");
    });

    // ── 5. CONFIRM SCALES ──
    await step("Read the set and confirm scales", async () => {
      // The page inventory runs on its own; the plan-set section waits for it.
      const panel = page.locator('[data-plan-ingest="panel"]');
      if (await seen(panel, 30_000)) note(`Reading the set: "${(await text(panel)).slice(0, 200)}"`);
      const titles = page.getByRole("button", { name: /Read the title blocks/ });
      if (NO_AI) {
        // Without plan reading nothing reads the title blocks: record what the panel says instead of waiting on it.
        await pause(page, 5000);
        await shot("ingest-no-ai");
        note(`Plan reading off — the panel says: "${(await text(panel).catch(() => "")).replace(/\s+/g, " ").slice(0, 400)}"`);
        if (await titles.isVisible().catch(() => false)) note(`It still offers "${await text(titles)}" — pressing it would call a model, so left alone.`);
      } else if (await seen(titles, 900_000)) {
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
        if (NO_AI) break;
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
        await workWait(page, 3000);
      }
      const read = await prisma.planSheetProposal.count({ where: { plan: { jobId } } });
      note(`Title blocks: ${read} pages read in ${Math.round((Date.now() - t0) / 1000)} s on this page${pauses > 0 ? `, Keep reading pressed ${pauses} times` : ""}.`);
      await shot("ingest-title-blocks-done");
      note(`Legend: ${await legendState()}`);
      const confirm = page.locator('[data-takeoff="confirm-scales"]');
      await page.reload();
      const set = page.locator('[data-takeoff="plan-set"]');
      // No Confirm when the reader is sure of no sheet (Totem Lake, plan reading off): the
      // floor plans' own printed scales below are the whole step.
      await expect(confirm.or(set).first()).toBeVisible({ timeout: 60_000 });
      if (await seen(confirm, 3000)) await hydrated(page, '[data-takeoff="confirm-scales"]');
      else note("No Confirm scales: the reader is sure of no sheet, so only the floor plans' printed scales are asked.");
      await set.scrollIntoViewIfNeeded();
      await shot("plan-set-before");
      note(`Plan set: "${(await text(set)).slice(0, 500)}"`);
      note(`Stepper: ${await states(page)} · ${await text(next(page))}`);
      // Confirm covers the sheets the reader is sure of, and says the floor
      // plans need their own (#1000): read what it says, then take them.
      if ((await confirm.count()) > 0 && (await confirm.isEnabled())) {
        note(`Confirm says: "${await text(page.locator('[data-takeoff="plan-set-covers"]'))}"`);
        await confirm.click();
        act();
        await expect(page.locator('[data-takeoff="plan-set-message"]')).toBeVisible({ timeout: 60_000 }).catch(() => {});
      }
      await page.reload();
      await page.locator('[data-takeoff="plan-set"]').scrollIntoViewIfNeeded().catch(() => {});
      await shot("plan-set-after");
      note(`After confirming: "${await text(page.locator('[data-takeoff="plan-set-summary"]'))}"`);
      // The floor plans: one "Use the printed scale on all N" press, the list
      // of what it will scale, and Apply (#1000).
      const all = page.locator('[data-takeoff="plan-set-printed-all"]');
      if (await seen(all, 5000)) {
        await hydrated(page, '[data-takeoff="plan-set-printed-all"]');
        note(`Offered: "${await text(all)}"`);
        await all.click();
        act();
        const list = page.locator('[data-takeoff="plan-set-printed-list"]');
        await expect(list).toBeVisible({ timeout: 30_000 });
        await shot("plan-set-printed-list");
        note(`It lists: ${(await page.locator('[data-takeoff="plan-set-printed-sheet"]').allInnerTexts()).map((t) => t.replace(/\s+/g, " ")).join(" | ")}`);
        await page.locator('[data-takeoff="plan-set-printed-apply"]').click();
        act();
        await expect(page.locator('[data-takeoff="plan-set-look"]')).toBeHidden({ timeout: 60_000 }).catch(() => {});
      } else {
        // One floor plan, or none printed: each sheet's own button.
        // "Use the printed scale 1/8\"" or, when printed dimensions agree with it, "Use 1/8\" (from 18
        // dimensions)" (plan-set-snap): either is the one press a person makes (Bluetooth office TI).
        const fixes = page.locator('[data-takeoff="plan-set-fix"]').getByRole("button", { name: /^Use / });
        let pressed = 0;
        while ((await fixes.count()) > 0 && pressed < 12) {
          const before = await fixes.count();
          await fixes.first().click();
          act();
          pressed += 1;
          await expect.poll(() => fixes.count(), { timeout: 60_000 }).toBeLessThan(before).catch(() => {});
        }
        if (pressed > 0) note(`No "on all" button; ${pressed} sheet-by-sheet printed-scale presses.`);
      }
      await page.reload();
      await page.locator('[data-takeoff="plan-set"]').scrollIntoViewIfNeeded().catch(() => {});
      await shot("plan-set-printed-used");
      const summary = await text(page.locator('[data-takeoff="plan-set-summary"]'));
      note(`After the printed scales: "${summary}"`);
      const [, done, total] = summary.match(/(\d+) of (\d+) floor plans? scaled/) ?? [];
      if (done !== total) stuck(`floor plans still unscaled after the scales step: "${summary}"`);
      note(`Stepper: ${await states(page)} · ${await text(next(page))}`);
    });

    // ── 6. RUN TAKEOFF ──
    let tab!: Page;
    /** A101 in the workspace, every found group added from the sheet's group list. */
    async function typeGroupsOnA101(): Promise<number> {
      // What is left to a person: open the floor plan of the work in the
      // workspace and add each group. A100 is the overall plan of the same
      // floor, so the walk works A101.
      tab = await page.context().newPage();
      watch(tab);
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
      await pause(tab, 3000);
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
      note(`On A101: added ${added} groups by hand (${plain} as plain measurements, the rest to a starter type), ${await tab.locator('[data-takeoff="found-group"]').count()} left.`);
      await tab.close();
      return prisma.takeoffMeasurement.count({ where: { page: { plan: { jobId } } } });
    }
    await step("Run takeoff", async () => {
      const nextText = await text(next(page));
      if (!/Run the takeoff/.test(nextText)) stuck(`Next says "${nextText}", not Run the takeoff`);
      [tab] = await Promise.all([page.context().waitForEvent("page"), (/Run the takeoff/.test(nextText) ? next(page) : page.locator('[data-job-step="takeoff"]')).click()]);
      act();
      watch(tab);
      await tab.setViewportSize(SIZE);
      await expect(tab.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 120_000 });
      const run = tab.locator('[data-takeoff="find-walls"]');
      if (!(await expect(run).toBeEnabled({ timeout: 30_000 }).then(() => true, () => false))) {
        // Opened on a sheet with no scale: a person picks the floor plan.
        stuck(`the workspace opened on "${(await text(tab.locator("header").first())).slice(0, 80)}", where Run takeoff is off ("${await run.getAttribute("title")}"); picked A101`);
        await shot("workspace-opened-unscaled", tab);
        const picker = tab.locator('[data-takeoff="sheet-picker"]');
        const options = await picker.locator("option").evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent ?? "" })));
        await picker.selectOption(options.find((o) => /^A101\b/.test(o.t.trim()))?.v ?? "13");
        act(2);
      }
      await expect(run).toBeEnabled({ timeout: 300_000 });
      await shot("workspace", tab);
      if (RENO) {
        // ── THE SUGGESTED DEMOLITION PAIRING, TAKEN AS OFFERED ──
        const prior = tab.locator('[data-takeoff="prior-plan"]');
        if (await seen(prior, 20_000)) {
          note(`Demolition pairing on "${(await text(tab.locator("header").first())).slice(0, 60)}": "${(await text(prior)).replace(/\s+/g, " ").slice(0, 300)}"`);
          const accept = tab.locator('[data-takeoff="prior-plan-accept"]');
          if (await accept.isVisible().catch(() => false)) {
            await shot("demolition-suggested", tab);
            await accept.click();
            act();
            await pause(tab, 3000);
            note(`After taking the suggestion: "${(await text(prior)).replace(/\s+/g, " ").slice(0, 300)}"`);
          }
        } else {
          stuck("no demolition-plan pairing shown in the workspace before Run takeoff on a renovation set");
        }
        await shot("demolition-paired", tab);
      }
      note(`Run button: "${await text(run)}"`);
      await run.click();
      act();
      // The run is going: the person waits on it, so this is work, not the walk.
      await workWait(tab, 3000);
      await shot("takeoff-running", tab);
      await expect(run).toBeEnabled({ timeout: 1_800_000 });
      await expect(run).toHaveText(/^(Find the walls|Run takeoff)/, { timeout: 1_800_000 });
      await pause(tab, 2000);
      await shot("takeoff-done", tab);
      if (RENO) {
        // ── WHAT WAS SET ASIDE AS EXISTING, AND WHAT STILL ASKS ──
        const said = async (sel: string) => ((await tab.locator(sel).first().isVisible().catch(() => false)) ? (await text(tab.locator(sel).first())).replace(/\s+/g, " ").slice(0, 300) : null);
        const aside = (await said('[data-takeoff="existing-aside"]')) ?? (await said('[data-takeoff="prior-plan-aside"]'));
        const prompt = await said('[data-takeoff="renovation-prompt"]');
        // Where the pairing sits matters as much as what it says: on screen, or below every layer.
        const bar = tab.locator('[data-takeoff="prior-plan"]').first();
        if (await bar.isVisible().catch(() => false)) {
          const onScreen = await bar.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; });
          note(`Pairing after the run (${onScreen ? "on screen" : "below the fold — scroll the panel to see it"}): "${(await text(bar)).replace(/\s+/g, " ").slice(0, 300)}"`);
          if (!onScreen) stuck("the demolition pairing and what it set aside sit below the layer list, off screen");
        } else note("No pairing bar after the run.");
        note(`Existing walls: ${aside === null ? "nothing says any were set aside" : `"${aside}"`}${prompt === null ? "" : `; the sheet still asks: "${prompt}"`}`);
        if (aside === null && prompt !== null) stuck(`existing walls not set aside after Run takeoff on a renovation sheet; it asks the estimator to "${prompt.slice(0, 120)}"`);
        await shot("existing-aside", tab);
      }
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
          await workWait(page, 3000);
        }
        await pause(page, 2000);
        await page.locator('[data-takeoff="whole-set"]').scrollIntoViewIfNeeded().catch(() => {});
        await shot("whole-set-done");
        note(`Whole set: ${Math.round((Date.now() - t0) / 1000)} s. "${(await text(page.locator('[data-takeoff="whole-set"]'))).slice(0, 700)}"`);
        if (RENO) {
          const reno = page.locator('[data-takeoff="whole-set-renovation"]');
          if (await reno.isVisible().catch(() => false)) note(`Whole set, renovation: "${(await text(reno)).replace(/\s+/g, " ").slice(0, 400)}"`);
        }
        measured = await prisma.takeoffMeasurement.count({ where: { page: { plan: { jobId } } } });
      }
      if (measured === 0) {
        stuck("neither button put a wall on the job: the whole-set run skipped every sheet as \"already found\" (the workspace's Run takeoff had stored them as proposals)");
        measured = await typeGroupsOnA101();
      }
      const lines = await prisma.jobLineItem.count({ where: { jobId, isDeleted: false } });
      note(`After the takeoff: ${measured} measurements, ${lines} estimate lines.`);
    });

    /** The stepper's Review, opened from its Next, answered item by item until empty. */
    async function answerQueue(): Promise<void> {
      await page.goto(`/jobs/${jobId}`);
      note(`Stepper: ${await states(page)} · ${await text(next(page))}`);
      await shot("job-after-takeoff");
      const nextText = await text(next(page));
      if (/Review/.test(nextText)) {
        [tab] = await Promise.all([page.context().waitForEvent("page"), next(page).click()]);
        act();
        watch(tab);
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
      note(`Legend at the queue: ${await legendState()}`);
      /** What the queue pre-fills on each group row it shows: type, height, and where each came from. */
      const offered: string[] = [];
      await shot("review-queue", tab);
      const seenKinds: Record<string, number> = {};
      /** Presses by kind of item (walls, types, heights, windows, prices…), each press counted on its own. */
      const pressesBy: Record<string, number> = {};
      // Each round's wall and walk seconds, so a slow queue says which round and whose wait it was.
      const trace: string[] = [];
      let noTypes = false;
      for (let pass = 0; pass < 2; pass += 1) {
      if (pass === 1) {
        if (!noTypes) break;
        // What the item says to do: type the groups in the sheet's group list.
        await tab.close();
        note(`On A101's group list: ${await typeGroupsOnA101()} measurements on the job; back to the queue.`);
        noTypes = false;
        tab = await page.context().newPage();
        watch(tab);
        await tab.setViewportSize(SIZE);
        await tab.goto(`/takeoff/${jobId}?open=review`);
        act();
        await expect(tab.locator('[data-takeoff="review-queue"]')).toBeVisible({ timeout: 120_000 });
      }
      const queue = tab.locator('[data-takeoff="review-queue"]');
      const left = queue.locator('[data-takeoff="review-queue-left"]');
      const item = queue.locator('[data-takeoff="review-queue-item"]');
      let settled = 0;
      // A renovation sheet's "existing walls" question (#1135) is skipped once: setting walls aside
      // changes what is counted, and this walk measures presses on the same quantities. Skip only
      // moves the cursor, so once it is all that is left, the queue is done for this walk.
      const skippedExisting = new Set<string>();
      // Only when the count says it is the LAST item: the queue comes back round to a skipped existing-walls
      // question while other items wait (Baker: "24 left" with it first again), and that is not done.
      const skippedExistingShown = async () =>
        (await item.first().getAttribute("data-kind", { timeout: 500 }).catch(() => null)) === "existing" &&
        skippedExisting.has((await queue.locator('[data-takeoff="review-queue-existing"]').getAttribute("data-page", { timeout: 500 }).catch(() => null)) ?? "");
      const onlySkippedLeft = async () =>
        /^1 left\b/.test(await text(left).catch(() => "")) &&
        (await item.first().getAttribute("data-kind", { timeout: 500 }).catch(() => null)) === "existing" &&
        skippedExisting.has((await queue.locator('[data-takeoff="review-queue-existing"]').getAttribute("data-page", { timeout: 500 }).catch(() => null)) ?? "");
      let mark = { t: Date.now(), walk: clock.walk, what: "open" };
      const lap = (what: string) => {
        const wall = Date.now() - mark.t;
        const walk = clock.walk - mark.walk;
        if (wall > 2000) trace.push(`${mark.what} ${Math.round(wall / 100) / 10}s (walk ${Math.round(walk / 100) / 10}s)`);
        mark = { t: Date.now(), walk: clock.walk, what };
      };
      for (let round = 0; round < 400; round += 1) {
        lap(`round ${round}: ${(await item.first().getAttribute("data-kind", { timeout: 500 }).catch(() => null)) ?? "none"} · ${(await text(left).catch(() => "")).slice(0, 30)}`);
        // "Nothing left" can be said before the server has written the typed walls' lines, and
        // their price questions follow (Totem Lake: 4 arrived after it). So the queue is re-opened
        // up to twice, a few seconds apart; only an empty queue after that is done. Opening it is
        // not a press: the person is already looking at it.
        if (/Nothing left/.test(await text(left)) || !(await seen(item, 10_000)) || (await onlySkippedLeft())) {
          // One reload check is enough: questions written after "Nothing left" arrive on their own
          // (Totem Lake: 0.1 s), and a second reload only re-asked an empty queue.
          if (settled >= 1) break;
          if (settled === 0) {
            // ── DOES A PERSON SEE MORE ARRIVE, OR DOES ONLY A RELOAD FIND IT? ──
            // Looking at the queue that just said it was done, as a person would, with no reload.
            const t0 = Date.now();
            // Not the existing-walls question already skipped: only a question that was not there before.
            const fresh = async () => (await item.first().isVisible().catch(() => false)) && !(await onlySkippedLeft()) && !/Nothing left/.test(await text(left));
            const arrived = await clock.look(() => expect.poll(fresh, { timeout: 15_000 }).toBe(true).then(() => true, () => false), 15_000);
            if (arrived) {
              note(`${Math.round((Date.now() - t0) / 100) / 10} s after the queue said it was done, more questions arrived on their own (${await text(left)}).`);
              continue;
            }
          }
          settled += 1;
          // From here the walk is checking itself: a pause and a reload a person would not make.
          const t1 = Date.now();
          await pause(tab, 3000);
          await tab.goto(`/takeoff/${jobId}?open=review`);
          // An empty queue does not open on `?open=review`: 15 s, not the 120 s that cost Falafel 240 s.
          await expect(tab.locator('[data-takeoff="review-queue"]')).toBeVisible({ timeout: 15_000 }).catch(() => {});
          clock.gaveUp(Date.now() - t1 - 3000);
          if (await item.first().isVisible().catch(() => false) && !(await onlySkippedLeft()) && !/Nothing left/.test(await text(left))) {
            stuck(`questions only a reload showed, after the queue said it was done: ${await text(left)}`);
          }
          continue;
        }
        settled = 0;
        // The sheet's drawn suggestions in one press, as a person who knows the
        // way would: what it takes is in the summary, the rest stays here.
        const acceptAll = queue.locator('[data-takeoff="review-queue-accept-sheet"]');
        if ((await acceptAll.count()) > 0) {
          const said = await text(acceptAll);
          const summary = queue.locator('[data-takeoff="review-queue-accepted-text"]');
          if (seenKinds.acceptAll === undefined && seenKinds.undoChecked === undefined) {
            // Undo, checked once and not counted: press, see the summary, Undo,
            // and the same groups are offered again with the same count.
            seenKinds.undoChecked = 1;
            const leftBefore = await text(left);
            note(`Accept all offered with the row at "${await item.locator('[data-takeoff="queue-height"]').first().inputValue().catch(() => "?")}" (${await text(item.locator('[data-takeoff="queue-height-from"]'))})`);
            await shot("review-accept-offered", tab);
            await acceptAll.click();
            await expect(summary).toBeVisible({ timeout: 60_000 });
            const took = await text(summary);
            await shot("review-accept-all", tab);
            await queue.locator('[data-takeoff="review-queue-accepted-undo"]').click();
            await expect(acceptAll).toBeVisible({ timeout: 60_000 }).catch(() => {});
            await expect.poll(async () => text(left), { timeout: 30_000 }).toBe(leftBefore).catch(() => {});
            const back = await text(acceptAll);
            note(`Undo check (not counted): "${said}" took "${took}"; Undo → "${back}", queue "${await text(left)}" (was "${leftBefore}")`);
            if (back !== said) stuck(`after Undo, Accept all says "${back}", not "${said}"`);
            continue;
          }
          await acceptAll.click();
          act();
          await expect(summary).toBeVisible({ timeout: 60_000 });
          note(`${said} → "${await text(summary)}"`);
          seenKinds.acceptAll = (seenKinds.acceptAll ?? 0) + 1;
          continue;
        }
        // "W1 on the 2 other groups drawn like it": the type the person just gave, on the untagged
        // groups drawn alike (same fill, thickness within an inch). One press, as a person who
        // agrees would; it says what it covers before it is pressed.
        // "The rest of A2.1's untagged walls: N groups, F ft = which of your types?" (one per sheet):
        // the walk's usual first type, then apply — two presses for every group nothing names.
        // "Tag 2A (3 groups, 96 ft) = which of your types?" (once per printed tag, across the set, before
        // the rest). The walk cannot know the real type, so it takes its usual first type: two presses a tag.
        const tagQ = queue.locator('[data-takeoff="review-queue-tag"]');
        if ((await tagQ.count()) > 0 && (await tagQ.isVisible().catch(() => false))) {
          const said = await text(tagQ);
          const before = await text(left);
          await tagQ.locator('[data-takeoff="review-queue-tag-code"]').first().click();
          await tagQ.locator('[data-takeoff="review-queue-tag-apply"]').click();
          act(2);
          pressesBy.type = (pressesBy.type ?? 0) + 2;
          seenKinds.tag = (seenKinds.tag ?? 0) + 1;
          if (seenKinds.tag === 1) await shot("review-tag", tab);
          note(`Tag: "${said.slice(0, 160)}"`);
          await expect.poll(async () => text(left), { timeout: 30_000 }).not.toBe(before).catch(() => note("the count did not move after the tag question"));
          continue;
        }
        const rest = queue.locator('[data-takeoff="review-queue-rest"]');
        if ((await rest.count()) > 0 && (await rest.isVisible().catch(() => false))) {
          const said = await text(rest);
          const before = await text(left);
          await rest.locator('[data-takeoff="review-queue-rest-code"]').first().click();
          await rest.locator('[data-takeoff="review-queue-rest-apply"]').click();
          act(2);
          pressesBy.type = (pressesBy.type ?? 0) + 2;
          seenKinds.rest = (seenKinds.rest ?? 0) + 1;
          if (seenKinds.rest === 1) await shot("review-rest", tab);
          note(`Rest: "${said.slice(0, 200)}"`);
          await expect.poll(async () => text(left), { timeout: 30_000 }).not.toBe(before).catch(() => note("the count did not move after the rest question"));
          continue;
        }
        const alike = queue.locator('[data-takeoff="review-queue-alike-apply"]');
        if ((await alike.count()) > 0 && (await alike.isVisible().catch(() => false))) {
          const said = await text(alike);
          const before = await text(left);
          await alike.click();
          act();
          pressesBy.type = (pressesBy.type ?? 0) + 1;
          seenKinds.alike = (seenKinds.alike ?? 0) + 1;
          if (seenKinds.alike === 1) await shot("review-alike", tab);
          note(`Alike: "${said}"`);
          await expect.poll(async () => text(left), { timeout: 30_000 }).not.toBe(before).catch(() => (clock.gaveUp(30_000), note("the count did not move after the alike offer")));
          continue;
        }
        const kind = (await item.getAttribute("data-kind")) ?? "?";
        seenKinds[kind] = (seenKinds[kind] ?? 0) + 1;
        const pressedBefore = current?.actions ?? 0;
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
            noTypes = true;
            break;
          }
          await tab.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          offered.push(`${await text(row.locator('[data-takeoff="queue-type"]'))} @ ${(await row.locator('[data-takeoff="queue-height"]').inputValue()) || "—"} (${await text(row.locator('[data-takeoff="queue-type-from"]'))} / ${await text(row.locator('[data-takeoff="queue-height-from"]'))})`);
          if (kind === "type" && (await text(row.locator('[data-takeoff="queue-type"]'))) === "—") {
            await tab.keyboard.press("1");
            act();
          }
          // No height: the row's own key (T since #1005, H before) opens the
          // box; type one and Enter accepts both.
          if ((await row.locator('[data-takeoff="queue-height"]').inputValue()) === "") {
            const keys = await text(row.locator('[data-takeoff="queue-keys"]'));
            await tab.keyboard.press(/\bT height\b/.test(keys) ? "t" : "h");
            await tab.keyboard.type("10");
            act(2);
          }
          await tab.keyboard.press("Enter");
        } else if (kind === "doors") {
          // The sheet's found doors with no printed mark (one item per sheet): a person who agrees keeps them all.
          await item.locator('[data-takeoff="queue-doors-accept"]').click();
        } else if (kind === "windows") {
          // The windows counted on the sheet (#1024): a person who agrees confirms them all.
          await item.locator('[data-takeoff="queue-windows-accept"]').click();
        } else if (kind === "scale") {
          // "Use the printed scale on all N sheets" first: with it, the per-sheet list is closed and
          // its buttons cannot be pressed (the USU ASPIRE hang).
          const printed = item.locator('[data-takeoff="review-queue-scale-all"], [data-takeoff="review-queue-confirm-scale"]:visible, [data-takeoff="review-queue-printed"]:visible');
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
          // Typing the cost; the Price it press is the one every item counts below. (This said act(2),
          // which counted Price it twice: 3 presses a price where a person makes 2.)
          act();
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
          act(); // typing the price; Save is counted below with every item
          await expect.poll(async () => (await prisma.jobLineItem.findUnique({ where: { id: id! }, select: { unitPrice: true } }))?.unitPrice?.toString() ?? "", { timeout: 30_000 }).not.toBe("");
          await estimate.close();
          await tab.bringToFront();
          await tab.evaluate(() => window.dispatchEvent(new Event("focus")));
        } else if (kind === "existing" && (await skippedExistingShown())) {
          // Already skipped, and other items are waiting behind it: Next, as a person moves past it.
          await item.locator('[data-takeoff="review-queue-next"]').click();
        } else if (kind === "existing") {
          const pageOf = (await item.locator('[data-takeoff="review-queue-existing"]').getAttribute("data-page")) ?? "";
          skippedExisting.add(pageOf);
          await item.getByRole("button", { name: "Skip", exact: true }).click();
        } else {
          stuck(`an item of kind "${kind}" the walk does not know how to answer`);
          await item.locator('[data-takeoff="review-queue-next"]').click();
        }
        act();
        pressesBy[kind] = (pressesBy[kind] ?? 0) + (current?.actions ?? 0) - pressedBefore;
        await expect.poll(async () => text(left), { timeout: 30_000 }).not.toBe(before).catch(() => (clock.gaveUp(30_000), note(`the count did not move after answering a ${kind}`)));
      }
      }
      const legendNamed = offered.filter((o) => !/^— /.test(o)).length;
      const fifteen = offered.filter((o) => / @ 15'-0" /.test(o)).length;
      note(`Pre-filled on ${offered.length} group rows shown one by one: ${legendNamed} with a type, ${fifteen} at 15'-0". ${offered.join(" | ")}`);
      const typedItems = await prisma.takeoffItem.findMany({ where: { jobId, wallTypeId: { not: null } }, select: { name: true, heightFt: true } });
      note(`Typed items' stored heights: ${typedItems.map((i) => `${i.name} ${i.heightFt?.toString() ?? "none"} ft`).join(", ")}`);
      note(`Slow rounds: ${trace.length === 0 ? "none" : trace.join(" | ")}`);
      note(`Presses by kind: ${Object.entries(pressesBy).map(([k, n]) => `${k} ${n}`).join(", ")}`);
      note(`Answered: ${Object.entries(seenKinds).map(([k, n]) => `${n} ${k}`).join(", ")}. Queue ends: "${await text(tab.locator('[data-takeoff="review-queue-left"]'))}"`);
      await shot("review-done", tab);
    }

    // ── 7. THE REVIEW QUEUE ──
    await step("Review queue", answerQueue);

    // ── 8. THE ESTIMATE ──
    await step("Estimate", async () => {
      await page.goto(`/jobs/${jobId}`);
      note(`Stepper: ${await states(page)} · ${await text(next(page))}`);
      if (/Put the takeoff on the estimate/.test(await text(next(page)))) {
        // Typed walls are not lines until the item panel sends them.
        const [work] = await Promise.all([page.context().waitForEvent("page"), next(page).click()]);
        act();
        await work.setViewportSize(SIZE);
        await expect(work.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 120_000 });
        await openItems(work);
        await work.locator('[data-takeoff="pick-item"]').first().click();
        const send = work.locator('[data-takeoff="send-to-estimate"]');
        await expect(send).toBeVisible({ timeout: 30_000 });
        await shot("send-to-estimate", work);
        await send.click();
        act(3);
        await expect(work.locator('[data-takeoff="send-result"]')).toBeVisible({ timeout: 60_000 });
        note(`Send takeoff to the estimate: "${(await text(work.locator('[data-takeoff="send-result"]'))).slice(0, 300)}"`);
        await work.close();
        await page.goto(`/jobs/${jobId}`);
        note(`After sending: ${await states(page)} · ${await text(next(page))}`);
        if (/Review/.test(await text(next(page)))) await answerQueue();
        await page.goto(`/jobs/${jobId}`);
        note(`Stepper: ${await states(page)} · ${await text(next(page))}`);
      }
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
      const sources = await page.locator('[data-estimate="price-source"]').allTextContents();
      note(`Price sources shown: ${sources.length === 0 ? "none" : sources.join(" | ")}`);
      const doorsPosted = (await prisma.takeoffMeasurement.findMany({ where: { kind: "COUNT", item: { jobId, name: "Doors" } }, select: { xs: true } })).reduce((n, m) => n + m.xs.length, 0);
      const doorLines = await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false, OR: [{ description: { contains: "Doors" } }, { description: { contains: "Windows" } }] }, select: { description: true, quantity: true, unit: true, unitPrice: true } });
      const doorTotal = doorLines.reduce((n, l) => n + Number(l.quantity) * Number(l.unitPrice ?? 0), 0);
      const listed = doorLines.map((l) => `${l.description} ${Number(l.quantity)} ${l.unit} @ ${l.unitPrice ?? "-"}`).join(" | ");
      note(`Doors: ${doorsPosted} posted; ${doorLines.length} door and window lines, ${doorTotal.toFixed(2)} dollars${listed ? `: ${listed}` : ""}`);
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
      } else {
        // The proposal already carries the company's standard clauses: nothing to type.
        note(`Next says "${await text(next(page))}": the proposal starts with the standard inclusions and exclusions.`);
        // The GC's terms are still set on the proposal, as in a run where clauses were typed, so the
        // two runs measure the same proposal: one press to open it, as a person would.
        await page.goto(`/jobs/${jobId}/proposal`);
        act();
      }
      {
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
      await bidCheck();
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
      // What the GC gets: the signing link, opened signed out in their own
      // browser (#1006). The walk stops here — it reads, it does not sign.
      const token = (await prisma.signatureRequest.findFirstOrThrow({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { token: true } })).token;
      const shown = await text(page.getByText(new RegExp(`/esign/${token}`)));
      if (shown) note(`The job shows the link to send: ${shown}`);
      else stuck("the job does not show the signing link to share");
      const gc = await (await page.context().browser()!.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
      await gc.goto(`/esign/${token}`);
      const sign = gc.getByRole("button", { name: "Sign contract" });
      if (!(await seen(sign, 60_000))) stuck("the signing link opens no Sign contract");
      // Scope by wall type: every row says its height, its LF, and its SF
      // (walls with no type yet have no height to make an area from).
      const scopeRows = (await gc.locator('[data-proposal="scope-row"]').allInnerTexts()).map((r) => r.replace(/\s+/g, " ").trim());
      note(`Scope by wall type: ${scopeRows.join(" | ") || "NONE"}`);
      if (scopeRows.length === 0) stuck("the GC's page has no scope by wall type");
      for (const row of scopeRows) {
        const typed = !/no type yet/.test(row);
        if (!/[\d,]+ LF/.test(row)) stuck(`a scope row has no LF: "${row}"`);
        if (typed && !/[\d,]+ SF/.test(row)) stuck(`a typed scope row has no SF: "${row}"`);
        if (typed && !/\d+'-\d+"/.test(row)) stuck(`a typed scope row has no height: "${row}"`);
      }
      const terms = await text(gc.locator('[data-proposal="terms"]'));
      if (terms === "") stuck("the GC's page has no terms");
      else note(`Terms: ${terms}`);
      for (const [what, selector] of [["Inclusions", '[data-proposal="clauses-inclusion"]'], ["Exclusions", '[data-proposal="clauses-exclusion"]']] as const) {
        const found = await text(gc.locator(selector));
        if (found === "") stuck(`the GC's page has no ${what}`);
        else note(`${what}: ${found.slice(0, 200)}`);
      }
      const total = await text(gc.getByText(/^Total: /));
      note(`Price: ${total}`);
      if (/\$0\.00$/.test(total)) stuck("the GC's price is $0.00");
      await gc.screenshot({ path: path.join(OUT, "proposal-the-gc-gets.png"), fullPage: true });
      current?.shots.push("proposal-the-gc-gets.png");
      await gc.context().close();
      await page.goto(`/jobs/${jobId}`);
      note(`Stepper: ${await states(page)} · ${await text(next(page))}`);
      await shot("job-end");
    });
  });
});
