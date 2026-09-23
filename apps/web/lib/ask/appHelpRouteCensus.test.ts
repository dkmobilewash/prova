import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pages, repoRoot } from "@/lib/walkthroughs/census-helpers";
import { WALKTHROUGHS } from "@/lib/walkthroughs";
import { isOpenableRoute, openableStartFor } from "@/lib/route-shape";
import type { Principal } from "@/lib/permissions";
import { runTool } from "./handlers";

/**
 * ASK NEVER SENDS ANYONE TO A PAGE THAT DOES NOT EXIST.
 *
 * THE DEFECT. `app_help` answers "how do I…" from the walkthrough
 * registry, and a walkthrough's `route` is written the way `app/` writes
 * it — so the six job-detail tabs are Next.js route PATTERNS,
 * `/jobs/[id]/billing` and friends. The handler emitted that string as
 * both the route the model narrates and the citation `AskPanel` renders
 * as a `<Link>`, which navigates to `/jobs/%5Bid%5D/billing`: "This page
 * doesn't exist." Measured on `origin/main` (9b53afc) before the fix —
 * "how do I bill the GC" cited `/jobs/[id]/billing` for BOTH an OWNER and
 * a FIELD member, and four more questions did the same.
 *
 * Global search shipped the identical bug from the identical registry
 * (#386) and is fixed on the unmerged #408. That is why the predicate
 * lives in `lib/route-shape.ts` and not in either surface.
 *
 * WHY A CENSUS AND NOT SIX ASSERTIONS. The registry is the moving part.
 * The next job-detail tab to get a walkthrough reintroduces this with no
 * code change at all in `handlers.ts`, so every question below is driven
 * FROM the registry rather than from a list of routes somebody typed.
 *
 * WHAT IT SEES, WHICH IS A SEPARATE QUESTION FROM WHAT IT ASKS.
 * CLAUDE.md records three ways a derived check goes green while guarding
 * nothing, and each has its own answer here:
 *
 *   - the pattern silently matches nothing -> the href scan's size is
 *     pinned against `git grep -c`, raw bytes, no parsing of ours;
 *   - the scan walks the wrong root -> the file set comes from
 *     `git ls-files`, not from a directory constant, and the modules
 *     reached through a non-literal href are named and followed;
 *   - the question is vacuous -> the registry must still CONTAIN dynamic
 *     routes, and the drives below must still return pages, or there is
 *     nothing for any of this to be true of.
 *
 * And the fourth, which is the one that let this defect through
 * `tools.test.ts` for two weeks: that file already derives Ask's
 * citations, but only the LITERAL ones (`href: "…"`). The defect lived in
 * an EXPRESSION, `href: match.route`, which a literal scan cannot see at
 * all. So every non-literal href is enumerated below with a written
 * reason, and an unrecognised one fails the build.
 */

const OWNER: Principal = { role: "OWNER", jobFunction: null };
const FIELD: Principal = { role: "MEMBER", jobFunction: "FIELD" };

// ---------------------------------------------------------------- scope --

/** Ask's own modules, as git lists them — never a directory walk of ours,
 * so a file cannot be missed by a glob nobody re-read. Untracked files are
 * included: a handler added this session must be scanned too. */
function askSourceFiles(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", "apps/web/lib/ask"],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split("\n")
    .filter((path) => path.endsWith(".ts") && !/\.(test|dbtest)\.ts$/.test(path));
}

/**
 * Every non-literal `href:` value in the scanned files, with why it cannot
 * be a route pattern and — where the real values live somewhere else — the
 * file that holds them, which is then scanned too.
 *
 * This list IS the scope decision. An href built from an expression is
 * invisible to the literal scan, so one that is not here is not "probably
 * fine", it is unexamined: the test below fails and names it.
 */
