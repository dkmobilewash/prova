import { expect, test } from "@playwright/test";
import { PERSONAS } from "../lib/personas";
import { signInAs } from "../lib/signIn";

/**
 * #510's ONE REMAINING EXPERIMENT, and nothing else.
 *
 * CLAUDE.md's #418 entry ends on a confound it names itself: a 96-load sweep
 * against `next dev` ON A LAPTOP produced ZERO mismatches, while production
 * mode in CI reports 3-9 pages per run. Two variables moved at once — BUILD
 * MODE and MACHINE — and the defect is a race, so a laptop dev server and a
 * GitHub runner are not interchangeable. The file says the cheap experiment
 * that separates them is "run the probe in CI with `E2E_DEV_SERVER=1`, on the
 * same runner class". This is that probe and only that probe.
 *
 * THREE THINGS IT DOES NOT DO, each a rule from that entry:
 *
 *   - it does NOT live in `e2e/specs/`. The `e2e` job's `testDir` is `./specs`
 *     with only `*.mobile.spec.ts`/`*.public.spec.ts` ignored, so a spec
 *     dropped there would join the suite that gates every PR. A diagnostic
 *     that can turn CI red is not a diagnostic.
 *   - it does NOT reuse `lib/health.ts`. That classifier matches
 *     "Minified React error #418", which a DEV build never prints — the main
 *     config says so in its own comment — so under this flag every mismatch
 *     would be filed as a CRASH. A probe whose instrument is wrong about the
 *     thing it measures reports a confident wrong number.
 *   - it does NOT read a pass/fail verdict off a dev run, which is the main
 *     config's standing instruction. Every assertion below is about THE
 *     INSTRUMENT. The measurement itself is printed, for a person to read.
 *
 * AND THE ZERO IS WORTHLESS WITHOUT THE CONTROL. A run that loads nothing,
 * hydrates nothing, or silently fails to sign in produces the same clean zero
 * as a genuinely clean app — the vacuous-green shape this repo keeps paying
 * for. So every load is separately proved HYDRATED, and the last phase
 * INJECTS a mismatch and requires the probe to catch it.
 */

/** Four routes from the page lists #510 records, which is deliberate: the
 * obvious objection to a zero is "you tested the quiet pages". `/dashboard`
 * recurs most; the other three have each appeared. Four and not sixteen
 * because `next dev` dies after about ten compiled routes — a heap flag cures
 * the "approaching the used memory threshold" restart and does NOT cure
 * "Zone Allocation failed", whose next symptom is ERR_CONNECTION_REFUSED and
 * reads exactly like a broken app. */
const ROUTES = ["/dashboard", "/pipeline", "/backcharges", "/wall-types"];
const LOADS_PER_ROUTE = 6;

/** React's DEVELOPMENT hydration text, from the installed react-dom 19.2.8
 * (`cjs/react-dom-client.development.js`, `throwOnHydrationMismatch`). The
 * minified build prints "Minified React error #418" and these words never;
 * the dev build prints these words and that code never. Matching the SENTENCE
 * rather than an error number is what makes this probe able to see anything at
 * all under this flag. */
const HYDRATION_TEXT = /Hydration failed because|hydrated but some attributes|did not match/i;

type Finding = { route: string; load: number; text: string };

test.describe("#510: does the mismatch survive a DEV build on a CI runner", () => {
  test("measures the residual #418 rate under next dev, and proves it could have seen one", async ({
    page,
  }) => {
    // Generous: a dev server compiles each route on first hit, and this walks
    // four of them many times over. The one previous dev run in CI took 12.7
    // minutes for the whole journey; this is a fraction of that work.
    test.setTimeout(15 * 60 * 1000);

    const findings: Finding[] = [];
    let hydratedLoads = 0;
    let totalLoads = 0;
    const captured: string[] = [];

    page.on("pageerror", (error) => captured.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") captured.push(message.text());
    });

    await signInAs(page, PERSONAS.main.email);

    for (const route of ROUTES) {
      for (let load = 1; load <= LOADS_PER_ROUTE; load += 1) {
        captured.length = 0;
        await page.goto(route, { waitUntil: "domcontentloaded" });
        // Settle: a mismatch is thrown DURING hydration, so the reading is
        // only meaningful once hydration has had its chance to happen.
        await page.waitForTimeout(2_500);

        totalLoads += 1;

        // REACT CANNOT MISMATCH ON A PAGE IT NEVER HYDRATED, so an
        // un-hydrated load is a silent zero and must not be counted as a
        // clean one. A `__reactFiber$` key on a real element is the proof.
        const hydrated = await page.evaluate(() => {
          const nodes = Array.from(document.querySelectorAll("body *")).slice(0, 400);
          return nodes.some((node) =>
            Object.keys(node).some((key) => key.startsWith("__reactFiber$")),
          );
        });
        if (hydrated) hydratedLoads += 1;

        const hit = captured.find((text) => HYDRATION_TEXT.test(text));
        if (hit !== undefined) findings.push({ route, load, text: hit.slice(0, 1_200) });
      }
    }

    console.log(`probe: ${totalLoads} loads, ${hydratedLoads} hydrated`);
    console.log(`probe: ${findings.length} hydration mismatches`);
    for (const finding of findings) {
      // THE WHOLE POINT OF A DEV RUN: this text names the element and carries
      // a component stack. Production strips it to an error code and a URL.
      console.log(`\nprobe: MISMATCH on ${finding.route} (load ${finding.load})\n${finding.text}`);
    }

    // ── The instrument's own assertions. Not the app's. ──
    expect(totalLoads, "the probe walked no pages").toBe(ROUTES.length * LOADS_PER_ROUTE);
    expect(
      hydratedLoads,
      "a load that never hydrated cannot mismatch, so a zero from it means nothing",
    ).toBe(totalLoads);

    // ── POSITIVE CONTROL, last, because it rewrites a response. ──
    // One extra <div> immediately inside <body> — inside React's own tree,
    // since the App Router renders `body`. This is the ColorZilla mechanism
    // from CLAUDE.md's #61 entry, and a mismatch React is documented to throw
    // on.
    let controlFirings = 0;
    await page.route("**/dashboard", async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({
        response,
        body: body.replace(/<body([^>]*)>/, '<body$1><div data-probe-injected="1"></div>'),
      });
    });

    for (let load = 1; load <= 3; load += 1) {
      captured.length = 0;
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2_500);
      if (captured.some((text) => HYDRATION_TEXT.test(text))) controlFirings += 1;
    }
    await page.unroute("**/dashboard");

    console.log(`probe: control fired ${controlFirings}/3`);

    // A CONTROL THAT DOES NOT FIRE IS THE INSTRUCTION TO FIX THE HARNESS,
    // never a result to read — three arms of the earlier investigation died
    // exactly here. Note what success looks like: the control asserts the
    // ERROR, not the injected node's presence. React says the tree "will be
    // regenerated on the client", and the regeneration DELETES the node, so
    // asserting presence reds a working control.
    expect(
      controlFirings,
      "the probe could not see a mismatch it injected itself, so its zero is meaningless",
    ).toBeGreaterThan(0);
  });
});
