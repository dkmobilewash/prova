import path from "node:path";
import { appendFileSync, createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { test, expect, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { stubDocumentUpload } from "../lib/blobStub";
import {
  finishWizard,
  landOnDashboard,
  openJobTab,
  startJob,
} from "../lib/journey";

/**
 * ── THE CUSTOMER'S LIVE LIST, RECORDED RUN FOR RUN (prereg-live-list-parity.md) ──
 *
 * After Run takeoff, the viewer's plan port carries `data-takeoff-live`: every run the contractor sees, in
 * page-width units — written only in a build with NEXT_PUBLIC_TAKEOFF_LIVE_DIGEST=1. This drives the real app
 * on real sheets (customer mode, not key mode) and appends one line per sheet to LIVE_OUT, so
 * `realplan/zzLiveParity.eval.ts` can hold it against server detection's offered-minus-held on the same PDF,
 * page and scale.
 *
 * The scale is set as `takeoff-app-equals-eval.local.spec.ts` sets it: two clicks half a page width apart
 * declared 144 ft (288 ft per page width), and the stored line is recorded so the Node side derives the
 * same feet per unit.
 *
 * Resumable: a sheet already in LIVE_OUT is skipped, so a walk cut at the heavy-lock limit continues.
 * LIVE_SHEETS is `<pdf file name>:<page>|…`; one upload per set.
 */
const PLANS = process.env.REAL_PLAN_DIR ?? "";
const OUT = process.env.LIVE_OUT ?? "";
// Separated by "|": real file names carry commas ("Falafel Fresh, Lake St, Kirkland WA.pdf").
const SHEETS = (process.env.LIVE_SHEETS ?? "")
  .split("|")
  .map((s) => s.trim())
  .filter((s) => s.includes(":"))
  .map((s) => ({
    file: s.slice(0, s.lastIndexOf(":")),
    page: Number(s.slice(s.lastIndexOf(":") + 1)),
  }));
const done = new Set(
  OUT !== "" && existsSync(OUT)
    ? readFileSync(OUT, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const r = JSON.parse(l) as { file: string; page: number };
          return `${r.file}:${r.page}`;
        })
    : [],
);
const bySet = new Map<string, number[]>();
for (const s of SHEETS)
  if (!done.has(`${s.file}:${s.page}`))
    (bySet.get(s.file) ?? bySet.set(s.file, []).get(s.file)!).push(s.page);

test.describe.configure({ mode: "serial" });

test.describe("the customer's live list, for parity with server detection", () => {
  test.skip(
    PLANS === "" || OUT === "" || SHEETS.length === 0,
    "needs REAL_PLAN_DIR, LIVE_OUT and LIVE_SHEETS",
  );
  test.setTimeout(1_500_000);
  let page: Page;
  let monitor: HealthMonitor;
  // A PATH, not the bytes: ELEVEN03 is 342 MB, and a body that size sent through `route.fulfill` ran the worker out of memory.
  let served: string | null = null;

  // ── A SET OVER 90 MB IS SERVED BY RANGE, as production serves every plan ──
  // `route.fulfill` hands the browser the whole file at once; at 99-342 MB that crashed the browser (Joplin) or
  // the worker (ELEVEN03). The viewer asks by HTTP range (PLAN_PDF_TRANSPORT), so for those sets the request is
  // continued to a local server that answers ranges. Smaller sets keep the whole-file answer every walk used.
  const BIG = 90 * 1024 * 1024;
  let rangeServer: Server | null = null;
  let rangePort = 0;
  test.afterAll(() => rangeServer?.close());

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    monitor = new HealthMonitor(page);
    rangeServer = createServer((req, res) => {
      if (served === null) return void res.writeHead(404).end();
      const size = statSync(served).size;
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
      const headers = { "Content-Type": "application/pdf", "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range, Content-Length" };
      if (m === null) {
        res.writeHead(200, { ...headers, "Content-Length": String(size) });
        return void createReadStream(served).pipe(res);
      }
      const start = Number(m[1]);
      const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
      res.writeHead(206, { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` });
      createReadStream(served, { start, end }).pipe(res);
    });
    await new Promise<void>((resolve) => rangeServer!.listen(0, "127.0.0.1", () => resolve()));
    rangePort = (rangeServer.address() as { port: number }).port;
    await page.route("**/api/takeoff/plan/**", async (route) => {
      if (served === null) return route.continue();
      if (statSync(served).size > BIG) return route.continue({ url: `http://127.0.0.1:${rangePort}/plan.pdf` });
      return route.fulfill({ status: 200, contentType: "application/pdf", path: served });
    });
    await signInAs(page, PERSONAS.takeoff.email);
    await landOnDashboard(page, monitor);
  });

  const picker = () => page.locator('[data-takeoff="sheet-picker"]');
  async function toSheet(n: number): Promise<void> {
    await picker().selectOption(String(n));
    await expect
      .poll(
        async () =>
          page
            .locator('[data-testid="takeoff-plan-port"] canvas')
            .evaluate((node) => (node as HTMLCanvasElement).width),
        { timeout: 180_000, message: `sheet ${n} never rendered` },
      )
      .toBeGreaterThan(0);
    await expect(picker()).toHaveValue(String(n));
    await page.waitForTimeout(600);
  }

  for (const [file, pages] of bySet) {
    test(`${file}: ${pages.length} sheet(s)`, async () => {
      const full = path.join(PLANS, file);
      expect(existsSync(full), `${file} not in REAL_PLAN_DIR`).toBe(true);
      expect(readdirSync(PLANS).includes(file)).toBe(true);
      served = full;
      // A long walk outlives the dev instance's session (6-oth: "Start the job" answered 404 → /sign-in after ~4 min).
      await page.goto("/dashboard");
      if (page.url().includes("/sign-in")) {
        await signInAs(page, PERSONAS.takeoff.email);
        await landOnDashboard(page, monitor);
      }
      const id = await startJob(page, monitor, {
        name: `ZZ-E2E Live parity ${file.slice(0, 40)}`,
        gcName: "ZZ-E2E Live parity GC",
      });
      await finishWizard(page, monitor, id);
      await openJobTab(page, "Takeoff");
      await page.waitForURL(new RegExp(`/jobs/${id}/takeoff$`));
      await stubDocumentUpload(page);
      await page.locator('input[type="file"]').setInputFiles(full);
      await expect(
        page.getByRole("button", { name: "Which revision is this?" }),
      ).toBeVisible({ timeout: 180_000 });
      await page.goto(`/takeoff/${id}`);
      await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
      await expect(picker()).toBeVisible({ timeout: 60_000 });
      for (const n of pages) {
        // ONE STUCK SHEET DOES NOT STOP THE WALK: it is written down with its error and no list, which
        // compare.py counts as missing (a parity failure), and the next sheet runs.
        try {
          await toSheet(n);
          const overlay = page.locator('[data-testid="takeoff-plan-port"] svg');
          await page.getByRole("button", { name: "Set scale" }).click();
          const box = await overlay.boundingBox();
          expect(box).not.toBeNull();
          await overlay.click({
            position: { x: box!.width * 0.2, y: box!.width * 0.3 },
          });
          await overlay.click({
            position: { x: box!.width * 0.7, y: box!.width * 0.3 },
          });
          const form = page
            .locator("form")
            .filter({
              has: page.getByRole("button", { name: "Set the scale" }),
            });
          await form.locator('input[name="declaredDistanceFeet"]').fill("144");
          await form.locator('input[name="pageLabel"]').fill(`P${n}`);
          const calibration = {
            points: await form.locator('input[name="points"]').inputValue(),
            declaredDistanceFeet: await form
              .locator('input[name="declaredDistanceFeet"]')
              .inputValue(),
          };
          await form.getByRole("button", { name: "Set the scale" }).click();
          // The form closing is the save, on a fresh sheet and on one whose printed scale was already applied
          // (11 Chestnut A2.0 shows no "Scale set" line; the scale chip changes instead).
          await expect(form).toHaveCount(0, { timeout: 60_000 });
          const find = page.locator('[data-takeoff="find-walls"]');
          await expect(find).toBeEnabled({ timeout: 60_000 });
          await find.click();
          await expect(find).toHaveText(/^(Find the walls|Run takeoff)$/, {
            timeout: 600_000,
          });
          const port = page.locator('[data-testid="takeoff-plan-port"]');
          // Absent means the build lacks the switch or the viewer found nothing; either way the line says which.
          await expect
            .poll(
              async () =>
                (await port.getAttribute("data-takeoff-live")) !== null,
              { timeout: 30_000 },
            )
            .toBe(true)
            .catch(() => undefined);
          const live = await port.getAttribute("data-takeoff-live");
          appendFileSync(
            OUT,
            JSON.stringify({
              file,
              page: n,
              calibration,
              live: live === null ? null : (JSON.parse(live) as number[][]),
            }) + "\n",
          );
        } catch (error) {
          appendFileSync(
            OUT,
            JSON.stringify({
              file,
              page: n,
              calibration: null,
              live: null,
              error: String(error).split("\n")[0]!.slice(0, 300),
            }) + "\n",
          );
          await page.goto(`/takeoff/${id}`).catch(() => undefined);
          await expect(picker())
            .toBeVisible({ timeout: 60_000 })
            .catch(() => undefined);
        }
      }
    });
  }
});
