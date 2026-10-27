import path from "node:path";
import { readFileSync } from "node:fs";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { dataTour } from "../lib/dataTour";
import { openCollapsed, openDisclosure } from "../lib/collapsed";
import { settleAction } from "../lib/journey";
import { expectNoCrmLinks } from "../lib/bidLinks";
import { stubDocumentUpload } from "../lib/blobStub";

/**
 * ── A DRYWALL SUB BIDS ONE TENANT-IMPROVEMENT JOB IN C STREAM BID, START TO
 *    FINISH, AND SAYS WHAT EVERY SCREEN SAID ──
 *
 * The founder asked for somebody to "click through it in the browser acting
 * like a real contractor". Nobody can do that from an agent container — the
 * preview's sign-in box carries Cloudflare Turnstile and Clerk's testing token
 * needs a secret only CI holds — so this file is that click-through, run by
 * CI's signed-in `e2e` job.
 *
 * ITS OUTPUT IS THE POINT. Screenshots cannot be fetched back out of CI from
 * where the reader works, so every screen and every press prints one line,
 * prefixed `[walk]`, carrying the words a contractor would have read there:
 * headings, the guide's ask card, the rail's five steps, bid so far, refusals
 * and empty states. Playwright's `list` reporter (playwright.config.ts) writes
 * a test's stdout into the job log, so `grep '\[walk\]'` over that log is the
 * transcript.
 *
 * WHAT IS ASSERTED AND WHAT IS ONLY PRINTED. Asserted: the things a contractor
 * must be able to do (log a bid, start its estimate, add lines, price a GC,
 * open that GC's proposal, log and acknowledge an addendum) and the health of
 * every page (no error boundary, no uncaught exception, no link out of Bid).
 * Printed: everything a person would judge rather than a machine — the
 * wording, the order of the asks, whether a figure looks right.
 *
 * ONE TEST, MANY STEPS, AND SOFT ASSERTIONS WHERE THE WALK CAN GO ON. A
 * serial file of separate tests skips everything after the first failure, and
 * a walk that stops at its first surprise prints a third of a transcript. So
 * an outcome nothing later depends on is `expect.soft` — still a red run,
 * still named — and only a step the rest of the walk stands on is a hard
 * `expect`. Page health is always hard (`expectHealthy`).
 *
 * ONE SIGN-IN, as TAKEOFF, for `bid-estimates.spec.ts`'s reason: a shared
 * company a dozen specs already write their own `ZZ-E2E` rows into, and no new
 * Clerk user (one refused phone number blocks the suite). Everything this file
 * makes carries this run's stamp. The company's OTHER bids show up on Bid
 * Home, so Home is printed with this job picked out of the list.
 *
 * THE ASK BOX IS NOT STUBBED. The runner blanks ANTHROPIC_API_KEY, so the box
 * should say it is not set up; the walk prints exactly what it shows, and
 * never invents an answer. The invite reader ("Fill the form from it") is the
 * same: with no key it refuses in a sentence, which is printed, and the form
 * is then typed by hand as a sub would.
 *
 * THE KNOWN #418 RACE is recorded, never asserted, exactly as
 * `estimating-spine.spec.ts` records it: `journey.spec.ts` step 11 is what
 * fails a run over it. A real crash (`monitor.crashes`) fails this one.
 *
 * NOT EXECUTED when it was written: the container that wrote it cannot sign in
 * to Clerk. The first real run is the `e2e` job on its PR — read that job's
 * log, not this comment, before believing any of it works.
 */
test.describe.configure({ mode: "serial" });

const STAMP = Date.now();
const GC_A = `ZZ-E2E Bayline Builders ${STAMP}`;
const GC_B = `ZZ-E2E Ridgeline Construction ${STAMP}`;
const PROJECT_A = `ZZ-E2E Harbor Point Suite 300 TI ${STAMP}`;
/** The second GC's own words for the same job; deliberately not containing PROJECT_A. */
const PROJECT_B = `ZZ-E2E Harbor Pt Medical Ste 300 (Ridgeline) ${STAMP}`;
const SITE = "1450 Harbor Blvd, Suite 300, Oakland, CA 94607";

const DAY_MS = 86_400_000;
/** A calendar day `offset` days from today, UTC — how the app stores and reads days. */
const isoDay = (offset: number): string => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
const spokenDate = (iso: string): string =>
  new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

// Far enough out that none of them is "coming up" (the guide asks about a walk
// or an RFI cutoff only inside two days, and treats a bid due inside 48 hours
// as the thing to send) — step 9 moves the walk to tomorrow on purpose.
const DUE = isoDay(14);
const WALK = isoDay(6);
const RFI = isoDay(9);
const TODAY = isoDay(0);
const TOMORROW = isoDay(1);

const INVITE_EMAIL = [
  `From: Dana Whitfield <dwhitfield@baylinebuilders.example>`,
  `Subject: ITB — Harbor Point Medical, Suite 300 Tenant Improvement — Framing & Drywall`,
  ``,
  `Hi,`,
  ``,
  `Bayline Builders invites you to bid the metal stud framing and drywall scope for the Harbor Point Medical`,
  `Suite 300 tenant improvement — approx. 9,800 SF on the 3rd floor of an occupied building. Noisy work`,
  `(demo, shooting track, core drilling) is nights only.`,
  ``,
  `Site: ${SITE}`,
  `Bids due: ${spokenDate(DUE)} by 2:00 PM, to estimating@baylinebuilders.example`,
  `Pre-bid job walk: ${spokenDate(WALK)} at 10:00 AM — meet in the main lobby`,
  `RFI cutoff: ${spokenDate(RFI)}`,
  ``,
  `Plans and specs are on BuildingConnected; addenda will be issued there.`,
  `Please include your bond rate, exclusions, and a unit price per SF for additional 5/8" Type X board.`,
  ``,
  `Thanks,`,
  `Dana Whitfield, Project Manager`,
  `Bayline Builders, Inc. · (510) 555-0142`,
].join("\n");

/** The lines a sub types in by hand. Prices are this file's own; no figure here is judged. */
const LINES = [
  { description: "Frame 3-5/8in 20ga studs @ 16in o.c. to deck", quantity: "1250", unit: "LF", unitPrice: "9.50", cost: "6.80", category: "LABOR" },
  { description: "5/8in Type X gypsum board, both sides", quantity: "9600", unit: "SF", unitPrice: "0.95", cost: "0.62", category: "MATERIAL" },
  { description: "Hang, tape and finish to Level 4", quantity: "9600", unit: "SF", unitPrice: "1.45", cost: "1.05", category: "LABOR" },
] as const;

const RATES: Record<string, string> = {
  laborMarkupPercent: "10",
  materialMarkupPercent: "8",
  overheadPercent: "10",
  profitPercent: "8",
};

const PLAN_FIXTURE = path.resolve(__dirname, "../../lib/takeoff/fixtures/plans/S02.pdf");
/** The width the takeoff specs give S02's half-sheet when they set its scale. */
const S02_HALF_SHEET_FEET = 48;

