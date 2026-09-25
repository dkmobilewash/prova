import { test } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";

/** TEMPORARY DIAGNOSTIC — not a guard, removed before this branch's final
 * commit.
 *
 * Round 1: the twelve pages the journey blames most were clean with a
 * 3-second dwell. Round 2: two walks of the same 38 destinations in ONE
 * signed-in session reported 6 (no dwell) and 4 (3-second dwell) — and
 * almost none of the same pages. So the page is not the variable and the
 * cadence barely is: it is ~10-15% of ANY authenticated page load. Round 2's
 * mutation log was useless because the HTML PARSER's own insertions filled
 * it before hydration began.
 *
 * Round 3 therefore: reload ONE page many times to get the rate, and record
 * only what the parser cannot do — a REMOVAL — plus everything after the
 * first one. React recovers from a mismatch by deleting the server's nodes,
 * so the first removal is where it noticed. */

const INSTRUMENT = () => {
  const w = window as unknown as { __muts: unknown[]; __sawRemoval: boolean };
  w.__muts = [];
  w.__sawRemoval = false;
  const path = (node: Node): string => {
    const parts: string[] = [];
    let cur: Node | null = node;
    while (cur && cur.nodeType === 1 && parts.length < 16) {
      const el = cur as Element;
      const parent = el.parentElement;
      parts.unshift(`${el.tagName.toLowerCase()}:nth-child(${parent ? [...parent.children].indexOf(el) + 1 : 0})`);
      cur = parent;
    }
    return parts.join(">");
  };
  const desc = (n: Node): string => {
    if (n.nodeType === 1) {
      const el = n as Element;
      const cls = (el.getAttribute("class") ?? "").slice(0, 80);
      const attrs = [...el.attributes].filter((a) => a.name !== "class").map((a) => `${a.name}="${a.value.slice(0, 30)}"`).slice(0, 5).join(" ");
      return `<${el.tagName.toLowerCase()}${attrs ? ` ${attrs}` : ""}${cls ? ` class="${cls}"` : ""}>${(el.textContent ?? "").trim().slice(0, 60)}`;
    }
    if (n.nodeType === 8) return `<!--${(n.textContent ?? "").slice(0, 24)}-->`;
    return `#text(${(n.textContent ?? "").trim().slice(0, 60)})`;
  };
  new MutationObserver((records) => {
    for (const r of records) {
      const isRemoval = r.removedNodes.length > 0;
      if (!isRemoval && !w.__sawRemoval) continue;
      if (isRemoval) w.__sawRemoval = true;
      if (w.__muts.length >= 90) break;
      w.__muts.push({
        t: Math.round(performance.now()),
        kind: r.type,
        at: path(r.target),
        target: desc(r.target),
        removed: [...r.removedNodes].map(desc),
        added: [...r.addedNodes].map(desc),
      });
    }
  }).observe(document, { childList: true, subtree: true, characterData: true });

  const dump = (message: string) => {
    if (!/Minified React error #(418|423|425)/.test(message)) return;
    try {
      sessionStorage.setItem(`__hydra:${location.pathname}:${Math.round(performance.now())}`, JSON.stringify({
        at: location.pathname,
        message: message.slice(0, 120),
        muts: w.__muts.slice(0, 22),
      }));
    } catch {
      /* storage refused */
    }
  };
  window.addEventListener("error", (event) => dump(String(event.message ?? "")));
};

const ROUTES = ["/backcharges", "/safety", "/wall-types", "/settings"];
const RELOADS = 10;

test("FORENSICS: the rate, and the first node React deleted", async ({ page }) => {
  test.setTimeout(900_000);
  await page.addInitScript(INSTRUMENT);
  await signInAs(page, PERSONAS.main.email);

  let loads = 0;
  let hits = 0;
  const where: string[] = [];
  page.on("pageerror", (error) => {
    if (/Minified React error #(418|423|425)/.test(error.message)) {
      hits += 1;
      where.push(page.url().replace(/^https?:\/\/[^/]+/, ""));
    }
  });
  for (let i = 0; i < RELOADS; i++) {
    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForTimeout(1200);
      loads += 1;
    }
  }
  await page.waitForTimeout(2000);
  console.log(`FORENSICS rate: ${hits} mismatches in ${loads} loads`);
  console.log(`FORENSICS where: ${JSON.stringify(where)}`);

  const dumps = await page.evaluate(() => {
    const out: unknown[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith("__hydra:")) out.push(JSON.parse(sessionStorage.getItem(key)!));
    }
    return out;
  });
  console.log(`FORENSICS dumps: ${dumps.length}`);
  for (const dump of dumps.slice(0, 3)) console.log(`FORENSICS dump: ${JSON.stringify(dump)}`);
});
