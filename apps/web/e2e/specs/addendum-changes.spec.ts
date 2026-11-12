import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";

/**
 * ── WHAT THE REVISED SHEETS CHANGE ──
 *
 * An addendum's sheets uploaded as a second plan file: each matched to the sheet
 * it replaces by sheet number, and the takeoff's change by wall type in LF, SF
 * and $. Seeded: A101 issued twice (one wall kept, one gone, one new), A102
 * revised with no scale yet, A103 a new sheet. Then the GC's summary, Apply,
 * and Undo.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/addendum-changes");
const S02 = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");

test.describe("what an addendum's sheets change, by wall type", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";

  test.beforeAll(async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    const pdf = readFileSync(S02);
    await context.route("**/api/takeoff/plan/**", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("1. a priced takeoff on the bid set, and an addendum's sheets uploaded after it", async () => {
    test.setTimeout(90_000);
    await signInAs(page, PERSONAS.gcProposal.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Addendum changes", gcName: "ZZ-E2E Addendum GC" });
    await finishWizard(page, monitor, jobId);
    const { companyId } = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { companyId: true } });
    const cal = { x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" };

    const bid = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:bid.pdf", fileName: "ZZ-E2E bid set.pdf", createdAt: new Date(Date.now() - 86_400_000) } });
    const oldA101 = await prisma.takeoffPlanPage.create({ data: { planId: bid.id, pageNumber: 3, label: "A101", pageWidthPt: 2592 } });
    await prisma.takeoffPlanPage.create({ data: { planId: bid.id, pageNumber: 4, label: "A102", pageWidthPt: 2592 } });
    const oldCal = await prisma.takeoffScaleCalibration.create({ data: { pageId: oldA101.id, ...cal } });
    const type = await prisma.wallType.create({ data: { companyId, code: "ZAD1", name: "ZZ-E2E 6in stud", sides: 2, components: { create: [{ description: "studs", basis: "LINEAR_FT", factor: 1 }] } } });
    const item = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "ZAD1 walls", type: "LINEAR", colorHex: "#111111", wallTypeId: type.id, heightFt: "10", sides: 2 } });
    await prisma.takeoffMeasurement.create({ data: { pageId: oldA101.id, calibrationId: oldCal.id, kind: "LINEAR", source: "DETECTED", xs: [0.1, 0.4], ys: [0.2, 0.2], itemId: item.id } });
    await prisma.takeoffMeasurement.create({ data: { pageId: oldA101.id, calibrationId: oldCal.id, kind: "LINEAR", source: "DETECTED", xs: [0.1, 0.3], ys: [0.5, 0.5], itemId: item.id } });
    // 50 ft priced at $1,000: $20 a foot.
    await prisma.jobLineItem.create({ data: { jobId, takeoffItemId: item.id, description: "ZZ-E2E ZAD1 studs", quantity: "50", unit: "lin ft", unitPrice: "20" } });

    const addendum = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:add1.pdf", fileName: "ZZ-E2E add1.pdf", revisionLabel: "Addendum 1" } });
    const newA101 = await prisma.takeoffPlanPage.create({ data: { planId: addendum.id, pageNumber: 1, label: "A-101", pageWidthPt: 2592 } });
    await prisma.takeoffPlanPage.create({ data: { planId: addendum.id, pageNumber: 2, label: "A102", pageWidthPt: 2592 } });
    await prisma.takeoffPlanPage.create({ data: { planId: addendum.id, pageNumber: 5, label: "A103", pageWidthPt: 2592 } });
    const newCal = await prisma.takeoffScaleCalibration.create({ data: { pageId: newA101.id, ...cal } });
    await prisma.takeoffWallProposal.create({ data: { pageId: newA101.id, calibrationId: newCal.id, thicknessInches: 6, source: "REMAINDER", runs: [{ x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.2, thicknessFeet: 0.5 }, { x1: 0.6, y1: 0.7, x2: 0.72, y2: 0.7, thicknessFeet: 0.5 }] } });
  });

  test("2. the Takeoff tab links to what the revised sheets change, where they are uploaded too", async () => {
    await page.goto(`/jobs/${jobId}/takeoff`);
    await expectHealthy(page, "the takeoff tab with two plan files", { monitor });
    await page.locator('[data-takeoff="addendum-link"]').click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/addendum$`));
    await expectHealthy(page, "the addendum page", { monitor });
    // Where the revised sheets go in: the Takeoff tab's own uploader is gone once a drawing is on the job (walk v8).
    await expect(page.locator('[data-addendum="upload"] input[type="file"]')).toHaveCount(1);
    await expect(page.locator('[data-addendum="upload"]').getByLabel("Add a drawing")).toBeVisible();
  });

  test("3. each revised sheet against the one it replaces", async () => {
    const sheets = page.locator('[data-addendum="sheet"]');
    await expect(sheets).toHaveCount(3);
    await expect(sheets.nth(0)).toContainText("A-101");
    await expect(sheets.nth(0)).toContainText("A-101 in ZZ-E2E bid set.pdf");
    await expect(sheets.nth(0).locator('[data-addendum="sheet-status"]')).toHaveText("compared: 1 of 2 runs matched in place");
    await expect(sheets.nth(1).locator('[data-addendum="sheet-status"]')).toHaveText("no scale yet: set it to compare");
    await expect(sheets.nth(2)).toContainText("a new sheet");
  });

  test("4. the change by wall type: LF, SF and $, and the new walls priced once typed", async () => {
    const rows = page.locator('[data-addendum="change"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("ZAD1 · ZAD1 walls");
    await expect(rows.nth(0)).toContainText("50 LF");
    await expect(rows.nth(0)).toContainText("30 LF");
    await expect(rows.nth(0)).toContainText("−20 LF");
    await expect(rows.nth(0)).toContainText("−400 SF");
    await expect(rows.nth(0)).toContainText("−$400.00");
    await expect(rows.nth(1)).toContainText("New walls, no type yet");
    await expect(rows.nth(1)).toContainText("+12 LF");
    await expect(page.locator('[data-addendum="total"]')).toContainText("−$400.00");
    await expect(page.locator('[data-addendum="unpriced"]')).toContainText("new walls, no type yet");
    await page.screenshot({ path: path.join(SHOTS, "addendum-changes-1280.png"), fullPage: true });
  });

  test("5. the summary to send the GC says the same, in words, with Copy", async () => {
    const summary = page.locator('[data-addendum="summary"]');
    await expect(summary).toHaveValue(/^Addendum 1: changes to our framing and drywall scope/);
    await expect(summary).toHaveValue(/• ZAD1: −20 LF \(−400 SF\), −\$400\.00/);
    await expect(summary).toHaveValue(/• New walls \(type to confirm\): \+12 LF, to be priced/);
    await expect(summary).toHaveValue(/Net change to our price: −\$400\.00, plus the walls still to be priced\./);
    await expect(page.locator('[data-addendum="copy-summary"]')).toBeVisible();
  });

  const rowsOn = async (label: string) => {
    const page = await prisma.takeoffPlanPage.findFirstOrThrow({ where: { label, plan: { jobId } }, select: { id: true } });
    return (await prisma.takeoffMeasurement.findMany({ where: { pageId: page.id }, orderBy: { createdAt: "asc" }, select: { item: { select: { name: true } } } })).map((m) => m.item?.name ?? "?");
  };

  test("6. Apply: the revised walls on their types, the earlier sheet's off the estimate, the summary kept", async () => {
    await page.locator('[data-addendum="apply"]').click();
    await expect(page.locator('[data-addendum="applied"]')).toHaveText(/^Applied: 2 revised walls on the takeoff \(2 written, 0 retyped\), 2 replaced walls taken off the estimate\. The estimate moved [+−]?\$[\d,]+\.\d\d\.$/, { timeout: 30_000 });
    // The summary kept is the estimate's real move, not the rows' guess.
    await expect(page.locator('[data-addendum="summary"]')).toHaveValue(/Net change to our price: [+−]?\$[\d,]+\.\d\d\.$/);
    await expect.poll(() => rowsOn("A-101"), { timeout: 30_000 }).toEqual(["ZAD1 walls", "Walls — untyped"]);
    expect(await rowsOn("A101")).toEqual(["Walls — dropped", "Walls — dropped"]);
    await expect(page.locator('[data-addendum="sheet"]').nth(0).locator('[data-addendum="sheet-status"]')).toHaveText(/^applied/, { timeout: 30_000 });
    await expect(page.locator('[data-addendum="summary"]')).toHaveValue(/• ZAD1: −20 LF/);
    await page.screenshot({ path: path.join(SHOTS, "addendum-applied-1280.png"), fullPage: true });
  });

  test("7. Undo: every wall back where it was, and the sheet to compare again", async () => {
    await page.locator('[data-addendum="undo"]').click();
    await expect.poll(() => rowsOn("A-101"), { timeout: 30_000 }).toEqual([]);
    expect(await rowsOn("A101")).toEqual(["ZAD1 walls", "ZAD1 walls"]);
    await expect(page.locator('[data-addendum="apply"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-addendum="sheet"]').nth(0).locator('[data-addendum="sheet-status"]')).toHaveText("compared: 1 of 2 runs matched in place");
  });

  test("8. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
