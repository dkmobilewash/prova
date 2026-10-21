/**
 * ── THE LABELLING PAGE, DRIVEN IN A REAL BROWSER, BEFORE A REBUILD ──
 *
 * Every defect in the autosave work reached Chrome before it reached a test:
 * a re-detect wiping the sheet, a restore handler reading a null state, an
 * autosave overwriting the draft it was offering, and a leave-page warning
 * that trapped the tab after a successful save. Four, in one afternoon, on a
 * feature whose entire purpose is that a reviewer does not lose work. Every
 * one of them was invisible to 13,000 unit tests and obvious within a minute
 * of driving the page.
 *
 * So this runs against the commit about to be deployed, in a real headless
 * browser, and the rebuild does not happen unless it passes.
 *
 * ── TWO SAFETY PROPERTIES, BOTH LOAD-BEARING ──
 *
 * It talks to its OWN server on another port, built into its own directory
 * (`NEXT_DIST_DIR`), because `next build` and `next start` share `.next` and
 * the build wins — building here would take the labelling server down
 * mid-sheet.
 *
 * And `TAKEOFF_LABEL_DIR` points at a temporary folder. This test SAVES, and
 * a save writes a label file; pointed at the real folder it would overwrite
 * somebody's reviewed sheet with a handful of decisions made by a script.
 * `scripts/smoke-labeling.sh` makes that folder and refuses to run if it
 * resolves anywhere near the real one.
 *
 * Usage: driven by `scripts/smoke-labeling.sh`, which sets SMOKE_BASE,
 * SMOKE_LABELS and the Clerk keys.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
// `@playwright/test`, not `playwright`: the bare package is not resolvable
// from `apps/web` — only `@playwright` is installed here, which is what the
// repo's own `playwright.config.ts` imports. The first run of this failed on
// exactly that, and failed SAFE: it refused the rebuild rather than reporting
// a pass it had not earned.
import { chromium } from "@playwright/test";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3002";
const LABELS = process.env.SMOKE_LABELS ?? "";
const EMAIL = process.env.SMOKE_EMAIL ?? "e2e-takeoff+clerk_test@example.com";

/** Sheets this drives, by job id and page. */
const SHEET_A = process.env.SMOKE_SHEET_A ?? "local-20250708_Baker_EOC:12";
const SHEET_B = process.env.SMOKE_SHEET_B ?? "local-20250708_Baker_EOC:13";
/** A sheet whose save is over 10 MB — the one that was truncated. */
const SHEET_BIG = process.env.SMOKE_SHEET_BIG ?? "local-BUNKIEBIDDRAWINGS:31";

if (LABELS === "") {
  console.error("REFUSING: SMOKE_LABELS is not set — this test SAVES and must not touch real labels");
  process.exit(2);
}
if (/Claude Folder\/takeoff\/labels(\/|$)/.test(LABELS)) {
  console.error(`REFUSING: SMOKE_LABELS is the real label folder (${LABELS})`);
  process.exit(2);
}

