import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── A PLAN SET OVER 100 MB GOES IN PARTS, WITH PROGRESS, AND RESUMES ──
 *
 * Diego, 2026-11-06: plan uploads up to 1 GB, straight to storage in parts, so a
 * slow connection does not fail the upload. A 101 MB PDF (generated here: the
 * bytes do not matter, the size does) goes through `uploadPlanSetFile`'s parts.
 * Then the same with one part that keeps failing: the upload stops, says so,
 * offers Resume, and Resume sends only the parts that are missing.
 */
test.describe.configure({ mode: "serial" });

const MB = 1024 * 1024;
/**
 * A PDF header and 101 MB of padding (13 parts of 8 MB), written to a file:
 * Playwright refuses an in-memory file over 50 MB.
 */
const dir = mkdtempSync(path.join(tmpdir(), "zz-e2e-big-plan-"));
const bigPdf = (name: string) => {
  const file = path.join(dir, name);
  writeFileSync(file, Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(101 * MB - 9, 0x20)]));
  return file;
};
const PARTS = Math.ceil((101 * MB) / (8 * MB));

test.describe("a big plan set uploads in resumable parts", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    monitor = new HealthMonitor(page);
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("1. 101 MB in parts, with progress: every part once, and the plan on the job", async () => {
    test.setTimeout(180_000);
    await signInAs(page, PERSONAS.rooms.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Big plan upload", gcName: "ZZ-E2E Big upload GC" });
    await finishWizard(page, monitor, jobId);
    await openJobTab(page, "Takeoff");
    const stub = await stubDocumentUpload(page);
    await page.locator('input[type="file"]').first().setInputFiles(bigPdf("ZZ-E2E big set.pdf"));
    await page.getByRole("button", { name: "Add a drawing" }).click();
    await expect(page.locator('[data-takeoff="plan-upload-progress-text"]')).toContainText(/of 101\.0 MB · \d+%/, { timeout: 60_000 });
    await expect.poll(() => prisma.takeoffPlan.count({ where: { jobId } }), { timeout: 120_000 }).toBe(1);
    expect(stub.partsSent().sort((a, b) => a - b)).toEqual(Array.from({ length: PARTS }, (_, i) => i + 1));
  });

  test("2. a part that keeps failing stops the upload with Resume, and Resume sends only what is missing", async () => {
    test.setTimeout(180_000);
    await page.goto(`/jobs/${jobId}/addendum`);
    // Part 7 fails on every try until the connection "comes back", just before Resume.
    let down = true;
    const stub = await stubDocumentUpload(page, { failPart: (n) => n === 7 && down });
    const upload = page.locator('[data-addendum="upload"]');
    await upload.locator('input[type="file"]').setInputFiles(bigPdf("ZZ-E2E addendum set.pdf"));
    await upload.getByRole("button", { name: "Add a drawing" }).click();
    const resume = upload.locator('[data-takeoff="plan-upload-resume"]');
    await expect(resume).toHaveText("Resume the upload of ZZ-E2E addendum set.pdf", { timeout: 120_000 });
    await expect(upload.getByRole("alert")).toContainText("press Resume to pick up where it stopped");
    const before = stub.partsSent();
    expect(before).not.toContain(7);
    down = false;
    await resume.click();
    await expect.poll(() => prisma.takeoffPlan.count({ where: { jobId } }), { timeout: 120_000 }).toBe(2);
    const resent = stub.partsSent().slice(before.length);
    // Only the part that was missing went again.
    expect(resent).toEqual([7]);
  });

  test("3. nothing crashed", async () => {
    expect(monitor.crashes).toEqual([]);
  });
});
