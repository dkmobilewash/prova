import { expect, test } from "@playwright/test";
import { PERSONAS } from "../lib/personas";
import { signInAs } from "../lib/signIn";

/**
 * WHAT ARE `<body>`'s DIRECT CHILDREN, AND WHICH OF THEM DID THE SERVER SEND?
 *
 * The mismatch locator narrowed #510 to a body-level regeneration and then
 * named what the regeneration removes:
 *
 *   control (injected): div#probe-injected-mismatch , div[hidden] , div.flex.h-screen.bg-canvas
 *   real  (field-reports):                            div[hidden] , div.flex.h-screen.bg-canvas
 *
 * Those removals are collateral — React clears the container it regenerates —
 * but they reveal body's children, and one is unaccounted for. The root layout
 * renders `<StaleDeployBanner/>`, `<RscFailureBanner/>` and `{children}`; both
 * banners return `null` on the server AND on the client's first render, and the
 * `(app)` layout returns ONE root `div.flex.h-screen`. So `div[hidden]` with no
 * id is nobody's in this codebase, and the boundary holders all carry ids
 * (`div#S:0[hidden]`), so it is not one of those either.
 *
 * A hidden div that the SERVER sent and the client does not expect — or that
 * the CLIENT injects into a body the server already closed — is precisely a
 * body-level mismatch. Which of those it is decides where the fix goes, and
 * guessing from the Clerk and Next sources did not settle it.
 *
 * So this prints both lists side by side and lets them answer. No assertion
 * about the app; the assertions are that both lists were actually read.
 *
 *   pnpm test:e2e -- --config e2e/playwright.probe.config.ts body-children
 *
 * LOCAL/DIAGNOSTIC. In `e2e/probes/`, invisible to the gating suite.
 */

const ROUTES = ["/dashboard", "/field-reports", "/safety"] as const;

test.describe("#510: what is in body", () => {
  test.setTimeout(5 * 60 * 1000);

  test("lists body's children from the DOM and from the served HTML", async ({ page }) => {
    await signInAs(page, PERSONAS.main.email);

    let readPairs = 0;
    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: "load" });
      await page.waitForTimeout(1500);

      // THE DOM, after hydration.
      const dom = await page.evaluate(() =>
        Array.from(document.body.children).map((el) => {
          let out = el.tagName.toLowerCase();
          if (el.id) out += `#${el.id}`;
          if (el.hasAttribute("hidden")) out += "[hidden]";
          const cls = el.getAttribute("class");
          if (cls) out += `.${cls.split(/\s+/).slice(0, 2).join(".")}`;
          // Every attribute, so nothing about this node stays anonymous.
          const attrs = Array.from(el.attributes)
            .map((a) => a.name)
            .filter((n) => n !== "class" && n !== "id" && n !== "hidden")
            .slice(0, 6);
          if (attrs.length > 0) out += ` {${attrs.join(",")}}`;
          return out;
        }),
      );

      // THE SERVED HTML, fetched through the page's own session so it is the
      // same authenticated response hydration ran against.
      const response = await page.request.get(route);
      const html = await response.text();
      const bodyOpen = html.indexOf("<body");
      const bodyInner = bodyOpen < 0 ? "" : html.slice(html.indexOf(">", bodyOpen) + 1);
      // Top-level tags only: walk and keep depth 0 openers. Crude and enough —
      // the question is which ELEMENTS the server put directly in body.
      const served: string[] = [];
      let depth = 0;
      const tag = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
      let m: RegExpExecArray | null;
      const VOID = new Set(["br", "hr", "img", "input", "link", "meta", "source", "wbr"]);
      while ((m = tag.exec(bodyInner)) !== null) {
        const [, closing, name, rest, selfClose] = m;
        if (name.toLowerCase() === "body" && closing) break;
        if (closing) {
          depth = Math.max(0, depth - 1);
          continue;
        }
        if (depth === 0) {
          const hidden = /\shidden[\s>=]/.test(rest + ">") ? "[hidden]" : "";
          const id = /\sid="([^"]*)"/.exec(rest);
          served.push(`${name.toLowerCase()}${id ? `#${id[1]}` : ""}${hidden}`);
        }
        if (!selfClose && !VOID.has(name.toLowerCase())) depth += 1;
      }

      console.log(`\nBODY ${route}`);
      console.log(`BODY   DOM (${dom.length}):`);
      for (const d of dom) console.log(`BODY     ${d}`);
      console.log(`BODY   SERVED (${served.length}):`);
      for (const s of served.slice(0, 20)) console.log(`BODY     ${s}`);
      // THE ANSWER: what the DOM has that the server did not send.
      const servedSet = new Set(served.map((s) => s.split("#")[0] + (s.includes("[hidden]") ? "[hidden]" : "")));
      const onlyInDom = dom.filter((d) => {
        const key = d.split(/[#.\s]/)[0] + (d.includes("[hidden]") ? "[hidden]" : "");
        return !servedSet.has(key);
      });
      console.log(`BODY   ONLY IN THE DOM: ${onlyInDom.length > 0 ? onlyInDom.join(" , ") : "(nothing)"}`);
      if (dom.length > 0 && served.length > 0) readPairs += 1;
    }

    // Assertions about the INSTRUMENT: both lists were really read. A pair of
    // empty lists would print a tidy "(nothing)" and mean nothing at all.
    expect(readPairs, "neither list was read for any route").toBeGreaterThan(0);
  });
});
