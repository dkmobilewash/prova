import { expect, test } from "@playwright/test";
import { PERSONAS } from "../lib/personas";
import { signInAs } from "../lib/signIn";

/**
 * ── #510's MISSING INSTRUMENT: NAME THE ELEMENT, IN A PRODUCTION BUILD ──
 *
 * CLAUDE.md's #418 entry ends on exactly this. Nine mechanisms are eliminated,
 * two fixes have shipped, and the residual mismatch fires on about one
 * authenticated page load in three — but nothing says WHICH element the two
 * sides disagree about. Production React puts #418 on `pageerror` with
 * `args[]=HTML` and prints no diff and no component stack, so the error itself
 * will never say.
 *
 * The dev-mode route to that answer is CLOSED, and the entry says so: the
 * defect does not reproduce under `next dev` — 96 loads on a laptop and 24 in
 * CI, both zero, both with a working positive control. A development build can
 * only name an element it actually sees disagree. So the entry's closing line
 * is "what is needed next is a PRODUCTION-mode instrument that can identify an
 * element without React's help — and the honest state of it is that nobody has
 * designed one."
 *
 * This is that design.
 *
 * ── HOW IT WORKS, AND WHY IT CAN WORK WHERE THE ERROR CANNOT ──
 *
 * React's own message says what it does about a mismatch: *"the tree will be
 * regenerated on the client"*. That regeneration is a DOM operation — a
 * subtree's children torn out and rebuilt — and a `MutationObserver` installed
 * before the page's first script sees it happen.
 *
 * The technique is already proven in this repo rather than hoped for. #501
 * installed one and caught the sidebar and the top bar being lifted into the
 * shell row "in the same millisecond as one of the #418s". That investigation
 * drew the WRONG CONCLUSION from it — the lift was React outlining a large
 * Suspense boundary, which is deterministic and harmless — but the instrument
 * saw a real DOM event at the right moment. What was missing was telling the
 * benign move apart from the regeneration.
 *
 * So this records both and labels them, rather than filtering one out. A probe
 * that silently drops a category is how #501 reached a confident wrong answer.
 *
 * ── THE CLOCK ──
 *
 * Both the error and the mutations are timestamped PAGE-SIDE with
 * `performance.now()`. A Playwright `pageerror` listener timestamps in Node,
 * and correlating two clocks across a process boundary at millisecond
 * resolution is a measurement nobody should trust. An `error` listener
 * installed in the same init script shares the mutations' clock exactly.
 *
 * ── AND THE CONTROL, WHICH IS NOT OPTIONAL ──
 *
 * A run that signs nobody in, loads nothing, or hydrates nothing produces the
 * same empty result as a clean app. Every load is separately proved HYDRATED,
 * and the final phase INJECTS a mismatch into the served HTML and requires the
 * probe to both catch the #418 and name the container. Without that, a quiet
 * run says nothing.
 *
 * ── RUNNING IT ──
 *
 *   pnpm test:e2e -- probes/mismatch-locator.probe.spec.ts --workers=1
 *
 * In `e2e/probes/`, which the gating suite's `testDir` cannot see, so this can
 * never turn CI red. It is a diagnostic and prints a measurement for a person
 * to read; its assertions are about the INSTRUMENT, never about the app.
 */

/**
 * ── EVERY NAV DESTINATION, TWICE, RATHER THAN FOUR PAGES SIX TIMES ──
 *
 * The first version of this probe reloaded `/dashboard`, `/safety`, `/settings`
 * and `/backcharges` six times each and found ZERO — on a GitHub runner, in a
 * production build, with the control firing 3/3. The gating suite kept finding
 * mismatches on the same branch, so the probe was looking in the wrong place.
 *
 * Two reasons, and the second is the one that matters:
 *
 *   - **"one load in three" is STALE.** CLAUDE.md measured 12 mismatches in 40
 *     reloads over those exact pages — `/safety` 5 of 10, `/settings` 5 of 10 —
 *     and that measurement PREDATES the two fixes that have since shipped. Step
 *     11 went from 14-19 pages to 6 to 1 after them. Sizing a probe from the
 *     old rate is sizing it for a defect that was partly fixed.
 *   - **the journey walks about THIRTY destinations, not four.** It opens every
 *     nav group, reads every `a[href^="/"]`, and `goto`s each one. Five recorded
 *     page lists are nearly disjoint and only `/dashboard` ever recurs, which is
 *     what a low-rate race over a wide route set looks like — and is exactly
 *     what four pages cannot sample.
 *
 * So this enumerates the nav the same way `journey.spec.ts` does rather than
 * naming routes, which also means it cannot drift from the product: a page
 * added to the sidebar is probed without editing this file.
 */
