import { expect, type Page } from "@playwright/test";

/**
 * THE ASSERTION THAT WOULD HAVE CAUGHT 2026-09-21, run after every
 * navigation and every action in the journey.
 *
 * That day the product shipped with CI green, 5,800+ unit tests green and
 * every census green while creating one invoice made EVERY authenticated
 * page render an error boundary, and a thousands comma in a quantity box
 * rendered Next's redacted "Server Components render" sentence. All of it
 * was found by a person clicking. This file is the machine doing the
 * clicking's most basic check: does the page I am looking at say it
 * broke?
 *
 * Three things are asserted, and the third is the one this repo's own
 * history insists on:
 *
 *   1. None of the crash sentences below is on the page — Next's stock
 *      boundaries, this app's own `PageLoadError` (components/
 *      PageLoadError.tsx), and the redacted message production
 *      substitutes for a thrown Server Action error.
 *   2. No uncaught exception reached the browser (`pageerror`), when a
 *      HealthMonitor was attached.
 *   3. The page rendered SOMETHING. A blank page contains none of the
 *      crash sentences and would pass check 1 forever — the "watcher
 *      whose needle can never be found" shape CLAUDE.md records more than
 *      once. So `<main>` (or the body, on a page without one) must carry a
 *      real amount of visible text, and a signed-in page must show the
 *      app shell's own navigation landmark.
 *
 * These strings are the RENDERED wording, checked against the source on
 * 2026-09-21. If PageLoadError's copy changes, this list is where the
 * change lands — and a change that makes the list match nothing would be
 * caught by check 3's companion in health.test.ts, which fails if the
 * markers stop matching the boundary's source.
 */
export const CRASH_MARKERS = [
  // Next's stock client boundary ("Application error: a client-side
  // exception has occurred … Digest: …") and its server twin.
  "Application error",
  "a client-side exception",
  "a server-side exception",
  "Digest:",
  // components/PageLoadError.tsx — every one of this app's own boundaries
  // (app/error.tsx, app/global-error.tsx, app/(app)/error.tsx) renders it.
  "This page didn't load",
  "Something went wrong reading your data",
  "If you report this, include reference",
  // What production substitutes for a thrown Server Action's message —
  // exactly what the `2,800` quantity rendered on 2026-09-21.
  "Server Components render",
  "omitted in production builds",
] as const;

/** Visible characters a page must render to count as having loaded.
 * Deliberately low: the point is "not blank", not "looks finished". */
const MIN_VISIBLE_CHARS = 120;

/**
 * Collects what the browser reports about a page for the life of that
 * page. Attach one per page, before the first navigation.
 *
 * `pageerror` is an UNCAUGHT exception — a real crash. Console `error`
 * lines are kept too but only reported, never asserted: a hydration
 * mismatch warning from a browser extension is noise (CLAUDE.md's #61
 * entry), and a check that fails on noise gets deleted.
 */
export class HealthMonitor {
  /** Uncaught exceptions that are NOT hydration mismatches — real crashes.
   * `expectHealthy` fails on these the moment it sees one. */
  readonly crashes: string[] = [];
  /**
   * React hydration mismatches (#418/#423/#425), kept apart from crashes
   * and asserted by the journey's LAST step rather than by every step.
   *
   * Why apart: the page recovers from one by re-rendering, so a person
   * sees nothing — but the server's HTML and the browser's first render
   * disagreed, which is the defect CLAUDE.md's Dates bullet warns about,
   * and it is worth failing the run over. Why last: it fired on
   * /jobs/<id>/billing in one run, /jobs/<id>/retainage in the next, and
   * on neither in a third — the shape of something in the job-tab shell
   * rendered from "now". Failing step 6 or 7 over it skipped 7b-10, the
   * steps that exist to catch an invoice crashing every page, and made the
   * report about the wrong thing. So the run still goes red, naming every
   * URL it happened on, after the spine has had its say.
   */
  readonly hydrationMismatches: string[] = [];
  readonly consoleErrors: string[] = [];

  /** Both kinds, for a report that wants everything the browser threw. */
  get pageErrors(): string[] {
    return [...this.crashes, ...this.hydrationMismatches];
  }

  constructor(page: Page) {
    page.on("pageerror", (error) => {
      // The URL at the moment it fired: hydration errors land AFTER
      // `load`, and would otherwise be blamed on whichever page the next
      // check happened to be looking at.
      const entry = `on ${page.url()}: ${error.name}: ${error.message}`;
      if (/Minified React error #(418|423|425)/.test(error.message)) {
        this.hydrationMismatches.push(
          `${entry} — a React HYDRATION MISMATCH: the server's HTML and the browser's first render disagreed`,
        );
      } else {
        this.crashes.push(entry);
      }
    });
    page.on("console", (message) => {
      if (message.type() === "error") this.consoleErrors.push(message.text());
    });
  }
}

export interface HealthOptions {
  /** Attach the page's monitor to also fail on uncaught exceptions. */
  monitor?: HealthMonitor;
  /** False for pages outside the signed-in shell (/welcome, /sign-in). */
  signedIn?: boolean;
}

/**
 * Fails, naming the step and the URL, if the page shows any crash
 * sentence, threw an uncaught exception, or rendered next to nothing.
 */
export async function expectHealthy(page: Page, step: string, options: HealthOptions = {}): Promise<void> {
  const where = `${step} (${page.url()})`;

  // Streamed RSC pages finish their HTML on `load`; a boundary that
  // replaces the page does so before then. Waiting here means the text
  // read below is the settled page, not the shell around a pending
  // Suspense boundary.
  await page.waitForLoadState("load");

  const body = page.locator("body");
  await expect(body, `${where}: no body rendered`).toBeVisible();
  const bodyText = await body.innerText();

  for (const marker of CRASH_MARKERS) {
    expect(bodyText, `${where}: the page shows "${marker}"`).not.toContain(marker);
  }

  if (options.monitor) {
    expect(options.monitor.crashes, `${where}: uncaught exception(s) in the browser`).toEqual([]);
  }

  const main = page.locator("main");
  const contentText = (await main.count()) > 0 ? await main.first().innerText() : bodyText;
  const visibleChars = contentText.replace(/\s+/g, " ").trim().length;
  expect(
    visibleChars,
    `${where}: rendered ${visibleChars} visible characters — a page that shows nothing cannot show an error either`,
  ).toBeGreaterThanOrEqual(MIN_VISIBLE_CHARS);

  if (options.signedIn !== false) {
    await expect(
      page.getByRole("navigation", { name: "Main" }),
      `${where}: the app shell's main navigation is missing`,
    ).toBeVisible();
  }
}
