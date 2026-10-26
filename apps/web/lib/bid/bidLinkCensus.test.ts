import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importClosure, navTargetsInFile, navTargetsInSource, resolveImport, type NavTarget } from "./navTargets";
import { exportedFunctionSource, exportedFunctionSources, importedBindings, jsxElements } from "./surfaceCalls";
import { isBidPath, isSharedPath } from "./surface";
import { surfaceHrefs } from "./surfaceHrefs";
import { JOB_START_RETURNS, estimateStartDestination, jobStartDestination } from "./jobStartDestination";
import { bidLogHrefs, bidPageCrumbs, storedHref } from "./bidLogHrefs";
import { bidPageData, webPage } from "./bidPageData";

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
const BID_LOG_HREF =
  "A per-row link from `bidLogHrefs(surface)` (lib/bid/bidLogHrefs.ts): the CRM's literal, or `null` on Bid, where the log draws plain text instead of a link. Every value `bidLogHrefs(\"bid\")` returns is classified in its section below.";
const BID_PAGE_HREF =
  "Chosen by `surface` for the bid's own page (`bidLogHrefs`, `bidPageCrumbs`) or re-pointed by `bidPageData`/`storedHref` (lib/bid), which the page runs every stored agent link through: a Bid value is a /bid path or null. Every value those return is classified in the \"the bid's own page\" section below, and the Bid page's source is pinned to call `bidPageData`.";
const BLOB_URL =
  "An object URL from URL.createObjectURL for a file the browser is saving (the anchor has a `download` attribute) — not a page navigation.";

