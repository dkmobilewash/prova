import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Dialog, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { prisma } from "@prova/db";
import { pageInventoryWork, realDeps } from "../../lib/plan-ingest/pageInventory";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { openFinders } from "../lib/finders";

/**
 * THE TAKEOFF CLICK LIST, AS A SPEC. LOCAL ONLY: `pnpm test:e2e -- --takeoff-click`.
 *
 * The takeoff features the Chrome rounds clicked by hand (coordination
 * sheets-to-label.md: the takeoff features click test, the combined list, the
 * short re-test and rounds 3 and 4), on the same TRAINING sheets, with the
 * numbers those rounds expected. Each test is one step, named by its part and
 * number; a failed step does not stop the rest, and a step after a failed one may
 * fail for that reason.
 *
 * The sheets are read from TAKEOFF_CLICK_PLANS, outside the repository; nothing
 * of a drawing is written under the tree. Each set is one job, as on :3010, with
 * a page row for every sheet a step opens, a scale only where :3010 had one, and
 * the sheet's number and title as the inventory names them with no model.
 *
 * Where a step needs a place on the drawing (a symbol to box, a wall to click,
 * a line across a room), the point is in page-width units, taken from the
 * training labels: the symbol keys in labels-symbols/, A100's wall key, and the
 * DINING and KITCHEN tags on Joplin A-101.
 */

const PLANS = process.env.TAKEOFF_CLICK_PLANS ?? "";
const SETS = {
  baker: { id: "zz-click-baker", file: "2025.07.08_Baker_EOC_BID.pdf" },
  joplin: { id: "zz-click-joplin", file: "Joplin-community-center.pdf" },
  estreet: { id: "zz-click-estreet", file: "E_Street_421-Set.pdf" },
  irving: { id: "zz-click-irving", file: "Irving-Lofts-Building-A-Cleburne-TX.pdf" },
  topeka: { id: "zz-click-topeka", file: "Topeka-Senior-Villas.pdf" },
} as const;
type SetKey = keyof typeof SETS;
const REV_JOB = "zz-click-rev";
/** page → [sheet number, title as the inventory names it, feet per page width where :3010 had a scale]. */
const PAGES: Record<SetKey, Record<number, [string, string, number | null]>> = {
  baker: { 11: ["A001", "KEYNOTE LEGEND", null], 12: ["A100", "OVERALL FLOOR PLAN", 288], 13: ["A101", "FLOOR PLAN", 288], 52: ["E0.03", "ELECTRICAL LEGEND", null], 54: ["EL1.01", "ELECTRICAL LIGHTING LEVEL 1 PLAN", null] },
  joplin: { 46: ["A-101", "OVERALL FIRST FLOOR PLAN", 288.1829733163914] },
  estreet: { 24: ["A1.1", "DEMOLITION - FLOOR PLAN", null], 27: ["A1.4", "DEMOLITION - ROOF PLAN", null], 28: ["A2.1", "FLOOR PLAN", null], 74: ["E1.2", "ELECTRICAL DEMOLITION - ROOF PLAN", null] },
  irving: { 12: ["DA2.1", "BUILDING A", null], 24: ["AA2.3", "BUILDING A", null] },
  topeka: { 73: ["AS-101", "TOPEKA SENIOR VILLAS VILLAS", null], 74: ["A-101", "TOPEKA SENIOR VILLAS", 384.17074255224526] },
};

let page: Page;
let monitor: HealthMonitor;
const missing = !PLANS || Object.values(SETS).some((s) => !existsSync(join(PLANS, s.file)));

const shown = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const says = (text: string | RegExp, timeout = 30_000) =>
  expect.poll(async () => (typeof text === "string" ? (await shown()).includes(text) : text.test(await shown())), { message: `the page should say ${text}`, timeout }).toBe(true);
const saysNot = (text: string | RegExp) =>
  expect.poll(async () => (typeof text === "string" ? (await shown()).includes(text) : text.test(await shown())), { message: `the page should NOT say ${text}` }).toBe(false);
const hook = (name: string) => page.locator(`[data-takeoff="${name}"]`);
const button = (label: string) => page.getByRole("button", { name: label, exact: true });
/** The first number in a string, commas allowed. */
const num = (s: string | null) => Number((s ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/)?.[0] ?? NaN);

/**
 * A sheet, drawn. NOT `expectHealthy`: the workspace is a full-screen drawing
 * outside the app shell, so it has no main navigation and few visible words —
 * `takeoff-workspace-real.spec.ts` says the same. Pixels on the canvas and no
 * exception in the browser are this screen's floor.
 */
async function sheet(set: SetKey, pageNumber: number) {
  await page.goto(`/takeoff/${SETS[set].id}?page=${pageNumber}`);
  await drawn();
  await says(PAGES[set][pageNumber]![0]);
}
/** This step's sheet: opened only if the page is not already on it. A failed step
 * restarts Playwright's worker, whose beforeAll signs in again on the dashboard,
 * so the step after a failure starts from there. */
