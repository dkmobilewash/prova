import path from "node:path";
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";

/**
 * ── THE ANSWER-KEY (LABELLING) MODE IS NOT A CUSTOMER FEATURE ──
 *
 * It makes answer keys against a client's drawings on a staff laptop, and it
 * exists only where `labellingAllowed` holds: a label folder, the local-plans
 * opt-in, a loopback bind, no Vercel. This suite's server satisfies none of
 * that — exactly like a customer's deployment — so a signed-in user who can see
 * the job's costs must get NOTHING: no "Answer key" button, nothing of the
 * panel when the URL asks for it, and a 404 from the label routes, read and
 * write alike. Before 2026-10-22 the URL switch opened the panel for anyone.
 */
const PLAN_FIXTURE = path.resolve(__dirname, "../fixtures/plan-sheet.pdf");

test.describe.configure({ mode: "serial" });

test.describe("answer-key mode is unreachable for a customer", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let jobId = "";

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    monitor = new HealthMonitor(page);
    const pdf = readFileSync(PLAN_FIXTURE);
    await page.route("**/api/takeoff/plan/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/pdf", body: pdf });
    });
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test("1. the workspace shows no answer-key button, and ?key=1 opens no panel", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    jobId = await startJob(page, monitor, { name: "ZZ-E2E Answer key gate", gcName: "ZZ-E2E Gate GC" });
    await finishWizard(page, monitor, jobId);
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { companyId: true } });
    await prisma.takeoffPlan.create({
      data: { companyId: job.companyId, jobId, fileUrl: "https://example.invalid/plan.pdf", fileName: "plan-sheet.pdf", revisionLabel: "Bid set" },
    });

    await page.goto(`/takeoff/${jobId}?key=1`);
    // `signedIn: false` as the workspace spec passes it: the full-screen
    // workspace has no app shell, so the shell-navigation check does not apply.
    await expectHealthy(page, "takeoff workspace asked for answer-key mode", { monitor, signedIn: false });
    // The workspace itself rendered — this is a negative test, and a blank page
    // would pass it for the wrong reason.
    await expect(page.locator('[data-takeoff="back-to-estimate"]')).toHaveCount(1);
    await expect(page.locator('[data-takeoff="toggle-answer-key"]'), "no answer-key button").toHaveCount(0);
    for (const marker of ["key-trace", "key-set-aside", "key-offer-all", "key-help-toggle", "key-duplicates"]) {
      await expect(page.locator(`[data-takeoff="${marker}"]`), `no ${marker}`).toHaveCount(0);
    }
  });

  test("2. the label routes answer 404 to a read and to a write", async () => {
    const read = await page.request.get("/api/takeoff/labels?set=ZZ-E2E&sheet=A101");
    expect(read.status()).toBe(404);
    const write = await page.request.post("/api/takeoff/labels", {
      data: { set: "ZZ-E2E", sheet: "A101", page: 1, candidates: [], verdicts: [], rows: [] },
    });
    expect(write.status()).toBe(404);
    // And the refusal names nothing about the server's environment.
    expect(await read.text()).not.toMatch(/TAKEOFF_LABEL_DIR|ALLOW_LOCAL_PLANS|HOSTNAME|VERCEL/);
  });
});
