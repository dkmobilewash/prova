/**
 * THE FIRM'S OWN WEBSITE, found by searching its name and city.
 *
 * A wrong domain is worse than none: it sends a cold email to a stranger in
 * the firm's name, or verifies an address at somebody else's company. So the
 * pick is conservative — directories, socials, aggregators and government sites
 * are skipped, and a result only counts when its host (or its title) carries
 * the company's name. Unsure returns null, and the caller says so.
 */

export type SearchResult = { url: string; title?: string };
export type DomainFound = { ok: true; domain: string; via: string } | { ok: false; why: string };

/** Second-level labels that are never a contractor's own site. */
const NOT_A_FIRM = new Set([
  "facebook", "yelp", "linkedin", "bbb", "buildzoom", "houzz", "angi", "angieslist", "homeadvisor",
  "thumbtack", "cslb", "instagram", "yellowpages", "manta", "bizapedia", "opencorporates", "dnb",
  "zoominfo", "mapquest", "google", "apple", "porch", "nextdoor", "indeed", "glassdoor", "youtube",
  "twitter", "x", "tiktok", "levelset", "procore", "planhub", "buildingconnected", "bluebook",
  "thebluebook", "wikipedia", "bloomberg", "chamberofcommerce", "buzzfile", "corporationwiki",
]);

/** Words a name carries that say nothing about WHICH firm it is. */
const GENERIC = new Set([
  "inc", "llc", "corp", "corporation", "co", "company", "ltd", "lp", "the", "and", "of", "dba",
  "construction", "constructions", "contractor", "contractors", "contracting", "drywall", "plastering",
  "plaster", "framing", "builders", "building", "interiors", "interior", "systems", "services", "group",
  "enterprises", "acoustical", "acoustics", "ceilings", "ceiling", "insulation", "fireproofing",
  "stucco", "painting", "general", "specialties", "california", "ca", "west", "pacific",
]);
const LEGAL = new Set(["inc", "llc", "corp", "corporation", "co", "company", "ltd", "lp", "the", "dba"]);

/** "https://www.BakerDrywall.com/contact" or "bakerdrywall.com" → "bakerdrywall.com". */
export function bareDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const host = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

function words(name: string): string[] {
  return name.toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(Boolean);
}

/** Pure: the first result that is plausibly the firm's own site, or null. */
export function pickDomain(name: string, results: SearchResult[]): { domain: string; via: string } | null {
  const all = words(name);
  const withoutLegal = all.filter((w) => !LEGAL.has(w)).join("");
  const distinctive = all.filter((w) => !GENERIC.has(w) && w.length >= 3);

  for (const result of results) {
    const domain = bareDomain(result.url);
    if (!domain) continue;
    const labels = domain.split(".");
    if (labels[labels.length - 1] === "gov") continue;
    if (labels.slice(0, -1).some((l) => NOT_A_FIRM.has(l))) continue;
    const site = labels.slice(0, -1).join("");

    // Full name first: "ABC Drywall" must match abcdrywall.com on "drywall" too.
    const hostMatch =
      (withoutLegal.length >= 4 && site.includes(withoutLegal)) ||
      (distinctive.join("").length >= 4 && site.includes(distinctive.join("")));
    // ponytail: substring, so "Baker" also matches bakersfieldplumbing.com. The
    // query carries name + city, which keeps such hosts rare in the top ten;
    // compare against the CSLB phone on the page if one ever gets through.
    const title = words(result.title ?? "");
    const titleMatch = distinctive.length > 0 && distinctive.every((w) => title.includes(w));
    if (hostMatch || titleMatch) return { domain, via: result.url };
  }
  return null;
}

export async function findDomain(
  lead: { name: string; city: string | null },
  apiKey: string | undefined,
  doFetch: typeof fetch = fetch,
): Promise<DomainFound> {
  if (!apiKey) return { ok: false, why: "no website on the lead and no search key set (BRAVE_SEARCH_API_KEY)" };
  const q = [lead.name, lead.city, "contractor"].filter(Boolean).join(" ");
  let results: SearchResult[];
  try {
    const response = await doFetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10&country=US`,
      { headers: { "X-Subscription-Token": apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return { ok: false, why: `the website search answered ${response.status}` };
    const body = (await response.json()) as { web?: { results?: SearchResult[] } };
    results = body.web?.results ?? [];
  } catch {
    return { ok: false, why: "the website search did not answer" };
  }
  const picked = pickDomain(lead.name, results);
  return picked ? { ok: true, ...picked } : { ok: false, why: "no website found" };
}