async function on(set: SetKey, pageNumber: number) {
  if (!page.url().includes(`/takeoff/${SETS[set].id}?page=${pageNumber}`)) await sheet(set, pageNumber);
}
async function drawn() {
  await expect(hook("workspace")).toBeVisible({ timeout: 120_000 });
  const broken = page.getByText("That page couldn't be drawn.");
  for (let waited = 0; ; waited += 500) {
    // Seen when Clerk answered 429 to the plan route after back-to-back runs: read the
    // server log for "status: 429" before believing this is about the drawing.
    if (await broken.isVisible().catch(() => false)) throw new Error(`${page.url()}: the viewer says "That page couldn't be drawn." (a Clerk 429 in the server log means the run, not the app)`);
    const width = await page.locator('[data-testid="takeoff-plan-port"] canvas').first().evaluate((n) => (n as HTMLCanvasElement).width).catch(() => 0);
    if (width > 0) break;
    if (waited > 180_000) throw new Error(`${page.url()}: the sheet never reached the canvas`);
    await page.waitForTimeout(500);
  }
  // Both stages: since round 10b the open says "Opening the set…", not "Drawing…",
  // and a fresh canvas is 300 px wide before anything is drawn on it.
  await expect(hook("viewer-busy")).toHaveCount(0, { timeout: 180_000 });
  // The items rail starts closed since the full-screen layout; these steps read
  // it, so open it (remembered in this browser from then on).
  if ((await hook("toggle-items").getAttribute("aria-expanded")) === "false") await hook("toggle-items").click();
  expect(monitor.crashes, "the browser threw").toEqual([]);
}
const overlay = () => page.locator('[data-testid="takeoff-plan-port"] svg').first();
/** A point on the drawing, in page-width units, as a place on the screen. */
async function at(x: number, y: number) {
  const box = (await overlay().boundingBox())!;
  return { x: box.x + x * box.width, y: box.y + y * box.width };
}
async function clickAt(x: number, y: number) {
  const p = await at(x, y);
  await page.mouse.click(p.x, p.y);
}
async function drag(x1: number, y1: number, x2: number, y2: number) {
  const a = await at(x1, y1), b = await at(x2, y2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}
async function findWalls() {
  // A sheet titled as something other than a floor plan holds the finder back
  // until "Run anyway", which is what a person presses there.
  const anyway = button("Run anyway");
  if (await anyway.isVisible().catch(() => false)) await anyway.click();
  await hook("find-walls").click();
  await expect(hook("wall-total")).toBeVisible({ timeout: 120_000 });
}
const wallFeet = async () => num(await hook("wall-total").innerText());
async function settledWallFeet(): Promise<number> {
  let last = NaN;
  await expect.poll(async () => { const now = await wallFeet(); const same = now === last; last = now; return same; }, { intervals: [700], timeout: 30_000 }).toBe(true);
  return last;
}
/** Each room as the panel lists it: name and number are fields, the area a cell. */
const roomRows = async () =>
  hook("rooms-panel").locator("tbody").evaluateAll((groups) =>
    groups.map((g) => {
      const first = g.querySelector("tr")!;
      const fields = [...first.querySelectorAll("input")].map((i) => (i as HTMLInputElement).value);
      const cells = [...first.querySelectorAll("td")].map((c) => c.textContent ?? "");
      return { name: fields[0] ?? "", number: fields[1] ?? "", sf: Number((cells[2] ?? "").replace(/,/g, "")) };
    }),
  );
type Room = Awaited<ReturnType<typeof roomRows>>[number];
const isDining = (r: Room) => /DINING/.test(r.name) && /KITCHEN/.test(r.name);
async function ensureWalls() {
  if (!(await hook("wall-total").isVisible().catch(() => false))) await findWalls();
}
async function ensureRooms() {
  if (await hook("rooms-panel").isVisible().catch(() => false)) return;
  await ensureWalls();
  await openFinders(page);
  await hook("find-rooms").click();
  await expect(hook("rooms-panel")).toBeVisible({ timeout: 120_000 });
}
const floorTotal = async () => num((await hook("rooms-panel").innerText()).match(/([\d,]+) sf ·/)?.[1] ?? "");
/** The tool rail's "⋯" menu, open: the tools without a slot of their own are in it. */
async function moreTools() {
  if ((await hook("rail-more").getAttribute("aria-expanded")) !== "true") await hook("rail-more").click();
}
/** A tool, from the rail or its "⋯" menu. `.first()` because the renovation prompt repeats Work area and Exclude like this below the toolbar. */
async function tool(label: string) {
  if (!(await button(label).first().isVisible().catch(() => false))) await moreTools();
  const b = button(label).first();
  // Pressing the tool that is already on turns it off, so press it only when it is not.
  if (!((await b.getAttribute("class")) ?? "").includes("bg-brand")) await b.click();
}

test.describe.configure({ timeout: 180_000 });
test.use({ actionTimeout: 15_000 });
test.skip(missing, "TAKEOFF_CLICK_PLANS must name the folder holding the four training sets");

test.beforeAll(async ({ browser }) => {
  const user = await prisma.user.findFirstOrThrow({ where: { email: PERSONAS.main.email } });
  const companyId = user.companyId;
  await prisma.company.update({ where: { id: companyId }, data: { symbolCountOn: true, roomFinderOn: true, doorsWindowsOn: true, wholeSetTakeoffOn: true } });
  const contact = (await prisma.contact.findFirst({ where: { companyId } })) ?? (await prisma.contact.create({ data: { companyId, name: "ZZ Click GC" } }));
  for (const [key, set] of Object.entries(SETS) as [SetKey, (typeof SETS)[SetKey]][]) {
    if (await prisma.job.findUnique({ where: { id: set.id } })) continue;
    await prisma.job.create({ data: { id: set.id, companyId, contactId: contact.id, name: `ZZ Click ${set.file.replace(/\.pdf$/, "")}`, status: "ESTIMATE" } });
    const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId: set.id, fileUrl: `local:${set.file}`, fileName: set.file, uploadedByUserId: user.id } });
    const ingest = await prisma.planIngestJob.create({ data: { planId: plan.id, companyId, stage: "PAGE_INVENTORY", pageCount: Math.max(...Object.keys(PAGES[key]).map(Number)) } });
    // THE INVENTORY ITSELF, on each sheet a step opens: its text row, its scale
    // reading (which is what the toolbar's printed-scale offer reads) and its name,
    // through the stage's own storage. Only the file read and the company's
    // plan-text switch are stood in for. Seeding these rows by hand left out the
    // scale reading, and Baker A001's "1/8\" = 1'-0\"" offer with it (B8).
    const bytes = readFileSync(join(PLANS, set.file));
    const inventory = pageInventoryWork(
      { planId: plan.id, companyId, ingestJobId: ingest.id, jobId: set.id, startedByUserId: user.id },
      { ...realDeps, readPlanBytes: async () => ({ ok: true as const, bytes: Buffer.from(bytes) }), planTextReadOn: async () => true },
    );
    for (const [n, [, , fpu]] of Object.entries(PAGES[key])) {
      const pageNumber = Number(n);
      const read = await inventory({ id: `seed-${set.id}-${pageNumber}`, pageNumber, stage: "PAGE_INVENTORY", attempts: 1 });
      if (!read.ok) throw new Error(`inventory of ${set.file} p${pageNumber}: ${JSON.stringify(read)}`);
      const row = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber } });
      if (fpu !== null) await prisma.takeoffScaleCalibration.create({ data: { pageId: row.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: String(fpu) } as never });
    }
  }
  // A TWO-ISSUE JOB from two sets on disk, nothing uploaded: Baker as the earlier
  // issue and Topeka as the later, each with an A-101, so Topeka's carries
  // "Compare with earlier version" and the two are different buildings. The
  // newest plan is the one the workspace opens. No scale on either.
  if (!(await prisma.job.findUnique({ where: { id: REV_JOB } }))) {
    await prisma.job.create({ data: { id: REV_JOB, companyId, contactId: contact.id, name: "ZZ Click Two issues", status: "ESTIMATE" } });
    for (const [key, pageNumber, ago] of [["baker", 13, 60_000], ["topeka", 74, 0]] as const) {
      const file = SETS[key].file;
      const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId: REV_JOB, fileUrl: `local:${file}`, fileName: file, uploadedByUserId: user.id, createdAt: new Date(Date.now() - ago) } });
      const ingest = await prisma.planIngestJob.create({ data: { planId: plan.id, companyId, stage: "PAGE_INVENTORY", pageCount: pageNumber } });
      const bytes = readFileSync(join(PLANS, file));
      const inventory = pageInventoryWork(
        { planId: plan.id, companyId, ingestJobId: ingest.id, jobId: REV_JOB, startedByUserId: user.id },
        { ...realDeps, readPlanBytes: async () => ({ ok: true as const, bytes: Buffer.from(bytes) }), planTextReadOn: async () => true },
      );
      const read = await inventory({ id: `seed-${REV_JOB}-${key}`, pageNumber, stage: "PAGE_INVENTORY", attempts: 1 });
      if (!read.ok) throw new Error(`inventory of ${file} p${pageNumber}: ${JSON.stringify(read)}`);
      await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber } });
    }
  }
  page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  monitor = new HealthMonitor(page);
  // ── TAKEOFF_RANGE_LOG=<file>: EVERY PLAN BYTE REQUEST, FOR pdf.js "Bad end offset" ──
  // Seen once in three full runs (R5-11, 2026-11-03) and not since. pdf.js throws
  // it when a range answer ends short of a chunk and is reported as complete.
  // Ruled out so far: the route (every 206 carried a content-length equal to the
  // body), pdf.js's own cancels (teardown only, and it marks itself aborted
  // first) and a navigation cutting a fetch (Chromium rejects the read, measured).
  // With this set, the next occurrence shows the range, status, length and bytes
  // received for the request that did it.
  if (process.env.TAKEOFF_RANGE_LOG) {
    const { appendFileSync } = await import("node:fs");
    const log = (line: string) => appendFileSync(process.env.TAKEOFF_RANGE_LOG!, `${new Date().toISOString()} ${line}\n`);
    page.on("response", async (r) => {
      if (!r.url().includes("/api/takeoff/plan/")) return;
      const h = r.headers();
      let n = -1;
      try { n = (await r.body()).length; } catch (e) { n = -2; }
      log(`${r.request().headers()["range"] ?? "-"} ${r.status()} len=${h["content-length"] ?? "-"} cr=${h["content-range"] ?? "-"} te=${h["transfer-encoding"] ?? "-"} got=${n} ${r.url().split("/api/takeoff/plan/")[1]}`);
    });
    page.on("requestfailed", (q) => { if (q.url().includes("/api/takeoff/plan/")) log(`FAILED ${q.headers()["range"] ?? "-"} ${q.failure()?.errorText}`); });
    page.on("pageerror", (e) => log(`PAGEERROR ${e.message}`));
  }
  await signInAs(page, PERSONAS.main.email);
});

// ── ROUND 5, steps 1-4: the whole-set run on Baker, FIRST ──
// Before any step presses Find the walls: a sheet whose walls are already found
// is not a sheet the whole-set run has left to do, and round 5 ran it on a fresh set.
test("R5-1 the whole-set run on Baker finishes", async () => {
  await page.goto(`/jobs/${SETS.baker.id}/takeoff`);
  await expectHealthy(page, "baker takeoff tab", { monitor });
  const progress = hook("whole-set-progress");
  for (let tries = 0; tries < 10 && !((await progress.textContent().catch(() => "")) ?? "").includes("done"); tries += 1) {
    const go = hook("find-walls-everywhere");
    if (await go.isEnabled().catch(() => false)) await go.click();
    await expect(progress).toContainText(/done|paused|waiting/, { timeout: 300_000 });
  }
  await expect(progress).toContainText("done");
  await expect(hook("whole-set-counts")).toContainText(/\d+ sheets? ha(s|ve) walls/);
});

