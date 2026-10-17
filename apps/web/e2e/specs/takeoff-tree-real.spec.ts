import path from "node:path";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";

import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor } from "../lib/health";
import { finishWizard, landOnDashboard, startJob } from "../lib/journey";
import { openPlanPdf } from "../../lib/plan-ingest/planPdf";
import { nameSheet } from "../../lib/takeoff/realplan/nameSheet";

/**
 * ── THE SHEET TREE, ON A REAL SET, IN A REAL BROWSER ──
 *
 * `sheetTree.test.ts` proves the rules and `sheetTreeReal.eval.ts` proves they
 * survive 175 sheets nobody controlled. Neither shows the SCREEN, and the
 * Phase 1 screenshots could not: the ordinary harness stubs the blob store, so
 * ingest never runs, `PlanSheetProposal` is empty, and every sheet files under
 * "Not filed" however good the grouping is.
 *
 * So this seeds what ingest WOULD have written — reading each page's title
 * block with the same glyph-height reader the eval uses — and photographs the
 * result.
 *
 * ── TWO THINGS IT DELIBERATELY DOES NOT DO ──
 *
 * It does not UPLOAD the drawing. ELEVEN03 is 340 MB and `setInputFiles` would
 * pull all of it through the test process and the blob stub's memory for no
 * gain; the plan row is created directly and the file is served to the browser
 * from disk by `route.fulfill({ path })`, which streams.
 *
 * It does not CALL A MODEL. The product's ingest reads a title block with one.
 * The reader here does not, so what these screenshots show is the GROUPING
 * working on real numbers — not a claim about the model's reading.
 *
 * ── THE DRAWINGS ARE A CLIENT'S ──
 *
 * Read in place from `REAL_PLAN_DIR`, screenshots written to `REAL_SHEET_OUT`,
 * both outside the repository. Nothing is committed and no fixture is derived.
 * The file SKIPS when the folder is absent, which is every CI run.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "/Users/diego/Claude Folder/takeoff/real-plans";
const OUT = process.env.REAL_SHEET_OUT ?? "/Users/diego/Claude Folder/takeoff/workspace-shots";

const SETS = [
  { label: "campbowwow", file: "Camp Bow Wow - 100% CD_ARCH (2) (1).pdf" },
  { label: "eleven03", file: "2025-03-28_ELEVEN03 PERMIT SET_ARCH.pdf" },
];

const present = SETS.filter((set) => existsSync(path.join(DIR, set.file)));

const DESKTOP = { width: 1440, height: 900 };

type SheetName = { page: number; number: string; title: string };

/**
 * Where `sheetTreeReal.eval.ts` leaves the names it read.
 *
 * ── THE SIDECAR IS NOT AN OPTIMISATION, IT IS THE ONLY WAY ELEVEN03 RUNS ──
 *
 * Parsing that set's 340 MB in a worker that has already parsed another one
 * dies with `FATAL ERROR: Zone Allocation failed - process out of memory` —
 * a V8 allocator `--max-old-space-size` does not govern, so the obvious fix
 * does nothing. Measured twice: once with the parse inline, once with it
 * moved into its own function so the buffer could be collected. Both died,
 * the second one before it had printed anything.
 *
 * The eval's process does nothing but read PDFs, so it manages all five sets
 * comfortably. Producer and consumer.
 */
const NAMES_JSON =
  process.env.REAL_SHEET_NAMES ?? "/Users/diego/Claude Folder/takeoff/tree-report/sheet-names.json";

/** See NAMES_JSON for why the cache is preferred over reading the PDF here. */
async function readSheetNames(file: string): Promise<SheetName[]> {
  if (existsSync(NAMES_JSON)) {
    const cached: unknown = JSON.parse(readFileSync(NAMES_JSON, "utf8"));
    const forSet =
      typeof cached === "object" && cached !== null
        ? (cached as Record<string, SheetName[]>)[path.basename(file)]
        : undefined;
    if (Array.isArray(forSet) && forSet.length > 0) return forSet;
  }
  const doc = await openPlanPdf(readFileSync(file));
  const named: SheetName[] = [];
  try {
    for (let n = 1; n <= doc.pageCount; n += 1) {
      try {
        const text = await doc.pageText(n);
        const { number, title } = nameSheet(
          text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, height: i.height })),
          { widthPt: text.widthPt, heightPt: text.heightPt },
        );
        named.push({ page: n, number, title });
      } catch {
        // A page whose text will not read is a page with no number — a
        // finding, which files under "Not filed" and the count reports.
        named.push({ page: n, number: "", title: "" });
      }
    }
  } finally {
    await doc.close?.();
  }
  return named;
}

