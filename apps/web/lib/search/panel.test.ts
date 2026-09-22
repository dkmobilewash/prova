import { describe, expect, it, vi } from "vitest";
import { runSearch, SEARCH_UNAVAILABLE, type SearchPanelResult } from "./panel";

/**
 * The panel hang: searching, then "Searching…" forever.
 *
 * `SearchLauncher` awaits its search inside a `setTimeout(async () => …)`
 * callback. Nothing awaits THAT, so a rejected promise is an unhandled
 * rejection and every statement after the `await` is skipped —
 * `setLoading(false)` included. The user sees a spinner that never stops
 * and has no way to tell it from a slow query.
 *
 * So the property that matters is not "the error is rendered nicely", it
 * is "the awaited call RESOLVES, whatever happens" — because that is the
 * one thing that keeps `setLoading(false)` reachable. That property is
 * testable here with no DOM, no React and no database, which is why
 * `runSearch` is a function in its own file rather than a `try` inlined in
 * the component.
 */

const OK: SearchPanelResult = { ok: true, value: { records: [], pages: [] } };

describe("runSearch", () => {
  it("resolves when the action rejects, instead of rejecting", async () => {
    // THE BUG. Before the fix this rejection propagated out of the
    // component's timer callback and nothing below the await ever ran.
    const result = await runSearch(async () => {
      throw new Error("Timed out fetching a new connection from the connection pool");
    });
    expect(result).toEqual({ ok: false, error: SEARCH_UNAVAILABLE });
  });

  it("resolves when the action rejects synchronously, before any await", async () => {
    const result = await runSearch(() => {
      throw new Error("boom");
    });
    expect(result.ok).toBe(false);
  });

  it("resolves for a rejection that is not an Error at all", async () => {
    // A Server Action failing in transport can reject with a plain object
    // or a string; `catch` must not depend on the shape.
    await expect(runSearch(() => Promise.reject("digest_1a2b3c"))).resolves.toEqual({
      ok: false,
      error: SEARCH_UNAVAILABLE,
    });
  });

  it("never reports a failure as an empty result set", () => {
    // "No results" and "search is broken" are different sentences, and
    // showing the first for the second is the one lie this box must not
    // tell — lib/actions/search.ts's own file comment says so.
    expect(SEARCH_UNAVAILABLE).not.toMatch(/no results/i);
    expect(SEARCH_UNAVAILABLE.length).toBeGreaterThan(10);
  });

  it("passes a successful result straight through, untouched", async () => {
    // The control: a wrapper that swallowed everything would pass every
    // assertion above.
    const value = { records: [], pages: [{ kind: "page" as const, route: "/photos", title: "Photos", href: "/photos" }] };
    await expect(runSearch(async () => ({ ok: true, value }))).resolves.toEqual({ ok: true, value });
  });

  it("passes a returned failure through as itself, not as the generic message", async () => {
    const failure: SearchPanelResult = { ok: false, error: "Search query must be text." };
    await expect(runSearch(async () => failure)).resolves.toEqual(failure);
  });

  it("calls the action exactly once", async () => {
    const spy = vi.fn(async () => OK);
    await runSearch(spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