test("R5-2 'Walls — to confirm' is among the items, with runs and feet", async () => {
  await sheet("baker", 12);
  const row = hook("item-row").filter({ hasText: "Walls — to confirm" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(/\d+ lin ft|\d+ ft|\d/);
});

// Round 5 saw these on A100. Here the set is five sheets, and the run counts A101
// for that level (A100 "passed over: same level"), so the step opens whichever
// sheet the run put them on.
test("R5-3 the sheet with runs to confirm says they are not on the estimate", async () => {
  const held = await prisma.takeoffMeasurement.findFirstOrThrow({ where: { label: "wall, to confirm", page: { plan: { jobId: SETS.baker.id } } }, select: { page: { select: { pageNumber: true } } } });
  await on("baker", held.page.pageNumber);
  await expect(hook("held-walls")).toContainText(/\d+ runs? to confirm, [\d,]+ ft: not on the estimate/);
});

test("R5-4 the estimate has no line for 'Walls — to confirm'", async () => {
  await page.goto(`/jobs/${SETS.baker.id}/estimate`);
  await expectHealthy(page, "baker estimate", { monitor });
  await saysNot("Walls — to confirm");
});

// ── PART A. Count like this, with no scale: Baker EL1.01 ──────────────────
const R1 = { x: 0.2455, y: 0.3412 }, OS = { x: 0.3335, y: 0.4939 }, E2 = { x: 0.3362, y: 0.5269 };
const TROFFERS = [R1, { x: 0.2038, y: 0.369 }];
/** Boxes one symbol and waits for its count: the total on screen until then is the previous box's. */
async function boxSymbol(p: { x: number; y: number }, want: number, hw = 0.006, hh = 0.005) {
  // The last count's panel sits above the sheet and pushes it down; a person clears it first.
  const clear = hook("symbol-count").getByRole("button", { name: "Clear", exact: true });
  if (await clear.isVisible().catch(() => false)) await clear.click();
  await button("Fit").click();
  await tool("Count like this");
  await drag(p.x - hw, p.y - hh, p.x + hw, p.y + hh);
  await expect.poll(async () => num(await hook("symbol-count-total").innerText().catch(() => "")), { timeout: 60_000, message: "the boxed symbol's count" }).toBe(want);
}
/** A mark, clicked where it is drawn: the overlay takes the click, not the mark element. */
/** A mark that A2's hand counts do not sit on: a saved count's dot takes the click
 * on the troffers it marks, so a mark under one cannot be clicked from the sheet. */
async function freeMark(): Promise<number> {
  const dots = await Promise.all([...TROFFERS, OS].map((p) => at(p.x, p.y)));
  const marks = await hook("symbol-match").all();
  for (let n = 0; n < marks.length; n += 1) {
    const b = (await marks[n]!.boundingBox())!;
    const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    if (dots.every((d) => Math.hypot(d.x - c.x, d.y - c.y) > 20)) return n;
  }
  throw new Error("every mark sits under a saved count");
}
async function clickMark(n: number) {
  const box = (await hook("symbol-match").nth(n).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // A hand rests on the mark before pressing; without the pause the press can land mid-render.
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.up();
}
async function acrossSheets() {
  if (await hook("symbol-across-save").isVisible().catch(() => false)) return;
  if ((await hook("symbol-across-start").count()) === 0) await boxSymbol(R1, 21);
  await hook("symbol-across-start").first().click();
  await expect(hook("symbol-across-save")).toBeVisible({ timeout: 170_000 });
}

test("A1 no scale: Count and Count like this pressable, Line and Area grey", async () => {
  await sheet("baker", 54);
  await expect(button("Count")).toBeEnabled();
  await moreTools();
  await expect(button("Count like this")).toBeEnabled();
  await hook("rail-more").click();
  await expect(button("Line")).toBeDisabled();
  await expect(button("Area")).toBeDisabled();
});

test("A2 three hand counts save as ZZ Click Count, under Items", async () => {
  await on("baker", 54);
  await tool("Count");
  for (const p of [...TROFFERS, OS]) await clickAt(p.x, p.y);
  await page.locator('input[name="label"]').fill("ZZ Click Count");
  await page.locator('input[name="label"]').press("Enter");
  await expect(hook("item-row").filter({ hasText: "ZZ Click Count" })).toHaveCount(1, { timeout: 20_000 });
  await expect(hook("item-row").filter({ hasText: "ZZ Click Count" })).toContainText("3");
});

test("A3 an OS occupancy sensor counts 16", async () => {
  await on("baker", 54);
  await boxSymbol(OS, 16);
});

test("A4 an E2 emergency fixture counts 7, the R2 cans left alone", async () => {
  await on("baker", 54);
  await boxSymbol(E2, 7, 0.004, 0.005);
});

test("A5 an R1 troffer counts 21; a dropped mark comes back", async () => {
  await on("baker", 54);
  await boxSymbol(R1, 21);
  // Chrome clicked a mark on the sheet. At 1600 px the count panel opens BESIDE the
  // sheet and squeezes it, so first say how wide the sheet is left.
  const width = (await overlay().boundingBox())?.width ?? 0;
  expect(width, `with the count panel open the sheet is ${Math.round(width)} px wide at a 1600 px window`).toBeGreaterThan(400);
  const mark = await freeMark();
  await clickMark(mark);
  await expect.poll(async () => num(await hook("symbol-count-total").innerText())).toBe(20);
  await clickMark(mark);
  await expect.poll(async () => num(await hook("symbol-count-total").innerText())).toBe(21);
});

// 21, not the 26 an older list expected: E0.03's five are the LEGEND's own symbols,
// not fixtures (Diego, 2026-11-03).
test("A6 Find on all sheets: 21 in all, EL1.01 21, the E0.03 legend and E0.02 0", async () => {
  await on("baker", 54);
  await acrossSheets();
  const rows = (await hook("symbol-across-rows").innerText()).replace(/\s+/g, " ");
  expect(num(await hook("symbol-across-total").innerText()), rows).toBe(21);
  expect(rows).toMatch(/EL1\.01\D+21/);
  expect(rows).toMatch(/E0\.03\s+0\b/);
  // The list shows every sheet of the discipline, zeros included; E0.02 must find nothing.
  expect(rows).toMatch(/E0\.02\s+0\b/);
});

test("A7 Save: 21 on 1 sheet as one count, nothing left unsaved", async () => {
  await on("baker", 54);
  await acrossSheets();
  await hook("symbol-label").fill("ZZ Troffers");
  await hook("symbol-across-save").click();
  await expect(hook("symbol-across-saved")).toContainText("Saved 21 on 1 sheet as one count", { timeout: 30_000 });
  await saysNot("Not saved");
  await expect(hook("item-row").filter({ hasText: "ZZ Troffers" })).toHaveCount(1);
  await expect(button("Line")).toBeDisabled();
});

// ── Send to estimate, from that count ─────────────────────────────────────
test("S1 Send to estimate puts ZZ Troffers on the estimate, with no stale warning", async () => {
  await on("baker", 54);
  // Send to estimate is on the picked item's panel.
  await hook("item-row").filter({ hasText: "ZZ Troffers" }).first().locator('[data-takeoff="pick-item"]').click();
  await hook("send-to-estimate").click();
  await expect(hook("send-result")).toBeVisible({ timeout: 30_000 });
  await page.goto(`/jobs/${SETS.baker.id}/estimate`);
  await expectHealthy(page, "baker estimate", { monitor });
  await says("ZZ Troffers");
  await saysNot(/not on the estimate[^.]*ZZ Troffers/);
});

// ── The takeoff download ──────────────────────────────────────────────────
test("X1 Download Excel: Quantities and Sheets tabs, ZZ Troffers as saved", async () => {
  await on("baker", 54);
  // The download buttons are on the picked item's panel, beside Send to estimate.
  const row = hook("item-row").filter({ hasText: "ZZ Troffers" }).first();
  if ((await hook("send-to-estimate").count()) === 0) await row.locator('[data-takeoff="pick-item"]').click();
  const excel = hook("export-xlsx");
  test.skip((await excel.count()) === 0, "the takeoff download is not on main yet (diego/takeoff-export-xlsx)");
  const [file] = await Promise.all([page.waitForEvent("download"), excel.click()]);
  const book = XLSX.read(readFileSync(await file.path()));
  expect(book.SheetNames).toEqual(["Quantities", "Sheets"]);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.Quantities!);
  // The file must agree with the item it was saved as (A7 says whether that was 26).
  const saved = num((await row.innerText()).match(/([\d,]+) ea/)?.[1] ?? "");
  const troffers = rows.filter((r) => r.Item === "ZZ Troffers");
  expect(troffers.reduce((n, r) => n + Number(r.Quantity), 0), `the item reads ${saved} ea`).toBe(saved);
  expect(troffers.every((r) => r.Unit === "ea" && r.Source === "count")).toBe(true);
});

// ── PART B. Demolition: E Street A1.1, then the sheets that must not offer it ──
test("B1 Find demolition is on the toolbar, grey until a scale", async () => {
  await sheet("estreet", 24);
  await openFinders(page);
  await expect(hook("find-demolition")).toBeVisible();
  await expect(hook("find-demolition")).toBeDisabled();
  await expect(hook("find-demolition")).toHaveAttribute("title", /set the scale/i);
});

/** "Use the printed scale", as the click list says: the toolbar offer opens Set scale
 * on the title block's reading, which offers "Use the printed scale"; where the
 * form still waits, "Set the scale" saves it. */
async function takeOfferedScale(scale: string) {
  await expect(hook("toolbar-scale-offer"), "the printed-scale offer").toContainText(scale, { timeout: 30_000 });
  await hook("toolbar-scale-offer").click();
  await button("Use the printed scale").click();
  const save = button("Set the scale");
  if (await save.isVisible({ timeout: 3000 }).catch(() => false)) await save.click();
  await expect(hook("find-demolition")).toBeEnabled({ timeout: 20_000 });
}

test("B2 the printed scale is offered: 1/4\" = 1'-0\"", async () => {
  await on("estreet", 24);
  await takeOfferedScale(`1/4" = 1'-0"`);
  await expect(hook("find-demolition")).toBeEnabled({ timeout: 20_000 });
});

test("B3 Find demolition: 24 walls to remove, 226 ft, 4 doors", async () => {
  await on("estreet", 24);
  await openFinders(page);
  await hook("find-demolition").click();
  await expect(hook("demo-total")).toContainText("24 walls to remove, 226 ft · 4 doors", { timeout: 60_000 });
});

test("B4 unticking a run takes it out of the count and the feet", async () => {
  await on("estreet", 24);
  if ((await hook("demo-total").count()) === 0) { await openFinders(page); await hook("find-demolition").click(); }
  await hook("demo-panel").getByRole("checkbox").first().uncheck();
  const total = await hook("demo-total").innerText();
  expect(total).toContain("23 walls");
  expect(num(total.match(/([\d,]+) ft/)?.[1] ?? "")).toBeLessThan(226);
});

test("B5 Save to takeoff: Demo walls and Demo doors, still there after a reload", async () => {
  await on("estreet", 24);
  await hook("demo-save").click();
  await expect(hook("item-row").filter({ hasText: "Demo walls" })).toHaveCount(1, { timeout: 20_000 });
  await page.reload();
  await drawn();
  await expect(hook("item-row").filter({ hasText: "Demo walls" })).toHaveCount(1, { timeout: 30_000 });
  await expect(hook("item-row").filter({ hasText: "Demo doors" })).toHaveCount(1);
});

test("B6 saving it again is refused, and adds no item", async () => {
  await on("estreet", 24);
  await openFinders(page);
  await hook("find-demolition").click();
  await expect(hook("demo-save")).toBeVisible({ timeout: 60_000 });
  await hook("demo-save").click();
  await says(/already saved/i);
  await expect(hook("item-row").filter({ hasText: /^Demo walls|Demo walls/ })).toHaveCount(1);
});

for (const [n, what] of [[28, "A2.1, a new floor plan"], [27, "A1.4, the roof demolition"], [74, "E1.2, electrical demolition"]] as const) {
  test(`B7 no Find demolition on ${what}`, async () => {
    await sheet("estreet", n);
    await expect(hook("find-demolition")).toHaveCount(0);
  });
}

test("B8 Baker A001 (keynote legend with a demo plan): 0 walls, 2 doors", async () => {
  await sheet("baker", 11);
  await openFinders(page);
  await expect(hook("find-demolition")).toBeVisible();
  await takeOfferedScale(`1/8" = 1'-0"`);
  await openFinders(page);
  await hook("find-demolition").click();
  await expect(hook("demo-total")).toContainText(/0 walls[^·]*· 2 doors/, { timeout: 60_000 });
});

// ── PART C. Rooms and Split area: Joplin A-101 ─────────────────────────────
// Across the open dining area at y = 0.306, between the DINING (y 0.274) and
// KITCHEN (y 0.337) tags; the room's outline crosses that line at x 0.480 and 0.603.
const SPLIT = { x1: 0.4815, y: 0.306, x2: 0.6018 };
let joplinWalls = NaN;
let wholeSf = NaN;
let wholeFloor = NaN;

// ── CHROME'S CLICK TEST, 2026-11-05: rooms off STORED walls came out unnamed ──
// Baker A101's walls are stored by the whole-set run (R5-1), so a fresh visit
// shows them without the finder having read the sheet in this browser, and
// Find the rooms named none of its rooms though the sheet prints them.
test("C0 Baker A101, straight from the stored walls: Find the rooms names the rooms the sheet prints", async () => {
  await sheet("baker", 13);
  await expect(hook("found-walls").or(hook("layer-row")).first(), "no stored walls on Baker A101 to start from").toBeVisible({ timeout: 60_000 });
  await openFinders(page);
  await hook("find-rooms").click();
  await expect(hook("rooms-panel")).toBeVisible({ timeout: 180_000 });
  const rows = await roomRows();
  const named = rows.filter((r) => r.name.trim() !== "");
  expect(rows.length, "no rooms at all").toBeGreaterThan(0);
  expect(named.length, `named ${named.length} of ${rows.length}: ${rows.map((r) => r.name || "·").join(", ")}`).toBeGreaterThanOrEqual(Math.min(6, rows.length));
  expect(named.map((r) => r.name).join(" | ")).toMatch(/CONFERENCE|CALL CENTER|STORAGE|JANITOR/);
});

test("C1 Find the walls then the rooms: the panel opens itself, about 70 rooms, no renovation prompt", async () => {
  await sheet("joplin", 46);
  await findWalls();
  joplinWalls = await settledWallFeet();
  await expect(hook("renovation-prompt")).toHaveCount(0);
  await openFinders(page);
  await hook("find-rooms").click();
  await expect(hook("rooms-panel")).toBeVisible({ timeout: 120_000 });
  const rooms = num(await hook("rooms-panel").locator("h3").innerText());
  wholeFloor = await floorTotal();
  expect(rooms, `rooms ${rooms}, floor ${wholeFloor} sf`).toBeGreaterThanOrEqual(58);
  expect(rooms).toBeLessThanOrEqual(75);
});

test("C2 one row DINING + KITCHEN + HALL + HALL, about 1,642 sf", async () => {
  await on("joplin", 46);
  await ensureRooms();
  const row = (await roomRows()).find(isDining);
  expect(row, "no DINING + KITCHEN … row").toBeTruthy();
  expect(row!.name).toBe("DINING + KITCHEN + HALL + HALL");
  wholeSf = row!.sf;
  if (Number.isNaN(wholeFloor)) wholeFloor = await floorTotal();
  if (Number.isNaN(joplinWalls)) joplinWalls = await settledWallFeet();
  expect(Math.abs(wholeSf - 1642), `${wholeSf} sf`).toBeLessThan(25);
});

async function splitDining() {
  await tool("Split area");
  await drag(SPLIT.x1, SPLIT.y, SPLIT.x2, SPLIT.y);
  await expect(hook("split-line")).toHaveCount(1, { timeout: 20_000 });
}

test("C3 Split area: two rows that add up to the room, and the floor total does not move", async () => {
  await on("joplin", 46);
  await ensureRooms();
  if (Number.isNaN(wholeSf)) wholeSf = (await roomRows()).find(isDining)?.sf ?? NaN;
  if (Number.isNaN(wholeFloor)) wholeFloor = await floorTotal();
  if (Number.isNaN(joplinWalls)) joplinWalls = await settledWallFeet();
  await splitDining();
  await expect.poll(async () => (await roomRows()).some(isDining), { timeout: 60_000 }).toBe(false);
  const parts = (await roomRows()).filter((r) => /DINING|KITCHEN/.test(r.name));
  const said = parts.map((r) => `${r.name} ${r.sf}`).join(" | ");
  expect(parts, said).toHaveLength(2);
  const sum = parts.reduce((n, r) => n + r.sf, 0);
  // The panel rounds each room to a whole foot, so two parts may differ from the whole by 1 in display.
  expect(Math.abs(sum - wholeSf), `${said} = ${sum} against ${wholeSf}`).toBeLessThanOrEqual(1);
  expect(Math.abs((await floorTotal()) - wholeFloor), `floor total ${await floorTotal()} against ${wholeFloor}`).toBeLessThanOrEqual(1);
  expect(await settledWallFeet()).toBe(joplinWalls);
});

test("C4 Undo puts the one row back; Redo splits it again", async () => {
  await on("joplin", 46);
  // Undo needs the split drawn in this session; a fresh page holds C3's saved split and no history.
  if (await hook("undo").isDisabled().catch(() => true)) {
    await ensureRooms();
    if ((await hook("split-line").count()) > 0) {
      await hook("remove-splits").click();
      await expect(hook("split-line")).toHaveCount(0, { timeout: 20_000 });
    }
    await splitDining();
  }
  await hook("undo").click();
  await expect.poll(async () => (await roomRows()).some(isDining), { timeout: 60_000 }).toBe(true);
  await hook("redo").click();
  await expect.poll(async () => (await roomRows()).some(isDining), { timeout: 60_000 }).toBe(false);
});

test("C5 after a reload the line is still there; Remove split gives one row again", async () => {
  await on("joplin", 46);
  if ((await hook("split-line").count()) === 0) {
    await ensureRooms();
    await splitDining();
  }
  await ensureWalls();
  if (Number.isNaN(joplinWalls)) joplinWalls = await settledWallFeet();
  await page.reload();
  await drawn();
  await expect(hook("split-line")).toHaveCount(1, { timeout: 30_000 });
  await findWalls();
  await openFinders(page);
  await hook("find-rooms").click();
  await expect.poll(async () => (await roomRows()).filter((r) => /DINING|KITCHEN/.test(r.name)).length, { timeout: 120_000 }).toBe(2);
  await hook("remove-splits").click();
  await expect(hook("split-line")).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(async () => (await roomRows()).some(isDining), { timeout: 60_000 }).toBe(true);
  expect(await settledWallFeet()).toBe(joplinWalls);
});

// ── PART D. Doors and windows: Baker A101 ──────────────────────────────────
test("D1 Find the walls: the panel opens itself with 18 doors and 9 windows to check", async () => {
  await sheet("baker", 13);
  await findWalls();
  await says(/\b18 doors\b/, 60_000);
  await says(/\b9 windows to check\b/);
});

// ── PART E. Work area, Exclude like this, undo, the renovation prompt: Baker A100 ──
// A wall the key calls a wall: x 0.2977, y 0.3142 to 0.469 (44.6 ft).
const WALL = { x: 0.2977, y: 0.39 };
const AREA = [{ x: 0.18, y: 0.235 }, { x: 0.3, y: 0.235 }, { x: 0.3, y: 0.52 }, { x: 0.18, y: 0.52 }];
let bakerWalls = NaN;

test("E1 Find the walls: about 1,742 ft, and the renovation prompt with its two tools", async () => {
  await sheet("baker", 12);
  await findWalls();
  bakerWalls = await settledWallFeet();
  expect(Math.abs(bakerWalls - 1742), `${bakerWalls} ft`).toBeLessThan(90);
  await expect(hook("renovation-prompt")).toContainText("This sheet shows existing work.");
  await expect(hook("renovation-work-area")).toBeVisible();
  await expect(hook("renovation-exclude")).toBeVisible();
});

test("E2 Exclude like this: the total drops and says why, and stays said", async () => {
  await on("baker", 12);
  await ensureWalls();
  if (Number.isNaN(bakerWalls)) bakerWalls = await settledWallFeet();
  await tool("Exclude like this");
  await clickAt(WALL.x, WALL.y);
  await says(/walls? drawn like the wall you clicked/);
  await expect.poll(wallFeet).toBeLessThan(bakerWalls);
  await page.waitForTimeout(5000);
  await says(/walls? drawn like the wall you clicked/);
  await expect(hook("renovation-prompt")).toHaveCount(0);
});

test("E3 one Undo restores the total exactly; Redo takes them away; Clear restores it", async () => {
  await on("baker", 12);
  await hook("undo").click();
  await expect.poll(wallFeet).toBe(bakerWalls);
  await hook("redo").click();
  await expect.poll(wallFeet).toBeLessThan(bakerWalls);
  await hook("clear-exclusions").click();
  await expect.poll(wallFeet).toBe(bakerWalls);
});

test("E4 a saved work area drops the walls outside it", async () => {
  await on("baker", 12);
  await ensureWalls();
  await tool("Work area");
  for (const p of AREA) await clickAt(p.x, p.y);
  await clickAt(AREA[0]!.x, AREA[0]!.y);
  await hook("save-work-area").click();
  await says("outside the work area you drew");
  await expect.poll(wallFeet).toBeLessThan(bakerWalls);
});

test("E5 after a reload Remove work area is offered first; removing it restores the total", async () => {
  await page.reload();
  await drawn();
  await expect(hook("remove-work-area")).toBeVisible({ timeout: 60_000 });
  await hook("remove-work-area").click();
  await findWalls();
  expect(await settledWallFeet()).toBe(bakerWalls);
});

// ── Review walls: K, D, U on Baker A100 ────────────────────────────────────
test("R1 Review walls: K keeps, D drops and the total falls, U takes it back", async () => {
  await on("baker", 12);
  await ensureWalls();
  await openFinders(page);
  await hook("review-walls").click();
  const counter = hook("review-counter");
  await expect(counter).toContainText(/^0 of \d+ reviewed/);
  const of = num((await counter.innerText()).replace(/^0 of /, ""));
  await page.keyboard.press("k");
  await expect(counter).toContainText(`1 of ${of} reviewed`);
  const before = await wallFeet();
  await page.keyboard.press("d");
  await expect(counter).toContainText(`2 of ${of} reviewed`);
  await expect.poll(wallFeet).toBeLessThan(before);
  await page.keyboard.press("u");
  await expect(counter).toContainText(`1 of ${of} reviewed`);
  await expect.poll(wallFeet).toBe(before);
  await hook("review-close").click();
});

// ── Suggested scale: Irving Lofts, no scale saved ──────────────────────────
test("G1 Irving p12: a 1/8\" scale suggested from 9 doors; Not this leaves no scale", async () => {
  await sheet("irving", 12);
  await expect(hook("scale-suggestion")).toContainText(/Suggested 1\/8" = 1'-0" from 9 doors: confirm\?/, { timeout: 60_000 });
  await hook("dismiss-suggested-scale").click();
  await expect(hook("scale-suggestion")).toHaveCount(0);
  await expect(button("Line")).toBeDisabled();
});

test("G2 after a reload, Confirm applies it and Find the walls works", async () => {
  await on("irving", 12);
  await page.reload();
  await drawn();
  await expect(hook("confirm-suggested-scale")).toBeVisible({ timeout: 60_000 });
  await hook("confirm-suggested-scale").click();
  await expect(button("Line")).toBeEnabled({ timeout: 20_000 });
  await findWalls();
  expect(await wallFeet()).toBeGreaterThan(0);
});

test("G3 Irving p24: 3/16\" from 18 doors, nothing applied until Confirm", async () => {
  await sheet("irving", 24);
  await expect(hook("scale-suggestion")).toContainText(/Suggested 3\/16" = 1'-0" from 18 doors: confirm\?/, { timeout: 60_000 });
  await expect(button("Line")).toBeDisabled();
  await hook("confirm-suggested-scale").click();
  await expect(button("Line")).toBeEnabled({ timeout: 20_000 });
});

// ── The takeoff download on the job's Takeoff tab (Chrome round 5, steps 21-22) ──
const stemOf = (name: string) => `${name.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "job"}-takeoff`;

test("X2 the Takeoff tab downloads Excel and CSV, named after the job", async () => {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: SETS.baker.id }, select: { name: true } });
  await page.goto(`/jobs/${SETS.baker.id}/takeoff`);
  await expectHealthy(page, "baker takeoff tab", { monitor });
  const [xlsx] = await Promise.all([page.waitForEvent("download"), hook("export-xlsx").click()]);
  expect(xlsx.suggestedFilename()).toBe(`${stemOf(job.name)}.xlsx`);
  expect(XLSX.read(readFileSync(await xlsx.path())).SheetNames).toEqual(["Quantities", "Sheets"]);
  const [csv] = await Promise.all([page.waitForEvent("download"), hook("export-csv").click()]);
  expect(csv.suggestedFilename()).toBe(`${stemOf(job.name)}.csv`);
  expect(readFileSync(await csv.path(), "utf8").split("\n")[0]).toBe("Item,Sheet,Quantity,Unit,Source,Note");
});

