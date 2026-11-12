import path from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import { finishWizard, landOnDashboard, openJobTab, startJob } from "../lib/journey";

/**
 * ── ANSWER-KEY MODE, ON A SERVER THAT ALLOWS LABELLING ──
 *
 * Step 22 of `specs/takeoff-workspace.spec.ts`, moved here whole. It needs a
 * server where `labellingRefusal` (lib/plan-ingest/labelStore.ts) says yes —
 * on a production build that means ALLOW_LOCAL_PLANS=1, a loopback HOSTNAME,
 * an absolute TAKEOFF_LOCAL_PLAN_DIR and an absolute TAKEOFF_LABEL_DIR. CI's
 * server has none of that ON PURPOSE (`answer-key-gate.spec.ts` proves a
 * customer gets nothing), so in CI it could only skip, and `verdicts.mjs`
 * counts a skip as a failure. Run it on a laptop, from the repo root:
 *
 *     ALLOW_LOCAL_PLANS=1 HOSTNAME=localhost TAKEOFF_LOCAL_PLAN_DIR=/abs/plans \
 *       TAKEOFF_LABEL_DIR="$(mktemp -d)" pnpm test:e2e -- --real-plans answer-key-mode
 *
 * The shell's env reaches the server through the main config's `webServer.env`.
 * Point TAKEOFF_LABEL_DIR at a throwaway folder: nothing here saves a key, but
 * the real labels are never the place to find that out.
 *
 * The drawing is the committed S02 fixture, uploaded and scaled exactly as the
 * workspace spec's step 1 does it (half the sheet is 48 ft), with the blob
 * stubbed and the plan bytes served from the fixture.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../artifacts/takeoff-workspace");
const FIXTURES = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans");
const DESKTOP = { width: 1440, height: 900 };

test.describe("answer-key mode in the takeoff workspace", () => {
  const GC_NAME = "ZZ-E2E Answer Key GC";
  const JOB_ONE = "ZZ-E2E Answer Key — S02";

  const servedPdf: Buffer = readFileSync(path.join(FIXTURES, "S02.pdf"));
  let page: Page;
  let monitor: HealthMonitor;
  let jobOne = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: DESKTOP });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    await page.route("**/api/takeoff/plan/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/pdf", body: servedPdf });
    });
    mkdirSync(SHOTS, { recursive: true });
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  const port = () => page.locator('[data-testid="takeoff-plan-port"]');
  const overlay = () => port().locator("svg");
  const tool = (label: string) => page.getByRole("button", { name: label, exact: true });

  async function settledOverlayBox(): Promise<{ width: number }> {
    let previous = -1;
    let steady = 0;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const box = await overlay().boundingBox();
      if (box && box.width > 0 && Math.abs(box.width - previous) < 0.5) {
        steady += 1;
        if (steady >= 3) return { width: box.width };
      } else {
        steady = 0;
      }
      previous = box?.width ?? -1;
      await page.waitForTimeout(100);
    }
    throw new Error("the sheet never stopped resizing, so no click on it can be trusted");
  }

  async function setScaleByClicking(halfSheetFeet: number): Promise<void> {
    await expect
      .poll(async () => port().locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width), {
        timeout: 60_000,
        message: "pdf.js should render the sheet to a canvas with real pixels",
      })
      .toBeGreaterThan(0);
    await tool("Set scale").click();
    const box = await settledOverlayBox();
    await overlay().click({ position: { x: box.width * 0.2, y: box.width * 0.5 } });
    await overlay().click({ position: { x: box.width * 0.7, y: box.width * 0.5 } });
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Set the scale" }) });
    await form.locator('input[name="declaredDistanceFeet"]').fill(String(halfSheetFeet));
    await form.locator('input[name="pageLabel"]').fill("sheet 1");
    await form.getByRole("button", { name: "Set the scale" }).click();
    await expect(page.getByText(/^Scale set/)).toBeVisible({ timeout: 30_000 });
  }

  async function onWorkspace(jobId: string): Promise<void> {
    await page.goto(`/takeoff/${jobId}`);
    await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
    await expect
      .poll(async () => port().locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width), {
        timeout: 60_000,
        message: "the workspace should render the sheet to a canvas",
      })
      .toBeGreaterThan(0);
  }

  async function findTheWalls(label: string): Promise<void> {
    const find = page.locator('[data-takeoff="find-walls"]');
    await expect(find, `Find the walls never became available on ${label}`).toBeEnabled({ timeout: 60_000 });
    await find.click();
    await expect(find).toHaveText("Find the walls", { timeout: 180_000 });
    await page.waitForTimeout(800);
  }

  test("a job with S02 uploaded and scaled, on the takeoff tab", async () => {
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
    jobOne = await startJob(page, monitor, { name: JOB_ONE, gcName: GC_NAME });
    await finishWizard(page, monitor, jobOne);
    await openJobTab(page, "Takeoff");
    await page.waitForURL(new RegExp(`/jobs/${jobOne}/takeoff$`));
    await stubDocumentUpload(page);
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "S02.pdf"));
    await expect(page.getByRole("button", { name: "Which revision is this?" })).toBeVisible({ timeout: 60_000 });
    await setScaleByClicking(48);
    await expectHealthy(page, "takeoff tab, S02 scaled", { monitor });
  });

  test("22. ANSWER-KEY MODE: candidates, not answers", async () => {
    // ── THE ONE THING THIS MODE MUST NOT DO ──
    //
    // Pre-accept the detection. A key that agrees with the detector by
    // construction is not a key, and the way it would happen is exactly this:
    // load the findings, mark them accepted, let the reviewer delete what is
    // wrong. Nobody deletes a hundred rows one at a time.
    //
    // `answerKeyReview.ts` holds that rule and is tested at every transition.
    // What no unit test can see is whether the SCREEN honours it — this repo
    // has shipped three fixes that were green and never rendered — so this
    // walks it in a real browser.
    await page.setViewportSize(DESKTOP);
    await onWorkspace(jobOne);
    await findTheWalls("S02 for the answer key");

    // ── SKIPS WHERE LABELLING IS NOT ALLOWED, WHICH IS THIS SUITE ──
    //
    // `labellingRefusal` hides answer-key mode entirely unless a label
    // folder, the local-plans opt-in, a loopback bind and no Vercel all hold.
    // This suite's server satisfies NONE of that ON PURPOSE —
    // `answer-key-gate.spec.ts` says so in its header and exists to prove a
    // customer gets nothing — so the toggle is correctly absent and this test
    // spent 30 seconds waiting for it.
    //
    // I first "fixed" that by giving the suite's server the labelling
    // environment. That made this test pass and defeated the gate everywhere,
    // including in the spec written to guard it: the suite stopped resembling
    // a customer's deployment, which is the one property it has to keep. The
    // revert is `b6d66318`.
    //
    // So this skips instead, and says which condition is missing rather than
    // vanishing quietly. Answer-key mode is covered on a real labelling
    // server by `e2e/smoke-labeling.mjs`, which has the environment because
    // it IS one.
    const toggle = page.locator('[data-takeoff="toggle-answer-key"]');
    if ((await toggle.count()) === 0) {
      test.skip(
        true,
        "labelling is not allowed on this server (by design — see answer-key-gate.spec.ts); " +
          "answer-key mode is covered by e2e/smoke-labeling.mjs",
      );
    }
    await toggle.click();
    const rail = page.locator('[data-takeoff="answer-key-rail"]');
    await expect(rail, "the answer-key rail never opened").toBeVisible({ timeout: 20_000 });

    // The rules are ON SCREEN, because a key made under one definition and
    // graded under another is worse than no key.
    await expect(rail).toContainText(/CENTRELINE/i);
    await expect(rail).toContainText(/furniture/i);

    // ── NOTHING IS ACCEPTED YET ──
    const progress = rail.locator('[data-takeoff="key-progress"]');
    await expect(progress).toContainText(/\b0 of \d+\b/);
    const candidates = rail.locator('[data-takeoff="key-candidate"]');
    const total = await candidates.count();
    expect(total, "no candidates loaded, so this step proves nothing").toBeGreaterThan(0);
    // Every one of them is undecided. A single accepted row here would mean
    // the mode had pre-answered the question it exists to ask.
    const verdicts = await candidates.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-verdict")),
    );
    expect(new Set(verdicts), "something was already decided").toEqual(new Set(["unreviewed"]));

    // ── AND SAVING IS REFUSED UNTIL IT IS SOMEBODY'S JUDGEMENT ──
    await expect(rail.locator('[data-takeoff="key-save"]')).toBeDisabled();

    // ── ONE DECISION, BY KEYBOARD ──
    await candidates.first().click();
    await page.keyboard.press("a");
    await expect(progress, "accepting a candidate did not move the count").toContainText(
      /\b1 of \d+\b/,
    );

    // …and the focus moved on by itself, which is what makes a hundred
    // decisions bearable.
    await page.keyboard.press("r");
    await expect(progress).toContainText(/\b2 of \d+\b/);

    // ── THE RAW DRAWING, WITH EVERYTHING OFF ──
    await page.locator('[data-takeoff="key-overlays"]').click();
    await expect(page.locator('[data-takeoff="key-overlay"]')).toHaveCount(0);
    await page.locator('[data-takeoff="key-overlays"]').click();
    await expect(page.locator('[data-takeoff="key-overlay"]')).toHaveCount(1);

    // ── AND WITH A NAME, IT CAN BE SAVED ──
    await rail.locator('[data-takeoff="key-reviewer"]').fill("e2e");
    await expect(rail.locator('[data-takeoff="key-save"]')).toBeEnabled();

    await expectHealthy(page, "answer-key mode", { monitor, signedIn: false });
    await page.screenshot({ path: path.join(SHOTS, "workspace-answer-key.png") });
  });
});
