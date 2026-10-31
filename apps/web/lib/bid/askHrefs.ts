import { isBidPath } from "./surface";
import { webPage } from "./bidPageData";
import type { Surface } from "./surfaceHrefs";

/**
 * THE LINKS ON AN ASK CARD OR ANSWER, AS ONE SURFACE MAY DRAW THEM.
 *
 * Every href Ask hands the browser was built on the server — a command's
 * "already exists" or "created" link (`/jobs/<id>`, `/contacts/<id>`), a
 * HANDOFF card's form (`/messages?draft=…`), a citation's page — and almost all
 * of them are CRM routes. In the CRM that is exactly right and nothing changes:
 * `"crm"` returns the href untouched.
 *
 * In C Stream Bid it is the one door `bidLinkCensus.test.ts` cannot read in
 * source, because the string only exists at runtime. So on `"bid"` an href
 * survives only if it is a `/bid` path (the same `isBidPath` middleware uses),
 * and anything else is `null` — which the caller renders as PLAIN TEXT, the
 * label with no link. The record is still named; there is just no way out of
 * Bid through it. `bidLogHrefs` makes the same choice for the bid log's rows.
 *
 * A protocol-relative `//host/…` is not a path, and is refused even though it
 * starts with a slash.
 */
export function askHref(surface: Surface, href: string | null | undefined): string | null {
  if (!href) return null;
  if (surface === "crm") return href;
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const path = href.split(/[?#]/)[0] ?? "";
  return isBidPath(path) ? href : null;
}

/** A web page a card cites (a research source). The CRM keeps it; Bid keeps
 * it only when it is not one of C Stream's own hosts (`webPage`, the rule the
 * bid's own page already uses), so an absolute URL cannot be a CRM door. */
export function askWebHref(surface: Surface, url: string | null | undefined): string | null {
  if (!url) return null;
  return surface === "crm" ? url : webPage(url);
}
