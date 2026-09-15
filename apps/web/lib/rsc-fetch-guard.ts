/**
 * #118: production intermittently returns 5xx on RSC navigation fetches
 * and Server Action POSTs, and the failure is invisible in the UI -- see
 * CLAUDE.md and the issue itself for the investigation. This file does
 * NOT explain why the 5xx happens (Neon compute wake vs. connection-pool
 * exhaustion vs. platform cold start are still competing, unresolved
 * hypotheses as of this writing). It only makes the failure visible at
 * the one layer application code can reach: the ordinary global `fetch`
 * Next's client router and Server Action queue both issue their requests
 * through (confirmed by reading the installed `next` package directly --
 * `dist/client/components/router-reducer/fetch-server-response.js:190`
 * and `dist/client/components/router-reducer/reducers/server-action-reducer.js:48`
 * both call the bare `fetch(...)`, nothing more specialized).
 *
 * WHY THIS IS OBSERVE-ONLY, NOT RETRY-AND-SWAP. An earlier draft of this
 * file retried a failed RSC navigation fetch once and returned the retry's
 * response to Next transparently. Reading the same source ruled that out
 * as not obviously safe: `fetchServerResponse` only issues a live fetch at
 * all when `getOrCreatePrefetchCacheEntry` decides the existing prefetch
 * cache entry is stale/expired; when a fresh entry already exists, the
 * navigation renders from that entry's already-resolved data and does not
 * wait on a new request -- so a `_rsc=` GET seen failing in the Network
 * tab may not be the request the render depends on to begin with, and
 * swapping in a different Response object there changes nothing anyone
 * can observe except risking a subtle mismatch with whatever Next itself
 * expected from that exact call. Reported, not fixed: a genuinely FRESH
 * navigation fetch (no usable cache entry) that gets a non-ok response
 * does NOT render stale data silently -- `fetch-server-response.js:121-129`
 * resolves with a bare url string in that case, and `navigate-reducer.js`
 * routes a string `flightData` through `handleExternalUrl`, i.e. a full
 * browser (MPA) navigation. So the silent-stale-render shape in the
 * issue's own repro is specifically a prefetch-cache-hit condition, not
 * Next unconditionally swallowing every failed navigation fetch -- worth
 * knowing before touching this file again.
 *
 * So this module changes NOTHING about what Next does with any response:
 * it calls the original `fetch`, fires a callback on a 5xx or a thrown
 * network error for two specific request shapes, and returns/rethrows
 * exactly what the original call produced, untouched. Server Action POSTs
 * are never retried automatically either way -- CLAUDE.md's "no create
 * action is idempotent" scar (#19) means a blind retry of a write that
 * actually completed server-side but 503'd on the way back could duplicate
 * money or evidence. This mirrors (app)/error.tsx's existing "reload and
 * check, don't resubmit" answer to a different failure shape.
 *
 * Two request shapes, identified by the header names read directly out of
 * `dist/client/components/router-reducer/app-router-headers.js` on the
 * installed `next@15.5.23` (lowercase; `Headers` lookups are
 * case-insensitive regardless):
 *
 *   - a Server Action POST carries a `next-action` request header.
 *   - a live RSC navigation GET carries an `rsc` request header WITHOUT a
 *     `next-router-prefetch` header (that second header is what marks a
 *     background prefetch). A failed background PREFETCH is deliberately
 *     NOT reported here: prefetches are speculative, a real navigation to
 *     the same route will fetch again regardless, and alerting on every
 *     one of those would be noise standing in for a signal -- the issue's
 *     own finding is about the LIVE navigation/action request 5xx-ing,
 *     never about a prefetch failing on its own.
 */

export type RscFailureKind = "server-action" | "rsc-navigation";

export interface RscFailureEvent {
  kind: RscFailureKind;
  status: number | null; // null when the failure was a thrown network error, not an HTTP response
  url: string;
}

function headerValue(input: RequestInfo | URL, init: RequestInit | undefined, name: string): string | null {
  const fromInit = init?.headers;
  if (fromInit) {
    if (typeof Headers !== "undefined" && fromInit instanceof Headers) {
      const v = fromInit.get(name);
      if (v !== null) return v;
    } else if (Array.isArray(fromInit)) {
      const hit = fromInit.find(([k]) => k.toLowerCase() === name.toLowerCase());
      if (hit) return hit[1];
    } else {
      const hit = Object.entries(fromInit as Record<string, string>).find(
        ([k]) => k.toLowerCase() === name.toLowerCase(),
      );
      if (hit) return hit[1];
    }
  }
  if (typeof Request !== "undefined" && input instanceof Request) {
    const v = input.headers.get(name);
    if (v !== null) return v;
  }
  return null;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Exported for its own unit tests. `null` covers everything this guard
 * does not report on: an ordinary app fetch, and a background prefetch
 * (`rsc` present alongside `next-router-prefetch`).
 */
export function classifyRequest(input: RequestInfo | URL, init?: RequestInit): RscFailureKind | null {
  if (headerValue(input, init, "next-action") !== null) return "server-action";
  if (headerValue(input, init, "rsc") !== null && headerValue(input, init, "next-router-prefetch") === null) {
    return "rsc-navigation";
  }
  return null;
}

function isAbort(error: unknown): boolean {
  return typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError";
}

/**
 * Installs the guard on `window.fetch`. Returns a cleanup function that
 * restores the original -- always call it on unmount, same shape as
 * `attachStaleDeployListener` in `stale-deploy-error.ts`.
 *
 * Every branch returns or throws EXACTLY what the wrapped `fetch` produced
 * (same Response instance, same rejection), after firing `onFailure` on a
 * qualifying 5xx or network error. An aborted request (the page unloading,
 * or the router cancelling an in-flight navigation) is never reported --
 * that is not a server failure.
 */
export function installRscFailureGuard(onFailure: (event: RscFailureEvent) => void): () => void {
  // Kept unbound (called via `.call(window, ...)` below) rather than
  // `.bind(window)` so `window.fetch = original` on uninstall restores the
  // exact same function reference the guard replaced -- a bound copy
  // would work identically but would never `===` whatever was there
  // before, which matters to anything (a test, another library) checking
  // that fetch was put back.
  const original = window.fetch;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const kind = classifyRequest(input, init);
    if (kind === null) return original.call(window, input, init);

    try {
      const response = await original.call(window, input, init);
      if (response.status >= 500 && response.status <= 599) {
        onFailure({ kind, status: response.status, url: requestUrl(input) });
      }
      return response;
    } catch (error) {
      if (!isAbort(error)) {
        onFailure({ kind, status: null, url: requestUrl(input) });
      }
      throw error;
    }
  };

  return () => {
    window.fetch = original;
  };
}
