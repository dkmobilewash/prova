import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importClosure, navTargetsInFile, navTargetsInSource, type NavTarget } from "./navTargets";
import { isBidPath, isSharedPath } from "./surface";

/**
 * NOTHING C STREAM BID RENDERS CAN TAKE A PERSON INTO THE CRM.
 *
 * The founder's rule (2026-10-25): Bid and the CRM are one codebase and one
 * account and are NOT reachable from each other. Middleware enforces the
 * host half — a CRM URL on bid.cstream.ai redirects home. This census
 * enforces the half middleware cannot see: a Bid screen that DRAWS a link to
 * `/jobs/…` works perfectly on a preview, sends the person into the CRM there,
 * and on the Bid host silently bounces them to the Bid home instead of where
 * the button said.
 *
 * WHAT IT READS — not just `app/bid/**`. Every file Bid's routes and
 * `components/bid/**` IMPORT, followed through `app/` and `components/`
 * (`importClosure` in navTargets.ts). That is the lesson CLAUDE.md records
 * three times — nothing is ever missing from a directory you do not walk —
 * applied to a shared component: `PageHeader` looks harmless in a Bid page
 * and its breadcrumb is `Home → /dashboard`. Each target is read through the
 * TypeScript AST (navTargets.ts), never a regex: CLAUDE.md's JSX checkbox
 * census lost five nodes to the `>` inside `(event) => …`.
 *
 * THE RULE: every literal target is a `/bid` path or one of the shared paths
 * (`isSharedPath` — the SAME function middleware uses, so this census and the
 * router cannot disagree about what "shared" means). A target whose first
 * segment is a CRM route is reported as such; anything else that is neither
 * Bid nor shared fails too, since on the Bid host it would redirect home.
 *
 * WHERE ITS SIGHT ENDS, said rather than left silent:
 *   - it stops at `lib/`. A server action's `redirect()` (e.g.
 *     `lib/actions/jobs.ts` `createJob`) and an href built by a lib function
 *     are not seen. `STOPS_AT_LIB` below asserts the boundary exists, so it
 *     cannot move without this sentence being re-read;
 *   - a DYNAMIC sink (`href={item.href}`) has no literal to read. Each one is
 *     named in DYNAMIC_ALLOWED with the reason it is safe, and an entry that
 *     stops existing fails, so the list cannot become scenery.
 *
 * TWO SIZE CHECKS, per CLAUDE.md's rule for a census that derives its set:
 *   - the CRM route set is derived from the filesystem under `app/(app)` and
 *     its count must equal `git ls-files`'s count of tracked pages there;
 *   - the closure must contain every entry file, must have reached a known
 *     shared component (proving imports are followed), and the literal sink
 *     set must contain a known Bid link (proving sinks are read).
 */

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const APP = join(webRoot, "app");
const CRM_ROOT = join(APP, "(app)");
const BID_APP = join(APP, "bid");
const BID_COMPONENTS = join(webRoot, "components", "bid");
const rel = (p: string) => relative(webRoot, p).split(sep).join("/");

// ─── the CRM route set ──────────────────────────────────────────────────────

/** URL pattern of a page file under `app/(app)`, route groups dropped. */
function patternOf(pageFile: string): string {
  const segments = relative(CRM_ROOT, pageFile)
    .split(sep)
    .slice(0, -1)
    .filter((s) => !/^\(.*\)$/.test(s));
  return "/" + segments.join("/");
}

