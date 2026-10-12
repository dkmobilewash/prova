import type { Page, Request } from "@playwright/test";

/**
 * What the browser did around a click that produced nothing on screen.
 *
 * Three records, all read back by `historyLog(page, sinceMs)`:
 *
 * - every `history.pushState` / `history.replaceState` the page makes, with
 *   who made it. Next's `app-router.js` patches both so a call the router
 *   did NOT make itself dispatches ACTION_RESTORE, and
 *   `app-router-instance.js` DISCARDS a Server Action that is in flight when
 *   a navigation or restore arrives. Installed as an init script, before
 *   Next's patch, so the router's own calls are seen too (their state
 *   carries `__NA` / `_N`; marked "(next)").
 * - every network request: method, path, the status it got or the failure
 *   it ended in, and whether it had FINISHED by the time the log is read. A
 *   request still pending when a 10s wait gave up is the thing nobody can
 *   see from a screenshot. Static chunks are listed only when they failed
 *   or never finished.
 * - every console message, any level. Production React and Next report
 *   some of what they drop with console.log — server-action-reducer.js says
 *   "SERVER ACTION APPLY FAILED" that way — and HealthMonitor keeps only
 *   errors.
 *
 * On #748 the server answered "Start the job" with a 303 to step 2, nothing
 * moved the URL, and the browser stayed on /jobs/new; this is what was
 * missing from that sentence.
 */
type NetEntry = {
  at: number;
  method: string;
  path: string;
  action: boolean;
  rsc: boolean;
  status?: number;
  failed?: string;
  done?: number;
};

const nets = new WeakMap<Page, NetEntry[]>();
const byRequest = new WeakMap<Request, NetEntry>();
const consoles = new WeakMap<Page, string[]>();

export async function installHistoryLog(page: Page): Promise<void> {
  page.on("request", (request) => {
    let path = request.url();
    try {
      const url = new URL(request.url());
      path = `${url.host === new URL(page.url() || "http://x/").host ? "" : url.host}${url.pathname}${url.search ? "?" : ""}`;
    } catch {
      // keep the raw url
    }
    const entry: NetEntry = {
      at: Date.now(),
      method: request.method(),
      path: path.slice(0, 90),
      action: request.headers()["next-action"] !== undefined,
      rsc: request.headers()["rsc"] === "1",
    };
    byRequest.set(request, entry);
    const list = nets.get(page) ?? [];
    list.push(entry);
    nets.set(page, list.slice(-400));
  });
  page.on("response", (response) => {
    const entry = byRequest.get(response.request());
    if (entry) entry.status = response.status();
  });
  page.on("requestfinished", (request) => {
    const entry = byRequest.get(request);
    if (entry) entry.done = Date.now();
  });
  page.on("requestfailed", (request) => {
    const entry = byRequest.get(request);
    if (entry) {
      entry.failed = request.failure()?.errorText ?? "failed";
      entry.done = Date.now();
    }
  });
  page.on("console", (message) => {
    const list = consoles.get(page) ?? [];
    list.push(`${Date.now()} [${message.type()}] ${message.text().replace(/\s+/g, " ").slice(0, 160)}`);
    consoles.set(page, list.slice(-200));
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

/** Everything above since `sinceMs` (a `Date.now()` taken in the test, same
 * machine's clock), as one string for a failure message. */
export async function historyLog(page: Page, sinceMs: number): Promise<string> {
  const entries = await page
    .evaluate(() => (window as unknown as { __historyLog?: string[] }).__historyLog ?? [])
    .catch(() => [] as string[]);
  const history = entries
    .filter((entry) => Number(entry.split(" ")[0]) >= sinceMs)
    .map((entry) => entry.replace(/^\d+ /, ""));
  const clerk = await page
    .evaluate(() => {
      const c = (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk;
      return c ? `Clerk.loaded=${String(c.loaded)}` : "no Clerk global";
    })
    .catch(() => "page gone");

  const isStatic = (entry: NetEntry) => entry.path.includes("/_next/static/");
  const network = (nets.get(page) ?? [])
    .filter((entry) => entry.at >= sinceMs && (!isStatic(entry) || entry.failed || entry.done === undefined))
    .map((entry) => {
      const tag = entry.action ? " [action]" : entry.rsc ? " [rsc]" : "";
      const outcome = entry.failed ? `FAILED ${entry.failed}` : entry.status !== undefined ? String(entry.status) : "no response";
      const end = entry.done !== undefined ? `done +${entry.done - sinceMs}ms` : "STILL PENDING";
      return `+${entry.at - sinceMs}ms ${entry.method} ${entry.path}${tag} -> ${outcome}, ${end}`;
    });
  const console_ = (consoles.get(page) ?? [])
    .filter((entry) => Number(entry.split(" ")[0]) >= sinceMs)
    .map((entry) => entry.replace(/^\d+ /, ""));

  return (
    `${clerk}; history calls since the click: ${history.length > 0 ? history.join(" | ") : "none"}; ` +
    `network since the click: ${network.length > 0 ? network.join(" | ") : "none"}; ` +
    `console since the click: ${console_.length > 0 ? console_.join(" | ") : "none"}`
  );
}
