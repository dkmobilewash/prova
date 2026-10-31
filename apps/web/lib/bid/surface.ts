/**
 * WHICH PRODUCT A REQUEST IS FOR — C Stream (the CRM, `app.cstream.ai`) or
 * C Stream Bid (`bid.cstream.ai`) — and what middleware does about it.
 *
 * Pure on purpose: middleware runs at the edge and cannot be unit-tested with
 * a real host header, so every decision it makes about hosts and paths is
 * made HERE, from two strings, and `surface.test.ts` drives it with the real
 * host strings (`bid.cstream.ai`, `app.cstream.ai`, a vercel.app preview,
 * `localhost:3000`) against every path class. `middleware.ts` only turns the
 * returned decision into a NextResponse.
 *
 * THE PRODUCT RULE THIS ENFORCES (founder's call, 2026-10-25): the two are the
 * same codebase, the same Clerk instance, the same database and the same
 * account, and they are NOT reachable from each other. Bid covers the
 * pre-award chain only — bid log, takeoff + wall types, estimate + recap,
 * proposal.
 *
 * THREE HOST CLASSES.
 *
 *   bid   first DNS label is `bid`, or the host is named in `BID_HOSTS`.
 *         `/<path>` is rewritten to `/bid/<path>`. Anything that is not a Bid
 *         route and not shared is REDIRECTED to the Bid home, so a CRM URL
 *         typed or pasted onto the Bid host never renders the CRM.
 *   open  previews (`*.vercel.app`) and local development (`localhost`,
 *         `127.0.0.1`, `*.localhost`). Nothing is rewritten and nothing is
 *         refused: the CRM works exactly as before, and `/bid/*` is reachable
 *         directly so Bid can be clicked before its domain exists.
 *   app   every other host — `app.cstream.ai` and the rest of the production
 *         domains. `/bid` and `/bid/*` answer 404: the products stay apart.
 *         Unknown hosts land here deliberately; the failure mode of a host
 *         nobody classified is "the CRM, without Bid", which is what the
 *         production app host already was before Bid existed.
 *
 * WHY BID IS AN ALLOWLIST OF ITS OWN SEGMENTS rather than a denylist of CRM
 * ones. Middleware cannot read the filesystem, so a CRM denylist would be a
 * hand-copied list of ~55 route segments that drifts the day somebody adds a
 * page to `app/(app)` — and the drift direction is the bad one: the new CRM
 * route renders on the Bid host. An allowlist of Bid's own handful drifts in
 * the safe direction (a new Bid page redirects home until it is listed), and
 * `surface.test.ts` pins `BID_SEGMENTS` to the directories that actually
 * exist under `app/bid`, so it cannot silently drift at all.
 */

/** The Bid surface's URL prefix inside the app. Every Bid route lives under
 * `app/bid/`, so on the open and bid hosts this prefix reaches them directly. */
export const BID_PREFIX = "/bid";

/** Where a signed-in Bid user lands: the home — one box ("What are we bidding
 * today?"), the open bids and what needs them. The bid log (`/bid/bids`) is
 * still the first link of the chain, one click away in the nav. */
export const BID_HOME = "/bid/home";

/** The public landing page. */
export const BID_LANDING = "/bid";

/**
 * Every top-level URL segment that exists under `app/bid/` (route groups like
 * `(signed-in)` flattened away). `surface.test.ts` derives the same set from
 * the filesystem and requires equality — add a Bid page, add its segment here.
 */
export const BID_SEGMENTS = [
  "home",
  "bids",
  "estimates",
  "wall-types",
  "price-book",
  "settings",
  "wall-takeoff",
  // The full-screen takeoff workspace: OUTSIDE the signed-in shell (the shell's
  // header would take the viewport the workspace exists to have), so it is a
  // segment of its own rather than a child of `estimates`.
  "workspace",
] as const;

/**
 * Paths served identically on every host and never rewritten. The sign-in and
 * sign-up pages are shared on purpose — one Clerk instance, one account — and
 * read the request to decide which product to send a person back to
 * (`bidAuthDestination` below). `/__clerk` is Clerk's proxy path (see the
 * matcher note in `middleware.ts`).
 */
const SHARED_PREFIXES = ["/sign-in", "/sign-up", "/api", "/trpc", "/_next", "/__clerk"] as const;
const SHARED_EXACT = ["/privacy", "/terms"] as const;

export type HostClass = "bid" | "app" | "open";

export type SurfaceDecision =
  /** Serve the path as requested. `protect` asks middleware to require a
   * session (a signed-in Bid page) on top of its own protected-route list. */
  | { kind: "pass"; protect: boolean }
  /** Serve `pathname` instead, keeping the browser's URL. */
  | { kind: "rewrite"; pathname: string; protect: boolean }
  /** Send the browser to `pathname` on the same host. */
  | { kind: "redirect"; pathname: string }
  /** Answer 404 — the product does not exist on this host. */
  | { kind: "not-found" };

/** Comma- or space-separated host list from an env var, lower-cased, ports kept
 * off. Empty and undefined both mean "none". */
export function parseHostList(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(/[\s,]+/)
    .map((h) => stripPort(h.trim().toLowerCase()))
    .filter(Boolean);
}

function stripPort(host: string): string {
  // An IPv6 literal is bracketed (`[::1]:3000`); nothing here serves one, but
  // splitting it on the first colon would produce garbage rather than a host.
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  const colon = host.indexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

export function classifyHost(rawHost: string | null | undefined, bidHosts: readonly string[] = []): HostClass {
  const host = stripPort((rawHost ?? "").trim().toLowerCase());
  // No Host header at all is not a browser; treat it as the production app,
  // the class that exposes nothing new.
  if (!host) return "app";
  if (bidHosts.includes(host)) return "bid";
  if (host.split(".")[0] === "bid") return "bid";
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".vercel.app")
  ) {
    return "open";
  }
  return "app";
}

