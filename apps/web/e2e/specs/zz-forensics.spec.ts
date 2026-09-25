import { test } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";

/** TEMPORARY DIAGNOSTIC — not a guard. Deleted before this branch's final
 * commit. It exists to name the element behind the #418 hydration mismatch
 * reported on seventeen pages, which no local run in an agent container can
 * reproduce (no Clerk, no browser for the signed-in suite). */

const PAGES = [
  "/dashboard",
  "/alerts",
  "/team",
  "/vendors",
  "/wall-types",
  "/schedule",
  "/photos",
  "/lien-deadlines",
  "/intake",
  "/drawings",
  "/settings/integrations",
  "/jobs",
];

test("FORENSICS: what the browser changed while hydrating", async ({ page }) => {
  test.setTimeout(600_000);

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message.split("\n")[0].slice(0, 160)));

  await page.addInitScript(() => {
    const w = window as unknown as { __muts: unknown[] };
    w.__muts = [];
    const path = (node: Node): string => {
      const parts: string[] = [];
      let cur: Node | null = node;
      while (cur && cur.nodeType === 1 && parts.length < 12) {
        const el = cur as Element;
        const parent = el.parentElement;
        const idx = parent ? [...parent.children].indexOf(el) + 1 : 0;
        parts.unshift(`${el.tagName.toLowerCase()}:nth-child(${idx})`);
        cur = parent;
      }
      return parts.join(">");
    };
    const desc = (n: Node): string => {
      if (n.nodeType === 1) {
        const el = n as Element;
        const cls = (el.getAttribute("class") ?? "").slice(0, 60);
        return `<${el.tagName.toLowerCase()}${cls ? ` class="${cls}"` : ""}>${(el.textContent ?? "").trim().slice(0, 40)}`;
      }
      return `#text(${(n.textContent ?? "").trim().slice(0, 40)})`;
    };
    new MutationObserver((records) => {
      for (const r of records) {
        if (w.__muts.length >= 300) return;
        w.__muts.push({
          t: Math.round(performance.now()),
          at: path(r.target),
          target: desc(r.target),
          removed: [...r.removedNodes].map(desc),
          added: [...r.addedNodes].map(desc),
        });
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });

  await signInAs(page, PERSONAS.main.email);

  for (const route of PAGES) {
    errors.length = 0;
    await page.goto(route);
    await page.waitForTimeout(3000);
    const mismatched = errors.filter((e) => /Minified React error #(418|423|425)/.test(e));

    // Independent, cause-agnostic detector: does the browser's PARSER
    // rewrite the server's own HTML? Any place it does is a guaranteed
    // hydration mismatch and is invisible to every check in this repo.
    const response = await page.request.get(route);
    const html = await response.text();
    const rewrite = await page.evaluate((raw: string) => {
      const doc = new DOMParser().parseFromString(raw, "text/html");
      const fromDom: string[] = [];
      const walk = (n: Element) => {
        fromDom.push(n.tagName.toLowerCase());
        for (const c of n.children) walk(c);
      };
      if (doc.body) for (const c of doc.body.children) walk(c);
      const fromText = [...raw.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*?)?(\/?)>/g)]
        .map((m) => m[1].toLowerCase())
        .filter((t) => !["html", "head", "meta", "link", "title", "script", "style", "base"].includes(t));
      const domSeq = fromDom.filter((t) => !["script", "style", "link", "meta", "template"].includes(t));
      const textSeq = fromText.filter((t) => !["script", "style", "link", "meta", "template", "body", "br", "hr", "img", "input", "path", "svg", "circle", "rect", "line", "g", "polyline", "polygon", "use", "defs", "stop", "source"].includes(t));
      const domOnly = domSeq.filter((t) => !["br", "hr", "img", "input", "path", "svg", "circle", "rect", "line", "g", "polyline", "polygon", "use", "defs", "stop", "source"].includes(t));
      let i = 0;
      for (; i < Math.min(domOnly.length, textSeq.length); i++) if (domOnly[i] !== textSeq[i]) break;
      return {
        equal: domOnly.length === textSeq.length && i >= domOnly.length,
        firstDivergence: i,
        domAround: domOnly.slice(Math.max(0, i - 6), i + 6),
        textAround: textSeq.slice(Math.max(0, i - 6), i + 6),
        counts: [domOnly.length, textSeq.length],
      };
    }, html);

    console.log(
      `FORENSICS ${route}: ${mismatched.length ? "MISMATCH" : "clean"} | parserRewrite=${rewrite.equal ? "no" : "YES"} ${JSON.stringify(rewrite)}`,
    );
    if (mismatched.length) {
      console.log(`FORENSICS ${route} errors: ${JSON.stringify(mismatched)}`);
      const muts = await page.evaluate(() => (window as unknown as { __muts: unknown[] }).__muts);
      console.log(`FORENSICS ${route} first mutations: ${JSON.stringify(muts.slice(0, 45), null, 1)}`);
    }
  }
});