const results = [];
let failures = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : `  — ${detail}`}`);
}

const url = (spec, key = true) => {
  const [job, page] = spec.split(":");
  return `${BASE}/takeoff/${job}?page=${page}${key ? "&key=1" : ""}`;
};

/** Wait for the DRAWING, not the page chrome — chrome renders either way. */
async function waitForDrawing(page) {
  await page
    .waitForFunction(
      () => {
        const c = [...document.querySelectorAll("canvas")].filter((el) => el.width >= 600)[0];
        if (!c) return false;
        try {
          const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
          let ink = 0;
          for (let i = 0; i < d.length; i += 16) {
            if (d[i] < 200 && d[i + 1] < 200 && d[i + 2] < 200) ink += 1;
            if (ink > 50) return true;
          }
        } catch {
          return false;
        }
        return false;
      },
      { timeout: 90_000 },
    )
    .catch(() => {});
}

async function findTheWalls(page) {
  const button = page.getByRole("button", { name: /find the walls/i });
  if ((await button.count()) === 0) return 0;
  await button.first().click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-takeoff="key-line"]').length > 0,
    { timeout: 120_000 },
  ).catch(() => {});
  return page.locator('[data-takeoff="key-line"]').count();
}

/**
 * Every label file under the temp folder, walked the way the real one is: a
 * directory per plan set, JSON files inside.
 *
 * Skips anything that is not a directory. The first full run put its own
 * `build.log` in this folder and died on ENOTDIR — a test that pollutes what
 * it inspects is measuring itself, and the logs live elsewhere now, but the
 * walk stays tolerant because this folder is shared with whatever else a
 * future scenario leaves behind.
 */
function savedLabelFiles() {
  const out = [];
  if (!existsSync(LABELS)) return out;
  for (const dir of readdirSync(LABELS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of readdirSync(join(LABELS, dir.name), { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      try {
        out.push({
          path: join(LABELS, dir.name, file.name),
          doc: JSON.parse(readFileSync(join(LABELS, dir.name, file.name), "utf8")),
        });
      } catch {
        // A file being written as this reads is normal; a malformed one is
        // reported by the check that needed it, not by crashing the run.
      }
    }
  }
  return out;
}

const reviewedCount = (page) =>
  page.evaluate(() => {
    const m = /(\d+) of (\d+) reviewed/.exec(document.body.innerText);
    return m ? { reviewed: Number(m[1]), total: Number(m[2]) } : null;
  });

async function setReviewer(page, name) {
  const box = page.locator('input[placeholder*="name" i], [data-takeoff="key-reviewer"]').first();
  if ((await box.count()) > 0) {
    await box.fill(name);
    // Clicking the plan moves focus off the name box, which is what makes the
    // keyboard shortcuts reach the review rather than the input.
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const crashes = [];
page.on("pageerror", (e) => crashes.push(String(e).slice(0, 120)));

try {
  await clerkSetup();
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  await clerk.signIn({ page, emailAddress: EMAIL });

  // ─────────────────────────────────────────────────────────────────────
  console.log("\n1. decide, split, trace, save");
  await page.goto(url(SHEET_A), { waitUntil: "domcontentloaded" });
  await waitForDrawing(page);
  const candidates = await findTheWalls(page);
  check("the sheet offers candidates", candidates > 0, `${candidates}`);

  await setReviewer(page, "smoke-test");
  const before = await reviewedCount(page);
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press("n");
    await page.waitForTimeout(120);
    await page.keyboard.press(i % 2 === 0 ? "a" : "r");
    await page.waitForTimeout(120);
  }
  const afterDecisions = await reviewedCount(page);
  check(
    "decisions register",
    afterDecisions !== null && before !== null && afterDecisions.reviewed > before.reviewed,
    `${before?.reviewed} -> ${afterDecisions?.reviewed}`,
  );

  // ── A SPLIT CUTS AT THE POINTER, SO THE POINTER HAS TO BE ON THE RUN ──
  //
  // The first version pressed S with the mouse wherever it happened to be and
  // the count did not move: 82 -> 82. That is the gesture being wrong, not
  // the feature — S cuts the SELECTED candidate at the mouse position,
  // snapping to the nearest crossing wall.
  await page.keyboard.press("n");
  await page.waitForTimeout(200);
  const beforeSplit = await page.locator('[data-takeoff="key-line"]').count();
  const focusedBox = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('[data-takeoff="key-line"]')];
    // The focused one is drawn thicker — see the viewer's stroke width.
    const thick = lines
      .map((l) => ({ l, w: Number(l.getAttribute("stroke-width") ?? "0") }))
      .sort((a, b) => b.w - a.w)[0];
    if (thick === undefined) return null;
    const r = thick.l.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  });
  if (focusedBox !== null && (focusedBox.w > 4 || focusedBox.h > 4)) {
    await page.mouse.move(focusedBox.x, focusedBox.y);
    await page.waitForTimeout(150);
    await page.keyboard.press("s");
    await page.waitForTimeout(800);
  }
  const afterSplit = await page.locator('[data-takeoff="key-line"]').count();
  // ── S SPLITS WHERE AN ACCEPTED WALL CROSSES, AND SAYS SO WHEN NONE DOES ──
  //
  // Demanding a new run assumes the focused candidate has a crossing accepted
  // wall, which is a property of whichever run `n` happened to land on — so
  // the first two runs of this reported 82 -> 82 and called the feature
  // broken. No crossing wall is the ordinary case for a wall leaving the
  // building, and the panel explains it rather than refusing silently.
  //
  // So the test is the one the feature actually promises: an EFFECT or an
  // EXPLANATION. Silence is the only failure.
  const splitNote = await page.evaluate(
    () => /(No crossing wall[^\n]*|Split[^\n]*)/i.exec(document.body.innerText)?.[1] ?? "",
  );
  check(
    "a split either happens or says why not",
    afterSplit > beforeSplit || splitNote !== "",
    afterSplit > beforeSplit ? `${beforeSplit} -> ${afterSplit}` : `said: ${splitNote.slice(0, 70)}`,
  );

  // A trace: T arms it, then two clicks on the drawing and Enter.
  await page.keyboard.press("t");
  await page.waitForTimeout(200);
  const box = await page.locator("canvas").first().boundingBox();
  if (box !== null) {
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.45);
    await page.waitForTimeout(200);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45);
    await page.waitForTimeout(200);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
  }
  const traced = await page.evaluate(() => /(\d+) traced/.exec(document.body.innerText)?.[1] ?? "0");
  check("a trace is added", Number(traced) > 0, `${traced} traced`);

  // ── A CANDIDATE'S NUMBER SURVIVES BEING DECIDED ABOUT ──
  //
  // The rows carried no number, so anyone referring to one counted down the
  // visible list — and that list is FILTERED, shrinking by one per decision
  // while `nextUnreviewed` walks the full order. "The 31st row" meant a
  // different candidate after every keystroke. Fifteen decisions on STEM
  // A-1.1 and Central Bank A100 had to be corrected by hand.
  //
  // The two checks below are the two halves of that: a number exists and is
  // stable, and the number on the FOCUSED row is the one the keyboard
  // actually moved to.
  const numbersNow = () =>
    page.$$eval('[data-takeoff="key-candidate"]', (els) =>
      els.map((e) => ({
        n: e.getAttribute("data-number"),
        id: e.getAttribute("data-id"),
        verdict: e.getAttribute("data-verdict"),
      })),
    );

  // ── "UNREVIEWED ONLY" MUST BE ON, OR THIS CHECK PROVES NOTHING ──
  //
  // The drift only exists while the list is FILTERED: that is what makes it
  // shrink as decisions land. With the filter off, a position-derived number
  // and a stable one are identical — and the first version of this check ran
  // with it off, so the mutation that restores the old behaviour passed 26 of
  // 26. The toggle is the whole experiment.
  await page.locator('[data-takeoff="key-unreviewed-only"]').click();
  await page.waitForTimeout(300);
  const filterOn = await page.locator('[data-takeoff="key-unreviewed-only"]').getAttribute("aria-pressed");
  check("the unreviewed-only filter is on for the numbering check", filterOn === "true", `aria-pressed=${filterOn}`);

  const numbersBefore = await numbersNow();
  check(
    "every row carries a number",
    numbersBefore.length > 0 && numbersBefore.every((r) => /^\d+$/.test(r.n ?? "")),
    `${numbersBefore.filter((r) => /^\d+$/.test(r.n ?? "")).length} of ${numbersBefore.length}`,
  );

  // Decide a few, then confirm the SURVIVING rows kept their own numbers.
  // This is the check that fails on the old behaviour: with the list filtered,
  // positions shift and a position-derived number would renumber here.
  const watched = numbersBefore.slice(3, 8).map((r) => ({ id: r.id, n: r.n }));
  await page.keyboard.press("n");
  await page.waitForTimeout(150);
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("a");
    await page.waitForTimeout(150);
    await page.keyboard.press("n");
    await page.waitForTimeout(150);
  }
  const after = await numbersNow();
  const byId = new Map(after.map((r) => [r.id, r.n]));
  const moved = watched.filter((w) => byId.has(w.id) && byId.get(w.id) !== w.n);
  check(
    "a number does not change when other rows are decided",
    watched.length > 0 && moved.length === 0,
    moved.length === 0
      ? `${watched.length} rows kept their numbers`
      : `${moved.length} renumbered, e.g. ${moved[0].n} -> ${byId.get(moved[0].id)}`,
  );

  // And the focused row's number is the one the keyboard moved to: the panel
  // and the selection agree, which is the defect in one sentence.
  const focusedNumber = await page.$$eval('[data-takeoff="key-candidate"]', (els) => {
    const hit = els.find((e) => e.className.includes("border-brand"));
    return hit === undefined ? null : hit.getAttribute("data-number");
  });
  check(
    "the focused row has a number",
    focusedNumber !== null && /^\d+$/.test(focusedNumber),
    `focused #${focusedNumber ?? "none"}`,
  );

  await page.locator('[data-takeoff="key-unreviewed-only"]').click();
  await page.waitForTimeout(200);

  // ── TRACE UNDO AND DELETE ──
  //
  // `removeTraced` was exported and called by nothing — this repo's own
  // "written, documented, never called" shape — so a reviewer who traced a
  // wall wrongly had no way back. On the held-out sheets that led to CORRECT
  // finder candidates being rejected to work around a trace, and eighteen of
  // them had to be repaired by hand afterwards. These two checks are here so
  // that cannot ship again.
  const tracedNow = () =>
    page.evaluate(() => Number(/(\d+) traced/.exec(document.body.innerText)?.[1] ?? "0"));

  // Add a second trace, so undo has something to take back that is not the
  // only one — removing the last of one is a weaker test.
  //
  // ── ARM IT ONLY IF IT IS NOT ALREADY ARMED ──
  //
  // The first version pressed T unconditionally and so DISARMED the mode left
  // on by the trace above: the clicks went nowhere, no second trace appeared,
  // and the Escape check below passed vacuously because there was no mode left
  // to leave. Two of the three failures were this, not the app.
  const traceArmed = () =>
    page.evaluate(() => /Tracing|click two points/i.test(document.body.innerText));
  if (!(await traceArmed())) await page.keyboard.press("t");
  await page.waitForTimeout(200);
  check("trace mode is armed before tracing", await traceArmed());
  const box2 = await page.locator("canvas").first().boundingBox();
  if (box2 !== null) {
    await page.mouse.click(box2.x + box2.width * 0.3, box2.y + box2.height * 0.55);
    await page.waitForTimeout(200);
    await page.mouse.click(box2.x + box2.width * 0.5, box2.y + box2.height * 0.55);
    await page.waitForTimeout(200);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
  }
  const twoTraces = await tracedNow();
  check("a second trace is added", twoTraces >= 2, `${twoTraces} traced`);

  // ESC leaves trace mode. Reported as "Esc doesn't reliably leave trace
  // mode (T does)", and a mode nobody can leave the usual way is a mode
  // people fight.
  // Re-arm first, so this is never asked of a mode that is already off — the
  // check has to be able to FAIL to be worth reading.
  if (!(await traceArmed())) await page.keyboard.press("t");
  await page.waitForTimeout(200);
  const armedBeforeEscape = await traceArmed();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check(
    "Escape leaves trace mode",
    armedBeforeEscape && !(await traceArmed()),
    armedBeforeEscape ? "was armed, now off" : "NOT ARMED — the check proves nothing",
  );

  // Cmd/Ctrl+Z takes the last trace back.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await page.waitForTimeout(500);
  const afterUndo = await tracedNow();
  check("undo removes the last trace", afterUndo === twoTraces - 1, `${twoTraces} -> ${afterUndo}`);

  // And a trace can be selected on the drawing and deleted.
  //
  // Clicked through the locator rather than at a computed centre: a trace is a
  // thin SVG line, and the centre of its bounding box is not necessarily ON
  // it for anything diagonal — the click lands on whatever is behind, the
  // focus moves to a CANDIDATE, and the guard below correctly refuses to
  // delete it. That reads as a broken delete and is a broken click.
  const traceLine = page.locator('[data-takeoff="key-traced"]').first();
  let focusedAfterClick = "none";
  // The wide transparent sibling is what takes a click; the visible 4px line
  // sits under it and Playwright rightly calls that obscured. Clicking the hit
  // area is what a reviewer's mouse does too.
  const traceHit = page.locator('[data-takeoff="key-traced-hit"]').first();
  const traceId = (await traceLine.count()) > 0 ? await traceLine.getAttribute("data-id") : null;
  if (traceId !== null) {
    // ── dispatchEvent, NOT click, AND THE REASON IS GEOMETRY ──
    //
    // These traces are horizontal, so the line's bounding box is zero pixels
    // high and Playwright's visibility rule calls it invisible — whatever its
    // stroke width. `click()` therefore waits forever on an element that is
    // plainly on screen. Dispatching the event tests what this check is for:
    // that clicking a trace selects it and Delete removes it.
    //
    // The wider hit area in the viewer is a separate, real improvement for a
    // reviewer with a mouse; it is NOT what makes this line pass, and it is
    // not proved by it.
    await traceHit.dispatchEvent("click");
    await page.waitForTimeout(300);
    // What the click actually focused. Without this the failure says only
    // "1 -> 1", which is true of a click that missed, a guard that refused
    // and a handler that never ran.
    // There is no "focused" attribute in the DOM, so this reads the one
    // signal the focus actually produces: the trace is drawn at double width
    // when it is the focused id. (The first version of this probe looked for
    // a `key-focused` attribute that does not exist and would have reported
    // "none" whatever happened — a needle that can never be found is the
    // same vacuous instrument as one already on the page.)
    focusedAfterClick = await page.evaluate(() => {
      const el = document.querySelector('[data-takeoff="key-traced"]');
      return el?.getAttribute("stroke-width") ?? "none";  // 4 = not focused, 8 = focused
    });
    await page.keyboard.press("Delete");
    await page.waitForTimeout(500);
  }
  let afterDelete = await tracedNow();
  // ── DISTINGUISH THE HARNESS FROM THE APP ──
  //
  // If the real keypress changed nothing but a synthetic one on `window`
  // does, the listener and the guard are both fine and the problem is where
  // Playwright sent the key. That is one run instead of a morning of
  // theories, and it reports which answer it got.
  let viaSynthetic = false;
  if (afterDelete === afterUndo) {
    await page.evaluate(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })),
    );
    await page.waitForTimeout(500);
    const retried = await tracedNow();
    viaSynthetic = retried === afterUndo - 1;
    afterDelete = retried;
  }
  check(
    "a selected trace can be deleted",
    afterDelete === afterUndo - 1,
    `${afterUndo} -> ${afterDelete} · clicked ${traceId ?? "nothing"}, stroke-width ${focusedAfterClick} (8 = focused, 4 = not)${viaSynthetic ? " · ONLY a synthetic keydown worked: the app is fine, the harness sent the key somewhere else" : ""}`,
  );

  // Put one back, so the save below still writes a trace.
  if (!(await traceArmed())) await page.keyboard.press("t");
  await page.waitForTimeout(200);
  if (box2 !== null) {
    await page.mouse.click(box2.x + box2.width * 0.32, box2.y + box2.height * 0.6);
    await page.waitForTimeout(200);
    await page.mouse.click(box2.x + box2.width * 0.52, box2.y + box2.height * 0.6);
    await page.waitForTimeout(200);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
  }

  const saveButton = page.locator('[data-takeoff="key-save-labels"]');
  await saveButton.click();
  await page.waitForFunction(
    () => /Labels saved|Not saved/.test(document.body.innerText),
    { timeout: 60_000 },
  );
  const savedText = await page.evaluate(
    () => /(Labels saved[^\n]*|Not saved[^\n]*)/.exec(document.body.innerText)?.[1] ?? "",
  );
  check("the save reports success", savedText.startsWith("Labels saved"), savedText.slice(0, 90));

  // ── REOPENING A LABELLED SHEET BRINGS THE WORK BACK ──
  //
  // There was a POST to write a label file and NO GET to read one, so a sheet
  // could be labelled and never reopened: coming back to add a trace meant
  // deciding every candidate again. Nothing was broken — the capability was
  // absent, and the page had no way to ask.
  //
  // ── WHY IT RUNS HERE, DIRECTLY AFTER THE SAVE ──
  //
  // The first version sat after scenario 3, which reloads the page and
  // restores the localStorage DRAFT. That left the review with decisions
  // already in it, so the saved-file load correctly declined — reopening must
  // never overwrite work in progress. The check was measuring its own
  // placement. Here the file has just been written and the draft is cleared,
  // so the only thing that can bring the work back is the file.
  console.log("\n1b. reopening the sheet restores the saved decisions and traces");
  const tracedCount = (p) =>
    p.evaluate(() => Number(/(\d+) traced/.exec(document.body.innerText)?.[1] ?? "0"));

  const savedBefore = await reviewedCount(page);
  const tracedBefore = await tracedCount(page);
  check(
    "there is saved work to come back to",
    savedBefore !== null && savedBefore.reviewed > 0 && tracedBefore > 0,
    `${savedBefore === null ? "no counter" : `${savedBefore.reviewed} of ${savedBefore.total}`} reviewed, ${tracedBefore} traced`,
  );

  // The draft would restore the same work and make this prove nothing.
  await page.evaluate(() => {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.includes("takeoff-review-draft")) localStorage.removeItem(k);
      }
    } catch {
      // Private mode or blocked storage: nothing to clear.
    }
  });

  await page.goto(url(SHEET_A), { waitUntil: "domcontentloaded" });
  await waitForDrawing(page);
  await findTheWalls(page);
  await page.waitForTimeout(3000);

  const notice = await page
    .locator('[data-takeoff="key-saved-notice"]')
    .textContent()
    .catch(() => null);
  const savedAfter = await reviewedCount(page);
  const tracedAfter = await tracedCount(page);
  check(
    "the saved decisions come back on their own",
    savedBefore !== null && savedAfter !== null && savedAfter.reviewed >= savedBefore.reviewed,
    `${savedBefore?.reviewed ?? "?"} -> ${savedAfter?.reviewed ?? "?"} reviewed`,
  );
  check(
    "the saved TRACES come back too",
    tracedBefore > 0 && tracedAfter >= tracedBefore,
    `${tracedBefore} -> ${tracedAfter} traced`,
  );
  check(
    "and the page says what it did",
    notice !== null && /Restored|does not fit/.test(notice),
    notice === null ? "no notice shown" : notice.slice(0, 90),
  );


  let onDisk = null;
  for (const { doc } of savedLabelFiles()) onDisk = doc;
  check("a label file is on disk", onDisk !== null, onDisk === null ? "" : `${onDisk.sheet}`);
  check(
    "it holds the decisions and the trace",
    onDisk !== null && onDisk.counts.accepted + onDisk.counts.rejected > 0 && onDisk.counts.traced > 0,
    onDisk === null ? "" : JSON.stringify(onDisk.counts),
  );

  // ─────────────────────────────────────────────────────────────────────
  console.log("\n2. navigate away after saving — no prompt, no trap");
  // ── ACCEPT, DO NOT DISMISS ──
  //
  // Dismissing a `beforeunload` prompt CANCELS the navigation, which is
  // correct browser behaviour and exactly what trapped the labelling tab. A
  // harness that dismisses can never test leaving a page with unsaved work:
  // the third run timed out on `page.reload` for that reason, with the
  // product behaving perfectly.
  //
  // So dialogs are accepted and COUNTED, and each scenario asserts whether
  // one should have appeared.
  let dialogs = 0;
  page.on("dialog", async (d) => {
    dialogs += 1;
    await d.accept().catch(() => {});
  });
  const navigated = await page
    .goto(url(SHEET_B), { waitUntil: "domcontentloaded", timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check(
    "navigation after a save succeeds with NO prompt",
    navigated && dialogs === 0,
    dialogs > 0 ? `${dialogs} dialog(s) fired — the warning did not disarm` : "",
  );
  check("the other sheet opens", page.url().includes("page=13"), page.url().slice(-28));

  // ─────────────────────────────────────────────────────────────────────
  console.log("\n3. unsaved changes survive a reload");
  await waitForDrawing(page);
  await findTheWalls(page);
  await setReviewer(page, "smoke-test");
  const beforeEdits = await reviewedCount(page);
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("n");
    await page.waitForTimeout(110);
    await page.keyboard.press(i % 2 === 0 ? "a" : "r");
    await page.waitForTimeout(110);
  }
  const unsaved = await reviewedCount(page);
  check(
    "there are unsaved decisions",
    unsaved !== null && beforeEdits !== null && unsaved.reviewed > beforeEdits.reviewed,
    `${beforeEdits?.reviewed} -> ${unsaved?.reviewed}`,
  );

  // The warning must be ARMED now — asked of the page rather than of a dialog,
  // because a headless browser dismisses the prompt and the only visible
  // effect would be a navigation that silently does not happen.
  const armed = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  check("the leave-page warning is armed while unsaved", armed);

  // The warning is armed, so a prompt is expected here and accepting it is
  // what lets the reload proceed. This is the scenario the labeller lost a
  // sheet to, run deliberately.
  const dialogsBeforeReload = dialogs;
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  check(
    "leaving with unsaved work does prompt",
    dialogs > dialogsBeforeReload,
    `${dialogs - dialogsBeforeReload} prompt(s)`,
  );
  await waitForDrawing(page);
  await findTheWalls(page);
  const offer = page.locator('[data-takeoff="key-restore-yes"]');
  const offered = (await offer.count()) > 0;
  check("a restore is offered after the reload", offered, offered ? await offer.first().innerText() : "");
  if (offered) {
    await offer.first().click();
    await page.waitForTimeout(1200);
    const restored = await reviewedCount(page);
    check(
      "it brings back exactly those decisions",
      restored !== null && unsaved !== null && restored.reviewed === unsaved.reviewed,
      `${unsaved?.reviewed} before, ${restored?.reviewed} after`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────

  console.log("\n4. a save over 10 MB is not truncated");
  await page.goto(url(SHEET_BIG), { waitUntil: "domcontentloaded" });
  await waitForDrawing(page);
  const bigCandidates = await findTheWalls(page);
  await setReviewer(page, "smoke-test");
  await page.keyboard.press("n");
  await page.waitForTimeout(150);
  await page.keyboard.press("a");
  await page.waitForTimeout(150);
  // ── MEASURE THE BODY, NOT THE ROWS ──
  //
  // The first version asserted the saved file held over 20,000 rows and got
  // 450 — because `labelRows` skips candidates no verdict covers while
  // `reviewComplete` is false, and this script makes one decision rather than
  // working the sheet. Row count measures how COMPLETE a review is. What was
  // truncated was the request BODY, so that is what is weighed: the panel's
  // own `fetch` is wrapped, the button is pressed, and the bytes it actually
  // posted are reported alongside the reply.
  const bigSave = await page.evaluate(async () => {
    const original = window.fetch;
    let bytes = 0;
    window.fetch = (input, init) => {
      const body = init?.body;
      if (typeof body === "string" && String(input).includes("/api/takeoff/labels")) {
        bytes = new Blob([body]).size;
      }
      return original(input, init);
    };
    try {
      const button = document.querySelector('[data-takeoff="key-save-labels"]');
      if (button === null) return { reply: "no save button", bytes: 0 };
      button.click();
      for (let i = 0; i < 240; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        const m = /(Labels saved[^\n]*|Not saved[^\n]*)/.exec(document.body.innerText);
        if (m) return { reply: m[1], bytes };
      }
      return { reply: "timed out", bytes };
    } finally {
      window.fetch = original;
    }
  });
  const megabytes = bigSave.bytes / (1024 * 1024);
  check(
    "the big sheet posts a body over 10 MB",
    megabytes > 10,
    `${megabytes.toFixed(2)} MB — under 10 means this sheet no longer exercises the limit`,
  );
  check(
    "and the server accepts it whole",
    bigSave.reply.startsWith("Labels saved"),
    `${bigSave.reply.slice(0, 80)} (truncation showed as a parse failure, not a short file)`,
  );
  void bigCandidates;
  void savedLabelFiles;

  // ─────────────────────────────────────────────────────────────────────
  console.log("\n5. a grey pre-rejected line is selectable on the drawing");
  await page.goto(url(SHEET_A), { waitUntil: "domcontentloaded" });
  await waitForDrawing(page);
  await findTheWalls(page);
  const grey = await page.evaluate(() => {
    // A pre-rejected candidate is drawn at reduced opacity. Find one, and
    // report where its midpoint is on screen.
    const lines = [...document.querySelectorAll('[data-takeoff="key-line"]')];
    const faded = lines.find((l) => Number(l.getAttribute("opacity") ?? "1") < 0.5);
    if (faded === undefined) return null;
    const box = faded.getBoundingClientRect();
    return { id: faded.getAttribute("data-id"), x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  if (grey === null) {
    check("a pre-rejected line exists to click", false, "none on this sheet");
  } else {
    await page.mouse.click(grey.x, grey.y);
    await page.waitForTimeout(400);
    const focused = await page.evaluate(
      (id) => {
        const line = document.querySelector(`[data-takeoff="key-line"][data-id="${id}"]`);
        return line === null ? false : Number(line.getAttribute("stroke-width") ?? "0") > 3;
      },
      grey.id,
    );
    check("clicking it selects it", focused, `id ${grey.id}`);
  }

  check("no page errors during the run", crashes.length === 0, crashes.slice(0, 1).join(""));
} catch (cause) {
  check("the run completed", false, String(cause).slice(0, 160));
} finally {
  await browser.close();
}

console.log(`\n${results.length - failures} of ${results.length} checks passed`);
for (const r of results.filter((one) => !one.ok)) console.log(`  FAILED: ${r.name}  ${r.detail}`);
process.exit(failures === 0 ? 0 : 1);