/** A path that looks like a file (`/brand/x.png`, `/favicon.ico`,
 * `/opengraph-image.png`) — served from `public/` or a metadata route, the
 * same on both products. The last segment carries a dot-extension. */
function isStaticAsset(pathname: string): boolean {
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return /\.[a-z0-9]{1,12}$/i.test(last);
}

function hasPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

export function isSharedPath(pathname: string): boolean {
  if ((SHARED_EXACT as readonly string[]).includes(pathname)) return true;
  if (SHARED_PREFIXES.some((p) => hasPrefix(pathname, p))) return true;
  return isStaticAsset(pathname);
}

/** `/bid` or anything under it. `/bidder` is not. */
export function isBidPath(pathname: string): boolean {
  return hasPrefix(pathname, BID_PREFIX);
}

/** A Bid page that needs a session: everything under `/bid/` except the
 * landing page itself and the free drawing-set read, which are public. */
export function isBidSignedInPath(pathname: string): boolean {
  if (!isBidPath(pathname)) return false;
  if (pathname === BID_LANDING || pathname === BID_LANDING + "/") return false;
  if (hasPrefix(pathname, `${BID_PREFIX}/wall-takeoff`)) return false;
  return true;
}

function firstSegment(pathname: string): string {
  return pathname.split("/").filter(Boolean)[0] ?? "";
}

export function decideSurface(
  rawHost: string | null | undefined,
  pathname: string,
  bidHosts: readonly string[] = [],
): SurfaceDecision {
  const hostClass = classifyHost(rawHost, bidHosts);

  if (hostClass === "open") {
    return { kind: "pass", protect: isBidSignedInPath(pathname) };
  }

  if (hostClass === "app") {
    if (isBidPath(pathname)) return { kind: "not-found" };
    return { kind: "pass", protect: false };
  }

  // hostClass === "bid"
  if (isSharedPath(pathname)) return { kind: "pass", protect: false };
  // Already prefixed — every link the Bid shell draws is, so it works the same
  // on a preview and here. Served as-is.
  if (isBidPath(pathname)) return { kind: "pass", protect: isBidSignedInPath(pathname) };
  if (pathname === "/" || pathname === "") {
    return { kind: "rewrite", pathname: BID_LANDING, protect: false };
  }
  if ((BID_SEGMENTS as readonly string[]).includes(firstSegment(pathname))) {
    const target = BID_PREFIX + pathname;
    return { kind: "rewrite", pathname: target, protect: isBidSignedInPath(target) };
  }
  // A CRM route (/dashboard, /jobs/…, /welcome, /pilot, /takeoff/…) or
  // anything else: never rendered here. The Bid home sends a signed-out
  // visitor to sign in, so this is also the right answer for a stale link.
  return { kind: "redirect", pathname: "/" };
}

/**
 * Where the shared sign-in / sign-up pages should send a person, when they
 * came from Bid — or `null` for the CRM's own default (`/dashboard`).
 *
 * A person is "from Bid" when the request is on the Bid host, or when the
 * `redirect_url` Clerk carries points into `/bid` (that is how a preview or
 * localhost, where the host says nothing, tells the page). The returned path
 * is ALWAYS a `/bid` path built here, never the raw `redirect_url`: an
 * attacker-supplied absolute URL must not become a redirect target.
 */
export function bidAuthDestination(
  rawHost: string | null | undefined,
  redirectUrl: string | null | undefined,
  bidHosts: readonly string[] = [],
): string | null {
  const fromBidHost = classifyHost(rawHost, bidHosts) === "bid";
  const target = bidPathFromRedirect(redirectUrl, rawHost, bidHosts);
  if (target) return target;
  return fromBidHost ? BID_HOME : null;
}

/** The `/bid…` path a `redirect_url` names, if it names one on the same host
 * (relative, or absolute with this request's host). A path on the Bid host
 * that is a bare Bid segment (`/estimates`) is mapped to its `/bid` form. */
function bidPathFromRedirect(
  redirectUrl: string | null | undefined,
  rawHost: string | null | undefined,
  bidHosts: readonly string[],
): string | null {
  if (!redirectUrl) return null;
  let url: URL;
  try {
    url = new URL(redirectUrl, "http://relative.invalid");
  } catch {
    return null;
  }
  const relative = url.host === "relative.invalid";
  const requestHost = stripPort((rawHost ?? "").trim().toLowerCase());
  if (!relative && stripPort(url.host.toLowerCase()) !== requestHost) return null;
  const pathname = url.pathname;
  if (isBidSignedInPath(pathname)) return pathname;
  if (isBidPath(pathname)) return BID_HOME;
  if (classifyHost(rawHost, bidHosts) === "bid") {
    if ((BID_SEGMENTS as readonly string[]).includes(firstSegment(pathname))) {
      const target = BID_PREFIX + pathname;
      return isBidSignedInPath(target) ? target : BID_HOME;
    }
  }
  return null;
}

/** The sign-up / sign-in links the Bid surface draws: they carry a
 * `redirect_url` into Bid so a preview (whose host says nothing) still brings
 * the person back to Bid rather than to the CRM's `/dashboard`. */
export function bidAuthHref(kind: "sign-up" | "sign-in"): string {
  return `/${kind}?redirect_url=${encodeURIComponent(BID_HOME)}`;
}
