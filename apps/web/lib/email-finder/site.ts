import { safeFetch, type SafeFetchOptions } from "./safeFetch";

/**
 * THE ADDRESSES A FIRM PRINTS ON ITS OWN WEBSITE — the best source there is,
 * because the firm chose to publish them.
 *
 * Reads the home page, then /contact, /contact-us and /about, and stops at the
 * first page that has one. Keeps only addresses on the firm's own domain: a
 * `@gmail.com` on a contact page might be the owner, but it might equally be
 * the web designer, and an address we cannot tie to the firm is not one we
 * send to. A personal-looking address ranks above `info@`/`office@`; both are
 * returned, ranked, so a verifier can try them in order.
 */

export const SITE_PAGES = ["/", "/contact", "/contact-us", "/about"] as const;

export type SiteEmail = { email: string; page: string };

const ROLE = /^(info|office|contact|admin|sales|hello|mail|estimating|estimates|bids|bid|service|support|team|general)$/;
const NOISE = /^(noreply|no-reply|donotreply|do-not-reply|example|test|user|name|email|yourname|you|webmaster|postmaster|abuse|privacy)$/;
const FILE = /\.(png|jpe?g|gif|svg|webp|css|js)$/i;

/** Pure: every address in `html` on `domain` (or its www), in page order. */
export function extractEmails(html: string, domain: string): string[] {
  const bare = domain.toLowerCase().replace(/^www\./, "");
  const decoded = html.replace(/&#64;|%40|&commat;/gi, "@");
  const out: string[] = [];
  for (const match of decoded.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    const email = match[0].toLowerCase();
    const [local, host] = email.split("@");
    if (FILE.test(email) || NOISE.test(local)) continue;
    if (host !== bare && host !== `www.${bare}`) continue;
    const clean = `${local}@${bare}`;
    if (!out.includes(clean)) out.push(clean);
  }
  return out;
}

/** Personal before role, page order otherwise (sort is stable). */
export function rankEmails<T extends { email: string }>(emails: T[]): T[] {
  return [...emails].sort((a, b) => Number(ROLE.test(a.email.split("@")[0])) - Number(ROLE.test(b.email.split("@")[0])));
}

/** Throws `UnsafeUrlError` on a refusal; anything else unreachable is just "none". */
export async function emailsOnSite(domain: string, opts: SafeFetchOptions = {}): Promise<SiteEmail[]> {
  for (const path of SITE_PAGES) {
    const page = await safeFetch(`https://${domain}${path}`, opts);
    if (!page || page.status >= 400) continue;
    const found = extractEmails(page.body, domain);
    if (found.length > 0) return rankEmails(found.map((email) => ({ email, page: path })));
  }
  return [];
}