const PASSES = 2;

/**
 * Installed before any page script. Records every DOM mutation and every
 * uncaught error on ONE clock.
 */
const INSTRUMENT = () => {
  type Mut = { t: number; path: string; removed: number; added: number; boundary: boolean };
  const w = window as Window & { __mut?: Mut[]; __err?: { t: number; msg: string }[] };
  w.__mut = [];
  w.__err = [];

  window.addEventListener("error", (event: ErrorEvent) => {
    w.__err?.push({ t: performance.now(), msg: String(event.message ?? event) });
  });

  /** A readable path: the chain of tag#id[data-*] up to body. This is the
   *  output of the whole probe — the thing the error refuses to say. */
  const pathOf = (node: Node | null): string => {
    const parts: string[] = [];
    let at: Node | null = node;
    while (at && at !== document.documentElement && parts.length < 8) {
      if (at.nodeType === 1) {
        const el = at as Element;
        let part = el.tagName.toLowerCase();
        if (el.id) part += `#${el.id}`;
        for (const attr of ["data-takeoff", "data-testid", "data-tour", "data-clerk-component", "data-bids"]) {
          const value = el.getAttribute(attr);
          if (value) part += `[${attr}="${value}"]`;
        }
        const cls = el.getAttribute("class");
        if (cls && !el.id) part += `.${cls.split(/\s+/).slice(0, 2).join(".")}`;
        parts.unshift(part);
      } else if (at.nodeType === 8) {
        parts.unshift(`<!--${(at as Comment).data.slice(0, 6)}-->`);
      }
      at = at.parentNode;
    }
    return parts.join(" > ") || "(detached)";
  };

  /**
   * Is this React completing an outlined Suspense boundary rather than
   * regenerating a mismatched tree?
   *
   * React streams a boundary out of order when it is merely BIG — the sidebar
   * measures 13,442 bytes against a 12,800 threshold — and completes it by
   * moving children out of `<div hidden id="S:n">`. CLAUDE.md proves that
   * happens on EVERY authenticated page deterministically and is not evidence
   * about the mismatch. Labelled, never dropped: dropping a category is how
   * #501 reached a confident wrong answer.
   */
  const isBoundaryMove = (record: MutationRecord): boolean => {
    const inHidden = (node: Node | null): boolean => {
      let at: Node | null = node;
      while (at) {
        if (at.nodeType === 1) {
          const el = at as Element;
          const id = el.getAttribute("id") ?? "";
          if (el.hasAttribute("hidden") && /^S:/.test(id)) return true;
          if (/^B:/.test(id)) return true;
        }
        at = at.parentNode;
      }
      return false;
    };
    if (inHidden(record.target)) return true;
    for (const node of Array.from(record.removedNodes)) if (inHidden(node)) return true;
    // A boundary completion also inserts next to a `<!--$?-->` placeholder.
    for (const node of Array.from(record.addedNodes)) {
      if (node.nodeType === 8 && /^\$/.test((node as Comment).data)) return true;
    }
    return false;
  };

  new MutationObserver((records) => {
    const t = performance.now();
    for (const record of records) {
      if (record.type !== "childList") continue;
      // Only a real structural change. A single text node arriving is the
      // other error number and not this one.
      if (record.addedNodes.length === 0 && record.removedNodes.length === 0) continue;
      // ── WHAT IS WORTH RECORDING, AND WHY MOST OF IT IS NOT ──
      //
      // The first run of this reported 476 "non-boundary" mutations per load
      // and the answer was buried in them. Reading what they were: script and
      // link tags arriving in <head>, and nodes mutated while DETACHED from the
      // document. Neither can be a hydration regeneration — React regenerates a
      // subtree that is IN the tree, under <body>.
      //
      // And a regeneration REMOVES. React's own message says the tree "will be
      // regenerated on the client": the mismatched container's children are
      // torn out and rebuilt. A mutation that only ADDS is a script tag, a
      // portal, or Clerk mounting — all of which happen constantly and none of
      // which is this.
      const target = record.target;
      const attached = target.isConnected === true;
      let inHead = false;
      for (let at: Node | null = target; at; at = at.parentNode) {
        if (at.nodeName === "HEAD") { inHead = true; break; }
      }
      if (!attached || inHead) continue;

      w.__mut?.push({
        t,
        path: pathOf(record.target),
        removed: record.removedNodes.length,
        added: record.addedNodes.length,
        boundary: isBoundaryMove(record),
      });
    }
  }).observe(document, { childList: true, subtree: true });
};

