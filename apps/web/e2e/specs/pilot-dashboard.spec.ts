import { test, expect } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { SALES_COMPANY_NAME } from "../lib/salesFixture";

/**
 * ── THE PILOT DASHBOARD, WITH TWO TEST COMPANIES ──
 *
 * Two pilot companies are seeded with activity whose every figure this file can
 * state; the operator's owner (SALES) sees a row for each with those figures and
 * no row for its own company; a customer's owner (MAIN) gets "Not part of your
 * access" and no table. Read-only: nothing is pressed but links.
 */
test.describe.configure({ mode: "serial" });

const TAG = `ZZ-E2E Pilot ${Date.now()}`;
const ONE = `${TAG} One`;
const TWO = `${TAG} Two`;

test.describe("the pilot dashboard", () => {
  test.beforeAll(async () => {
    const one = await prisma.company.create({ data: { name: ONE } });
    const two = await prisma.company.create({ data: { name: TWO } });
    const gc = await prisma.contact.create({ data: { companyId: one.id, name: "GC" } });
    const job = await prisma.job.create({ data: { companyId: one.id, contactId: gc.id, name: `${ONE} job`, status: "ESTIMATE" } });
    const plan = await prisma.takeoffPlan.create({ data: { companyId: one.id, jobId: job.id, fileUrl: "local:none.pdf", fileName: "none.pdf", createdAt: new Date(Date.now() - 5 * 3600_000) } });
    const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1 } });
    const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
    for (const label of ["W1 wall (set by hand)", "W1 wall (set by hand)", "W1 wall (auto, from printed tag)"]) {
      await prisma.takeoffMeasurement.create({ data: { pageId: page.id, calibrationId: cal.id, kind: "LINEAR", source: "DETECTED", xs: [0, 1], ys: [0, 0], label } });
    }
    await prisma.signatureRequest.create({ data: { jobId: job.id, token: `pilot-${Date.now()}`, createdAt: new Date(Date.now() - 3 * 3600_000) } });
    const gc2 = await prisma.contact.create({ data: { companyId: two.id, name: "GC" } });
    await prisma.job.create({ data: { companyId: two.id, contactId: gc2.id, name: `${TWO} job`, status: "ESTIMATE" } });
  });

  test("the operator's owner sees both pilots with their figures, and not its own company", async ({ page }) => {
    const monitor = new HealthMonitor(page);
    await signInAs(page, PERSONAS.sales.email);
    await page.goto("/internal/pilots");
    await expectHealthy(page, "pilots", { monitor });
    await expect(page.getByRole("heading", { name: "Pilots" })).toBeVisible();
    const row = (name: string) => page.locator(`[data-pilots="row"][data-company="${name}"]`);
    const one = row(ONE);
    await expect(one).toHaveCount(1);
    await expect(one.locator('[data-pilots="jobs"]')).toHaveText("1");
    await expect(one.locator('[data-pilots="sets"]')).toHaveText("1");
    await expect(one.locator('[data-pilots="sheets"]')).toHaveText("1");
    await expect(one.locator('[data-pilots="typed"]')).toHaveText("2");
    await expect(one.locator('[data-pilots="auto"]')).toHaveText("1");
    await expect(one.locator('[data-pilots="bid"]')).toHaveText("2 h (1)");
    const two = row(TWO);
    await expect(two).toHaveCount(1);
    await expect(two.locator('[data-pilots="jobs"]')).toHaveText("1");
    await expect(two.locator('[data-pilots="sets"]')).toHaveText("0");
    await expect(two.locator('[data-pilots="bid"]')).toHaveText("—");
    await expect(row(SALES_COMPANY_NAME)).toHaveCount(0);
    expect(monitor.crashes).toEqual([]);
  });

  test("a customer's owner gets nothing, and no figure of anybody's", async ({ page }) => {
    await signInAs(page, PERSONAS.main.email);
    await page.goto("/internal/pilots");
    await expect(page.getByRole("heading", { name: "Not part of your access" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-pilots="table"]')).toHaveCount(0);
    await expect(page.getByText(ONE)).toHaveCount(0);
  });
});
