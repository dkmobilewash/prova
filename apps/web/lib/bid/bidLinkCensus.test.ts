import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importClosure, navTargetsInFile, navTargetsInSource, resolveImport, type NavTarget } from "./navTargets";
import { exportedFunctionSource, exportedFunctionSources, importedBindings, jsxElements } from "./surfaceCalls";
import { isBidPath, isSharedPath } from "./surface";
import { surfaceHrefs } from "./surfaceHrefs";
import { JOB_START_RETURNS, jobStartDestination } from "./jobStartDestination";

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
 *   - it stops at `lib/`. `STOPS_AT_LIB` below asserts the boundary exists, so
 *     it cannot move without this sentence being re-read. What lives past it
 *     is covered by name instead of by sight:
 *       * a Server Action's `redirect()` (`createJob` ends in one) — the
 *         Server Actions section reads the body of every action Bid's files
 *         import;
 *       * an href built by `lib/bid/surfaceHrefs.ts` or
 *         `lib/bid/jobStartDestination.ts` — those are CALLED here, with the
 *         Bid arguments, and every value returned is classified;
 *     and what stays unseen is the redirect inside a helper an action calls
 *     (`ACTION_REDIRECTS_ALLOWED` names the dynamic ones it can see);
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
const SURFACE_PROP =
  "A prop whose value is chosen by `surface` (lib/bid/surfaceHrefs.ts). The CRM value is today's href; Bid renders this file with `surface=\"bid\"` or a Bid-only wrapper, which the \"rendered as Bid\" section below REQUIRES, and every value `surfaceHrefs(\"bid\", …)` returns is classified in the surfaceHrefs section.";
const BLOB_URL =
  "An object URL from URL.createObjectURL for a file the browser is saving (the anchor has a `download` attribute) — not a page navigation.";