test("X3 on a job with nothing measured, either button says so", async () => {
  const user = await prisma.user.findFirstOrThrow({ where: { email: PERSONAS.main.email } });
  const contact = await prisma.contact.findFirstOrThrow({ where: { companyId: user.companyId } });
  const id = "zz-click-empty";
  if (!(await prisma.job.findUnique({ where: { id } }))) await prisma.job.create({ data: { id, companyId: user.companyId, contactId: contact.id, name: "ZZ Click Empty", status: "ESTIMATE" } });
  await page.goto(`/jobs/${id}/takeoff`);
  await expectHealthy(page, "empty takeoff tab", { monitor });
  await hook("export-xlsx").click();
  await says("Nothing is measured on this job yet.");
});

// ── ROUND 5's PASSING STEPS, so Chrome need not click them again ─────────────
// Numbered as round 5 numbers them (sheets-to-label.md, "CHROME ROUND 5").

test("R5-6 Topeka A-101: Review walls starts at 0 of N, on a highlighted run", async () => {
  await sheet("topeka", 74);
  await findWalls();
  await openFinders(page);
  await hook("review-walls").click();
  await expect(hook("review-counter")).toContainText(/^0 of \d+ reviewed/);
  // Drawn on the overlay, which Playwright cannot call "visible"; that it is there is the check.
  await expect(hook("review-run")).toHaveCount(1);
});

