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
 *
 * CI run 38311288211 (`7d79e6f7`) read the network half back and settled
 * where the stall is NOT: the server answers, and then the BROWSER cancels
 * the request — the stage box's RSC fetch and the action POST both end
 * `net::ERR_ABORTED` 200-360ms after the click, no history call, and in the
 * action cases `page.evaluate` fails, which Playwright does when the page's
 * execution context was destroyed. Next's router aborts its own fetch only
 * on `pagehide` (fetch-server-response.js), and the action POST has no
 * abort signal at all, so something unloads or swaps the document — with no
 * document request in the log. So the fourth record: the DOCUMENT itself.
 *
 * - every main-frame navigation the browser commits (`framenavigated`),
 *   whether or not it cost a request — about:blank, a bfcache restore and a
 *   same-document swap all count — plus every dialog, a crash, the page
 *   closing; and from inside the page, `pagehide`/`pageshow`/
 *   `beforeunload`/`visibilitychange`, each stamped with a per-document id
 *   minted by the init script, so two documents at one URL can be told
 *   apart. Each request also says whether it was a navigation request and
 *   what kind of resource it was.
 *
 * CI run 38313153165 (`74ad3195`) read THAT back too, and it emptied the
 * document explanation: in the stage-box cases no page event fired at all —
 * no navigation, no pagehide, no dialog, no crash, same document id, Clerk
 * loaded, readyState complete — and the RSC fetch was still cancelled 200 to
 * 440ms after the click, once its response had begun. So the cancel comes
 * from INSIDE the page, by a code path that holds either the request's
 * AbortSignal or its response body. The fifth record, then, is WHO:
 *
 * - `AbortController.prototype.abort` and `ReadableStream.prototype.cancel`
 *   (plus a reader's `cancel`) are wrapped before any page script, and each
 *   call logs the first frames of its stack. `window.fetch` is wrapped the
 *   same way, so every fetch logs who made it, whether it was a prefetch, and
 *   when its response arrived — a prefetch and a navigation both carry
 *   `rsc: 1`, and only `next-router-prefetch` tells them apart.
 * - `popstate` and `hashchange` join the document events: a fragment
 *   navigation goes through neither pushState nor pagehide.
 */
type NetEntry = {
  at: number;
  method: string;
  path: string;
  action: boolean;
  rsc: boolean;
  /** A document (navigation) request, as opposed to a fetch the page made. */
  nav: boolean;
  type: string;
  status?: number;
  failed?: string;
  done?: number;
};

const nets = new WeakMap<Page, NetEntry[]>();
const byRequest = new WeakMap<Request, NetEntry>();
const consoles = new WeakMap<Page, string[]>();
const events = new WeakMap<Page, string[]>();

function note(page: Page, line: string) {
  const list = events.get(page) ?? [];
  list.push(`${Date.now()} ${line}`);
  events.set(page, list.slice(-200));
}

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
      nav: request.isNavigationRequest(),
      type: request.resourceType(),
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
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    // The id the init script minted for THIS document; a navigation that
    // kept the document (a hash change) keeps the id, a new document gets a
    // new one. Read asynchronously; a frame mid-swap answers "unreadable".
    frame
      .evaluate(() => (window as unknown as { __docId?: string }).__docId ?? "no id")
      .then((id) => note(page, `framenavigated ${frame.url()} doc=${id}`))
      .catch(() => note(page, `framenavigated ${frame.url()} doc=unreadable`));
  });
  // Registering a dialog listener switches off Playwright's auto-dismiss, so
  // dismiss here — the same outcome the suite had before, now written down.
  // For a beforeunload prompt, dismiss means the navigation is CANCELLED.
  page.on("dialog", (dialog) => {
    note(page, `dialog ${dialog.type()} "${dialog.message().slice(0, 120)}" -> dismissed`);
    dialog.dismiss().catch(() => {});
  });
  page.on("crash", () => note(page, "page CRASHED"));
  page.on("close", () => note(page, "page closed"));
  page.on("load", () => note(page, `load ${page.url()}`));
  await page.addInitScript(() => {
    const log: string[] = [];
    const docId = Math.random().toString(36).slice(2, 8);
    (window as unknown as { __docId: string }).__docId = docId;
    const navType = (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type ?? "?";
    log.push(`${Date.now()} document ${docId} started (${navType}) at ${location.href}`);
    const frames = () =>
      (new Error().stack ?? "")
        .split("\n")
        .slice(2, 7)
        .map((line) => line.trim().replace(/^at /, "").replace(location.origin, ""))
        .join(" < ");
    const abort = AbortController.prototype.abort;
    AbortController.prototype.abort = function patchedAbort(reason?: unknown) {
      log.push(`${Date.now()} AbortController.abort(${reason === undefined ? "" : String(reason).slice(0, 60)}) from ${frames()}`);
      return abort.call(this, reason);
    };
    const cancel = ReadableStream.prototype.cancel;
    ReadableStream.prototype.cancel = function patchedCancel(reason?: unknown) {
      log.push(`${Date.now()} ReadableStream.cancel(${reason === undefined ? "" : String(reason).slice(0, 60)}) from ${frames()}`);
      return cancel.call(this, reason);
    };
    const getReader = ReadableStream.prototype.getReader;
    ReadableStream.prototype.getReader = function patchedGetReader(this: ReadableStream, ...args: unknown[]) {
      const reader = (getReader as (this: ReadableStream, ...a: unknown[]) => ReadableStreamDefaultReader).apply(this, args);
      const readerCancel = reader.cancel;
      reader.cancel = function patchedReaderCancel(reason?: unknown) {
        log.push(`${Date.now()} reader.cancel(${reason === undefined ? "" : String(reason).slice(0, 60)}) from ${frames()}`);
        return readerCancel.call(this, reason);
      };
      return reader;
    } as typeof ReadableStream.prototype.getReader;
    const fetch_ = window.fetch;
    window.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const kind = h.has("next-action") ? "action" : h.get("next-router-prefetch") ? "PREFETCH" : h.get("rsc") ? "rsc" : "plain";
      if (kind === "plain" && !url.startsWith("/") && !url.startsWith(location.origin)) return fetch_.call(window, input, init);
      const started = Date.now();
      const short = url.replace(location.origin, "").slice(0, 80);
      log.push(`${started} fetch ${kind} ${init?.method ?? "GET"} ${short} signal=${init?.signal ? (init.signal.aborted ? "aborted" : "live") : "none"} from ${frames()}`);
      try {
        const res = await fetch_.call(window, input, init);
        log.push(`${Date.now()} fetch ${kind} ${short} -> ${res.status} after ${Date.now() - started}ms`);
        return res;
      } catch (error) {
        log.push(`${Date.now()} fetch ${kind} ${short} THREW ${String(error).slice(0, 80)} after ${Date.now() - started}ms`);
        throw error;
      }
    };
    for (const name of ["popstate", "hashchange"] as const) {
      window.addEventListener(name, () => log.push(`${Date.now()} ${name} ${location.pathname}${location.search}${location.hash} doc=${docId}`));
    }
    for (const name of ["pagehide", "pageshow", "beforeunload", "visibilitychange", "unload"] as const) {
      window.addEventListener(name, (event) => {
        const persisted = "persisted" in event ? ` persisted=${String((event as PageTransitionEvent).persisted)}` : "";
        const vis = name === "visibilitychange" ? ` ${document.visibilityState}` : "";
        log.push(`${Date.now()} ${name}${persisted}${vis} doc=${docId}`);
      });
    }
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
      const w = window as unknown as { __docId?: string };
      return `${c ? `Clerk.loaded=${String(c.loaded)}` : "no Clerk global"}; doc=${w.__docId ?? "no id"} ${document.readyState}`;
    })
    .catch((error: unknown) => `page gone (${String(error).replace(/\s+/g, " ").slice(0, 120)})`);
  const page_ = (events.get(page) ?? [])
    .filter((entry) => Number(entry.split(" ")[0]) >= sinceMs)
    .map((entry) => entry.replace(/^\d+ /, ""));

  const isStatic = (entry: NetEntry) => entry.path.includes("/_next/static/");
  const network = (nets.get(page) ?? [])
    .filter((entry) => entry.at >= sinceMs && (!isStatic(entry) || entry.failed || entry.done === undefined))
    .map((entry) => {
      const tag = `${entry.action ? " [action]" : entry.rsc ? " [rsc]" : ""}${entry.nav ? ` [DOCUMENT ${entry.type}]` : entry.type === "fetch" || entry.type === "xhr" ? "" : ` [${entry.type}]`}`;
      const outcome = entry.failed ? `FAILED ${entry.failed}` : entry.status !== undefined ? String(entry.status) : "no response";
      const end = entry.done !== undefined ? `done +${entry.done - sinceMs}ms` : "STILL PENDING";
      return `+${entry.at - sinceMs}ms ${entry.method} ${entry.path}${tag} -> ${outcome}, ${end}`;
    });
  const console_ = (consoles.get(page) ?? [])
    .filter((entry) => Number(entry.split(" ")[0]) >= sinceMs)
    .map((entry) => entry.replace(/^\d+ /, ""));

  return (
    `${clerk}; page events since the click: ${page_.length > 0 ? page_.join(" | ") : "none"}; ` +
    `history and document events since the click: ${history.length > 0 ? history.join(" | ") : "none"}; ` +
    `network since the click: ${network.length > 0 ? network.join(" | ") : "none"}; ` +
    `console since the click: ${console_.length > 0 ? console_.join(" | ") : "none"}`
  );
}