type Readout = {
  errors: { t: number; msg: string }[];
  muts: { t: number; path: string; removed: number; added: number; boundary: boolean }[];
  hydrated: boolean;
};

async function readout(page: import("@playwright/test").Page): Promise<Readout> {
  return page.evaluate(() => {
    const w = window as unknown as { __mut: Readout["muts"]; __err: Readout["errors"] };
    // HYDRATION IS PROVED, not assumed. React cannot mismatch on a page it
    // never hydrated, and an un-hydrated load is a silent zero — the vacuous
    // green this whole directory exists to end.
    const hydrated = [...document.querySelectorAll("body *")]
      .slice(0, 400)
      .some((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$")));
    return { errors: w.__err ?? [], muts: w.__mut ?? [], hydrated };
  }) as Promise<Readout>;
}

const IS_418 = (msg: string) => /Minified React error #418|error #418/.test(msg);

/** Mutations within this many ms of the error are reported as its neighbours.
 *  #501 saw its burst "in the same millisecond"; 60 is generous enough to
 *  survive a slow frame without pulling in unrelated work. */
const WINDOW_MS = 60;

test.describe("#510: name the mismatched element", () => {
  // 4 routes x 6 loads, each with a 1.2s settle, plus sign-in. The default 30s
  // is not enough and the first run died on it mid-walk — which looks exactly
  // like a hang if you are not reading the error.
  test.setTimeout(10 * 60 * 1000);

  test("locates the regenerated container in a production build", async ({ page }) => {
    await page.addInitScript(INSTRUMENT);
    await signInAs(page, PERSONAS.main.email);

    // The nav's own destinations, collected exactly as the journey collects
    // them — groups opened first, because a closed group hides its links.
    await page.goto("/dashboard", { waitUntil: "load" });
    const nav = page.getByRole("navigation", { name: "Main" });
    for (let guard = 0; guard < 20; guard += 1) {
      const closed = nav.locator('button[aria-expanded="false"]');
      if ((await closed.count()) === 0) break;
      await closed.first().click();
    }
    const hrefs = await nav.locator('a[href^="/"]').evaluateAll((anchors) =>
      anchors.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""),
    );
    const routes = [...new Set(hrefs)].filter((h) => h.length > 1);
    console.log(`LOC walking ${routes.length} nav destinations x ${PASSES} passes`);
    // A HANDFUL OF LINKS IS A NAV THAT LOST ITS GROUPS, and a probe over four
    // routes is the thing this version exists to stop being. Same floor the
    // journey asserts.
    expect(routes.length, "the nav should offer a real set of destinations").toBeGreaterThanOrEqual(20);

    let loadsHydrated = 0;
    let loadsTotal = 0;
    const hits: string[] = [];

    for (let pass = 0; pass < PASSES; pass += 1) {
      for (const route of routes) {
        const i = pass;
        await page.goto(route, { waitUntil: "load" });
        // Let hydration finish and any regeneration land. Shorter than the
        // first version's 1200ms because there are now ~60 loads rather than
        // 24, and the control measures the regeneration landing within a
        // millisecond of the error — 600ms is many times that margin.
        await page.waitForTimeout(600);
        const data = await readout(page);
        loadsTotal += 1;
        if (data.hydrated) loadsHydrated += 1;

        const mismatches = data.errors.filter((e) => IS_418(e.msg));
        for (const error of mismatches) {
          const near = data.muts
            .filter((m) => Math.abs(m.t - error.t) <= WINDOW_MS)
            .sort((a, b) => Math.abs(a.t - error.t) - Math.abs(b.t - error.t));
          // REMOVALS FIRST. A regeneration tears a subtree out; an insert-only
          // mutation is a portal or a script and is never this. Within that,
          // closest to the error.
          const real = near
            .filter((m) => !m.boundary && m.removed > 0)
            .sort((a, b) => b.removed - a.removed || Math.abs(a.t - error.t) - Math.abs(b.t - error.t));
          const line =
            `MISMATCH on ${route} (load ${i + 1}): ${near.length} mutations within ${WINDOW_MS}ms, ` +
            `${real.length} of them NOT a Suspense boundary move`;
          hits.push(line);
          console.log(`LOC ${line}`);
          // The suspects first, then the boundary noise, so the answer is not
          // buried in the thing #501 mistook for it.
          for (const m of real.slice(0, 6)) {
            console.log(`LOC    SUSPECT  +${(m.t - error.t).toFixed(1)}ms  -${m.removed}/+${m.added}  ${m.path}`);
          }
          for (const m of near.filter((x) => x.boundary).slice(0, 3)) {
            console.log(`LOC    boundary +${(m.t - error.t).toFixed(1)}ms  -${m.removed}/+${m.added}  ${m.path}`);
          }
        }
      }
    }

    console.log(`LOC === ${loadsHydrated}/${loadsTotal} loads hydrated, ${hits.length} mismatches seen`);

    // ── ASSERTIONS ABOUT THE INSTRUMENT, NEVER ABOUT THE APP ──
    expect(loadsTotal, "no loads ran").toBeGreaterThan(0);
    expect(loadsHydrated, "a load that never hydrated cannot mismatch, so a zero would be vacuous").toBe(
      loadsTotal,
    );
  });

  test("CONTROL: catches and names an injected mismatch", async ({ page }) => {
    // Without this, a quiet run above says nothing. Rewrite the served HTML to
    // carry one extra <div> inside <body> — inside React's own tree, since the
    // App Router renders `body` — which is the ColorZilla mechanism CLAUDE.md's
    // #61 entry records, and the control the dev probe already uses.
    await page.addInitScript(INSTRUMENT);
    await signInAs(page, PERSONAS.main.email);

    await page.route("**/dashboard", async (route) => {
      if (route.request().resourceType() !== "document") return route.fallback();
      const response = await route.fetch();
      const html = await response.text();
      const injected = html.replace("<body", '<body data-injected="yes"').replace(
        /(<body[^>]*>)/,
        '$1<div id="probe-injected-mismatch">injected</div>',
      );
      // A REWRITE THAT DID NOT REWRITE is a control that proves nothing, so it
      // fails here rather than passing silently.
      expect(injected, "the body injection did not apply").toContain("probe-injected-mismatch");
      await route.fulfill({ response, body: injected });
    });

    let caught = 0;
    let named = 0;
    for (let i = 0; i < 3; i += 1) {
      await page.goto("/dashboard", { waitUntil: "load" });
      await page.waitForTimeout(1200);
      const data = await readout(page);
      expect(data.hydrated, `control load ${i + 1} never hydrated`).toBe(true);
      const error = data.errors.find((e) => IS_418(e.msg));
      if (!error) continue;
      caught += 1;
      const near = data.muts
        .filter((m) => Math.abs(m.t - error.t) <= WINDOW_MS && !m.boundary && m.removed > 0)
        .sort((a, b) => b.removed - a.removed || Math.abs(a.t - error.t) - Math.abs(b.t - error.t));
      console.log(`LOC CONTROL load ${i + 1}: caught #418, ${near.length} non-boundary mutations`);
      for (const m of near.slice(0, 4)) {
        console.log(`LOC    +${(m.t - error.t).toFixed(1)}ms  -${m.removed}/+${m.added}  ${m.path}`);
      }
      // The container React regenerates for a body-level mismatch is body
      // itself. Naming it is what proves the locator works.
      if (near.some((m) => /(^|> )body/.test(m.path))) named += 1;
    }

    console.log(`LOC === CONTROL caught ${caught}/3, named the container on ${named}`);
    expect(caught, "the control never produced a mismatch — the harness is broken, not the app").toBeGreaterThan(0);
    expect(named, "the control mismatched but the locator could not name the container").toBeGreaterThan(0);
  });
});
