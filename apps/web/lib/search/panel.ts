import type { SearchPageResult, SearchRecordResult } from "./types";

/**
 * The client half of global search: the one call `SearchLauncher` awaits,
 * and the guarantee that awaiting it can never leave the panel stuck.
 *
 * Lives beside `types.ts` and for the same reason its file comment gives —
 * `providers.ts` imports `@prova/db`, so nothing a client component
 * touches may come from there. This file imports types only.
 *
 * WHY IT EXISTS AT ALL, rather than a `try` inline in the component.
 * `SearchLauncher` had:
 *
 *     const timer = setTimeout(async () => {
 *       const result = await searchApp(trimmed);
 *       if (id !== requestId.current) return;
 *       setLoading(false);
 *       …
 *     }, DEBOUNCE_MS);
 *
 * An `async` function passed to `setTimeout` is a floating promise: nothing
 * awaits it, so a rejection is an unhandled rejection and every line after
 * the `await` — `setLoading(false)` included — simply never runs. The panel
 * then reads "Searching…" forever, for any cause at all: a cold Neon
 * compute, a dropped connection, a Server Action 500. `lib/actions/search.ts`
 * now catches on the server side too, but that cannot cover a failure in
 * the TRANSPORT, which is the half that reaches the browser as a rejected
 * promise.
 *
 * Extracting it makes the property testable in a node environment with no
 * DOM and no React: `runSearch` resolves, always. That is exactly the
 * property that keeps `setLoading(false)` reachable, so the test is about
 * the bug rather than about a component's internals.
 */

export type SearchPanelResult =
  | { ok: true; value: { records: SearchRecordResult[]; pages: SearchPageResult[] } }
  | { ok: false; error: string };

/** Said to the user when search itself could not run — deliberately not
 * "no results", which is a different and much more misleading claim. */
export const SEARCH_UNAVAILABLE = "Search could not run just now. Try again in a moment.";

/**
 * Runs `fetchResults` and NEVER REJECTS.
 *
 * Takes the call as a parameter rather than importing `searchApp` so a test
 * can hand it a rejecting function — the case that caused the hang — without
 * a session, a database or a server.
 */
export async function runSearch(fetchResults: () => Promise<SearchPanelResult>): Promise<SearchPanelResult> {
  try {
    return await fetchResults();
  } catch {
    return { ok: false, error: SEARCH_UNAVAILABLE };
  }
}