const squash = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();
const clip = (text: string, max = 320): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** One line of the transcript. Goes to stdout, which the list reporter prints. */
function walk(line: string): void {
  console.log(`[walk] ${clip(line, 600)}`);
}

/**
 * What an element says, for the transcript — or `fallback` when it is not on
 * the screen. Never waits long: a bare `innerText()` on a missing element
 * waits out the whole test timeout, and a line that is only PRINTED must not
 * be able to stall the walk.
 */
async function textOf(locator: Locator, fallback = "(not on the screen)"): Promise<string> {
  if ((await locator.count()) === 0) return fallback;
  return locator
    .first()
    .innerText({ timeout: 5_000 })
    .then(squash, () => fallback);
}

type GuideView = {
  headline: string;
  jobName: string;
  meta: string;
  steps: string[];
  askId: string | null;
  askTitle: string;
  askBody: string;
  actions: string[];
  chips: string[];
  bidSoFar: string;
};

test.describe("C Stream Bid — a drywall sub bids one TI job, start to finish", () => {
  let page: Page;
  let monitor: HealthMonitor;
  let estimateId = "";
  let invitationA = "";
  let invitationB = "";
  let servedPdf: Buffer = Buffer.alloc(0);

  const bidNav = () => page.getByRole("navigation", { name: "C Stream Bid" });
  const rowById = (id: string): Locator => page.locator(`li[id="${id}"]`).first();
  const jobScreen = (tab: "takeoff" | "estimate" | "recap" | "proposal" = "takeoff") => `/bid/estimates/${estimateId}/${tab}`;

  /** Healthy, inside the Bid shell, and linking nowhere out of Bid. */
  async function bidPage(step: string, options: { shell?: boolean; minLinks?: number } = {}): Promise<void> {
    // `signedIn: false` switches off the CRM's "Main" navigation check, which
    // Bid's shell (its own nav) does not draw. Crash markers, uncaught
    // exceptions and the blank-page floor all still apply.
    await expectHealthy(page, step, { monitor, signedIn: false });
    if (options.shell !== false) await expect(bidNav(), `${step}: the Bid header is missing`).toBeVisible();
    await expectNoCrmLinks(page, step, options.minLinks === undefined ? {} : { minLinks: options.minLinks });
  }

  /** React has attached to this element, so a press or a change will be handled. */
  async function hydrated(locator: Locator, what: string): Promise<void> {
    await expect
      .poll(() => locator.first().evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactFiber$"))), {
        timeout: 30_000,
        message: `${what} never hydrated`,
      })
      .toBe(true);
  }

  async function readGuide(): Promise<GuideView | null> {
    return page.evaluate(() => {
      const sq = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
      const shell = document.querySelector('[data-guide="shell"]');
      if (!shell) return null;
      const rail = shell.querySelector('[data-guide="rail"]');
      const ask = shell.querySelector('[data-guide="ask"]');
      const bid = shell.querySelector('[data-guide="bid-so-far"]') ?? shell.querySelector('[data-guide="bid-so-far-inline"]');
      return {
        headline: sq(shell.querySelector('[data-guide="headline"] h2')?.textContent),
        jobName: sq(rail?.querySelector('[data-guide="job-name"]')?.textContent),
        meta: sq(rail?.querySelector('[data-guide="job-name"] + p:not([data-guide])')?.textContent),
        steps: Array.from(rail?.querySelectorAll('[data-guide="steps"] > li') ?? []).map(
          (li) => `${li.getAttribute("data-step")}=${li.getAttribute("data-status")} "${sq(li.textContent)}"`,
        ),
        askId: ask?.getAttribute("data-ask-id") ?? null,
        askTitle: sq(ask?.querySelector("#guide-ask-title")?.textContent),
        askBody: sq(ask?.querySelector("#guide-ask-title + p")?.textContent),
        actions: Array.from(ask?.querySelectorAll('[data-guide="actions"] a, [data-guide="actions"] button') ?? []).map(
          (el) => `${sq(el.textContent)}${el.getAttribute("data-primary") ? " (yellow)" : ""}`,
        ),
        chips: Array.from(ask?.querySelectorAll('[data-guide="chips"] button') ?? []).map((el) => sq(el.textContent)),
        bidSoFar: sq(bid?.textContent),
      };
    });
  }

  /** Prints the job screen's guide: headline, rail, the ask card, bid so far. */
  async function printGuide(where: string, options: { rail?: boolean } = {}): Promise<GuideView | null> {
    const guide = await readGuide();
    if (!guide) {
      walk(`${where} · NO GUIDE on this screen (the plain header and tabs rendered instead)`);
      return null;
    }
    walk(`${where} · headline: "${guide.headline}"`);
    if (options.rail !== false) {
      walk(`${where} · rail: ${guide.jobName}${guide.meta ? ` — ${guide.meta}` : ""}`);
      walk(`${where} · steps: ${guide.steps.join(" | ")}`);
    }
    if (guide.askId) {
      walk(`${where} · ask [${guide.askId}]: "${guide.askTitle}"${guide.askBody ? ` — "${guide.askBody}"` : ""}`);
      const buttons = [...guide.chips.map((chip) => `(${chip})`), ...guide.actions];
      walk(`${where} · ask buttons: ${buttons.length > 0 ? buttons.join(" · ") : "(none)"}`);
    } else {
      walk(`${where} · ask: (no ask card — nothing needs you)`);
    }
    walk(`${where} · ${guide.bidSoFar || "bid so far: (not shown — nothing priced yet)"}`);
    return guide;
  }

  async function openJobScreen(tab: "takeoff" | "estimate" | "recap" | "proposal", step: string): Promise<void> {
    await page.goto(jobScreen(tab));
    await bidPage(step);
    await expect(page.locator('[data-guide="shell"]'), `${step}: the guided job screen did not render`).toBeVisible();
  }

  /** Bid Home's "Needs you", with this run's job picked out of a shared company's list. */
  async function printHome(where: string): Promise<void> {
    await expect(page.getByRole("heading", { name: "What are we bidding today?", level: 1 })).toBeVisible();
    const yourBids = await textOf(page.locator("#your-bids"));
    walk(`${where} · h1 "What are we bidding today?" · left column "${yourBids}"`);
    const empty = page.locator('[data-bid="home-needs-empty"]');
    if ((await empty.count()) > 0) {
      walk(`${where} · Needs you: (empty) "${await textOf(empty)}"`);
      return;
    }
    const rows = page.locator('[data-bid="home-needs"]');
    const texts = (await rows.allInnerTexts()).map(squash);
    walk(`${where} · Needs you: ${texts.length} rows (the company is shared with other specs; theirs are ZZ-E2E rows too)`);
    texts.slice(0, 4).forEach((text, i) => walk(`${where} · Needs you #${i + 1}: ${text}`));
    const mine = texts.findIndex((text) => text.includes(PROJECT_A));
    walk(
      mine === -1
        ? `${where} · Needs you: THIS job (${PROJECT_A}) is not on the list`
        : `${where} · Needs you, THIS job at #${mine + 1}: ${texts[mine]}`,
    );
  }

  test.beforeAll(async ({ browser }) => {
    // Read here, never at module scope: a spec that does I/O while Playwright
    // is only LISTING tests can take the whole signed-in suite down with it
    // (takeoff-workspace-real.spec.ts records the day it did).
    servedPdf = readFileSync(PLAN_FIXTURE);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    monitor = new HealthMonitor(page);
    // The blob store is stubbed: the browser's upload is answered in the
    // browser (blobStub.ts), and every plan fetch is answered with S02 —
    // the same arrangement as takeoff-workspace.spec.ts.
    await page.route("**/api/takeoff/plan/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/pdf", body: servedPdf });
    });
    await stubDocumentUpload(page);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("one job, from the GC's invite email to that GC's proposal", async () => {
    test.setTimeout(900_000);
    walk(`run ${STAMP}: GCs "${GC_A}" and "${GC_B}", project "${PROJECT_A}" · due ${DUE} 2:00 PM · walk ${WALK} 10:00 AM · RFIs ${RFI}`);

    // ── 1 ──────────────────────────────────────────────────────────────────
    await test.step("1. the landing page, before signing in", async () => {
      await page.goto("/bid");
      await bidPage("Bid landing, signed out", { shell: false });
      const h1 = page.getByRole("heading", { level: 1 });
      const eyebrow = await textOf(h1.locator("xpath=preceding-sibling::p[1]"));
      walk(`landing · eyebrow: "${eyebrow}"`);
      walk(`landing · h1: "${await textOf(h1)}"`);
      walk(`landing · promise: "${await textOf(page.locator("h1 + p").first())}"`);
      for (const heading of ["You give it", "You get back"]) {
        const items = await page
          .getByRole("heading", { name: heading, exact: true })
          .locator("xpath=following-sibling::ul[1]/li")
          .allInnerTexts();
        walk(`landing · ${heading}: ${items.map(squash).join(" / ")}`);
      }
      const steps = await page.locator('section[aria-labelledby="bid-steps"] li').allInnerTexts();
      walk(`landing · the steps: ${steps.map(squash).join(" | ")}`);
      walk(`landing · AI section: "${await textOf(page.locator("#bid-ai"))}" — "${await textOf(page.locator("#bid-ai + p"))}"`);
      const ctas = await page.locator("main a, header a, section a").allInnerTexts();
      walk(`landing · links a visitor can press: ${[...new Set(ctas.map(squash).filter(Boolean))].join(" · ")}`);
      await expect.soft(h1, "the landing page's promise").toContainText("From the invite to the proposal");
    });

    // ── 2 ──────────────────────────────────────────────────────────────────
    await test.step("2. sign in and land on Bid Home", async () => {
      await signInAs(page, PERSONAS.takeoff.email);
      await page.goto("/bid/home");
      await bidPage("Bid Home, first visit");
      await printHome("home (before logging anything)");
      const placeholder = await page.locator("#bid-home-paste").getAttribute("placeholder");
      walk(`home · the big box says: "${placeholder ?? ""}" · buttons: Attach drawings · Start →`);
    });

    // ── 3 ──────────────────────────────────────────────────────────────────
    await test.step("3. add the two GCs, log the first invite from its email, then the second GC on the same job", async () => {
      // A bid hangs off the GC who sent it, and Bid has no contacts page: GCs
      // are added in Settings, which is where Log a bid's own empty state points.
      await page.goto("/bid/settings");
      await bidPage("Bid settings");
      const gcForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Add GC" }) });
      await hydrated(gcForm, "the Add GC form");
      for (const name of [GC_A, GC_B]) {
        await gcForm.locator('input[name="name"]').fill(name);
        await settleAction(page, () => gcForm.getByRole("button", { name: "Add GC" }).click());
        await expect(page.locator("[data-bid='gc-list']").getByText(name), `${name} should be on the GC list`).toBeVisible();
      }
      walk(`settings · added two GCs: "${GC_A}", "${GC_B}"`);

      await page.goto("/bid/bids?view=all");
      await bidPage("the bid log");
      walk(`bids · h1 "${await textOf(page.getByRole("heading", { level: 1 }).first())}" — "${await textOf(page.getByRole("heading", { level: 1 }).first().locator("xpath=following-sibling::p[1]"))}"`);
      const logSection = page.locator('[data-bids="log-bid"]');
      await openCollapsed(page, "+ Log a bid", logSection);
      walk(`bids · pressed "+ Log a bid": "${await textOf(logSection.getByRole("heading").first())}"`);

      // THE PASTE. With no model key the reader refuses in words; with one it
      // fills the form. Neither sentence exists before the press.
      const paste = logSection.locator('[data-bids="paste-invite"]');
      await paste.locator('textarea[name="invitationText"]').fill(INVITE_EMAIL);
      walk(`bids · pasted the GC's invite email (${INVITE_EMAIL.split("\n").length} lines, subject "ITB — Harbor Point Medical, Suite 300 TI")`);
      await paste.getByRole("button", { name: "Fill the form from it" }).click();
      const readError = logSection.locator('[data-bids="paste-error"]');
      const readOk = logSection.locator('[data-bids="paste-read"]');
      await expect(readError.or(readOk).first(), "the invite reader should answer, either way").toBeVisible({ timeout: 90_000 });
      if (await readError.isVisible()) {
        walk(`bids · "Fill the form from it" REFUSED: "${await textOf(readError)}"`);
        walk(`bids · so the form is typed in by hand from the email, as a sub would`);
      } else {
        walk(`bids · the reader said: "${await textOf(readOk)}"`);
      }
      const logForm = logSection.locator("form");
      const formValues = async () =>
        logForm.evaluate((form) => {
          const data = new FormData(form as HTMLFormElement);
          const select = (form as HTMLFormElement).querySelector('select[name="contactId"]') as HTMLSelectElement | null;
          const gc = select?.selectedOptions[0]?.textContent ?? "";
          const keys = ["projectName", "tradeScope", "dueDate", "dueTime", "walkDate", "walkTime", "rfiCutoffDate", "notes"];
          return [`GC="${gc}"`, ...keys.map((key) => `${key}="${String(data.get(key) ?? "")}"`)].join(" ");
        });
      walk(`bids · the form after the paste: ${await formValues()}`);

      await hydrated(logForm, "the Log a bid form");
      await logForm.locator('select[name="contactId"]').selectOption({ label: GC_A });
      await logForm.locator('input[name="projectName"]').fill(PROJECT_A);
      await logForm.locator('select[name="tradeScope"]').selectOption("METAL_FRAMING_DRYWALL");
      await logForm.locator('input[name="dueDate"]').fill(DUE);
      await logForm.locator('input[name="dueTime"]').fill("14:00");
      await logForm.locator('input[name="walkDate"]').fill(WALK);
      await logForm.locator('input[name="walkTime"]').fill("10:00");
      await logForm.locator('input[name="rfiCutoffDate"]').fill(RFI);
      await logForm.locator('input[name="notes"]').fill(`Site: ${SITE}. Nights for demo and core drilling. Bond rate requested.`);
      walk(`bids · the form as logged: ${await formValues()}`);
      await settleAction(page, () => logForm.getByRole("button", { name: "Log invitation" }).click());

      await page.goto("/bid/bids?view=all");
      await bidPage("the bid log with the first invite on it");
      const rowA = page.locator(`${dataTour("bids-list")} li[id]`).filter({ hasText: PROJECT_A }).first();
      await expect(rowA, "the logged bid should be on the log").toBeVisible();
      invitationA = (await rowA.getAttribute("id")) ?? "";
      expect(invitationA, "the bid's row carries its id").not.toBe("");
      walk(`bids · logged: ${clip(await textOf(rowA.locator("> div").first()))}`);
      const upcomingA = await rowA.locator('[data-bids^="upcoming-"]').allInnerTexts();
      walk(`bids · its date warnings: ${upcomingA.length > 0 ? upcomingA.map(squash).join(" / ") : "(none — the walk and RFI cutoff are more than a few days out)"}`);

      // The SECOND GC: same building, its own invite, its own name for it.
      await openCollapsed(page, "+ Log a bid", logSection);
      await hydrated(logForm, "the Log a bid form, second time");
      await logForm.locator('select[name="contactId"]').selectOption({ label: GC_B });
      await logForm.locator('input[name="projectName"]').fill(PROJECT_B);
      await logForm.locator('select[name="tradeScope"]').selectOption("METAL_FRAMING_DRYWALL");
      await logForm.locator('input[name="dueDate"]').fill(DUE);
      await logForm.locator('input[name="dueTime"]').fill("15:00");
      await logForm.locator('input[name="notes"]').fill(`Site: ${SITE}. Ridgeline's invite, phoned in.`);
      // The same-job check is debounced and asks the server; it warns, it never blocks.
      const sameJob = logSection.locator('[data-bids="same-job-warning"]');
      const warned = await sameJob
        .waitFor({ state: "visible", timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      walk(warned ? `bids · second GC, before saving: "${await textOf(sameJob)}"` : "bids · second GC: NO same-job warning appeared within 8s");
      const join = logForm.locator('select[name="bidProjectId"]');
      const choices = await join.locator("option").allInnerTexts();
      walk(`bids · "Same job as…" offers ${choices.length} choices; the first few: ${choices.slice(0, 4).map(squash).join(" / ")}`);
      const joinValue = await join.locator("option").filter({ hasText: PROJECT_A }).first().getAttribute("value");
      expect(joinValue, "the first GC's project should be offered under 'Same job as…'").toBeTruthy();
      await join.selectOption(joinValue!);
      await expect(join, "the same-job choice must be on the control before it is saved").toHaveValue(joinValue!);
      await settleAction(page, () => logForm.getByRole("button", { name: "Log invitation" }).click());

      await page.goto("/bid/bids?view=all");
      await bidPage("the bid log with two GCs on one job");
      const ids = await page
        .locator(`${dataTour("bids-list")} li[id]`)
        .filter({ hasText: PROJECT_B })
        .evaluateAll((nodes) => nodes.map((node) => node.id));
      invitationB = ids.find((id) => id !== invitationA) ?? "";
      expect(invitationB, "the second GC's bid should be on the log").not.toBe("");
      const panelA = rowById(invitationA).locator('[data-bids="project-gcs"]');
      await expect.soft(panelA, "the first GC's row should name both GCs on the job").toContainText(GC_B);
      walk(`bids · the job now: "${await textOf(panelA, "(no 'Same job' line)")}"`);
    });

    // ── 4 ──────────────────────────────────────────────────────────────────
    await test.step("4. start the estimate from the project; the job screen's rail and ask card", async () => {
      const rowA = rowById(invitationA);
      await openDisclosure(rowA.locator('details[data-bids="project-controls"]'));
      const start = rowA.getByRole("button", { name: "Start the estimate" });
      await hydrated(start, "Start the estimate");
      walk(`bids · project panel: "${await textOf(start.locator("xpath=following-sibling::p[1]"))}"`);
      await start.click();
      await page.waitForURL(/\/bid\/estimates\/[^/]+\/takeoff$/, { timeout: 30_000 });
      estimateId = page.url().match(/\/bid\/estimates\/([^/]+)\/takeoff$/)![1]!;
      expect(estimateId).not.toBe("new");
      await bidPage("the new estimate's job screen");
      const guide = await printGuide("job screen (new)");
      expect(guide, "a new estimate opens on the guided job screen").not.toBeNull();
      expect.soft(guide?.jobName, "the job takes the project's name").toBe(PROJECT_A);
      expect.soft(guide?.askId, "a job with no drawings asks for them").toBe("no-drawings");
      const tabs = await page.getByRole("navigation", { name: "This estimate" }).getByRole("link").allInnerTexts();
      walk(`job screen · tabs: ${tabs.map(squash).join(" · ")}`);
    });

    // ── 5 ──────────────────────────────────────────────────────────────────
    let wallsAdded = 0;
    await test.step("5. takeoff: upload a sheet, set the scale, find the walls, add groups", async () => {
      // A failure in here is RECORDED (soft) rather than ending the walk: the
      // estimate is then built by hand in step 6, and the log says so.
      let takeoffProblem: string | null = null;
      try {
        await expect(page.getByRole("heading", { name: "Takeoff", level: 2, exact: true })).toBeVisible();
        const empty = page.getByText("No drawing on this job yet");
        walk(`takeoff tab · ${(await empty.count()) > 0 ? '"No drawing on this job yet"' : "(no empty-state sentence)"}`);
        const addDrawing = page.getByRole("button", { name: "Add a drawing" });
        await hydrated(addDrawing, "Add a drawing");
        await page.locator('input[type="file"]').setInputFiles(PLAN_FIXTURE);
        await addDrawing.click();
        await expect(page.getByRole("button", { name: "Which revision is this?" }), "the uploaded sheet should be filed").toBeVisible({ timeout: 60_000 });
        walk("takeoff tab · uploaded S02.pdf (a generated one-sheet floor plan, the takeoff suite's fixture)");
        await bidPage("takeoff tab with a sheet");
        await page.reload();
        await printGuide("after the upload", { rail: false });

        // Scale, by clicking two points the way a person does — the blob store
        // is stubbed, so the server reads nothing and offers no scale itself.
        const port = page.locator('[data-testid="takeoff-plan-port"]');
        const overlay = port.locator("svg");
        await expect
          .poll(() => port.locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width), {
            timeout: 60_000,
            message: "pdf.js should draw the sheet to a canvas with real pixels",
          })
          .toBeGreaterThan(0);
        const setScale = page.getByRole("button", { name: "Set scale", exact: true });
        await hydrated(setScale, "Set scale");
        await setScale.click();
        const box = await settledBox(overlay);
        await overlay.click({ position: { x: box.width * 0.2, y: box.width * 0.5 } });
        await overlay.click({ position: { x: box.width * 0.7, y: box.width * 0.5 } });
        const scaleForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Set the scale" }) });
        await scaleForm.locator('input[name="declaredDistanceFeet"]').fill(String(S02_HALF_SHEET_FEET));
        await scaleForm.locator('input[name="pageLabel"]').fill("A-101 floor plan");
        await scaleForm.getByRole("button", { name: "Set the scale" }).click();
        const scaleSet = page.getByText(/^Scale set/).first();
        await expect(scaleSet, "the scale should be set").toBeVisible({ timeout: 30_000 });
        walk(`takeoff tab · clicked two points ${S02_HALF_SHEET_FEET} ft apart: "${await textOf(scaleSet)}"`);
        await page.reload();
        await printGuide("after the scale", { rail: false });

        // Find the walls in the full-screen workspace, as the guide's own
        // "Measure the walls" button sends you.
        await page.goto(`/bid/workspace/${estimateId}`);
        await expect(page.locator('[data-takeoff="workspace"]')).toBeVisible();
        await bidPage("the takeoff workspace", { shell: false, minLinks: 1 });
        const wsPort = page.locator('[data-testid="takeoff-plan-port"]');
        await expect
          .poll(() => wsPort.locator("canvas").evaluate((n) => (n as HTMLCanvasElement).width), { timeout: 60_000 })
          .toBeGreaterThan(0);
        await settledBox(wsPort.locator("svg"));
        const find = page.locator('[data-takeoff="find-walls"]');
        await hydrated(find, "Find the walls");
        await expect(find, "Find the walls never became available").toBeEnabled({ timeout: 60_000 });
        // "Find the walls" is also the button's RESTING label, so the wait
        // that counts is below: the panel or a refusal, neither of which is
        // on the page before a find runs. This loop only re-presses when the
        // app says the sheet was still loading (takeoff-workspace.spec.ts).
        const stillLoading = page.getByText("The sheet is still loading. Try that again in a moment.");
        for (let attempt = 1; ; attempt += 1) {
          await find.click();
          await expect(find).toHaveText("Find the walls", { timeout: 180_000 });
          await page.waitForTimeout(800);
          if (!(await stillLoading.isVisible())) break;
          expect(attempt, "the sheet never finished loading").toBeLessThan(20);
          await page.waitForTimeout(1_000);
        }
        const panel = page.locator('[data-takeoff="found-walls"]');
        const findError = page.locator('[data-takeoff="find-error"]');
        await expect(panel.or(findError).first(), "Find the walls should show walls or say why not").toBeVisible({ timeout: 30_000 });
        if (!(await panel.isVisible())) {
          throw new Error(`Find the walls refused: "${await textOf(findError)}"`);
        }
        const groups = panel.locator('[data-takeoff="found-group"]');
        const total = await groups.count();
        walk(`workspace · Find the walls: "${await textOf(panel.locator("p").first())}" — ${total} groups`);
        for (const [i, text] of (await groups.allInnerTexts()).slice(0, 6).entries()) {
          walk(`workspace · group ${i + 1}: ${clip(squash(text), 220)}`);
        }
        expect(total, "S02 should yield at least one group of walls").toBeGreaterThan(0);

        // Add up to two groups the way the panel asks: a group nothing names
        // asks "What are these?" — a type from the library if there is one,
        // else plain measurements. A type with no default height asks for one.
        let skip = 0;
        for (let k = 0; k < 2 && skip < (await groups.count()); k += 1) {
          const before = await groups.count();
          const group = groups.nth(skip);
          const label = await textOf(group.locator('span[title^="Measured"]'), "?");
          const choice = group.locator('[data-takeoff="group-choice"]');
          if ((await choice.count()) > 0) {
            const options = await choice.locator("option").evaluateAll((nodes) =>
              nodes.map((node) => ({ value: (node as HTMLOptionElement).value, text: (node.textContent ?? "").trim() })),
            );
            const type = options.find((option) => !["", "create", "plain"].includes(option.value));
            const pick = type ?? options.find((option) => option.value === "plain");
            walk(`workspace · group "${label}" asks "What are these?" — offers: ${options.map((o) => o.text).join(" / ")}`);
            if (!pick) {
              walk(`workspace · group "${label}": nothing addable to pick; skipped`);
              skip += 1;
              continue;
            }
            await choice.selectOption(pick.value);
            walk(`workspace · picked "${pick.text}"`);
          }
          const height = group.locator('[data-takeoff="group-height"]');
          if ((await height.count()) > 0 && (await height.isVisible())) {
            walk(`workspace · group "${label}" asks for a height ("${(await height.getAttribute("placeholder")) ?? ""}") — typed 10`);
            await height.fill("10");
          }
          const add = group.locator('[data-takeoff="add-group"]');
          const addLabel = await textOf(add);
          if (await add.isDisabled()) {
            walk(`workspace · group "${label}": "${addLabel}" is disabled; skipped`);
            skip += 1;
            continue;
          }
          const errorBefore = (await findError.count()) > 0 ? await textOf(findError) : "";
          await add.click();
          // Cannot be true before the press: the group leaves the list, or a
          // NEW refusal sentence appears.
          await expect(async () => {
            const now = await groups.count();
            const error = (await findError.count()) > 0 ? await textOf(findError) : "";
            expect(now < before || (error !== "" && error !== errorBefore)).toBe(true);
          }, `pressing "${addLabel}" should add the group or say why not`).toPass({ timeout: 30_000 });
          if ((await groups.count()) < before) {
            wallsAdded += 1;
            walk(`workspace · pressed "${addLabel}" on "${label}": added`);
          } else {
            walk(`workspace · pressed "${addLabel}" on "${label}": REFUSED "${await textOf(findError)}"`);
            skip += 1;
          }
        }
        if ((await panel.locator('[data-takeoff="no-walls"]').count()) > 0) {
          walk(`workspace · panel now says: "${await textOf(panel.locator('[data-takeoff="no-walls"]'))}"`);
        }
        walk(`workspace · groups added: ${wallsAdded}`);
        expect.soft(wallsAdded, "at least one group of walls should go onto the measurements").toBeGreaterThan(0);
      } catch (error) {
        takeoffProblem = error instanceof Error ? error.message.split("\n")[0]! : String(error);
        walk(`takeoff · STOPPED: ${takeoffProblem}`);
      }
      expect.soft(takeoffProblem, "the takeoff should run end to end on the fixture").toBeNull();
      if (takeoffProblem || wallsAdded === 0) {
        walk("takeoff · FALLBACK: no walls came from the drawing, so step 6 builds the estimate from hand-typed lines only");
      }

      // Back on the job screen: the guide's view of the takeoff, and the
      // wall-height question if a measured type has no height.
      await openJobScreen("takeoff", "job screen after the takeoff");
      const guide = await printGuide("after the takeoff");
      if (guide?.askId === "wall-height") {
        const ask = page.locator('[data-guide="ask"]');
        const chip = ask.locator('[data-guide="chips"]').getByRole("button", { name: "10 ft", exact: true });
        await hydrated(chip, "the 10 ft answer");
        await chip.click();
        const confirm = ask.locator('[data-guide="confirm"]');
        await expect(confirm, "a tap answer arms a confirm").toBeVisible();
        walk(`wall height · tapped "10 ft"; the card asks: "${await textOf(confirm.locator("p").first())}"`);
        await settleAction(page, () => confirm.getByRole("button", { name: "Yes, do it" }).click());
        walk("wall height · pressed Yes, do it");
        await page.reload();
        const after = await printGuide("after answering the height", { rail: false });
        expect.soft(after?.askId, "the height question should be answered").not.toBe("wall-height");
      } else {
        walk("wall height · the guide did not ask for a wall height on this job");
      }
    });

    // ── 6 ──────────────────────────────────────────────────────────────────
    await test.step("6. Estimate and Bid recap: lines, costs, rates, Apply", async () => {
      await openJobScreen("estimate", "estimate tab");
      await expect(page.getByRole("heading", { name: "Line items (estimate)" })).toBeVisible();
      const existing = await page.locator('details[name="estimate-line"] > summary').allInnerTexts();
      walk(`estimate · ${existing.length} lines already on it${existing.length > 0 ? `: ${existing.slice(0, 5).map((t) => clip(squash(t), 120)).join(" / ")}` : ""}`);
      const noLines = page.getByText("No line items yet");
      if ((await noLines.count()) > 0) walk('estimate · empty state: "No line items yet"');

      const addForm = page.locator(dataTour("job-add-line-item"));
      for (const line of LINES) {
        await openCollapsed(addForm, "Add line item", addForm.locator('input[name="description"]'));
        await addForm.locator('input[name="description"]').fill(line.description);
        await addForm.locator('input[name="quantity"]').fill(line.quantity);
        await addForm.locator('input[name="unit"]').fill(line.unit);
        await addForm.locator('input[name="unitPrice"]').fill(line.unitPrice);
        await addForm.locator('input[name="budgetedUnitCost"]').fill(line.cost);
        await settleAction(page, () => addForm.locator("form").getByRole("button", { name: "Add line item", exact: true }).click());
        await page.reload();
        await bidPage(`estimate tab after adding "${line.description}"`);
        await expect(
          page.locator('details[name="estimate-line"]').filter({ hasText: line.description }),
          `"${line.description}" should be on the estimate`,
        ).toHaveCount(1);
        const guide = await readGuide();
        walk(`estimate · added ${line.quantity} ${line.unit} "${line.description}" @ $${line.unitPrice} (cost $${line.cost}) → ${guide?.bidSoFar || "bid so far not shown"}`);
      }
      await printGuide("estimate, lines in", { rail: false });

      await page.getByRole("navigation", { name: "This estimate" }).getByRole("link", { name: "Bid recap" }).click();
      await page.waitForURL(new RegExp(`/bid/estimates/${estimateId}/recap$`));
      await bidPage("bid recap tab");
      const recapTable = page.locator("table").filter({ hasText: "Direct cost of the work" });
      const printRecap = async (where: string) => {
        const rows = (await recapTable.locator("tr").allInnerTexts()).map(squash);
        walk(`recap ${where} · ${rows.join(" | ")}`);
      };
      await printRecap("(as it opened)");
      for (const line of LINES) {
        const select = page.locator(`select[aria-label="Cost type for ${line.description}"]`);
        await hydrated(select, `the cost type for "${line.description}"`);
        await settleAction(page, () => select.selectOption(line.category));
      }
      walk(`recap · set cost types: ${LINES.map((l) => `${l.description.split(" ").slice(0, 3).join(" ")}=${l.category}`).join(", ")}`);
      await openCollapsed(page, "Edit rates", page.locator('input[name="laborMarkupPercent"]'));
      for (const [name, value] of Object.entries(RATES)) await page.locator(`input[name="${name}"]`).fill(value);
      await settleAction(page, () => page.getByRole("button", { name: "Save rates" }).click());
      walk(`recap · typed rates: ${Object.entries(RATES).map(([k, v]) => `${k.replace(/Percent$/, "")} ${v}%`).join(", ")} and pressed Save rates`);
      await page.reload();
      await bidPage("bid recap after saving rates");
      await printRecap("(rates saved)");
      await printGuide("recap, rates saved", { rail: false });

      const apply = page.getByRole("button", { name: "Apply to line prices" });
      await hydrated(apply, "Apply to line prices");
      if (await apply.isDisabled()) {
        walk("recap · Apply to line prices is DISABLED");
        expect.soft(await apply.isDisabled(), "Apply to line prices should be pressable once rates are saved").toBe(false);
      } else {
        const confirm = page.getByRole("button", { name: /^Confirm — price \d+ line/ });
        const applied = page.getByText(/^Applied to \d+ lines? — they now total /);
        await apply.click();
        await expect.soft(confirm.or(applied).first(), "Apply should apply, or ask to confirm first").toBeVisible({ timeout: 30_000 });
        if (await confirm.isVisible()) {
          walk(`recap · Apply asked first: "${await textOf(confirm)}" — confirmed`);
          await confirm.click();
        }
        await expect.soft(applied, "Apply should say what it wrote").toBeVisible({ timeout: 30_000 });
        if (await applied.isVisible()) walk(`recap · "${await textOf(applied)}"`);
      }
      await page.reload();
      await bidPage("bid recap after Apply");
      await printRecap("(after Apply)");
      await printGuide("recap, after Apply", { rail: false });
    });

    // ── 7 ──────────────────────────────────────────────────────────────────
    await test.step("7. the job's ask box", async () => {
      await openJobScreen("estimate", "estimate tab, for the ask box");
      const box = page.locator('[data-guide="ask-box"]');
      await expect(box, "the job screen should carry its ask box").toBeVisible();
      const off = box.locator('[data-guide="ask-off"]');
      const input = box.locator("#guide-ask-box");
      await expect.soft(off.or(input).first(), "the box is either an input or a sentence saying why not").toBeVisible();
      const questions = ["what's the bid so far?", "add 10% for night work"];
      if ((await off.count()) > 0) {
        walk(`ask box · NOT AVAILABLE — it shows only: "${await textOf(off)}"`);
        for (const question of questions) walk(`ask box · could not ask "${question}": there is no input to type into`);
      } else {
        walk(`ask box · placeholder "${(await input.getAttribute("placeholder")) ?? ""}" · hint "${await textOf(box.locator('[data-guide="ask-hint"]'), "")}"`);
        await hydrated(input, "the ask box");
        const again = box.getByRole("button", { name: "Ask something else" });
        for (const question of questions) {
          await input.fill(question);
          await box.getByRole("button", { name: "Send" }).click();
          // Drawn only once an answer, a refusal, a card or a question is on screen.
          await expect.soft(again, `"${question}" should get some answer`).toBeVisible({ timeout: 120_000 });
          const result = box.locator('[data-guide="ask-result"]');
          walk(`ask box · asked "${question}" → ${(await result.count()) > 0 ? await textOf(result) : "(nothing shown)"}`);
          if ((await again.count()) > 0 && (await again.isVisible())) await again.click();
        }
        walk("ask box · any card it offered was NOT confirmed by the walk");
      }
    });

    // ── 8 ──────────────────────────────────────────────────────────────────
    await test.step("8. the second GC's price, 5% under, and that GC's proposal", async () => {
      await page.goto("/bid/bids?view=all");
      await bidPage("the bid log, to price the second GC");
      const rowB = rowById(invitationB);
      await openDisclosure(rowB.locator('details[data-bids="project-controls"]'));
      const priceForm = rowB.locator("form").filter({ has: page.getByRole("button", { name: "Save price" }) });
      await hydrated(priceForm, "the GC price form");
      walk(`bids · ${GC_B}'s row, before: ${(await rowB.locator('[data-bids="gc-price-row"]').allInnerTexts()).map(squash).join(" | ") || "(no price rows)"}`);
      const kind = priceForm.locator('select[name="kind"]');
      await kind.selectOption("percent");
      await expect(kind, "the adjustment kind must be on the control before it is saved").toHaveValue("percent");
      await priceForm.locator('input[name="value"]').fill("-5");
      await priceForm.locator('input[name="reason"]').fill("Ridgeline pays net 30 and we want their next job");
      await settleAction(page, () => priceForm.getByRole("button", { name: "Save price" }).click());
      walk(`bids · ${GC_B}: "Add or take off a percent", -5, why "Ridgeline pays net 30 and we want their next job" → Save price`);

      await page.reload();
      await bidPage("the bid log after pricing the second GC");
      const priceRows = rowById(invitationB).locator('[data-bids="gc-price-row"]');
      walk(`bids · estimate total ${await textOf(rowById(invitationB).locator('[data-bids="estimate-total"]'), "(not shown)")}`);
      for (const text of await priceRows.allInnerTexts()) walk(`bids · price row: ${squash(text)}`);
      const rowForB = priceRows.filter({ hasText: GC_B });
      await expect.soft(rowForB, "the second GC's price row names its adjustment").toContainText("−5%");

      await rowForB.getByRole("link", { name: "Proposal" }).click();
      await page.waitForURL(/\/proposal\?invitation=/);
      await bidPage(`${GC_B}'s proposal, lump sum`);
      const title = page.getByRole("heading", { name: /^Proposal — / });
      await expect(title).toBeVisible();
      const addressee = await textOf(title.locator("xpath=following-sibling::p[1]"));
      walk(`proposal · "${await textOf(title)}" · "${addressee}"`);
      expect.soft(addressee, "the proposal is addressed to the GC it was opened for").toContain(GC_B);
      const note = page.locator('[data-proposal="gc-price-note"]');
      walk(`proposal · note to the sender (does not print): ${(await note.count()) > 0 ? `"${await textOf(note)}"` : "(none)"}`);
      await expect.soft(note, "the sender is told how this GC's price was reached").toContainText(`Priced for ${GC_B}`);
      const priceSection = page.locator("section").filter({ has: page.getByRole("heading", { name: /^(Price|Schedule of values)$/ }) });
      const printPrice = async (mode: string) => {
        const rows = (await priceSection.locator("tr").allInnerTexts()).map(squash);
        walk(`proposal (${mode}) · ${rows.length} rows: ${rows.slice(0, 8).join(" | ")}${rows.length > 8 ? ` | …and ${rows.length - 8} more` : ""}`);
      };
      await printPrice("Lump sum");
      await expect.soft(page.getByText("Lump sum for the work described in this proposal")).toBeVisible();
      const modes = page.getByRole("navigation", { name: "Price presentation" });
      for (const [label, mode] of [["By scope", "scope"], ["Itemized", "itemized"]] as const) {
        await modes.getByRole("link", { name: label, exact: true }).click();
        await page.waitForURL(new RegExp(`mode=${mode}`));
        await bidPage(`${GC_B}'s proposal, ${label}`);
        await printPrice(label);
        if (mode === "itemized") {
          const warning = page.getByText("Itemized prints your unit prices for every line to the GC.", { exact: false }).first();
          if ((await warning.count()) > 0) walk(`proposal (Itemized) · warning: "${await textOf(warning)}"`);
        }
      }
      const amber = await page.locator("p.bg-tag-amber, p.bg-tag-rose").allInnerTexts();
      for (const text of amber) walk(`proposal · banner: "${clip(squash(text))}"`);
    });

    // ── 9 ──────────────────────────────────────────────────────────────────
    await test.step("9. an addendum, the job walk moved to tomorrow, and the acknowledgements", async () => {
      const complianceLines = async (row: Locator): Promise<string> => {
        const text = await row.locator('details[name="bid"]').innerText();
        return text
          .split("\n")
          .map(squash)
          .filter((line) => /addend|non-responsive|acknowledg|outstanding|changed work/i.test(line))
          .slice(0, 6)
          .join(" / ");
      };

      await page.goto("/bid/bids?view=all");
      await bidPage("the bid log, to log an addendum");
      const rowA = rowById(invitationA);
      await openDisclosure(rowA.locator('details[name="bid"]'));
      await rowA.getByRole("button", { name: "Log an addendum" }).first().click();
      const addendum = rowA.locator("form").filter({ has: page.locator('input[name="reference"]') });
      await addendum.locator('input[name="reference"]').fill("Addendum 1");
      await addendum.locator('input[name="issuedOn"]').fill(TODAY);
      await addendum.locator('input[name="affectsPricedScope"]').check();
      await addendum.locator('input[name="impactNote"]').fill("corridor walls go 1-hr rated, 5/8 Type X both sides to deck");
      await settleAction(page, () => addendum.getByRole("button", { name: "Log addendum" }).click());
      walk(`bids · logged "Addendum 1" issued ${TODAY} on ${GC_A}'s bid, changes priced work, NOT acknowledged`);
      await page.reload();
      await bidPage("the bid log with an unacknowledged addendum");
      await openDisclosure(rowById(invitationA).locator('details[name="bid"]'));
      await expect(rowById(invitationA), "the addendum should be on the bid").toContainText("Addendum 1");
      walk(`bids · ${GC_A}'s row says: ${await complianceLines(rowById(invitationA))}`);

      // Bid's own page for the bid, on its Addenda tab — the guide's "Read the
      // addendum" goes here. (On Bid this tab lists addenda; it has no add
      // form, so the addendum above was logged on the bid log's row.)
      await page.goto(`/bid/bids/${invitationA}?tab=addenda`);
      await bidPage("the bid's Addenda tab");
      const steps = await page.getByRole("navigation", { name: "Bid steps" }).getByRole("link").allInnerTexts();
      walk(`bid page · steps: ${steps.map(squash).join(" · ")}`);
      walk(`bid page · Addenda tab: "${clip(await textOf(page.locator("[data-bid-workspace] > div").last()))}"`);

      await openJobScreen("takeoff", "job screen with an unacknowledged addendum");
      await printGuide("addendum logged, not acknowledged", { rail: false });

      // The GC moves the walk to tomorrow morning.
      await page.goto("/bid/bids?view=all");
      await bidPage("the bid log, to move the walk");
      const edit = rowById(invitationA).locator('[data-bids="edit-details"]');
      // Not `openCollapsed`: its census (e2e/lib/collapsed.test.ts) matches an
      // opener against source text, and this button's source spells the
      // ampersand `&amp;`. Same press-until-revealed, written out.
      const walkField = edit.locator('input[name="walkDate"]');
      await expect(async () => {
        if (await walkField.isVisible()) return;
        await edit.getByRole("button", { name: "Edit details & dates" }).click({ timeout: 2_000 });
        await expect(walkField).toBeVisible({ timeout: 2_000 });
      }, "Edit details & dates should open the bid's details").toPass({ timeout: 15_000 });
      const editForm = edit.locator("form");
      await hydrated(editForm, "the bid details form");
      await editForm.locator('input[name="walkDate"]').fill(TOMORROW);
      await editForm.locator('input[name="walkTime"]').fill("07:00");
      await settleAction(page, () => editForm.getByRole("button", { name: "Save", exact: true }).click());
      await page.reload();
      await bidPage("the bid log after moving the walk");
      const upcoming = await rowById(invitationA).locator('[data-bids^="upcoming-"]').allInnerTexts();
      walk(`bids · walk moved to ${TOMORROW} 7:00 AM; the row now warns: ${upcoming.map(squash).join(" / ") || "(nothing)"}`);
      await openJobScreen("takeoff", "job screen with the walk tomorrow");
      const walkGuide = await printGuide("walk tomorrow, addendum not acknowledged");
      expect.soft(walkGuide?.askId, "a job walk tomorrow is the one thing that needs you").toBe("job-walk");
      expect.soft(walkGuide?.askTitle ?? "", "the walk ask says when").toContain("The job walk is tomorrow");

      // Acknowledge it on each GC's bid form: an addendum belongs to the job,
      // its acknowledgement to each GC's form.
      for (const [id, gc] of [
        [invitationA, GC_A],
        [invitationB, GC_B],
      ] as const) {
        await page.goto("/bid/bids?view=all");
        await bidPage(`the bid log, to acknowledge on ${gc}'s form`);
        const row = rowById(id);
        await openDisclosure(row.locator('details[name="bid"]'));
        const acknowledge = row.getByRole("button", { name: "Acknowledge", exact: true }).first();
        await hydrated(acknowledge, `Acknowledge on ${gc}'s row`);
        await settleAction(page, () => acknowledge.click());
        await page.reload();
        await bidPage(`the bid log after acknowledging on ${gc}'s form`);
        await openDisclosure(rowById(id).locator('details[name="bid"]'));
        await expect.soft(rowById(id).getByText(/acknowledged \d{4}-\d{2}-\d{2}/).first(), `the addendum should read as acknowledged on ${gc}'s form`).toBeVisible();
        walk(`bids · acknowledged on ${gc}'s form; the row says: ${await complianceLines(rowById(id))}`);
        await openJobScreen("takeoff", `job screen after acknowledging on ${gc}'s form`);
        await printGuide(`acknowledged on ${gc}'s form`, { rail: false });
      }
    });

    // ── 10 ─────────────────────────────────────────────────────────────────
    await test.step("10. back to Home", async () => {
      await page.goto("/bid/home");
      await bidPage("Bid Home, after the walk");
      await printHome("home (after)");
      const mine = page.locator('[data-bid="home-needs"]').filter({ hasText: PROJECT_A });
      await expect.soft(mine, "this job, with its walk tomorrow, should be on Needs you").toHaveCount(1);
      const side = page.locator('[data-bid="home-bid"]').filter({ hasText: PROJECT_A });
      if ((await side.count()) > 0) walk(`home · Your bids, this job: ${await textOf(side.first())}`);
    });

    // ── 11 ─────────────────────────────────────────────────────────────────
    await test.step("11. the same screens on a phone, 375px", async () => {
      await page.setViewportSize({ width: 375, height: 800 });
      const screens: Array<[string, string]> = [
        ["Home", "/bid/home"],
        ["job screen", jobScreen("estimate")],
        [`${GC_B}'s proposal`, `${jobScreen("proposal")}?invitation=${encodeURIComponent(invitationB)}`],
      ];
      for (const [name, url] of screens) {
        await page.goto(url);
        await bidPage(`${name} at 375px`);
        const measured = await page.evaluate(() => {
          const root = document.scrollingElement!;
          const wide = Array.from(document.querySelectorAll("body *"))
            .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
            .slice(0, 3)
            .map((el) => `${el.tagName.toLowerCase()}${el.getAttribute("data-guide") ? `[data-guide=${el.getAttribute("data-guide")}]` : ""} "${(el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40)}"`);
          return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, innerWidth: window.innerWidth, wide };
        });
        const overflows = measured.scrollWidth > measured.clientWidth;
        walk(
          `phone · ${name}: scrollWidth ${measured.scrollWidth} / clientWidth ${measured.clientWidth} / innerWidth ${measured.innerWidth} → ` +
            `${overflows ? "OVERFLOWS sideways" : "fits"}${measured.wide.length > 0 ? ` · past the edge: ${measured.wide.join("; ")}` : ""}`,
        );
        if (name === "job screen") {
          const current = page.locator('[data-guide="current-line"]');
          walk(`phone · job screen step strip: ${(await readGuide())?.steps.join(" | ") ?? "(no guide)"}`);
          if ((await current.count()) > 0) walk(`phone · job screen current step: "${await textOf(current)}"`);
          await printGuide("phone job screen", { rail: false });
        }
        expect.soft(measured.innerWidth, `${name} at 375px: the layout viewport should be the phone`).toBe(375);
        expect.soft(overflows, `${name} at 375px: the page should not scroll sideways`).toBe(false);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    });

    // ── 12 ─────────────────────────────────────────────────────────────────
    await test.step("12. what the browser reported along the way", async () => {
      walk(`health · uncaught exceptions: ${monitor.crashes.length} · #418 hydration mismatches: ${monitor.hydrationMismatches.length} · console errors: ${monitor.consoleErrors.length}`);
      for (const line of monitor.hydrationMismatches) walk(`health · #418 (recorded, not asserted): ${line}`);
      for (const line of monitor.consoleErrors.slice(0, 5)) walk(`health · console error: ${clip(squash(line), 200)}`);
      // THE SHELL'S KNOWN #418 RACE IS RECORDED, NOT ASSERTED — the same call
      // estimating-spine.spec.ts makes, for its reason: journey.spec.ts step 11
      // fails the run over it by name, and asserting it here too would make
      // this walk red for a defect that belongs to none of its screens.
      if (monitor.hydrationMismatches.length > 0) {
        test.info().annotations.push({
          type: "known-hydration-race-501",
          description:
            `${monitor.hydrationMismatches.length} React #418 hydration mismatch(es) — ` +
            `journey.spec.ts step 11 is what fails the run over this:\n${monitor.hydrationMismatches.join("\n")}`,
        });
      }
      expect(monitor.crashes, "an uncaught exception reached the browser").toEqual([]);
      walk("done");
    });
  });

  /** The overlay stops resizing, so a click on it lands where it was aimed (takeoff-workspace.spec.ts). */
  async function settledBox(overlay: Locator): Promise<{ width: number }> {
    let previous = -1;
    let steady = 0;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const box = await overlay.boundingBox();
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
});