function walkPages(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkPages(full, out);
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

const crmPages = walkPages(CRM_ROOT);
const crmPatterns = [...new Set(crmPages.map(patternOf))].sort();
/** First URL segments that belong to the CRM. The routes OUTSIDE `(app)` that
 * are CRM-only are added by name, each one asserted to exist on disk below. */
const CRM_OUTSIDE_APP_GROUP = ["welcome", "pilot", "takeoff", "portal", "esign", "quickbooks", "unsubscribe", "lien-waiver", "wall-takeoff"];
const crmSegments = new Set([
  ...crmPatterns.map((p) => p.split("/")[1]).filter(Boolean),
  ...CRM_OUTSIDE_APP_GROUP,
]);

function classify(text: string): "ok" | "crm" | "not-bid" | "external" {
  if (/^https?:\/\//i.test(text)) {
    // An absolute URL into C Stream that is not the Bid host is a CRM door.
    const host = text.replace(/^https?:\/\//i, "").split(/[/?#]/)[0].toLowerCase();
    if (host.endsWith("cstream.ai") && !host.startsWith("bid.")) return "crm";
    return "external";
  }
  // Not a path: a query or fragment on the current page, mailto:, tel:.
  if (!text.startsWith("/")) return "ok";
  // `/${x}` — a template that starts with its hole cannot be read.
  const path = text.split(/[?#]/)[0];
  if (path === "/") return "crm"; // the CRM's own landing page; Bid's is "/bid"
  if (isBidPath(path) || isSharedPath(path)) return "ok";
  return crmSegments.has(path.split("/")[1] ?? "") ? "crm" : "not-bid";
}

// ─── the Bid surface and what it imports ────────────────────────────────────

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourcesUnder(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec|dbtest)\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const entries = [...sourcesUnder(BID_APP), ...sourcesUnder(BID_COMPONENTS)];
const closure = importClosure(entries, webRoot, [APP, join(webRoot, "components")]);
const targets: NavTarget[] = closure.files.flatMap((f) => navTargetsInFile(f));
const literalTargets = targets.filter((t) => !t.dynamic);
const dynamicTargets = targets.filter((t) => t.dynamic);

/**
 * Sinks whose target the parser cannot read, each with why it cannot reach
 * the CRM. Keyed `file: expression`.
 */
const DYNAMIC_ALLOWED: Record<string, string> = {
  "components/bid/BidHeader.tsx: item.href":
    "BID_NAV in components/bid/bidNav.ts — every entry is a literal `href:` property, which this census reads as a prop-href sink.",
};

describe("the CRM route set, derived from app/(app)", () => {
  it("matches git's count of tracked pages (the walk cannot quietly stop finding files)", () => {
    const tracked = execFileSync("git", ["ls-files", "--", "app/(app)"], { cwd: webRoot, encoding: "utf8" })
      .split("\n")
      .filter((f) => f.endsWith("/page.tsx"));
    expect(tracked.length).toBeGreaterThan(60);
    expect(crmPages.length).toBe(tracked.length);
  });

  it("contains the routes it obviously must", () => {
    for (const seg of ["dashboard", "jobs", "bids", "wall-types", "catalog", "settings", "contacts"]) {
      expect(crmSegments.has(seg), seg).toBe(true);
    }
    expect(crmPatterns).toContain("/jobs/[id]/proposal");
  });

  it("names only real directories outside the (app) group", () => {
    for (const seg of CRM_OUTSIDE_APP_GROUP) expect(existsSync(join(APP, seg)), seg).toBe(true);
  });
});

describe("the Bid closure", () => {
  it("starts from every Bid route and component", () => {
    expect(entries.length).toBeGreaterThanOrEqual(10);
    for (const must of ["app/bid/page.tsx", "app/bid/(signed-in)/layout.tsx", "components/bid/BidHeader.tsx"]) {
      expect(entries.map(rel)).toContain(must);
    }
    for (const entry of entries) expect(closure.files).toContain(entry);
  });

  it("followed imports into shared components (it is not reading app/bid alone)", () => {
    const files = closure.files.map(rel);
    expect(files).toContain("components/WallTypes.tsx");
    expect(files).toContain("components/WallTakeoffOffer.tsx");
  });

  it("STOPS_AT_LIB: its sight ends at lib/, and that boundary is real", () => {
    const stopped = closure.stoppedAt.map(rel);
    expect(stopped.some((f) => f.startsWith("lib/"))).toBe(true);
    expect(closure.files.map(rel).some((f) => f.startsWith("lib/"))).toBe(false);
  });

  it("read the sinks (a known Bid link is among them)", () => {
    expect(literalTargets.length).toBeGreaterThan(10);
    expect(literalTargets.map((t) => t.text)).toContain("/bid/bids");
    expect(literalTargets.map((t) => t.text)).toContain("/bid/wall-takeoff");
  });
});

describe("no Bid screen links into the CRM", () => {
  it("every literal target is a /bid path or a shared one", () => {
    const bad = literalTargets
      .map((t) => ({ t, kind: classify(t.text) }))
      .filter(({ kind }) => kind === "crm" || kind === "not-bid")
      .map(({ t, kind }) => `${rel(t.file)}:${t.line} ${t.sink} ${JSON.stringify(t.text)} (${kind === "crm" ? "a CRM route" : "not a Bid route"})`);
    expect(bad, "a Bid screen draws a link out of Bid — point it at a /bid route").toEqual([]);
  });

  it("every dynamic target is named, with its reason, and no name is stale", () => {
    const found = [...new Set(dynamicTargets.map((t) => `${rel(t.file)}: ${t.text}`))].sort();
    expect(found).toEqual(Object.keys(DYNAMIC_ALLOWED).sort());
  });
});

describe("the sink reader itself", () => {
  // The shapes a CRM door arrives in, and one it must NOT count.
  const fixture = `
    import Link from "next/link";
    // <Link href="/jobs/commented-out">
    export function X({ id, router }) {
      if (id) redirect("/dashboard");
      router.push(\`/jobs/\${id}/billing\`);
      const actions = [{ label: "Contacts", href: "/welcome" }];
      rows.push("/not-navigation");
      return <Link href={id ? "/bid/bids" : "/pilot"}>x</Link>;
    }
  `;
  const read = navTargetsInSource(fixture, "fixture.tsx");

  it("finds every sink and no comment", () => {
    expect(read.map((t) => t.text).sort()).toEqual(
      ["/bid/bids", "/dashboard", "/jobs/${}/billing", "/pilot", "/welcome"].sort(),
    );
  });

  it("classifies them", () => {
    expect(read.filter((t) => classify(t.text) === "crm").map((t) => t.text).sort()).toEqual(
      ["/dashboard", "/jobs/${}/billing", "/pilot", "/welcome"].sort(),
    );
    expect(classify("https://app.cstream.ai/jobs")).toBe("crm");
    expect(classify("https://bid.cstream.ai/bids")).toBe("external");
    expect(classify("/")).toBe("crm");
    expect(classify("/sign-up?redirect_url=%2Fbid%2Fbids")).toBe("ok");
    expect(classify("/made-up")).toBe("not-bid");
  });

  it("reports a sink it cannot read as dynamic", () => {
    const dyn = navTargetsInSource(`<a href={item.href} />; redirect(target);`, "d.tsx");
    expect(dyn.map((t) => [t.text, t.dynamic])).toEqual([
      ["item.href", true],
      ["target", true],
    ]);
  });
});
