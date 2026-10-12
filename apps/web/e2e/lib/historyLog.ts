import type { Page } from "@playwright/test";

/**
 * Records every `history.pushState` / `history.replaceState` the page makes,
 * with who made it. The reason this exists is in Next's own router:
 * `app-router.js` patches both so a call the router did NOT make itself
 * dispatches ACTION_RESTORE, and `app-router-instance.js` DISCARDS a Server
 * Action that is in flight when a navigation or restore arrives — the
 * server's answer (a redirect, a re-render carrying a new row) is thrown
 * away and nothing on screen says so. On #748 the server answered "Start
 * the job" with a 303 to step 2 and the browser stayed on /jobs/new.
 *
 * Installed as an init script, so it runs before Next's patch and sees the
 * router's own calls too (those carry `__NA` / `_N` in their state and are
 * marked "(next)"). Read it with `historyLog`, which also says whether
 * Clerk's browser script had finished loading — a development instance
 * rewrites the URL as it loads.
 */
export async function installHistoryLog(page: Page): Promise<void> {
  // The one way the router drops an action's answer WITHOUT a navigation is
  // a flight payload that is not a root render: server-action-reducer.js
  // then `console.log('SERVER ACTION APPLY FAILED')` — a log, not an error,
  // so HealthMonitor never sees it. Kept here with the same clock.
  page.on("console", (message) => {
    if (message.text().includes("SERVER ACTION APPLY FAILED")) routerLogs.set(page, [...(routerLogs.get(page) ?? []), `${Date.now()} ${message.text()}`]);
  });
  await page.addInitScript(() => {
    const log: string[] = [];
    (window as unknown as { __historyLog: string[] }).__historyLog = log;
    for (const name of ["pushState", "replaceState"] as const) {
      const original = history[name].bind(history);
      history[name] = function patched(data: unknown, unused: string, url?: string | URL | null) {
        const internal = data !== null && typeof data === "object" && ("__NA" in data || "_N" in data);
        log.push(`${Date.now()} ${name}${internal ? " (next)" : ""} ${url ?? ""}`);
        return original(data, unused, url);
      } as typeof history.pushState;
    }
  });
}

/** One sentence: Clerk's load state and every history call since `sinceMs`
 * (a `Date.now()` taken in the test, on the same machine's clock). */
const routerLogs = new WeakMap<Page, string[]>();

export async function historyLog(page: Page, sinceMs: number): Promise<string> {
  const dropped = (routerLogs.get(page) ?? []).filter((entry) => Number(entry.split(" ")[0]) >= sinceMs).length;
  const entries = await page
    .evaluate(() => (window as unknown as { __historyLog?: string[] }).__historyLog ?? [])
    .catch(() => [] as string[]);
  const recent = entries
    .filter((entry) => Number(entry.split(" ")[0]) >= sinceMs)
    .map((entry) => entry.replace(/^\d+ /, ""));
  const clerk = await page
    .evaluate(() => {
      const c = (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk;
      return c ? `Clerk.loaded=${String(c.loaded)}` : "no Clerk global";
    })
    .catch(() => "page gone");
  return (
    `${clerk}; history calls since the click: ${recent.length > 0 ? recent.join(" | ") : "none"}; ` +
    `router "SERVER ACTION APPLY FAILED" logs since the click: ${dropped}`
  );
}