const COMPUTED_HREFS: Record<string, { why: string; followTo?: string }> = {
  "match.href": {
    why:
      "app_help's citations. `AppHelpMatch.href` is `openableFor(route)`, which is exactly what this " +
      "file's behavioural drive exercises against every walkthrough in the registry.",
  },
  "step.href": {
    why: "getting_started's citations — the dashboard card's own steps, whose hrefs are string literals.",
    followTo: "apps/web/lib/getting-started.ts",
  },
  route: {
    why: "inside `openableFor` itself: returned only when `isOpenableRoute(route)` is already true.",
    followTo: "apps/web/lib/ask/appHelp.ts",
  },
  "openableStartFor": {
    why: "the other arm of `openableFor` — a prefix with every dynamic segment removed, or /dashboard.",
    followTo: "apps/web/lib/ask/appHelp.ts",
  },
  "alert.href": {
    why:
      "needs_attention's per-record \"go straight to\" links, and the same value /alerts links its own " +
      "rows to. `Alert.href` is built in alerts.ts from literals and job/contact id templates — never " +
      "composed from anything a person typed, and never supplied by the model (ItemLink in tools.ts " +
      "says why: `links` is not in `data`, so the model cannot see or edit an href).",
    followTo: "apps/web/lib/alerts.ts",
  },
  "renewal.href": {
    why:
      "surfaced by following alerts.ts above: the RENEWAL alert copies `renewal.href` rather than " +
      "building one, so the real values are one file further out. Following it is the point — a census " +
      "that stops at the first hop cannot see the file the href is actually written in.",
    followTo: "apps/web/lib/renewals.ts",
  },
  string: { why: "a type annotation (`href: string`), not a value." },
};

/** Captures the VALUE after `href:` in each of its four written forms. A
 * form this does not know about is counted by git and not by us, which the
 * size pin turns into a failure rather than a silent omission. */
