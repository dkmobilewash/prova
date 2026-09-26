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
 *      app shell's own navigation — the 240px rail at desktop width, the
 *      drawer button below Tailwind's `md`, whichever one that width owes.
 *      See `expectShellNavigation` at the foot of this file: asking for the
 *      rail at 375px is what made both field-screens.mobile specs red on
 *      main for days, about a phone shell that was there all along.
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

/**
 * Tailwind's `md` breakpoint in px — the width at and above which the
 * desktop rail renders, and below which the phone drawer does. Both of
 * those `md:` classes are read from the same number, so it is not a
 * constant invented here: health.test.ts pins it to the value
 * `resolveConfig(tailwind.config.ts).theme.screens.md` actually resolves
 * to, and fails if the app's config ever moves it.
 */
export const RAIL_BREAKPOINT_PX = 768;

/** The desktop rail's accessible name (`Sidebar.tsx`) and the phone
 * shell's hamburger (`MobileNav.tsx`). Both are pinned to those two files
 * in health.test.ts, for the reason the crash markers are: a name this
 * file looks for and the app no longer renders is a check about nothing. */
export const RAIL_NAV_NAME = "Main";
export const DRAWER_BUTTON_NAME = "Open navigation";

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
   * disagreed, and it is worth failing the run over. Why last: it fires on
   * a different set of pages every run, so failing step 6 or 7 over it
   * skipped 7b-10, the steps that exist to catch an invoice crashing every
   * page, and made the report about the wrong thing. So the run still goes
   * red, naming every URL it happened on, after the spine has had its say.
   *
   * WHAT THIS COMMENT SAID UNTIL 2026-09-25, AND WHY IT WAS EXPENSIVE. It
   * read "the shape of something in the job-tab shell rendered from
   * 'now'", and the assertion's own failure message still pointed at
   * CLAUDE.md's Dates bullet. Both were wrong, and being wrong in a
   * plausible direction is what kept this open: they sent three separate
   * investigations at dates and timezones.
   *
   * It is not a date, and the error itself says so. React's #418 carries
   * its kind as the first argument, and every occurrence in every run
   * reads `args[]=HTML` — read out of the installed react-dom 19.2.8,
   * `cjs/react-dom-client.development.js`, `throwOnHydrationMismatch`:
   * "Hydration failed because the server rendered " + (fromText ? "text"
   * : "HTML"). `fromText` is true ONLY for a text-node mismatch, so
   * `HTML` means an ELEMENT-level disagreement — a node the server wrote
   * and the browser did not, or the other way round. A date formatted
   * differently is a text mismatch and cannot produce this message.
   * Playwright also sets no `timezoneId`, so in CI the server and the
   * browser are both UTC and every zone-derived value is identical on the
   * two sides by construction.
   *
   * Nor is it the job-tab shell, or any page. See CLAUDE.md's entry for
   * the measurement: ~one authenticated page load in three, on whichever
   * pages happen to lose the race.
   *
   * WHAT THE SIGNED-IN SHELL DOES ABOUT IT, so a list here is read against
   * the right history. Two things were fixed 2026-09-25: the shell's
   * regions are paired with their widgets inside a client module
   * (`components/AppChrome.tsx`), so a region's child can no longer arrive
   * in the browser as a deferred lazy; and Clerk's `<UserButton>`, which
   * renders markup only when `clerk.loaded` — a flag it reads during render
   * and one that is false on the server ALWAYS — now waits for mount
   * (`components/AfterMount.tsx`). If this list is non-empty again, it is
   * something NEW, and the first question is which element the two sides
   * disagree about rather than which page it says.
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
    await expectShellNavigation(page, where);
  }
}

/**
 * THE SIGNED-IN SHELL HAS TWO NAVIGATIONS AND ONLY EVER RENDERS ONE OF
 * THEM, and which one depends on the width. This check used to know about
 * the desktop one only.
 *
 * `Sidebar.tsx` is the 240px rail — `<nav aria-label="Main">` inside a
 * `hidden … md:block` spacer, so below Tailwind's `md` it is
 * `display: none` and not in the accessibility tree at all. `MobileNav.tsx`
 * is the same links in a drawer behind a hamburger, and its wrapper is
 * `md:hidden`, so above `md` IT is the one that does not exist. Exactly one
 * of the two is reachable at any width.
 *
 * So this is not an either/or, and deliberately not written as one: an `or`
 * would go green on a phone that still had a desktop rail, or on a desktop
 * that had lost it, which is the "absence of a failure is not a pass" shape
 * CLAUDE.md records. The width decides which navigation is OWED, and that
 * one is then required.
 *
 * `window.innerWidth`, not `page.viewportSize()`: the media query behind
 * `md:` reads the LAYOUT viewport, which is what `innerWidth` reports and
 * what lib/viewport.ts documents can differ from the declared device width.
 * Asking the browser what the media query sees means this cannot disagree
 * with the CSS that is actually applied.
 */
async function expectShellNavigation(page: Page, where: string): Promise<void> {
  const layoutWidth = await page.evaluate(() => window.innerWidth);

  if (layoutWidth >= RAIL_BREAKPOINT_PX) {
    await expect(
      page.getByRole("navigation", { name: RAIL_NAV_NAME }),
      `${where}: the app shell's main navigation is missing`,
    ).toBeVisible();
    return;
  }

  await expect(
    page.getByRole("button", { name: DRAWER_BUTTON_NAME }),
    `${where}: at a layout width of ${layoutWidth}px the shell's navigation is the drawer button ` +
      `("${DRAWER_BUTTON_NAME}") and it is not there. Below ${RAIL_BREAKPOINT_PX}px the desktop rail is ` +
      "display:none, so this button is the only way off this page on a phone.",
  ).toBeVisible();
}
