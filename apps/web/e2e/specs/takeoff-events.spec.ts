import path from "node:path";
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";

/**
 * ── TAKEOFF EVENTS FROM REAL PRESSES, AND THE PILOT'S JOB ROW ──
 *
 * A pilot (TAKEOFF's company) works the review queue of a seeded job by hand: picks
 * the type, types a height, accepts (ACCEPT + PICK + HEIGHT_EDIT on one group), passes
 * the next group with Next (SKIP), and makes the signing link (SEND). Then the
 * operator's owner (SALES) opens that pilot on /internal/pilots and reads the job's
 * row: 4 touches, 1 accepted, nothing auto-posted or changed, and minutes to send.
 */
test.describe.configure({ mode: "serial" });

const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
const JOB = `ZZ-E2E Events ${Date.now()}`;
// The starter W1, as review-queue.spec.ts gets it: a type of our own on this shared company hid
// the starter button from that spec and failed its setup.
const CODE = "W1";

test.describe("takeoff events on a pilot's job", () => {
  test.setTimeout(120_000);
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let companyName = "";

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    monitor = new HealthMonitor(page);
    const pdf = readFileSync(S02);
    await page.context().route("**/api/takeoff/plan/**", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("1. a job with two wall groups waiting in the queue", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await page.goto("/dashboard");
    const user = await prisma.user.findFirstOrThrow({ where: { email: PERSONAS.takeoff.email }, select: { companyId: true, company: { select: { name: true } } } });
    const companyId = user.companyId;
    companyName = user.company.name;
    const gc = await prisma.contact.create({ data: { companyId, name: `${JOB} GC` } });
    jobId = (await prisma.job.create({ data: { companyId, contactId: gc.id, name: JOB, status: "ESTIMATE" } })).id;
    const planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:none.pdf", fileName: "none.pdf" } })).id;
    if ((await prisma.wallType.count({ where: { companyId, code: CODE } })) === 0) {
      await page.goto("/wall-types");
      const start = page.getByRole("button", { name: /Start from the common trade assemblies/ });
      await expect.poll(async () => (await start.isVisible()) || (await prisma.wallType.count({ where: { companyId, code: CODE } })) === 1, { timeout: 30_000 }).toBe(true);
      if (await start.isVisible()) await start.click();
      await expect.poll(() => prisma.wallType.count({ where: { companyId, code: CODE } }), { timeout: 60_000 }).toBe(1);
    }
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 0, kind: "legend", value: { page: 1, title: "PARTITION TYPES", codes: [CODE], proposals: [], reason: "seeded", confidence: "HIGH" } } });
    const sheet = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "144" } });
    const untyped = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#888888" } });
    const groups = [
      { inches: 4.875, runs: [{ x1: 0.2, y1: 0.3, x2: 0.5, y2: 0.3 }, { x1: 0.5, y1: 0.3, x2: 0.5, y2: 0.45 }] },
      { inches: 6.5, runs: [{ x1: 0.2, y1: 0.7, x2: 0.6, y2: 0.7 }] },
    ];
    for (const g of groups) {
      await prisma.takeoffWallProposal.create({ data: { pageId: sheet.id, calibrationId: calibration.id, thicknessInches: g.inches, source: "REMAINDER", runs: g.runs.map((r) => ({ ...r, thicknessFeet: g.inches / 12 })) } });
      for (const r of g.runs) {
        await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [r.x1, r.x2], ys: [r.y1, r.y2], itemId: untyped.id, label: "wall, untyped" } });
      }
    }
  });

  test("2. pick, height and Enter on one group; Next on the other", async () => {
    await page.goto(`/takeoff/${jobId}?open=review`);
    const queue = page.locator('[data-takeoff="review-queue"]');
    await expect(queue).toBeVisible({ timeout: 60_000 });
    const group = queue.locator('[data-takeoff="queue-group"]').first();
    await expect(group).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => group.locator('[data-takeoff="queue-accept"]').evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
    await group.locator('[data-takeoff="queue-code"]', { hasText: CODE }).click();
    await group.locator('[data-takeoff="queue-height"]').fill("9");
    const saved = page.waitForResponse(async (r) => r.request().method() === "POST" && !!r.request().headers()["next-action"] && (await r.text().catch(() => "")).includes('"accepted":'), { timeout: 60_000 });
    await group.locator('[data-takeoff="queue-accept"]').click();
    expect(await (await saved).text()).toContain('"accepted":1');
    await expect.poll(() => prisma.takeoffEvent.count({ where: { jobId, kind: { in: ["ACCEPT", "PICK", "HEIGHT_EDIT"] } } }), { timeout: 30_000 }).toBe(3);
    await queue.locator('[data-takeoff="review-queue-next"]').click();
    await expect.poll(() => prisma.takeoffEvent.count({ where: { jobId, kind: "SKIP" } }), { timeout: 30_000 }).toBe(1);
    await expectHealthy(page, "the queue after the presses", { monitor, signedIn: false });
  });

  test("3. the signing link is the SEND", async () => {
    await page.goto(`/jobs/${jobId}#contract-signature`);
    await page.getByRole("button", { name: /Create signing link/ }).click();
    await expect(page.getByText(/\/esign\/[A-Za-z0-9_-]+/).first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => prisma.takeoffEvent.count({ where: { jobId, kind: "SEND" } }), { timeout: 30_000 }).toBe(1);
    const rows = await prisma.takeoffEvent.findMany({ where: { jobId }, select: { target: true, source: true, kind: true } });
    // One group's accept, pick and height share its target; nothing off the drawing is stored.
    const accept = rows.find((r) => r.kind === "ACCEPT")!;
    expect(rows.filter((r) => r.target === accept.target).map((r) => r.kind).sort()).toEqual(["ACCEPT", "HEIGHT_EDIT", "PICK"]);
    expect(accept.source).toBe("none");
    expect(accept.target).toMatch(/^[0-9a-f]{16}$/);
  });

  test("4. the operator reads the job's row on the pilot's page", async ({ browser }) => {
    const operator = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await signInAs(operator, PERSONAS.sales.email);
    await operator.goto("/internal/pilots");
    await operator.locator(`[data-pilots="row"][data-company="${companyName}"] [data-pilots="open"]`).click();
    await expectHealthy(operator, "the pilot's jobs", { monitor: new HealthMonitor(operator) });
    const row = operator.locator(`[data-pilot-jobs="row"][data-job="${JOB}"]`);
    await expect(row.locator('[data-pilot-jobs="touches"]')).toHaveText("4");
    await expect(row.locator('[data-pilot-jobs="accepted"]')).toHaveText("1");
    await expect(row.locator('[data-pilot-jobs="auto"]')).toHaveText("0");
    await expect(row.locator('[data-pilot-jobs="changed"]')).toHaveText("0");
    await expect(row.locator('[data-pilot-jobs="send"]')).toHaveText(/^\d+ min$/);
    await operator.context().close();
  });

  test("5. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