const HREF_VALUE = /\bhref:\s*(\{|"[^"]*"|`[^`]*`|[A-Za-z_$][\w$.]*)/g;

function scannedFiles(): string[] {
  const followed = Object.values(COMPUTED_HREFS)
    .map((entry) => entry.followTo)
    .filter((path): path is string => Boolean(path));
  return [...new Set([...askSourceFiles(), ...followed])];
}

type Href = { file: string; value: string };

function hrefsIn(files: string[]): Href[] {
  const out: Href[] = [];
  for (const file of files) {
    for (const match of readFileSync(join(repoRoot, file), "utf8").matchAll(HREF_VALUE)) {
      out.push({ file, value: match[1] });
    }
  }
  return out;
}

/** The independent count: git's own grep, no regex of ours, no brace or
 * string parsing. It counts comments too, which is deliberate — a comment
 * containing `href:` must be reworded rather than tolerated, because the
 * alternative is a scan that strips comments and can therefore be fooled
 * by one. */
function hrefCountByGit(files: string[]): number {
  let total = 0;
  for (const file of files) {
    try {
      total += execFileSync("git", ["grep", "--untracked", "-h", "-o", "-E", "href:", "--", file], {
        cwd: repoRoot,
        encoding: "utf8",
      })
        .split("\n")
        .filter(Boolean).length;
    } catch (error) {
      // git grep exits 1 when a file holds no match. Any other status is real.
      if ((error as { status?: number }).status !== 1) throw error;
    }
  }
  return total;
}

/** `/cash-flow?job=1#x` -> `/cash-flow`; a template's `${…}` -> `[id]`, so
 * `` `/jobs/${job.id}` `` is looked up as the page file `/jobs/[id]`. */
function routeShapeOf(value: string): string {
  return value
    .slice(1, -1)
    .replace(/\$\{[^}]*\}/g, "[id]")
    .split(/[?#]/)[0];
}

describe("the census sees what it reasons about", () => {
  const files = scannedFiles();
  const found = hrefsIn(files);

  it("scans the file set git reports, not one of its own", () => {
    const fromGit = askSourceFiles();
    expect(fromGit.length, "git listed no source files under apps/web/lib/ask").toBeGreaterThan(30);
    for (const required of ["handlers.ts", "appHelp.ts", "tools.ts"]) {
      expect(
        fromGit.includes(`apps/web/lib/ask/${required}`),
        `${required} is not in the scanned set — this census would be blind to the file the defect was in`,
      ).toBe(true);
    }
    for (const file of files) {
      expect(existsSync(join(repoRoot, file)), `${file} is scanned but does not exist`).toBe(true);
    }
  });

  it("parses every href git can find, byte for byte", () => {
    // The whole point: a HREF_VALUE that stopped matching would make every
    // assertion below vacuously true, since nothing is ever wrong in an
    // empty list. Comparing against git means the failure reads "git
    // counts N and this file parsed M" instead of going quietly green.
    const byGit = hrefCountByGit(files);
    expect(byGit, "no `href:` found anywhere — the scan root or the pathspec is wrong").toBeGreaterThan(100);
    expect(
      found.length,
      `git counts ${byGit} \`href:\` occurrences in these ${files.length} files and this file parsed ` +
        `${found.length}. Either HREF_VALUE has drifted from a form somebody wrote, or a COMMENT now ` +
        `contains "href:" — reword the comment.`,
    ).toBe(byGit);
  });

  it("still has dynamic routes in the registry, all of them job pages", () => {
    // Without these the filter has nothing to remove and this whole file
    // passes for free. A finding, not a pass.
    const dynamic = WALKTHROUGHS.map((w) => w.route).filter((route) => !isOpenableRoute(route));
    expect(
      dynamic.length,
      "no walkthrough has a dynamic route any more — this census now proves nothing; delete it or re-aim it",
    ).toBeGreaterThan(0);
    for (const route of dynamic) {
      expect(
        openableStartFor(route),
        `${route} is dynamic but does not start inside /jobs — \`insideOneJob\` in appHelp.ts is now a ` +
          "lie, and the sentence app_help's tool description tells the model to say is wrong",
      ).toBe("/jobs");
    }
    expect(WALKTHROUGHS.length - dynamic.length).toBeGreaterThan(20);
  });

  it("knows which page files exist, from the disk rather than from a list", () => {
    expect(pages.size, "no page.tsx found — every resolution check below would be meaningless").toBeGreaterThan(30);
    expect(pages.has("/jobs")).toBe(true);
    expect(pages.has("/jobs/[id]/billing")).toBe(true);
  });
});

describe("every href Ask can emit is a page that exists", () => {
  const files = scannedFiles();
  const found = hrefsIn(files);

  it("resolves every literal one against a real page.tsx", () => {
    const literals = found.filter((href) => href.value.startsWith('"'));
    expect(literals.length, "no literal hrefs parsed").toBeGreaterThan(80);
    const broken = literals
      .filter((href) => !pages.has(routeShapeOf(href.value)))
      .map((href) => `${href.file}: ${href.value}`);
    expect(broken, `Ask cites a page with no page.tsx behind it: ${broken.join("; ")}`).toEqual([]);
  });

  it("resolves every template one, and never leaves a bracket in it", () => {
    const templates = found.filter((href) => href.value.startsWith("`"));
    expect(templates.length, "no template hrefs parsed").toBeGreaterThan(20);
    const broken = templates
      .filter((href) => !pages.has(routeShapeOf(href.value)))
      .map((href) => `${href.file}: ${href.value}`);
    expect(broken, `Ask builds an href for a route with no page: ${broken.join("; ")}`).toEqual([]);
  });

  it("recognises every non-literal one — the shape the defect actually had", () => {
    // `href: match.route` passed `tools.test.ts` for two weeks because that
    // file reads literals only. An expression nobody has written a reason
    // for is unexamined, not safe.
    const unexplained = found
      .filter((href) => !/^["`{]/.test(href.value) && !(href.value in COMPUTED_HREFS))
      .map((href) => `${href.file}: href: ${href.value}`);
    expect(
      unexplained,
      "An href built from an expression cannot be checked by reading it. Add it to COMPUTED_HREFS with " +
        `why it can never be a route pattern, and a \`followTo\` if its values live elsewhere: ${unexplained.join("; ")}`,
    ).toEqual([]);
  });

  it("keeps no entry in COMPUTED_HREFS after it has stopped existing", () => {
    // An exception list nobody prunes becomes permanent.
    const values = new Set(found.map((href) => href.value));
    const stale = Object.keys(COMPUTED_HREFS).filter((key) => !values.has(key));
    expect(stale, `Delete these — nothing uses them any more: ${stale.join(", ")}`).toEqual([]);
  });
});

describe("app_help never cites a route it cannot open", () => {
  /** Driven FROM the registry: every walkthrough's own title, so a new
   * page is covered the day it is added, plus the questions a contractor
   * actually asked. */
  const topics = [
    ...WALKTHROUGHS.map((walkthrough) => walkthrough.title),
    "one of my guys cut his hand on site this morning",
    "how do I bill the GC",
    "where do I see the estimate for a job",
    "how do I add crew to a job",
    "where do I put job photos",
    "how do I log a field report",
  ];

  type Page = { page: string; route: string; insideOneJob?: boolean };

  async function emitted() {
    const routes: { topic: string; role: string; route: string; insideOneJob: boolean }[] = [];
    const citations: { topic: string; role: string; href: string }[] = [];
    for (const topic of topics) {
      for (const principal of [OWNER, FIELD]) {
        const role = `${principal.role}/${principal.jobFunction}`;
        const result = await runTool({ companyId: "co_1", principal }, "app_help", { topic });
        for (const page of ((result.data as { pages?: Page[] } | null)?.pages ?? [])) {
          routes.push({ topic, role, route: page.route, insideOneJob: page.insideOneJob === true });
        }
        for (const citation of result.citations) citations.push({ topic, role, href: citation.href });
      }
    }
    return { routes, citations };
  }

  it("emits no route pattern, to anybody, for any question", async () => {
    const { routes, citations } = await emitted();
    // Vacuity floor first: an empty drive satisfies everything below it.
    expect(routes.length, "app_help answered nothing at all — is the registry reachable?").toBeGreaterThan(40);
    expect(routes.some((r) => r.insideOneJob), "no job-page match came back, so the fixed path never ran").toBe(true);

    const pattern = /[[\]]|%5B/i;
    const broken = [
      ...routes.filter((r) => pattern.test(r.route)).map((r) => `${r.role} "${r.topic}" route ${r.route}`),
      ...citations.filter((c) => pattern.test(c.href)).map((c) => `${c.role} "${c.topic}" citation ${c.href}`),
    ];
    expect(
      broken,
      `A route PATTERN handed to a person navigates to /jobs/%5Bid%5D/… and 404s: ${broken.join("; ")}`,
    ).toEqual([]);
  });

  it("sends nobody anywhere that is not a real page file", async () => {
    const { routes, citations } = await emitted();
    const missing = [
      ...routes.filter((r) => !pages.has(r.route)).map((r) => `route ${r.route} ("${r.topic}")`),
      ...citations.filter((c) => !pages.has(c.href)).map((c) => `citation ${c.href} ("${c.topic}")`),
    ];
    expect(missing, `no page.tsx behind this: ${missing.join("; ")}`).toEqual([]);
  });

  it("invents nothing — every route it gives is one the registry owns", async () => {
    // The other half of "never cite a route that does not resolve": a path
    // can exist and still be a page this answer has no business naming.
    const legitimate = new Set<string>();
    for (const walkthrough of WALKTHROUGHS) {
      legitimate.add(walkthrough.route);
      const start = openableStartFor(walkthrough.route);
      if (start) legitimate.add(start);
    }
    legitimate.add("/dashboard"); // app_help's stated fallback citation
    const { routes, citations } = await emitted();
    const invented = [
      ...routes.map((r) => r.route),
      ...citations.map((c) => c.href),
    ].filter((href) => !legitimate.has(href));
    expect(invented, `not a walkthrough route or the start of one: ${[...new Set(invented)].join(", ")}`).toEqual([]);
  });

  it("gives each citation a distinct href, because three job tabs collapse onto one", async () => {
    // AskPanel keys its citation links by href. Before the dedupe, "how do
    // I add crew to a job" produced three links all reading /jobs.
    for (const topic of ["how do I add crew to a job", "where do I see the estimate for a job"]) {
      const result = await runTool({ companyId: "co_1", principal: OWNER }, "app_help", { topic });
      const hrefs = result.citations.map((citation) => citation.href);
      expect(hrefs.length, `${topic} cited nothing`).toBeGreaterThan(0);
      expect(new Set(hrefs).size, `${topic} cited the same href twice: ${hrefs.join(", ")}`).toBe(hrefs.length);
    }
  });

  it("still answers the question rather than going silent on it", async () => {
    // The positive half, and the reason this fix is not #408's. Excluding
    // the match would satisfy every assertion above perfectly and leave a
    // contractor with "nothing matches" for a question the app answers.
    const result = await runTool({ companyId: "co_1", principal: OWNER }, "app_help", {
      topic: "how do I bill the GC",
    });
    const found = ((result.data as { pages?: Page[] } | null)?.pages ?? [])[0];
    expect(result.unavailable).toBeUndefined();
    expect(found?.page).toBe("A job — billing");
    expect(found?.route).toBe("/jobs");
    expect(found?.insideOneJob).toBe(true);
    // The steps are the answer; they must survive intact for the model to quote.
    const registry = WALKTHROUGHS.find((walkthrough) => walkthrough.route === "/jobs/[id]/billing")!;
    expect((found as unknown as { steps: unknown[] }).steps).toEqual(
      registry.steps.map((step) => ({ title: step.title, body: step.body })),
    );
  });

  it("tells the model what insideOneJob means, in the tool description", async () => {
    // A field the model is never told about is a field it ignores, and the
    // answer then reads "go to Jobs" as though that were the billing page.
    const { TOOLS } = await import("./tools");
    const description = TOOLS.find((tool) => tool.name === "app_help")!.description;
    expect(description).toContain("insideOneJob");
    expect(description).toContain("square brackets");
  });
});
