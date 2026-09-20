import { cacheAge, cacheGet, cacheSet } from "./offline-cache";

/**
 * One policy for reading a list on a phone that may have no signal.
 *
 * Every screen used to do the same three lines and get them subtly
 * different — and one of them, the punch list, got them wrong in a way
 * that mattered: with no connection it rendered its empty state, "Nothing
 * outstanding on this job.", which on a jobsite reads as a claim that the
 * job is clear rather than as a page that failed to load. Reported from
 * site on 2026-09-20.
 *
 * So the policy lives here and the screens spend it:
 *
 *   server   the answer, freshly fetched and now cached
 *   cache    the last answer this phone got, with how old it is
 *   nothing  no answer and nothing to fall back on — the ONE case where a
 *            screen must say it could not load rather than that there is
 *            nothing to show
 *
 * It caches whatever shape it is given, so a screen that loads two lists
 * caches them as one object and gets both back together — which is also
 * what stops half a screen being fresh and the other half a week old.
 */
export type CachedRead<T> =
  | { from: "server"; value: T }
  | { from: "cache"; value: T; note: string }
  | { from: "nothing" };

export async function cachedRead<T>(key: string, read: () => Promise<T>): Promise<CachedRead<T>> {
  try {
    const value = await read();
    await cacheSet(key, value);
    return { from: "server", value };
  } catch {
    const cached = await cacheGet<T>(key);
    if (!cached) return { from: "nothing" };
    return {
      from: "cache",
      value: cached.rows,
      note: `Showing what this phone last loaded, ${cacheAge(cached.at)} — no connection`,
    };
  }
}

/** The line a screen shows above the list, or null when the data is
 * fresh. Centralised so eight screens cannot word it eight ways. */
export function staleNote<T>(read: CachedRead<T>): string | null {
  return read.from === "cache" ? read.note : null;
}

/** True when there is nothing to draw AND nothing was loaded — the case
 * an empty state must not describe as emptiness. */
export function couldNotLoad<T>(read: CachedRead<T>): boolean {
  return read.from === "nothing";
}