test("R5-8 D then U: the run comes back and the counter returns to 0", async () => {
  await on("topeka", 74);
  if (!(await hook("review-counter").isVisible().catch(() => false))) {
    await findWalls();
    await openFinders(page);
    await hook("review-walls").click();
  }
  await page.keyboard.press("d");
  await expect(hook("review-counter")).toContainText(/^1 of \d+ reviewed/);
  await page.keyboard.press("u");
  await expect(hook("review-counter")).toContainText(/^0 of \d+ reviewed/);
});

test("R5-10 Done, then K pages to the previous sheet again", async () => {
  await on("topeka", 74);
  if (await hook("review-close").isVisible().catch(() => false)) await hook("review-close").click();
  await expect(hook("review-counter")).toHaveCount(0);
  await page.keyboard.press("k");
  // K pages inside the viewer; the sheet picker says which sheet is open.
  const picker = page.getByRole("combobox", { name: /Jump to a sheet/ });
  await expect.poll(async () => picker.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? "")).toContain("AS-101");
});

test("R5-11 Review walls in the top bar opens a sheet at 0 of N looked at · 0 ft dropped", async () => {
  await sheet("baker", 12);
  await hook("review-set").click();
  await expect(hook("review-counter")).toContainText(/^0 of \d+ looked at · 0 ft dropped/);
  // The first run is on whichever sheet holds it, and the viewer must open that sheet.
  const where = (await hook("review-counter").locator("xpath=..").innerText()).match(/sheet (\S+)/)?.[1] ?? "";
  const picker = page.getByRole("combobox", { name: /Jump to a sheet/ });
  await expect.poll(async () => picker.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? "")).toContain(where);
  await expect(hook("review-run")).toHaveCount(1);
});

