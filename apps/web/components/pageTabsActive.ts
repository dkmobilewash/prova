/**
 * Which tab a URL is on — the rule `PageTabs` highlights by, in a plain
 * module so the SERVER side of a `?tab=` page can decide what to render from
 * the same rule. (A function exported from a "use client" file reaches a
 * server component as a client-reference proxy, not a function — the
 * emptyStateStyles.ts note.)
 */
export type PageTab = { href: string; label: string };

export function activeTab<T extends PageTab>(tabs: readonly T[], pathname: string, search: URLSearchParams): T | undefined {
  let best: T | undefined;
  let bestParams = -1;
  for (const tab of tabs) {
    const url = new URL(tab.href, "http://x");
    if (url.pathname !== pathname) continue;
    const params = [...url.searchParams.entries()];
    if (!params.every(([k, v]) => search.get(k) === v)) continue;
    if (params.length > bestParams) {
      best = tab;
      bestParams = params.length;
    }
  }
  return best;
}