const DYNAMIC_ALLOWED: Record<string, string> = {
  "components/bid/BidHeader.tsx: item.href":
    "BID_NAV in components/bid/bidNav.ts — every entry is a literal `href:` property, which this census reads as a prop-href sink.",
  "components/bid/BidEstimateTabs.tsx: tab.href":
    "bidEstimateTabs() in components/bid/bidEstimateTabs.ts — every entry is a literal `href:` template starting /bid/estimates/, read here as a prop-href sink.",
  "components/bid/guide/JobGuideAsk.tsx: action.href":
    "A guide's ask actions (`JobGuide.ask.actions[].href`, built by the guide engine). JobGuideAsk draws a link only when `isBidPath(href)` holds and drops the action otherwise, so a target outside /bid cannot reach the page by construction; jobGuideScreen.test.tsx also requires every fixture href to start with /bid.",
  "components/bid/guide/JobGuideRail.tsx: href":
    "`guideStepLink()` in lib/bid/guide/stepHrefs.ts — every return is a literal /bid/estimates/<id>/(takeoff|estimate|proposal) template; jobGuideScreen.test.tsx renders every fixture and requires each rail href to start with /bid.",
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
  "components/BidLog.tsx: allHref":
    "The bid log's \"see all\" / \"show fewer\" links, `${hrefs.bids}?…` — `surfaceHrefs(surface).bids`, classified in its section below, plus a query string. Passed to SeeAll (next entry).",
  "components/SeeAll.tsx: href":
    "SeeAll's own prop. Its only caller in Bid's closure is the bid log, which passes `${hrefs.bids}?…` (previous entry); the \"BidLog is rendered as Bid\" tests below pin that the log gets `surface=\"bid\"`.",
  "components/SeeAll.tsx: fewerHref": "Same as `href` above.",
  "components/BidLog.tsx: bidPageHref": BID_LOG_HREF,
  "components/BidLog.tsx: contactHref": BID_LOG_HREF,
  "app/(app)/bids/[id]/regret/RegretLetter.tsx: backHref":
    "`bidLogHrefs(surface).list` — \"/bids\" in the CRM, \"/bid/bids\" in Bid; classified in the bidLogHrefs section below. The Bid regret page renders it with surface=\"bid\" (pinned by the \"every use passes the Bid value\" test).",
  "components/ai-bid/BidWorkspace.tsx: contactHref": BID_LOG_HREF,
  "components/ai-bid/BidWorkspace.tsx: crumb.href": BID_PAGE_HREF,
  "components/ai-bid/BidWorkspace.tsx: a.href": BID_PAGE_HREF,
  "components/ai-bid/BidWorkspace.tsx: finding.fixHref": BID_PAGE_HREF,
  "components/ai-bid/parts.tsx: s.href": BID_PAGE_HREF,
  "components/ai-bid/parts.tsx: s.url":
    "A research citation's own web page (target=_blank, an outside site). `bidPageData` keeps a url only through `webPage()`, which refuses any cstream.ai host — tested in the bid's own page section below.",
  "components/BidLog.tsx: regretHref": BID_LOG_HREF,
  "components/BidProjectPanel.tsx: hrefs.job": SURFACE_PROP,
  "components/LogBidForm.tsx: hrefs.addGc": SURFACE_PROP,
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

describe("estimateStartDestination: where \"Start the estimate\" (from a bid project) sends a person", () => {
  it("every word a form may send lands in Bid, on the estimate itself", () => {
    expect(JOB_START_RETURNS.length).toBeGreaterThanOrEqual(1);
    for (const word of JOB_START_RETURNS) {
      const destination = estimateStartDestination(word, "job_abc");
      expect(classify(destination), `${word} -> ${destination}`).toBe("ok");
      expect(destination).toBe("/bid/estimates/job_abc");
    }
  });

  it("anything else is the CRM stepper, never an echo of the input (the CRM form binds \"crm\")", () => {
    for (const hostile of ["crm", undefined, null, "", "BID", "//evil.example", "https://evil.example", "/jobs", "__proto__", new FormData()]) {
      expect(estimateStartDestination(hostile, "job_abc"), String(hostile)).toBe("/jobs/new/job_abc/items");
    }
  });
});

describe("bidLogHrefs(\"bid\"): the bid log's per-row links", () => {
  it("links only to screens Bid has, draws NO link where it has none, and the CRM value is a CRM door (so the classifier can tell)", () => {
    const bid = bidLogHrefs("bid");
    const crm = bidLogHrefs("crm");
    for (const [name, make] of [["bidPage", "bidPage"], ["contact", "contact"], ["regret", "regret"]] as const) {
      const value = bid[make]("x1");
      // Null is the safe answer; a string is fine only if it stays in Bid.
      expect(value === null || classify(value) === "ok", `bidLogHrefs("bid").${name} = ${String(value)}`).toBe(true);
      expect(classify(crm[make]("x1") as string), `bidLogHrefs("crm").${name}`).toBe("crm");
    }
    // Bid has the bid's own page and the regret letter, and no GC page.
    expect(bid.bidPage("x1")).toBe("/bid/bids/x1");
    expect(bid.regret("x1")).toBe("/bid/bids/x1/regret");
    expect(bid.contact("x1")).toBeNull();
  });
});

describe("the bid's own page (/bid/bids/<id>) and the regret letter", () => {
  // The links the AGENTS store are written as CRM routes in lib/agents, past
  // this census's sight and already in the database. Derive the set from the
  // source so a new agent link cannot be missing from the question.
  const agentsDir = join(webRoot, "lib", "agents");
  const stored = new Set<string>();
  let agentFiles = 0;
  for (const name of readdirSync(agentsDir)) {
    if (!name.endsWith(".ts") || /\.(test|dbtest)\.ts$/.test(name)) continue;
    agentFiles++;
    const text = readFileSync(join(agentsDir, name), "utf8");
    for (const m of text.matchAll(/\b(?:\w*[hH]ref)\s*[:=]\s*(?:\(\w+(?::\s*\w+)?\)\s*=>\s*)?[`"](\/[^`"]*)[`"]/g)) {
      stored.add(m[1]!.replace(/\$\{[^}]*\}/g, "x1"));
    }
  }

  it("found the agents' stored links (size first: a pattern matching nothing would pass everything)", () => {
    expect(agentFiles).toBeGreaterThanOrEqual(8);
    expect(stored.size).toBeGreaterThanOrEqual(8);
    for (const must of ["/ai/bids/x1", "/contacts/x1", "/jobs/x1/estimate", "/pipeline", "/backcharges", "/jobs/x1"]) {
      expect([...stored], must).toContain(must);
    }
    // And the classifier can tell: the CRM keeps them, and they are CRM doors.
    expect([...stored].some((h) => classify(storedHref("crm", h) as string) === "crm")).toBe(true);
  });

  it("every stored link, as Bid draws it, is a /bid path or nothing", () => {
    const bad = [...stored]
      .map((h) => ({ h, value: storedHref("bid", h) }))
      .filter(({ value }) => value !== null && classify(value) !== "ok")
      .map(({ h, value }) => `${h} -> ${value}`);
    expect(bad).toEqual([]);
    // The two it keeps, and the CRM doors it must have dropped.
    expect(storedHref("bid", "/ai/bids/x1")).toBe("/bid/bids/x1");
    expect(storedHref("bid", "/contacts/x1")).toBeNull();
    expect(storedHref("bid", "/pipeline")).toBeNull();
  });

  it("bidPageData leaves no anchor target that is not /bid, a web page or nothing — on a bid carrying every stored link", () => {
    const links = [...stored];
    const row = (id: string, href: string) => ({
      id,
      agent: "BID_RESEARCH",
      kind: "k",
      severity: "warn",
      title: "t",
      body: "b",
      sources: [
        { label: "chip", href },
        { label: "web", url: "https://example.com/x" },
        { label: "ours", url: "https://app.cstream.ai/jobs/j1" },
        { label: "mixed", href, url: "https://app.cstream.ai/contacts/c1" },
      ],
      fixHref: href,
      bidInvitationId: "b1",
      bidProjectName: "P",
      createdAt: new Date(0),
      dismissedAt: null,
      runId: "r1",
    });
    const data = {
      bid: { id: "b1", projectName: "P", gcName: "G", contactId: "c1", dueDate: null, status: "INVITED", bidAmount: null, tradeScope: null },
      research: links.map((h, i) => row(`r${i}`, h)),
      estimateCheck: links.map((h, i) => row(`e${i}`, h)),
      addenda: links.map((h, i) => ({ id: `a${i}`, reference: "A", issuedOn: null, read: false, openDecisions: 0, href: h })),
      decision: {
        recommendation: { id: "x", kind: "bid_or_pass", subjectType: "BidInvitation", subjectId: "b1", title: "t", reason: "r", confidence: "high", score: 1, href: "/ai/bids/b1", sources: [{ label: "c", href: "/contacts/c1" }], status: "open", updatedAt: new Date(0) },
        outcome: null,
      },
      lastRuns: [],
      subject: { type: "BidInvitation" as const, id: "b1" },
    };
    const out = bidPageData(data as never);
    const targets: string[] = [];
    for (const f of [...out.research, ...out.estimateCheck]) {
      if (f.fixHref) targets.push(f.fixHref);
      for (const s of f.sources) targets.push(...[s.href, s.url].filter((v): v is string => !!v));
    }
    for (const a of out.addenda) targets.push(a.href);
    for (const s of out.decision.recommendation?.sources ?? []) targets.push(...[s.href, s.url].filter((v): v is string => !!v));
    expect(targets.length).toBeGreaterThan(links.length * 2); // it looked at something
    const bad = targets.filter((t) => classify(t) !== "ok" && !(/^https:\/\/example\.com\//.test(t)));
    expect(bad).toEqual([]);
    expect(targets.some((t) => t.startsWith("https://example.com/"))).toBe(true);
  });

  it("a web page keeps its link only when it is not one of C Stream's own hosts", () => {
    expect(webPage("https://example.com/a")).toBe("https://example.com/a");
    for (const own of ["https://app.cstream.ai/jobs/j1", "http://bid.cstream.ai/bid/bids", "https://cstream.ai/", "/jobs/j1", "javascript:alert(1)", undefined]) {
      expect(webPage(own as string | undefined), String(own)).toBeNull();
    }
  });

  it("the breadcrumb and the per-bid links Bid draws stay in Bid", () => {
    for (const crumb of bidPageCrumbs("bid")) expect(classify(crumb.href), crumb.href).toBe("ok");
    expect(classify(bidLogHrefs("bid").list)).toBe("ok");
    expect(classify(bidLogHrefs("crm").list)).toBe("crm");
    expect(bidPageCrumbs("crm").every((c) => classify(c.href) === "crm")).toBe(true);
  });

  it("the Bid bid page runs every stored link through bidPageData, and draws no Ask", () => {
    const source = readFileSync(join(BID_APP, "(signed-in)", "bids", "[id]", "page.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(source).toMatch(/data=\{bidPageData\(data\)\}/);
    expect(source).toMatch(/surface="bid"/);
    expect(source).not.toMatch(/AskPanel|ask=\{/);
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
    "startEstimateFromProject: estimateStartDestination(returnTo, started.value.jobId)":
      "lib/bid/jobStartDestination.ts: the same WORD-from-a-fixed-list rule, with its own destination table (`ESTIMATE_DESTINATIONS`), classified in the estimateStartDestination section above.",
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

  function uses(files: string[] = entries) {
    const found: { file: string; line: number; tag: string; prop: string; value: string | true | undefined }[] = [];
    for (const file of files) {
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
    for (const must of ["JobTakeoffPage", "JobProposalPage", "TakeoffWorkspacePage", "EstimateLineItems", "NewJobForm", "BidLog"]) {
      expect(tags, must).toContain(must);
    }
  });

  it("every use passes the Bid value", () => {
    const wrong = uses()
      .filter((u) => u.value !== "bid")
      .map((u) => `${u.file}:${u.line} <${u.tag}> has no ${u.prop}="bid"`);
    expect(wrong, "a shared screen rendered without telling it it is in Bid draws CRM links").toEqual([]);
  });

  it("a shared component that renders another one FORWARDS its own surface (the log's panels cannot fall back to the CRM)", () => {
    // Everything Bid imports but does not own: BidLog renders LogBidForm and
    // BidProjectPanel, whose links depend on the `surface` they are handed. The
    // entry check above stops at the first hop; this follows the closure. A use
    // passes `surface={surface}` (read as "present, not a string literal") and
    // only inside a file that itself takes a `surface`; a literal "crm" fails.
    const inner = closure.files.filter((f) => !entries.includes(f));
    const nested = uses(inner);
    expect(nested.map((u) => u.tag), "the log's two surface-aware panels").toEqual(
      expect.arrayContaining(["LogBidForm", "BidProjectPanel"]),
    );
    const wrong = nested
      .filter((u) => u.prop === "surface")
      .filter((u) => {
        if (u.value === "bid") return false;
        const owner = readFileSync(join(webRoot, u.file), "utf8");
        return !(u.value === true && /surface\??: Surface/.test(owner));
      })
      .map((u) => `${u.file}:${u.line} <${u.tag}> does not forward its surface`);
    expect(wrong).toEqual([]);
  });

  it("the proposal hands no finding link outside the CRM", () => {
    const source = readFileSync(join(APP, "(app)", "jobs", "[id]", "proposal", "page.tsx"), "utf8");
    expect(source).toContain('href: surface === "crm" ? finding.fixHref : null');
  });
});
