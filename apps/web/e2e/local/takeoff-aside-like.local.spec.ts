import path from "node:path";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";

/**
 * ── A RENOVATION SHEET'S EXISTING WALLS, FROM THE REVIEW QUEUE, IN ONE STEP (Bluetooth AI101) ──
 *
 * No rule can clean a renovation sheet automatically, so the queue offers the manual step on
 * a sheet whose words say it shows existing work: "Set aside all walls drawn like this one". The
 * person picks one existing wall, the preview says how many walls and feet on the sheet are drawn
 * like it, Enter sets them aside, and one Undo puts them back. AI101's first pick, from the press
 * measurement (`realplan/setAsideLike.eval.ts`): the longest run the key rejects, (0.3882, 0.1825).
 *
 * SKIPS unless REAL_PLAN_DIR holds the Bluetooth set, and the runner was started with
 * TAKEOFF_LOCAL_PLAN_DIR = REAL_PLAN_DIR, ALLOW_LOCAL_PLANS=1 and HOSTNAME=localhost.
 * One stand-in, named: the plan row is written with a `local:` file instead of an upload.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = "Bluetooth-office-TI-Kirkland-WA.pdf";
const PICK = { x: 0.3882, y: 0.1825 };

test.describe.configure({ mode: "serial" });

test.describe("set aside all walls drawn like this one, from the queue (Bluetooth AI101)", () => {
  test.skip(DIR === "" || !existsSync(path.join(DIR, SET)), "REAL_PLAN_DIR does not hold the Bluetooth set");
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let planId = "";
  let companyId = "";
  let aiWas = true;
  let whole = NaN;
  let previewFeet = NaN;

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
    monitor = new HealthMonitor(page);
  });
  test.afterAll(async () => {
    if (companyId !== "") await prisma.companyAiSettings.update({ where: { companyId }, data: { aiEnabled: aiWas } }).catch(() => {});
    await page?.context().close();
  });

  const hook = (name: string) => page.locator(`[data-takeoff="${name}"]`);
  const num = (s: string) => Number(s.replace(/,/g, ""));
  const wallFeet = async () => num(((await hook("wall-total").innerText()).match(/([\d,]+) ft/) ?? [])[1] ?? "NaN");
  /** The total once it stops moving: the stored groups take over from the first render. */
  async function settled(): Promise<number> {
    let last = NaN;
    await expect.poll(async () => { const now = await wallFeet(); const same = now === last; last = now; return same; }, { intervals: [1_000], timeout: 60_000 }).toBe(true);
    return last;
  }
  const exclusions = () => prisma.takeoffSheetExclusion.count({ where: { kind: "EXCLUDE_LIKE", page: { planId, pageNumber: 6 } } });
  async function at(x: number, y: number) {
    const box = (await page.locator('[data-testid="takeoff-plan-port"] svg').first().boundingBox())!;
    return { x: box.x + x * box.width, y: box.y + y * box.width };
  }

  test("1. AI101 scaled (its 1/8\" snap) and its walls on the job", async () => {
    test.setTimeout(900_000);
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Set aside like — Bluetooth", gcName: "ZZ-E2E Set aside GC" });
    await finishWizard(page, monitor, jobId);
    ({ companyId } = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { companyId: true } }));
    aiWas = (await prisma.companyAiSettings.findUnique({ where: { companyId }, select: { aiEnabled: true } }))?.aiEnabled ?? true;
    await prisma.companyAiSettings.upsert({ where: { companyId }, create: { companyId, aiEnabled: false }, update: { aiEnabled: false } });
    ({ id: planId } = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: `local:${SET}`, fileName: SET, revisionLabel: "Bid set" }, select: { id: true } }));
    await page.goto(`/jobs/${jobId}/takeoff`);
    await expect.poll(async () => (await prisma.planIngestJob.findFirst({ where: { planId, stage: "PAGE_INVENTORY" }, select: { finishedAt: true } }))?.finishedAt != null, { timeout: 600_000, intervals: [5_000] }).toBe(true);
    await page.goto(`/jobs/${jobId}/takeoff`);
    await page.locator('[data-takeoff="plan-set-fix"][data-page="6"] [data-takeoff="plan-set-snap"]').click({ timeout: 60_000 });
    await expect(page.locator('[data-takeoff="plan-set-message"]')).toHaveText(/^1 scale confirmed/, { timeout: 60_000 });
    await page.goto(`/takeoff/${jobId}?page=6`);
    await expect(hook("find-walls")).toBeEnabled({ timeout: 180_000 });
    // The walls the scale stored, onto the job.
    await expect.poll(async () => prisma.takeoffWallProposal.count({ where: { page: { planId, pageNumber: 6 } } }), { timeout: 240_000, intervals: [3_000] }).toBeGreaterThan(0);
    await hook("find-walls").click();
    await expect(hook("wall-total")).toBeVisible({ timeout: 180_000 });
    await expect.poll(async () => prisma.takeoffMeasurement.count({ where: { kind: "LINEAR", source: "DETECTED", page: { planId, pageNumber: 6 } } }), { timeout: 120_000 }).toBeGreaterThan(0);
    whole = await settled();
    expect(whole).toBeGreaterThan(0);
  });

  test("2. the queue offers it first on the renovation sheet", async () => {
    test.setTimeout(180_000);
    await hook("review-queue-open").click();
    const item = hook("review-queue-existing");
    await expect(item).toBeVisible({ timeout: 60_000 });
    await expect(item).toHaveAttribute("data-page", "6");
    await expect(item).toContainText("AI101 shows existing work");
  });

  test("3. pick one existing wall: the preview says how many walls and feet are drawn like it", async () => {
    test.setTimeout(240_000);
    // The sheet drawn, so there is a wall to click (a fresh canvas is 0 wide until it is, #1119).
    await expect.poll(async () => page.locator('[data-testid="takeoff-plan-port"] canvas').first().evaluate((n) => (n as HTMLCanvasElement).width).catch(() => 0), { timeout: 180_000 }).toBeGreaterThan(0);
    whole = await settled();
    await hook("review-queue-aside-like").click();
    await expect(hook("aside-like-pick")).toBeVisible({ timeout: 30_000 });
    const p = await at(PICK.x, PICK.y);
    await page.mouse.click(p.x, p.y);
    const preview = hook("aside-like-preview");
    await expect(preview).toBeVisible({ timeout: 60_000 });
    const m = (await preview.innerText()).match(/^(\d+) walls?, ([\d,]+) ft drawn like this one\. Enter sets them aside/);
    expect(m, `the preview: "${await preview.innerText()}"`).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(1);
    previewFeet = num(m![2]!);
    console.log(`[aside] AI101: ${whole} ft before; preview "${await preview.innerText()}"`);
    expect(await exclusions(), "nothing set aside before Enter").toBe(0);
    expect(await wallFeet(), "the total does not move on the preview").toBe(whole);
  });

  test("4. Enter sets them aside: the total falls by the previewed feet, and the queue moves on", async () => {
    await page.keyboard.press("Enter");
    await expect(hook("aside-like-done")).toContainText(`ft drawn like the one you picked`, { timeout: 30_000 });
    await expect.poll(wallFeet).toBeLessThan(whole);
    expect(Math.abs(whole - (await wallFeet()) - previewFeet), `${whole} − ${await wallFeet()} against the preview's ${previewFeet}`).toBeLessThanOrEqual(2);
    await expect.poll(exclusions).toBe(1);
    await expect(hook("review-queue-existing")).toHaveCount(0);
  });

  test("5. one Undo puts them all back", async () => {
    await hook("undo").click();
    await expect.poll(wallFeet).toBe(whole);
    await expect.poll(exclusions).toBe(0);
  });
});
