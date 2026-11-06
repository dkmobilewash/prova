import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";

/**
 * ── THE GUIDED FLOW'S LAST STEP: SEND, AND WHAT THE GC GETS ──
 *
 * The signing link was the line items and a total. A proposal the GC can act
 * on also says the scope by wall type with the takeoff's feet, what is in the
 * number and what is not, and the terms. This walks Send from a priced
 * estimate: the stepper asks for inclusions and exclusions first, the link is
 * made, and the GC — signed out, in their own browser — reads all of it, signs,
 * and the signed copy keeps it even after the job changes.
 *
 * The takeoff is seeded (one W1 type, 50 ft of wall on a sheet 100 ft across,
 * 10 ft high, both faces) so the figures are this file's own arithmetic:
 * 50 LF and 50 × 10 × 2 = 1,000 SF.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/gc-proposal");
const INCLUSION = "ZZ-E2E Metal stud framing and Type X board per the wall types listed";
const EXCLUSION = "ZZ-E2E Fire caulking, insulation not listed, and paint";

test.describe("Send, and the proposal the GC gets", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";
  let link = "";
  const next = () => page.locator("[data-job-next]");

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    monitor = new HealthMonitor(page);
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("1. a priced estimate with a takeoff behind it, and terms on the GC's record", async () => {
    await signInAs(page, PERSONAS.gcProposal.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E GC proposal", gcName: "ZZ-E2E GC proposal GC" });
    await finishWizard(page, monitor, jobId);
    const job = await prisma.job.update({ where: { id: jobId }, data: { retainagePercent: "10" }, select: { companyId: true, contactId: true } });
    const companyId = job.companyId;
    await prisma.contact.update({ where: { id: job.contactId }, data: { paymentTermsDays: 30 } });

    const w1 = await prisma.wallType.create({ data: { companyId, code: "ZW1", name: "ZZ-E2E steel studs, board both sides", defaultHeightFt: 10, sides: 2, components: { create: [{ description: "studs", basis: "LINEAR_FT", factor: 1 }] } } });
    const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:none.pdf", fileName: "none.pdf" } });
    const sheet = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: sheet.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "100" } });
    const item = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "ZW1 walls", type: "LINEAR", colorHex: "#111111", wallTypeId: w1.id, heightFt: "10" } });
    for (const [x2, y] of [[0.3, 0.3], [0.2, 0.4]] as const) {
      await prisma.takeoffMeasurement.create({ data: { pageId: sheet.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [0, x2], ys: [y, y], itemId: item.id } });
    }
    await prisma.jobLineItem.create({ data: { jobId, description: "ZZ-E2E ZW1 framing and board", quantity: "1000", unit: "sq ft", budgetedUnitCost: "4", unitPrice: "5.13", costCategory: "MATERIAL" } });
  });

  test("2. Send asks for inclusions and exclusions first, on the proposal", async () => {
    await page.goto(`/jobs/${jobId}`);
    await expectHealthy(page, "the job, priced", { monitor });
    await expect(next()).toHaveText("Next: Add inclusions and exclusions");
    await next().click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}/proposal#clauses`));
    // The proposal page shows the GC's scope and terms beside its own clauses.
    await expect(page.locator('[data-proposal="scope-row"]')).toHaveCount(1);
    await expect(page.locator('[data-proposal="terms"]')).toContainText("Payment: net 30 days.");
    for (const [kind, text] of [["INCLUSION", INCLUSION], ["EXCLUSION", EXCLUSION]] as const) {
      const form = page.locator("form").filter({ has: page.locator('input[name="text"]') }).last();
      await expect.poll(() => form.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
      await form.locator('select[name="kind"]').selectOption(kind);
      await form.locator('input[name="text"]').fill(text);
      await form.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByText(text)).toBeVisible({ timeout: 30_000 });
    }
    await page.goto(`/jobs/${jobId}`);
    await expect(next()).toHaveText("Next: Send it for signature");
  });

  test("3. Send makes the signing link", async () => {
    await next().click();
    await page.waitForURL(new RegExp(`/jobs/${jobId}#contract-signature`));
    await page.getByRole("button", { name: /Create signing link/ }).click();
    const shown = page.getByText(/\/esign\/[A-Za-z0-9_-]+/).first();
    await expect(shown).toBeVisible({ timeout: 30_000 });
    link = new URL((await shown.innerText()).trim()).pathname;
    expect(link).toMatch(/^\/esign\//);
  });

  let gc: Page;
  test("4. the GC, signed out, reads the scope by wall type, the clauses, the price and the terms", async ({ browser }) => {
    gc = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await gc.goto(link);
    await expectHealthy(gc, "the signing link, as the GC", { monitor: new HealthMonitor(gc), signedIn: false });
    const row = gc.locator('[data-proposal="scope-row"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("ZW1 · ZZ-E2E steel studs, board both sides");
    await expect(row).toContainText("10'-0\"");
    await expect(row).toContainText("50 LF");
    await expect(row).toContainText("1,000 SF");
    await expect(gc.locator('[data-proposal="clauses-inclusion"]')).toContainText(INCLUSION);
    await expect(gc.locator('[data-proposal="clauses-exclusion"]')).toContainText(EXCLUSION);
    // The price: 1,000 sq ft at $5.13, the line's marked-up price.
    await expect(gc.getByText("Total: $5,130.00")).toBeVisible();
    await expect(gc.locator('[data-proposal="terms"]')).toHaveText(/Payment: net 30 days\.\s*Retainage: 10%\./);
    await expect(gc.getByRole("button", { name: "Sign contract" })).toBeVisible();
    await gc.screenshot({ path: path.join(SHOTS, "proposal-the-gc-gets.png"), fullPage: true });
  });

  test("5. signed, and the signed copy keeps what was agreed after the job changes", async () => {
    await gc.locator('input[name="signerName"]').fill("ZZ-E2E Pat GC");
    await gc.locator('input[name="agree"]').check();
    await gc.getByRole("button", { name: "Sign contract" }).click();
    await expect(gc.getByText(/^Signed by ZZ-E2E Pat GC/)).toBeVisible({ timeout: 30_000 });
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { companyId: true } });
    await prisma.jobProposalClause.create({ data: { companyId: job.companyId, jobId, kind: "EXCLUSION", text: "ZZ-E2E added after signing" } });
    await gc.reload();
    await expect(gc.locator('[data-proposal="clauses-exclusion"]')).toContainText(EXCLUSION);
    await expect(gc.getByText("ZZ-E2E added after signing")).toHaveCount(0);
    await expect(gc.locator('[data-proposal="scope-row"]')).toContainText("1,000 SF");
    await gc.screenshot({ path: path.join(SHOTS, "proposal-signed.png"), fullPage: true });
    await gc.context().close();
  });

  test("6. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
