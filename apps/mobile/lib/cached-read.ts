import { tokenOrNull } from "./clerk-token";
import { t } from "./i18n";
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
/**
 * The read a screen hands to `cachedRead`, with the token fetched INSIDE
 * it rather than before it.
 *
 * This exists because of a bug that reached a real phone on 2026-09-20.
 * Every screen was written as:
 *
 *     const token = await getToken();
 *     if (!token) return;              // ← never reaches the cache
 *     const result = await cachedRead(key, () => api.list(jobId, token));
 *
 * Clerk refreshes the session JWT over the NETWORK, so with no signal
 * `getToken()` answers null — and every screen returned before it could
 * read its own cache. Offline, the punch list therefore fell back to its
 * initial state and rendered "Nothing outstanding on this job.", which is
 * the exact bug the whole caching layer was built to kill, reintroduced
 * by the refactor that unified it.
 *
 * Putting the token inside the reader makes a missing token fail the same
 * way a dead network does, which is the only way the fallback can see it.
 */
export function withToken<T>(
  getToken: () => Promise<string | null>,
  read: (token: string) => Promise<T>,
): () => Promise<T> {
  return async () => requireToken(await tokenOrNull(getToken), read)();
}

/**
 * The same policy for a screen that fetches ONE token and spends it on
 * several calls: a missing token fails the read, so the fallback runs,
 * rather than returning before the read exists.
 *
 * Both halves of that sentence are scars. `if (!token) return;` skipped
 * the cache (#398), and waiting on `getToken()` without a deadline
 * skipped it for two and a half minutes (see clerk-token.ts).
 */
export function requireToken<T>(
  token: string | null,
  read: (token: string) => Promise<T>,
): () => Promise<T> {
  return async () => {
    if (!token) throw new Error("No token — offline or signed out");
    return read(token);
  };
}

export type CachedRead<T> =
  | { from: "server"; value: T }
  /** `at` is when this phone last got the real thing, so a screen made of
   * several lists can report the OLDEST of them rather than whichever one
   * it happened to render first. */
  | { from: "cache"; value: T; note: string; at: string }
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
      at: cached.at,
      note: t("offline.stale", { age: cacheAge(cached.at) }),
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

/** The note for a screen made of SEVERAL cached lists — the oldest of
 * them, because a screen is only as fresh as its stalest part. Home had
 * its own sentence with no age in it at all; this is where that sentence
 * comes from now. */
export function oldestNote(reads: CachedRead<unknown>[]): string | null {
  const cached = reads.filter(
    (read): read is Extract<CachedRead<unknown>, { from: "cache" }> => read.from === "cache",
  );
  if (cached.length === 0) return null;
  // ISO-8601 sorts as text, which is the only reason this is a compare
  // and not a Date.parse.
  return cached.reduce((a, b) => (a.at <= b.at ? a : b)).note;
}