const DYNAMIC_ALLOWED: Record<string, string> = {
  "components/bid/BidHeader.tsx: item.href":
    "BID_NAV in components/bid/bidNav.ts — every entry is a literal `href:` property, which this census reads as a prop-href sink.",
  "components/bid/BidEstimateTabs.tsx: tab.href":
    "bidEstimateTabs() in components/bid/bidEstimateTabs.ts — every entry is a literal `href:` template starting /bid/estimates/, read here as a prop-href sink.",
  "app/(app)/jobs/[id]/(tabs)/takeoff/page.tsx: hrefs.workspace": SURFACE_PROP,
  "app/(app)/jobs/[id]/(tabs)/takeoff/page.tsx: hrefs.estimate": SURFACE_PROP,
  "app/(app)/jobs/[id]/(tabs)/takeoff/legend/page.tsx: hrefs.takeoff": SURFACE_PROP,
  "app/(app)/jobs/[id]/proposal/page.tsx: hrefs.estimate": SURFACE_PROP,
  "app/(app)/jobs/[id]/proposal/page.tsx: proposalHref(mode, option.id)":
    "The proposal page's `proposalHref` is `${hrefs.proposal}?mode=…&invitation=…` — `surfaceHrefs(surface, …).proposal` plus a query, classified in its section below. `proposal/page.test.ts` renders it as Bid and requires every link to stay under /bid.",
  "app/(app)/jobs/[id]/proposal/page.tsx: proposalHref(option, invitationId)":
    "Same helper, same base: `hrefs.proposal` plus `?mode=` and `&invitation=`. Pinned by the \"Bid surface keeps its links inside Bid\" test in proposal/page.test.ts.",
  "app/takeoff/[id]/page.tsx: hrefs.takeoff": SURFACE_PROP,
  "components/job/EstimateStage.tsx: hrefs.takeoff": SURFACE_PROP,
  "components/job/EstimateStage.tsx: hrefs.workspace": SURFACE_PROP,
  "components/NoAccess.tsx: homeHref":
    "NoAccess's one button; pages pass `hrefs.home`. Bid's own pages never render it (BidNoAccess), and the CRM pages Bid renders sit behind a stricter Bid gate first.",
  "components/PlanIngestPanel.tsx: legend.reviewHref":
    "The takeoff page passes `hrefs.legend` — `surfaceHrefs` again, classified in its section below.",
  "components/ProposalClauses.tsx: libraryHref": SURFACE_PROP,
  "components/TakeoffAssemblyPanel.tsx: wallTypesHref": SURFACE_PROP,
  "components/TakeoffCurrencyBanner.tsx: bidsHref": SURFACE_PROP,
  "components/TakeoffWorkspace.tsx: backHref": SURFACE_PROP,
  "components/WallSchedule.tsx: wallTypesHref": SURFACE_PROP,
  "components/BidPackageBuilder.tsx: messageLogHref":
    "Bid's `surfaceHrefs` value is null, which draws no link at all; the CRM value is /messages.",
  "components/BidPackageBuilder.tsx: finding.href":
    "An estimate-check finding's fix link, built in lib/agents and naming CRM screens. The proposal page hands it through ONLY when surface is \"crm\" — pinned by the \"hands no finding link\" test below.",
  "components/BidPackageBuilder.tsx: url": BLOB_URL,
  "components/AnswerKeyPanel.tsx: url": BLOB_URL,
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

// ─── what lives past lib/, covered by calling it ────────────────────────────

describe("surfaceHrefs(\"bid\", …): every link a shared screen is told to draw", () => {
  const bid = surfaceHrefs("bid", "job_abc");
  const pairs = Object.entries(bid);

  it("is non-empty, and null only where a screen draws NO link", () => {
    expect(pairs.length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(bid).sort()).toEqual(Object.keys(surfaceHrefs("crm", "job_abc")).sort());
    expect(pairs.filter(([, value]) => value === null).map(([key]) => key)).toEqual(["messageLog"]);
  });

  it("is a /bid path (or shared) for every key", () => {
    const bad = pairs
      .filter(([, value]) => value !== null)
      .map(([key, value]) => ({ key, value: value as string, kind: classify(value as string) }))
      .filter(({ kind }) => kind !== "ok")
      .map(({ key, value, kind }) => `surfaceHrefs("bid").${key} = ${JSON.stringify(value)} (${kind})`);
    expect(bad).toEqual([]);
  });

  it("the CRM values, which the same classifier DOES call CRM (so it can tell them apart)", () => {
    const crm = Object.entries(surfaceHrefs("crm", "job_abc"))
      .filter(([, value]) => value !== null)
      .map(([key, value]) => ({ key, kind: classify(value as string) }));
    expect(crm.filter(({ kind }) => kind === "crm").length).toBeGreaterThanOrEqual(10);
  });
});

describe("jobStartDestination: where createJob sends a person", () => {
  it("every word a form may send lands in Bid", () => {
    expect(JOB_START_RETURNS.length).toBeGreaterThanOrEqual(1);
    for (const word of JOB_START_RETURNS) {
      const destination = jobStartDestination(word, "job_abc");
      expect(classify(destination), `${word} -> ${destination}`).toBe("ok");
      expect(isBidPath(destination)).toBe(true);
    }
  });

  it("anything else is the CRM default, never an echo of the input", () => {
    for (const hostile of [undefined, null, "", " bid", "BID", "bid ", "//evil.example", "https://evil.example", "/jobs", "/bid/estimates/x", "__proto__", "constructor"]) {
      const destination = jobStartDestination(hostile, "job_abc");
      expect(destination, String(hostile)).toBe("/jobs/new/job_abc/items");
    }
  });
});

describe("Server Actions Bid calls: the redirects its sight cannot reach", () => {
  const ACTIONS_DIR = join(webRoot, "lib", "actions");
  /** Redirects whose target is computed, each with why it stays in Bid. Keyed
   * `action: expression`; an entry no action matches fails, so the list cannot
   * become scenery. */
  const ACTION_REDIRECTS_ALLOWED: Record<string, string> = {
    "createJob: jobStartDestination(returnTo, created.value.jobId)":
      "lib/bid/jobStartDestination.ts: `returnTo` is a WORD from a fixed list, never a URL, and every word's destination is classified in the jobStartDestination section above.",
  };

  const actionFiles = readdirSync(ACTIONS_DIR)
    .filter((f) => f.endsWith(".ts") && !/\.(test|dbtest)\.ts$/.test(f) && f !== "index.ts")
    .map((f) => join(ACTIONS_DIR, f));

  // Every identifier a Bid-closure file imports from the actions barrel (or a
  // file under lib/actions/).
  const called = new Map<string, string>(); // action name -> first importing file
  for (const file of closure.files) {
    for (const binding of importedBindings(readFileSync(file, "utf8"), file)) {
      if (binding.specifier === "@/lib/actions" || binding.specifier.startsWith("@/lib/actions/")) {
        if (!called.has(binding.imported)) called.set(binding.imported, rel(file));
      }
    }
  }

  // Each action file parsed ONCE: name -> where it is and what it says.
  const bodies = new Map<string, { file: string; text: string }>();
  for (const file of actionFiles) {
    for (const [name, text] of exportedFunctionSources(readFileSync(file, "utf8"), file)) {
      if (!bodies.has(name)) bodies.set(name, { file, text });
    }
  }
  const sourceOf = (name: string) => bodies.get(name) ?? null;

  it("finds the actions (a known one among them) and finds every one's body", () => {
    expect(called.size).toBeGreaterThan(10);
    expect([...called.keys()]).toContain("createJob");
    const unresolved = [...called.keys()].filter((name) => sourceOf(name) === null);
    expect(unresolved, "an imported action whose body the census cannot find is an unread redirect").toEqual([]);
  });

  it("no action Bid calls redirects into the CRM, and every computed redirect is named", () => {
    const literal: string[] = [];
    const dynamic = new Set<string>();
    for (const name of called.keys()) {
      const found = sourceOf(name);
      if (!found) continue;
      for (const target of navTargetsInSource(found.text, found.file)) {
        if (target.dynamic) dynamic.add(`${name}: ${target.text}`);
        else if (classify(target.text) !== "ok") literal.push(`${name} (${rel(found.file)}) ${target.sink} ${JSON.stringify(target.text)}`);
      }
    }
    expect(literal, "a Server Action Bid calls redirects out of Bid").toEqual([]);
    expect([...dynamic].sort()).toEqual(Object.keys(ACTION_REDIRECTS_ALLOWED).sort());
  });

  it("the reader sees a CRM redirect when one is there (it is not reading nothing)", () => {
    const sample = navTargetsInSource(
      "export async function sample() { redirect(`/jobs/new/${id}/items`); }",
      "sample.ts",
    );
    expect(sample.map((t) => classify(t.text))).toEqual(["crm"]);
  });
});

describe("shared screens are RENDERED as Bid", () => {
  /**
   * `href={hrefs.x}` has no literal to read, so the census above can only name
   * it. What makes it Bid's is the caller: a Bid page that renders the CRM's
   * takeoff WITHOUT `surface="bid"` draws every CRM link through that sink and
   * passes every other check here. So: derive which components take a
   * `surface` (or `returnTo`) from their own source, and require every use
   * under app/bid and components/bid to pass the Bid value.
   */
  const MARKERS: { marker: string; prop: string }[] = [
    { marker: "surface?: Surface", prop: "surface" },
    { marker: "returnTo?: JobStartReturn", prop: "returnTo" },
  ];

  function uses() {
    const found: { file: string; line: number; tag: string; prop: string; value: string | true | undefined }[] = [];
    for (const file of entries) {
      const source = readFileSync(file, "utf8");
      const byLocal = new Map(importedBindings(source, file).map((b) => [b.local, b]));
      for (const element of jsxElements(source, file)) {
        const binding = byLocal.get(element.tag);
        if (!binding) continue;
        const target = resolveImport(binding.specifier, file, webRoot);
        if (!target) continue;
        // The signature of THAT export, not the whole file: EstimateStage
        // exports sections that take a `surface` beside sections that do not.
        const declaration = exportedFunctionSource(readFileSync(target, "utf8"), target, binding.imported);
        if (!declaration) continue;
        for (const { marker, prop } of MARKERS) {
          if (!declaration.includes(marker)) continue;
          found.push({ file: rel(file), line: element.line, tag: element.tag, prop, value: element.props[prop] });
        }
      }
    }
    return found;
  }

  it("finds the uses (a known page and a known section among them)", () => {
    const tags = uses().map((u) => u.tag);
    for (const must of ["JobTakeoffPage", "JobProposalPage", "TakeoffWorkspacePage", "EstimateLineItems", "NewJobForm"]) {
      expect(tags, must).toContain(must);
    }
  });

  it("every use passes the Bid value", () => {
    const wrong = uses()
      .filter((u) => u.value !== "bid")
      .map((u) => `${u.file}:${u.line} <${u.tag}> has no ${u.prop}="bid"`);
    expect(wrong, "a shared screen rendered without telling it it is in Bid draws CRM links").toEqual([]);
  });

  it("the proposal hands no finding link outside the CRM", () => {
    const source = readFileSync(join(APP, "(app)", "jobs", "[id]", "proposal", "page.tsx"), "utf8");
    expect(source).toContain('href: surface === "crm" ? finding.fixHref : null');
  });
});
