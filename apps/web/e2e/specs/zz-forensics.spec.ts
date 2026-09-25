import { test } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";

/** TEMPORARY DIAGNOSTIC — not a guard, removed before this branch's final
 * commit. Round 1 (154c170e) established that the twelve pages the journey
 * reported most often are CLEAN when visited with a 3-second dwell as MAIN,
 * in the same CI run whose journey reported seventeen. So the variable is
 * not the page. This round tests the remaining difference: how fast the
 * suite navigates away. */

const DESTINATIONS = [
  "/dashboard", "/ask", "/bids", "/pipeline", "/proposals", "/catalog", "/wall-types",
  "/phase-codes", "/schedule", "/field-reports", "/photos", "/punch-lists", "/rfis",
  "/submittals", "/drawings", "/closeout", "/material-orders", "/vendors",
  "/vendors/pricing", "/equipment", "/deployment", "/team", "/certifications",
  "/compliance", "/prevailing-wage", "/union-compliance", "/safety", "/backcharges",
  "/lien-deadlines", "/cash-flow", "/alerts", "/intake", "/messages", "/contacts",
  "/sales", "/settings", "/settings/integrations", "/jobs",
];

const INSTRUMENT = () => {
  const w = window as unknown as { __muts: unknown[] };
  w.__muts = [];
  const path = (node: Node): string => {
    const parts: string[] = [];
    let cur: Node | null = node;
    while (cur && cur.nodeType === 1 && parts.length < 14) {
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
      const cls = (el.getAttribute("class") ?? "").slice(0, 70);
      return `<${el.tagName.toLowerCase()}${cls ? ` class="${cls}"` : ""}>${(el.textContent ?? "").trim().slice(0, 50)}`;
    }
    if (n.nodeType === 8) return `<!--${(n.textContent ?? "").slice(0, 20)}-->`;
    return `#text(${(n.textContent ?? "").trim().slice(0, 50)})`;
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (w.__muts.length >= 160) break;
      w.__muts.push({
        t: Math.round(performance.now()),
        at: path(r.target),
        target: desc(r.target),
        removed: [...r.removedNodes].map(desc),
        added: [...r.addedNodes].map(desc),
      });
    }
  }).observe(document, { childList: true, subtree: true, characterData: true });

  // The dump has to outlive the document: at the fast cadence the error
  // fires as the next navigation starts, so reading it from the test after
  // the fact reads the WRONG document. sessionStorage survives a same-tab
  // navigation and is read back once at the end.
  const dump = (message: string) => {
    if (!/Minified React error #(418|423|425)/.test(message)) return;
    try {
      const key = `__hydra:${location.pathname}:${Math.round(performance.now())}`;
      sessionStorage.setItem(key, JSON.stringify({ message: message.slice(0, 200), at: location.pathname, muts: w.__muts.slice(0, 40) }));
    } catch {
      /* storage refused — nothing to do */
    }
  };
  window.addEventListener("error", (event) => dump(String(event.message ?? "")));
  const original = console.error;
  console.error = (...args: unknown[]) => {
    dump(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
    original(...args);
  };
};

async function walk(
  page: import("@playwright/test").Page,
  label: string,
  dwellMs: number,
): Promise<void> {
  const hits: string[] = [];
  const onError = (error: Error) => {
    if (/Minified React error #(418|423|425)/.test(error.message)) hits.push(page.url().replace(/^https?:\/\/[^/]+/, ""));
  };
  page.on("pageerror", onError);
  for (const route of DESTINATIONS) {
    await page.goto(route);
    if (dwellMs) await page.waitForTimeout(dwellMs);
  }
  await page.waitForTimeout(3000);
  page.off("pageerror", onError);
  console.log(`FORENSICS ${label}: ${hits.length} of ${DESTINATIONS.length} pages reported a mismatch`);
  console.log(`FORENSICS ${label} urls: ${JSON.stringify(hits)}`);
}

test("FORENSICS: fast cadence, then slow, same persona and build", async ({ page }) => {
  test.setTimeout(900_000);
  await page.addInitScript(INSTRUMENT);
  await signInAs(page, PERSONAS.main.email);

  await walk(page, "FAST (no dwell)", 0);
  await walk(page, "SLOW (3s dwell)", 3000);

  const dumps = await page.evaluate(() => {
    const out: unknown[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith("__hydra:")) out.push(JSON.parse(sessionStorage.getItem(key)!));
    }
    return out;
  });
  console.log(`FORENSICS dumps captured: ${dumps.length}`);
  for (const dump of dumps.slice(0, 4)) console.log(`FORENSICS dump: ${JSON.stringify(dump, null, 1)}`);
});