test.describe.configure({ mode: "serial" });

test.describe("the sheet tree on a real set", () => {
  test.skip(present.length === 0, `no real plan sets under ${DIR}`);
  // Reading 175 title blocks is the slow part, and it is the point.
  test.setTimeout(900_000);

  let page: Page;
  let monitor: HealthMonitor;
  let served = "";
  let ranged: Server;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: DESKTOP });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    // ── THE DRAWING IS STREAMED, NOT BUFFERED ──
    //
    // `route.fulfill({ path })` reads the whole file into this worker for
    // EVERY request, and pdf.js fetches a big document in many RANGE requests
    // — so ELEVEN03's 340 MB was being read dozens of times and the worker
    // died with `Zone Allocation failed - process out of memory`. Measured
    // three ways before this: parse inline, parse in its own scope, and read
    // the names from a cache instead. All three still died, because the
    // memory was never in the parse — it was here.
    //
    // A twenty-line range server keeps it flat: pdf.js asks for the slices it
    // wants and nothing ever holds more than one 64 KB chunk.
    ranged = createServer((request, response) => {
      const stat = statSync(served);
      // ── CORS, AND IT IS NOT OPTIONAL ──
      //
      // The redirect below crosses origins, and pdf.js fetches with
      // `credentials: omit` precisely so a `*` origin is acceptable — see the
      // viewer's own note. Without these headers the browser blocks every
      // read and the page says "That drawing couldn't be opened", which is
      // indistinguishable on a screenshot from a slow load.
      //
      // IT COST A WRONG FINDING. Before this was added, ELEVEN03's canvas was
      // blank after five minutes and that was nearly reported as "a 340 MB set
      // does not render" — a claim about the PRODUCT taken from a defect in
      // this harness. `content-range` must be EXPOSED or pdf.js cannot read
      // the ranges it just asked for.
      const cors = {
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "content-range, accept-ranges, content-length",
      };
      const range = /bytes=(\d*)-(\d*)/.exec(request.headers.range ?? "");
      if (!range) {
        response.writeHead(200, {
          ...cors,
          "content-type": "application/pdf",
          "content-length": stat.size,
          "accept-ranges": "bytes",
        });
        createReadStream(served).pipe(response);
        return;
      }
      const start = range[1] === "" ? 0 : Number(range[1]);
      const end = range[2] === "" ? stat.size - 1 : Math.min(Number(range[2]), stat.size - 1);
      response.writeHead(206, {
        ...cors,
        "content-type": "application/pdf",
        "content-range": `bytes ${start}-${end}/${stat.size}`,
        "content-length": end - start + 1,
        "accept-ranges": "bytes",
      });
      createReadStream(served, { start, end }).pipe(response);
    });
    await new Promise<void>((resolve) => ranged.listen(0, "127.0.0.1", resolve));
    const port = (ranged.address() as AddressInfo).port;

    await page.route("**/api/takeoff/plan/**", async (route) => {
      // Redirected rather than proxied, so the bytes never enter this process.
      await route.fulfill({ status: 302, headers: { location: `http://127.0.0.1:${port}/plan.pdf` } });
    });
    mkdirSync(OUT, { recursive: true });
    await signInAs(page, PERSONAS.takeoff.email);
  });

  test.afterAll(async () => {
    await page?.context().close();
    await new Promise<void>((resolve) => ranged?.close(() => resolve()));
  });

  for (const set of present) {
    test(`${set.label}: every sheet filed, and the tree on screen`, async () => {
      const file = path.join(DIR, set.file);
      served = file;

      // ── WHAT EACH SHEET CALLS ITSELF ──
      //
      //    IN ITS OWN SCOPE, which is load-bearing rather than tidy. ELEVEN03
      //    is 340 MB; holding that Buffer alive while the browser also parses
      //    the same file killed the worker outright with `Zone Allocation
      //    failed - process out of memory` — a V8 allocator the heap flag does
      //    not govern, so raising `--max-old-space-size` does not help. The
      //    buffer and the pdf.js document both become collectable when this
      //    function returns, before any browser work starts.
      const named = await readSheetNames(file);
      expect(named.length, "the set produced no pages").toBeGreaterThan(0);

      // ── A JOB, THROUGH THE UI, so company context is the real thing ──
      await landOnDashboard(page, monitor);
      const jobId = await startJob(page, monitor, {
        name: `ZZ-E2E Tree ${set.label}`,
        gcName: "ZZ-E2E Tree GC",
      });
      await finishWizard(page, monitor, jobId);

      // ── AND THE PLAN SET, SEEDED ──
      const job = await prisma.job.findUniqueOrThrow({
        where: { id: jobId },
        select: { companyId: true },
      });
      const plan = await prisma.takeoffPlan.create({
        data: {
          companyId: job.companyId,
          jobId,
          fileUrl: `https://example.invalid/${set.label}.pdf`,
          fileName: set.file,
          revisionLabel: "Permit set",
        },
        select: { id: true },
      });
      const ingest = await prisma.planIngestJob.create({
        data: {
          planId: plan.id,
          companyId: job.companyId,
          stage: "TITLE_BLOCK",
          pageCount: named.length,
        },
        select: { id: true },
      });
      await prisma.planSheetText.createMany({
        data: named.map((entry) => ({
          planId: plan.id,
          pageNumber: entry.page,
          hasTextLayer: entry.number !== "" || entry.title !== "",
          widthPt: 3024,
          heightPt: 2160,
        })),
      });
      await prisma.planSheetProposal.createMany({
        data: named
          .filter((entry) => entry.number !== "" || entry.title !== "")
          .map((entry) => ({
            ingestJobId: ingest.id,
            planId: plan.id,
            pageNumber: entry.page,
            proposedSheetNumber: entry.number || null,
            proposedTitle: entry.title || null,
            // NULL, so the tree's PREFIX rule is what these screenshots show.
            // Filling it would be photographing a model's answer instead.
            proposedDiscipline: null,
            proposedReason: "seeded from the sheet's own title block",
            proposedConfidence: "HIGH",
            model: "none — glyph-height reader",
            promptVersion: "n/a",
          })),
      });

      await page.goto(`/takeoff/${jobId}`);
      await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible({ timeout: 120_000 });

      const tree = page.locator('[data-takeoff="sheet-tree"]');
      if ((await page.locator('[data-takeoff="sheet-rail"]').count()) === 0) {
        await page.locator('[data-takeoff="toggle-sheets"]').click();
      }
      await expect(tree).toBeVisible();

      // ── GIVE THE DRAWING A CHANCE, BUT DO NOT REQUIRE IT ──
      //
      // The first run photographed "Drawing…" and a rail of placeholder page
      // numbers — the loading state, which is not what anybody is being asked
      // to approve. So this waits.
      //
      // It does NOT assert, because the subject of this screenshot is the
      // RAIL, and a drawing that is merely slow should not fail it. The
      // console line says which happened, so a blank canvas in a screenshot
      // can never be mistaken for a fast one.
      const drawingDeadline = Date.now() + 90_000;
      let drew = false;
      while (Date.now() < drawingDeadline) {
        drew = await page
          .locator('[data-testid="takeoff-plan-port"] canvas')
          .evaluate((n) => (n as HTMLCanvasElement).width > 0)
          .catch(() => false);
        if (drew) break;
        await page.waitForTimeout(2000);
      }
      // A moment for the visible thumbnails, which queue behind the page.
      await page.waitForTimeout(drew ? 4000 : 1000);

      // ── WHAT LANDED WHERE, read off the SCREEN rather than recomputed ──
      const groups = await tree.locator('[data-takeoff="tree-group"]').evaluateAll((nodes) =>
        nodes.map((node) => ({
          key: node.getAttribute("data-key") ?? "?",
          count: node.querySelectorAll('[data-takeoff="tree-sheet"]').length,
        })),
      );
      const total = groups.reduce((sum, group) => sum + group.count, 0);
      expect(total, "the tree listed fewer sheets than the set has").toBe(named.length);

      const unfiled = groups.find((group) => group.key === "—")?.count ?? 0;
      // eslint-disable-next-line no-console -- this spec's output IS its report.
      console.log(
        `[tree] ${set.label}: ${named.length} sheets · ` +
          groups.map((g) => `${g.key}=${g.count}`).join(" ") +
          ` · not filed ${unfiled} (${((unfiled / named.length) * 100).toFixed(1)}%)` +
          ` · drawing ${drew ? "rendered" : "DID NOT render within 90s"}`,
      );

      await page.screenshot({ path: path.join(OUT, `tree-${set.label}-1440.png`) });
      // Widened so the whole rail and several groups read in one picture.
      await tree.locator('[data-takeoff="sheet-search"]').fill("plan");
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `tree-${set.label}-search-plan.png`) });
      await tree.locator('[data-takeoff="sheet-search"]').fill("");

      expect(monitor.crashes, "the browser threw on a real set").toEqual([]);
    });
  }
});
