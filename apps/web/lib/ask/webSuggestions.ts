/**
 * Web-found suggestions on a confirm card, as data.
 *
 * Pure and dependency-free, so the card (a client component), the confirm
 * action and the command's `execute` all read the same shape through the
 * same validator. The payload that holds them is server-held, but it is
 * JSON read back out of a row, so it is parsed rather than cast — the same
 * treatment every other `resolved` payload gets in lib/ask/commands.
 *
 * THE BROWSER CAN ONLY REMOVE. A confirm sends the keys the person
 * UNticked; `keepSuggestions` returns the server-held list minus those.
 * Nothing the browser sends can add a suggestion or change a value, which
 * is the same property the card's id-only confirm already has.
 */

export type WebSource = { title: string; url: string };

export type WebSuggestion = {
  /** Stable within one card: the research field name. */
  key: string;
  label: string;
  value: string;
  sources: WebSource[];
};

/** Absolute http(s) links only. A stored source is rendered as a link on
 * the job page, and a `javascript:` URL there would be a script. */
export function isWebLink(candidate: unknown): candidate is string {
  if (typeof candidate !== "string") return false;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function suggestionsFrom(value: unknown): WebSuggestion[] {
  if (!Array.isArray(value)) return [];
  const out: WebSuggestion[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const { key, label, value: text, sources } = entry as Record<string, unknown>;
    if (typeof key !== "string" || typeof label !== "string" || typeof text !== "string") continue;
    if (!key || !text.trim() || out.some((existing) => existing.key === key)) continue;
    const links = Array.isArray(sources)
      ? sources.flatMap((source) => {
          const { title, url } = (source ?? {}) as Record<string, unknown>;
          return isWebLink(url) ? [{ title: typeof title === "string" && title ? title : url, url }] : [];
        })
      : [];
    // A suggestion with no source is exactly what this feature promises
    // never to show, so one that lost its links on the way is dropped.
    if (links.length === 0) continue;
    out.push({ key, label, value: text, sources: links });
  }
  return out;
}

export function keepSuggestions(value: unknown, dropKeys: readonly string[] = []): WebSuggestion[] {
  const drop = new Set(dropKeys);
  return suggestionsFrom(value).filter((suggestion) => !drop.has(suggestion.key));
}

/** The keys a browser may send as "dropped": strings, bounded, few. */
export function droppedKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((key): key is string => typeof key === "string" && key.length <= 40).slice(0, 20);
}