test("R5-12/13 D moves on and adds the dropped feet; U takes it back; Done", async () => {
  if (!(await hook("review-counter").isVisible().catch(() => false))) {
    await sheet("baker", 12);
    await hook("review-set").click();
  }
  await page.keyboard.press("d");
  await expect(hook("review-counter")).toContainText(/^1 of \d+ looked at · [1-9][\d,]* ft dropped/);
  await page.keyboard.press("u");
  await expect(hook("review-counter")).toContainText(/^0 of \d+ looked at · 0 ft dropped/);
  await hook("review-close").click();
  await expect(hook("review-counter")).toHaveCount(0);
});

test("R5-15 Baker A101 shows the renovation prompt, and a saved work area takes it away", async () => {
  await sheet("baker", 13);
  await findWalls();
  await expect(hook("renovation-prompt")).toContainText("This sheet shows existing work.");
  await hook("renovation-work-area").click();
  // Round the left part of A101's plan (its key walls run x 0.334-0.565, y 0.252-0.525).
  const area = [{ x: 0.33, y: 0.245 }, { x: 0.45, y: 0.245 }, { x: 0.45, y: 0.53 }, { x: 0.33, y: 0.53 }];
  // Three points are enough for Save; a person draws round and presses it.
  for (const p of area) await clickAt(p.x, p.y);
  await hook("save-work-area").click();
  await says("outside the work area you drew");
  await expect(hook("renovation-prompt")).toHaveCount(0);
});

test("R5-19 Quantities on a sheet with nothing found says nothing is measured yet", async () => {
  await sheet("joplin", 46);
  if ((await hook("quantities-empty").count()) === 0) await hook("toggle-panel").click();
  await expect(hook("quantities-empty")).toContainText("No quantities on this sheet yet.");
});

test("R5-20 deleting an item offers to delete its measurements, ticked, and leaves nothing in Unassigned", async () => {
  await sheet("baker", 54);
  const row = hook("item-row").filter({ hasText: "ZZ Click Count" }).first();
  await expect(row).toBeVisible();
  const unassignedBefore = (await hook("unassigned").innerText().catch(() => "")).replace(/\s+/g, " ");
  await row.hover();
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  const box = page.locator('[data-takeoff="delete-item-measurements"]');
  await expect(box).toBeChecked();
  await expect(box.locator("xpath=..")).toContainText(/Also delete its \d+ measurements?/);
  await page.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await expect(hook("item-row").filter({ hasText: "ZZ Click Count" })).toHaveCount(0, { timeout: 20_000 });
  const unassignedAfter = (await hook("unassigned").innerText().catch(() => "")).replace(/\s+/g, " ");
  expect(unassignedAfter, "nothing new in Unassigned").toBe(unassignedBefore);
});


// ── COUNT LIKE THIS, WHATEVER THE BOX: Baker EL1.01 ───────────────────────
test("CB1 a loose box round an R1 troffer counts 21, the same as the close one", async () => {
  await on("baker", 54);
  await boxSymbol(R1, 21, 0.012, 0.012);
  await boxSymbol(R1, 21, 0.0062, 0.0042);
});

test("CB2 a box round an OS sensor and its neighbours asks which; the sensor counts 16", async () => {
  await on("baker", 54);
  const clear = hook("symbol-count").getByRole("button", { name: "Clear", exact: true });
  if (await clear.isVisible().catch(() => false)) await clear.click();
  await button("Fit").click();
  await tool("Count like this");
  await drag(OS.x - 0.009, OS.y - 0.009, OS.x + 0.009, OS.y + 0.009);
  await expect(hook("symbol-which")).toContainText(/That box holds \d symbols/, { timeout: 60_000 });
  // The estimator clicks the numbered symbol they meant: the one drawn round the sensor.
  const target = await at(OS.x, OS.y);
  const choices = await hook("symbol-choice").all();
  let picked = -1;
  for (let i = 0; i < choices.length && picked < 0; i += 1) {
    const b = (await choices[i]!.boundingBox())!;
    if (target.x >= b.x && target.x <= b.x + b.width && target.y >= b.y && target.y <= b.y + b.height) picked = i;
  }
  expect(picked, "a numbered choice is drawn round the sensor").toBeGreaterThanOrEqual(0);
  await hook("symbol-pick").nth(picked).click();
  await expect.poll(async () => num(await hook("symbol-count-total").innerText().catch(() => "")), { timeout: 60_000 }).toBe(16);
});

// ── ROUND 6 ───────────────────────────────────────────────────────────────
/** The rooms drawn on the sheet, as rings in page-width units. */
const roomRings = async () =>
  (await hook("room").evaluateAll((ps) => ps.map((p) => p.getAttribute("points") ?? ""))).map((pts) => {
    const xy = pts.trim().split(/\s+/).map((pair) => pair.split(",").map(Number));
    return { xs: xy.map((q) => q[0]!), ys: xy.map((q) => q[1]!) };
  });
async function clearSplits() {
  if ((await hook("split-line").count()) > 0) {
    await hook("remove-splits").click();
    await expect(hook("split-line")).toHaveCount(0, { timeout: 20_000 });
  }
}

