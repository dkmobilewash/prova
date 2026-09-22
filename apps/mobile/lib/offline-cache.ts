import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The last list this phone successfully loaded, kept so a screen with no
 * signal can still show the work rather than an empty page.
 *
 * WHY THIS EXISTS. On 2026-09-20, on site, the punch list was opened in
 * Airplane Mode and said **"Nothing outstanding on this job."** — the empty
 * state, because the fetch failed and the screen had nothing else to draw.
 * On a jobsite that sentence is not a blank page, it is a claim: it reads
 * as "this job is clean", which is the opposite of what anybody knew. A
 * queue that protects writes offline and a list that lies about reads
 * offline is half a field app.
 *
 * Deliberately small: last-known rows per job, a timestamp so the screen
 * can say how old they are, and nothing else. It is not a sync engine and
 * must never be treated as one — what the server says on the next
 * successful load always wins, without merging.
 */

const PREFIX = "prova.cache.";

export type Cached<T> = { rows: T; at: string };

export async function cacheGet<T>(key: string): Promise<Cached<T> | null> {
  const raw = await AsyncStorage.getItem(PREFIX + key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Cached<T>;
    // A cache written by an older build, or half-written: treated as
    // absent rather than rendered as data of unknown shape.
    if (!parsed || typeof parsed.at !== "string" || parsed.rows === undefined) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(key: string, rows: T): Promise<void> {
  await AsyncStorage.setItem(PREFIX + key, JSON.stringify({ rows, at: new Date().toISOString() }));
}

/** "2 hours ago", for the line that tells somebody how stale what they are
 * looking at is. Deliberately coarse — the point is old-or-not, and a
 * to-the-second answer invites trusting it more precisely than it deserves. */
export function cacheAge(at: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(at).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return "earlier";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
