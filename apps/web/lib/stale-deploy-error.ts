/**
 * #118: a browser tab left open across a production deployment can try to
 * fetch a JS chunk from the OLD deployment after the new one has replaced
 * it on the CDN. That surfaced during a 2026-09-09 test session as
 * `TypeError: network error` from `_next/static/chunks/5635-*.js`,
 * escaping every boundary and landing on Next's bare "client-side
 * exception" screen with no next step for the person looking at it.
 *
 * React's `reset()` (what (app)/error.tsx's "Try again" button calls)
 * cannot fix this: it re-renders the same failed subtree, which re-issues
 * a fetch for the exact same now-missing URL. The only real remedy is a
 * hard reload, which fetches the new deployment's asset manifest fresh.
 * This module exists to recognize that specific failure shape so the UI
 * can say the true thing ("reload", not "try again") instead of a generic
 * message that doesn't fix anything.
 *
 * Named identifiers webpack/Next use for this failure ("ChunkLoadError",
 * "Loading chunk ... failed", "Failed to fetch dynamically imported
 * module") are unambiguous and checked first. The bare "network error"
 * TypeError seen on #118's own capture is NOT unique to this cause by
 * itself -- an ordinary dropped connection on a real data request says
 * the same thing -- so it only counts here when the stack also names a
 * `_next/static` asset, tying the failure to a build artifact rather than
 * an API call. Getting this over-broad would tell someone their save is
 * safe to reload away when it might not be; getting it too narrow just
 * falls back to the existing generic message, which is the safe default.
 */
export function isStaleDeployError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message ?? "";
  if (error.name === "ChunkLoadError") return true;
  if (/loading chunk [\w.-]+ failed/i.test(message)) return true;
  if (/failed to fetch dynamically imported module/i.test(message)) return true;
  if (/network error/i.test(message) && /_next\/static/i.test(error.stack ?? "")) return true;
  return false;
}

/**
 * Catches the failure shape above at the WINDOW level rather than through
 * a React error boundary. An error boundary like (app)/error.tsx can only
 * ever see errors React itself sees during render or a commit -- an async
 * fetch callback or an awaited dynamic import outside a transition throws
 * outside that entirely, as an uncaught exception or an unhandled
 * rejection that never reaches any boundary. This is a supplementary net
 * for exactly that gap, not a replacement for the boundary: anything that
 * ISN'T this specific shape is left exactly as loud as it already was.
 *
 * Returns the cleanup function `useEffect` expects, so a caller never has
 * to remember to remove what it added.
 */
export function attachStaleDeployListener(onDetect: () => void): () => void {
  const onError = (event: ErrorEvent) => {
    if (isStaleDeployError(event.error)) onDetect();
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    if (isStaleDeployError(event.reason)) onDetect();
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