test("R6-1 two lines across the dining room: the parts add up and the floor total does not move", async () => {
  await on("joplin", 46);
  await ensureRooms();
  await clearSplits();
  await expect.poll(async () => (await roomRows()).some(isDining), { timeout: 60_000 }).toBe(true);
  const floor = await floorTotal(), rows = (await roomRows()).length;
  // The dining room's own outline, so the second line crosses it wall to wall.
  const mid = { x: (SPLIT.x1 + SPLIT.x2) / 2, y: SPLIT.y };
  const ring = (await roomRings()).find((r) => r.xs.some((_, i) => r.ys[i]! < mid.y) && r.xs.some((_, i) => r.ys[i]! > mid.y) && Math.min(...r.xs) < mid.x && Math.max(...r.xs) > mid.x);
  expect(ring, "a drawn room holds the split's middle").toBeDefined();
  const x = SPLIT.x1 + (SPLIT.x2 - SPLIT.x1) * 0.7;
  await splitDining();
  await drag(x, Math.min(...ring!.ys) - 0.002, x, Math.max(...ring!.ys) + 0.002);
  await expect(hook("split-line")).toHaveCount(2, { timeout: 20_000 });
  await expect.poll(async () => (await roomRows()).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(rows + 2);
  expect(Math.abs((await floorTotal()) - floor), `floor total ${await floorTotal()} against ${floor}`).toBeLessThanOrEqual(1);
  await clearSplits();
});

test("R6-2 a split stopped 3 ft short of each wall is taken to the walls and divides the room", async () => {
  await on("joplin", 46);
  await ensureRooms();
  await clearSplits();
  const short = 3 / PAGES.joplin[46]![2]!;
  await tool("Split area");
  await drag(SPLIT.x1 + short, SPLIT.y, SPLIT.x2 - short, SPLIT.y);
  await expect(hook("split-line")).toHaveCount(1, { timeout: 20_000 });
  await expect.poll(async () => (await roomRows()).some(isDining), { timeout: 60_000 }).toBe(false);
  await clearSplits();
});

test("R6-3 a split in no room is refused, saying why, and nothing is recorded", async () => {
  await on("joplin", 46);
  await ensureRooms();
  await clearSplits();
  await tool("Split area");
  await drag(0.02, 0.02, 0.05, 0.02);
  await says("The line must reach a wall at both ends.");
  await expect(hook("split-line")).toHaveCount(0);
});

test("R6-4 Topeka A-101 Review walls: D on a run not yet on the job says it only takes it off this list", async () => {
  await sheet("topeka", 74);
  await findWalls();
  await openFinders(page);
  await hook("review-walls").click();
  await says("D only takes it off this list");
  await page.keyboard.press("d");
  await expect(hook("review-counter")).toContainText(/^1 of \d+ reviewed/);
  await page.keyboard.press("u");
  await hook("review-close").click();
});

test("R6-5 no Compare with earlier version on a sheet with one issue", async () => {
  await on("topeka", 74);
  await expect(hook("compare-revision")).toHaveCount(0);
});

test("R6-6 a two-issue job: Compare says too much changed, and Find the walls says why it waits", async () => {
  await page.goto(`/takeoff/${REV_JOB}?page=74`);
  await drawn();
  await hook("compare-revision").click();
  await expect(hook("revision-redrawn")).toContainText("Too much changed to draw", { timeout: 120_000 });
  await expect(hook("revision-find-walls")).toBeDisabled();
  await expect(hook("revision-find-why")).toContainText(/scale|Run anyway|plan/i);
  // Where the toolbar offers the printed scale, so does the panel.
  if ((await hook("toolbar-scale-offer").count()) > 0) await expect(hook("revision-scale-offer")).toBeVisible();
});

// ── THE ANSWER-KEY TOOL, ROUND 10: Baker A101 with ?key=1 ─────────────────
// Saves go to the throwaway TAKEOFF_LABEL_DIR the config makes, never the real labels.
const KEY_URL = `/takeoff/${SETS.baker.id}?page=13&key=1`;
async function keySheet() {
  if (!page.url().endsWith(KEY_URL)) {
    await page.goto(KEY_URL);
    await drawn();
  }
  if ((await hook("key-line").count()) === 0) {
    const anyway = button("Run anyway");
    if (await anyway.isVisible().catch(() => false)) await anyway.click();
    await hook("find-walls").click();
    await expect.poll(async () => hook("key-line").count(), { timeout: 120_000 }).toBeGreaterThan(0);
  }
}
/** The screen centre of a candidate's line, and a point a few pixels off it. */
async function besideLine(n: number) {
  const line = hook("key-line").nth(n);
  const [x1, y1, x2, y2] = await Promise.all(["x1", "y1", "x2", "y2"].map(async (a) => Number(await line.getAttribute(a))));
  const mid = await at((x1! + x2!) / 2, (y1! + y2!) / 2);
  const len = Math.hypot(x2! - x1!, y2! - y1!) || 1;
  // 5 px off the line, across it: a hand, not a pixel-perfect aim.
  return { id: (await line.getAttribute("data-id"))!, mid, off: { x: mid.x - ((y2! - y1!) / len) * 5, y: mid.y + ((x2! - x1!) / len) * 5 } };
}
const focusedRow = () => page.locator('[data-takeoff="key-candidate"][data-focused="true"]');
/** A step run on its own starts with an empty name box; Save needs one. */
async function ensureReviewer() {
  if ((await hook("key-reviewer").inputValue()) === "") await hook("key-reviewer").fill("ZZ Spec");
}

test("K1 every candidate's number is drawn on its line, and stays on it through a zoom", async () => {
  await keySheet();
  const lines = await hook("key-line").count();
  await expect(hook("key-number")).toHaveCount(lines);
  const near = async () => {
    const { mid } = await besideLine(0);
    const box = (await hook("key-number").first().boundingBox())!;
    return Math.hypot(box.x + box.width / 2 - mid.x, box.y + box.height / 2 - mid.y);
  };
  expect(await hook("key-number").first().textContent()).toBe("1");
  expect(await near(), "number 1 sits on line 1").toBeLessThan(20);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(500);
  expect(await near(), "and is still on it after zooming in").toBeLessThan(20);
});

test("K2 a click beside a line on the drawing selects it", async () => {
  await keySheet();
  const { id, off } = await besideLine(2);
  await page.mouse.click(off.x, off.y);
  await expect(focusedRow()).toHaveAttribute("data-id", id);
});

test("K3 A, R and U register: with the name box focused then the drawing clicked, and with nothing selected", async () => {
  await keySheet();
  // Focus left in the name box is what a reviewer has after typing it.
  await hook("key-reviewer").click();
  const { id, off } = await besideLine(3);
  await page.mouse.click(off.x, off.y);
  await expect(focusedRow()).toHaveAttribute("data-id", id);
  await page.keyboard.press("a");
  await expect(page.locator(`[data-takeoff="key-candidate"][data-id="${id}"]`)).toHaveAttribute("data-verdict", "wall");
  await expect(hook("key-reviewer")).toHaveValue("");
  // Nothing selected: a click on empty paper clears it, and R takes the first undecided one.
  await clickAt(0.02, 0.02);
  await expect(focusedRow()).toHaveCount(0);
  const rejected = () => page.locator('[data-takeoff="key-candidate"][data-verdict="not-a-wall"]').count();
  const before = await rejected();
  await page.keyboard.press("r");
  await expect.poll(rejected).toBe(before + 1);
  const unsure = () => page.locator('[data-takeoff="key-candidate"][data-verdict="unsure"]').count();
  const u0 = await unsure();
  await page.keyboard.press("u");
  await expect.poll(unsure).toBe(u0 + 1);
});

test("K4 Save says to fill in Reviewed by, and the name is remembered in this browser", async () => {
  await keySheet();
  await expect(hook("key-need-reviewer")).toHaveText("Fill in Reviewed by to save");
  await expect(hook("key-save-labels")).toBeDisabled();
  await hook("key-need-reviewer").click();
  await expect(hook("key-reviewer")).toBeFocused();
  await page.keyboard.type("ZZ Spec");
  await expect(hook("key-need-reviewer")).toHaveCount(0);
  await page.reload();
  await drawn();
  // The panel appears once the candidates do.
  await keySheet();
  await expect(hook("key-reviewer")).toHaveValue("ZZ Spec");
});

test("K5 a stale draft is said beside Save with Restore and Discard, and Save still works", async () => {
  await keySheet();
  // A decision not yet saved is a draft in this browser; a reload leaves it waiting.
  const { off } = await besideLine(4);
  await page.mouse.click(off.x, off.y);
  await page.keyboard.press("a");
  await page.reload();
  await drawn();
  await keySheet();
  const labels = hook("key-labels");
  await expect(labels.locator('[data-takeoff="key-restore"]')).toContainText("unsaved review in this browser");
  await expect(labels.locator('[data-takeoff="key-restore-yes"]')).toBeVisible();
  await expect(labels.locator('[data-takeoff="key-restore-no"]')).toBeVisible();
  await expect(hook("key-save-labels")).toBeEnabled();
  await labels.locator('[data-takeoff="key-restore-yes"]').click();
  await expect(labels.locator('[data-takeoff="key-restore"]')).toHaveCount(0);
});

test("K6 Save to labels says how many decisions it saved", async () => {
  await keySheet();
  await ensureReviewer();
  await hook("key-save-labels").click();
  await expect(hook("key-labels-saved")).toHaveText(/^Saved \d+ decisions? to /, { timeout: 30_000 });
});

/** A sheet opened from the sheet tree, which moves the workspace (j/k move only the viewer). */
async function treeSheet(pageNumber: number) {
  if ((await page.locator('[data-takeoff="sheet-tree"]').count()) === 0) await hook("toggle-sheets").click();
  await page.locator(`[data-takeoff="tree-sheet"][data-page="${pageNumber}"] button`).first().click();
  await drawn();
}

test("K7 a saved trace, still in memory, is not restored a second time on coming back to the sheet", async () => {
  await keySheet();
  await page.keyboard.press("t");
  await clickAt(0.36, 0.30);
  await clickAt(0.42, 0.30);
  await page.keyboard.press("Enter");
  await expect(hook("key-progress")).toContainText("1 traced");
  await ensureReviewer();
  await hook("key-save-labels").click();
  await expect(hook("key-labels-saved")).toHaveText(/^Saved \d+ decisions? to /, { timeout: 30_000 });
  // Away to A100 and its walls, then back to A101. A GUARD ON THE RESULT, NOT A REPRODUCTION:
  // run against a build without the dedupe, this sequence (and a Restore raced against a
  // late-loading saved file) still showed "1 traced", so the round-10 "2 traced" needs a path
  // not found here. The dedupe itself is proved in restoreSaved.test.ts, mutation-tested.
  await treeSheet(12);
  await hook("find-walls").click();
  await expect.poll(async () => hook("key-line").count(), { timeout: 120_000 }).toBeGreaterThan(0);
  await treeSheet(13);
  await page.waitForTimeout(4000);
  await expect(hook("key-progress")).toContainText("1 traced");
});

test("K8 the help says only NEW walls are walls, and NIC is not", async () => {
  await keySheet();
  await hook("key-help-toggle").click();
  await says("Only NEW walls are walls.");
  await saysNot("NIC counts");
});

// ── ROUND 10b ──
test("K9 Save as answer key clears the draft, so another job's URL opens", async () => {
  await keySheet();
  await ensureReviewer();
  const { off } = await besideLine(5);
  await page.mouse.click(off.x, off.y);
  await page.keyboard.press("a");
  const download = page.waitForEvent("download");
  await hook("key-save").click();
  await download;
  await expect(hook("key-saved")).toBeVisible();
  // Before: the leave-warning stayed armed, Playwright dismisses it like an
  // automation browser does, and a dismissed prompt cancels the navigation.
  await page.goto(`/takeoff/${SETS.joplin.id}?page=46`, { timeout: 30_000 });
  await drawn();
  await page.goto(KEY_URL);
  await drawn();
  await keySheet();
  await expect(hook("key-restore")).toHaveCount(0);
});

test("K10 the help says partial-height walls count", async () => {
  await keySheet();
  await hook("key-help-toggle").click();
  await says("Partial-height walls");
});

test("K11 the labels route takes a TRACE-ONLY sheet: no candidates, traces only", async () => {
  // The panel half (no pairings is not a refusal) is in answerKeyPanel.test.tsx;
  // this is the server half, through the real route, into the throwaway folder.
  const response = await page.request.post("/api/takeoff/labels", {
    data: {
      set: SETS.baker.file, sheet: "ZZ-trace-only", page: 99, reviewedBy: "ZZ Spec", feetPerUnit: 288,
      candidates: [],
      verdicts: [{ x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.1, lengthFeet: 57.6, thicknessFeet: 0, verdict: "traced" }],
    },
  });
  const body = (await response.json()) as { ok: boolean; error?: string };
  expect(body.error ?? "").toBe("");
  expect(body.ok).toBe(true);
});

test("K12 a draft with a split restores, and says nothing about the finder reading it differently", async () => {
  await keySheet();
  // The longest of the first twenty lines, so a cut at its middle leaves two real halves.
  const lens = await hook("key-line").evaluateAll((ls) => ls.slice(0, 20).map((l) => Math.hypot(Number(l.getAttribute("x2")) - Number(l.getAttribute("x1")), Number(l.getAttribute("y2")) - Number(l.getAttribute("y1")))));
  const n = lens.indexOf(Math.max(...lens));
  const { id, mid, off } = await besideLine(n);
  await page.mouse.click(off.x, off.y);
  await expect(focusedRow()).toHaveAttribute("data-id", id);
  const before = await hook("key-line").count();
  await page.keyboard.down("Shift");
  await page.mouse.click(mid.x, mid.y);
  await page.keyboard.up("Shift");
  await expect(hook("key-line")).toHaveCount(before + 1);
  const { off: half } = await besideLine(n);
  await page.mouse.click(half.x, half.y);
  await page.keyboard.press("a");
  await page.reload();
  await drawn();
  await keySheet();
  const labels = hook("key-labels");
  await labels.locator('[data-takeoff="key-restore-yes"]').click();
  await saysNot("Could not restore");
  await expect(hook("key-line")).toHaveCount(before + 1);
});

test("K13 Save to labels through the button saves a TRACE-ONLY sheet: nothing offered, one trace", async () => {
  // Round 10c: Washington Village A.100 (0 candidates, 8 traces) still read as
  // refused on :3010. K11 is the route alone; this is the button, end to end,
  // on a legend sheet where Find the walls offers nothing.
  await page.goto(`/takeoff/${SETS.baker.id}?page=11&key=1`);
  await drawn();
  const printed = page.getByRole("button", { name: /^Use the printed scale/ });
  if (await printed.isVisible().catch(() => false)) await printed.click();
  // The offer opens Set scale with the printed figure filled in; Set the scale keeps it.
  const confirm = button("Use the printed scale");
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  // B8 has usually set this sheet's scale earlier in the same run, and then
  // there is no form to press; the line after this is what proves a scale.
  const setIt = button("Set the scale");
  if (await setIt.isVisible().catch(() => false)) await setIt.click();
  await saysNot("Set the scale on this sheet before measuring");
  // A001 reads as an elevations sheet, so the finder waits to be told.
  await button("Run anyway").click();
  await hook("find-walls").click();
  await expect(hook("key-progress")).toBeVisible({ timeout: 120_000 });
  await expect(hook("key-line")).toHaveCount(0);
  await page.keyboard.press("t");
  await clickAt(0.36, 0.30);
  await clickAt(0.42, 0.30);
  await page.keyboard.press("Enter");
  await expect(hook("key-progress")).toContainText("1 traced");
  await ensureReviewer();
  await hook("key-save-labels").click();
  await expect(hook("key-labels-saved")).toHaveText(/^Saved 1 decision to /, { timeout: 30_000 });
});

test("K14 the plan file answers a big set's burst of range requests, none refused", async () => {
  // Round 10c: Hutto (247 MB, 142 pages) sat on "Opening the set…" for 85 s
  // with nearly every plan request a 503 — each range request asked Clerk's
  // backend for the user, and Clerk answered 429. 150 at once is a big set's
  // open; a known user must now cost Clerk nothing.
  const planUrl = page.waitForResponse((r) => r.url().includes("/api/takeoff/plan/"));
  await page.goto(`/takeoff/${SETS.topeka.id}?page=74`);
  const url = (await planUrl).url();
  await drawn();
  const statuses = await Promise.all(
    Array.from({ length: 150 }, (_, i) =>
      page.request.get(url, { headers: { range: `bytes=${i * 65536}-${i * 65536 + 65535}` } }).then((r) => r.status()),
    ),
  );
  const refused = statuses.filter((s) => s !== 206);
  expect(refused, `statuses other than 206: ${[...new Set(refused)].join(", ")}`).toEqual([]);
});

test("K15 a reload with a trace unsaved is not stopped by the leave prompt, and a trace after Restore gets a new id", async () => {
  // Joplin A-101: no other step traces or saves here, so the counts are this step's own.
  const url = `/takeoff/${SETS.joplin.id}?page=46&key=1`;
  const open = async () => {
    await page.goto(url);
    await drawn();
  };
  const find = async () => {
    const anyway = button("Run anyway");
    if (await anyway.isVisible().catch(() => false)) await anyway.click();
    await hook("find-walls").click();
    await expect(hook("key-progress")).toBeVisible({ timeout: 120_000 });
  };
  await open();
  await find();
  const traceAt = async (y: number) => {
    await page.keyboard.press("t");
    await clickAt(0.36, y);
    await clickAt(0.42, y);
    await page.keyboard.press("Enter");
  };
  const tracedNow = async () => Number(/(\d+) traced/.exec((await hook("key-progress").textContent()) ?? "")?.[1] ?? 0);
  const before = 0;
  await traceAt(0.32);
  await expect.poll(tracedNow).toBe(before + 1);
  // Round 10c: the prompt cancelled Chrome's reload and the tab kept stale JS.
  // The draft holds the trace, so nothing asks.
  const prompts: string[] = [];
  const onDialog = (d: Dialog) => { prompts.push(d.type()); void d.accept(); };
  page.on("dialog", onDialog);
  await page.reload();
  page.off("dialog", onDialog);
  expect(prompts).toEqual([]);
  await drawn();
  await find();
  await hook("key-labels").locator('[data-takeoff="key-restore-yes"]').click();
  await expect.poll(tracedNow).toBe(before + 1);
  await traceAt(0.34);
  await expect.poll(tracedNow).toBe(before + 2);
  // Read back what the browser kept: two traces, two ids.
  const ids = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith("takeoff-review-draft:") && k.includes(":46:"))
      .flatMap((k) => (JSON.parse(localStorage.getItem(k)!) as { traced: { id: string }[] }).traced.map((t) => t.id)),
  );
  expect(ids.length).toBe(before + 2);
  expect(new Set(ids).size, `trace ids ${ids.join(", ")}`).toBe(ids.length);
});
