import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NAV_FOOTER, navGroupsFor } from "@/components/navItems";
import { JOB_TAB_ROUTES } from "@/components/job/jobTabs";
import { AREAS, toolRoute } from "@/lib/areas";

/**
 * EVERY PAGE WE BUILT HAS A DOOR.
 *
 * #748 (Concept G) took the sidebar away and swapped the job tab row for five
 * stage boxes. Nothing was deleted, and about half the app stopped having a
 * visible way in — reachable only from ⌘K or the avatar's "All pages" panel.
 * No test noticed, because no test asked "can a person get here?".
 *
 * This one does. It walks every `page.tsx` under `app/(app)`, turns each into
 * its app-router pattern, and requires that pattern to be one of:
 *
 *   (a) in the sidebar — `navGroupsFor(owner, { showsInternal: true })` plus
 *       `NAV_FOOTER`, which is exactly what the sidebar renders;
 *   (b) an area page or a tool on one (`AREAS` in lib/areas.ts);
 *   (c) in the top bar (TOP_BAR below, each naming the file that draws it);
 *   (d) in the job tab row (`JOB_TAB_ROUTES`);
 *   (e) on REACHED_FROM below — a detail page, wizard step or filing view,
 *       with the PARENT that links to it named AND CHECKED: the parent file
 *       must contain the link, so a reason that stops being true fails.
 *
 * CLAUDE.md's two failure modes for a census that derives its own set are
 * both asserted, not assumed. SIZE: the walk must find at least 70 pages, and
 * an independent second scan must find the same set. SCOPE: every page git
 * tracks under `app/(app)` must be in the walk — the walk, not git, is the
 * primary source, for the reason `pageWidthCensus.test.ts` records (a
 * `git ls-files '**' + '/page.tsx'` pre-scan missed a root route file once).
 *
 * The allow-list is a ratchet: an entry whose page is gone, or whose page is
 * ALSO reachable by (a)-(d), fails — so it cannot become scenery.
 */

const appDir = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: appDir, encoding: "utf8" }).trim();

/** The signed-in shell. Pages outside it (portal, e-sign, pilot) are public
 * links someone is sent, not places you navigate to. */
const SHELL_ROOT = resolve(appDir, "app/(app)");

function walkPages(dir: string, out: string[] = []): string[] {
  // A missing root returns nothing so the size assertions below report it,
  // rather than a crash at collection that names no rule.
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkPages(full, out);
    else if (name === "page.tsx") out.push(relative(SHELL_ROOT, full).split(sep).join("/"));
  }
  return out;
}

/**
 * The same question as `walkPages`, asked a different way — the size
 * cross-check this census rests on.
 *
 * ── IT WAS `fs.globSync`, AND THAT IS NODE 22. CI IS NODE 20. ──
 *
 * `globSync` landed in Node 22. `ci.yml` pins `node-version: 20`, so on CI
 * this threw `TypeError: (0 , globSync) is not a function` — the test failed,
 * the Test step failed, and lint, typecheck and build were SKIPPED behind it.
 * It passed for whoever wrote it, on a newer Node, which is why it reached
 * main: a local run and CI were not asking the same question.
 *
 * So this uses nothing newer than `readdirSync` with `withFileTypes`, which is
 * Node 10. And it stays INDEPENDENT of `walkPages` in the two ways that matter
 * for a cross-check: it is ITERATIVE where that one recurses, and it reads the
 * entry kind off the DIRENT where that one calls `statSync`. Two traversals
 * that share an implementation prove nothing about each other.
 */
function scanPages(): string[] {
  if (!existsSync(SHELL_ROOT)) return [];
  const out: string[] = [];
  const stack = [SHELL_ROOT];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === "page.tsx") out.push(relative(SHELL_ROOT, full).split(sep).join("/"));
    }
  }
  return out;
}

/** `jobs/[id]/(tabs)/estimate/page.tsx` -> `/jobs/[id]/estimate`. Route
 * groups `(name)` are not URL segments. */
function routePattern(pagePath: string): string {
  const segments = pagePath
    .split("/")
    .slice(0, -1)
    .filter((segment) => !/^\(.*\)$/.test(segment));
  return `/${segments.join("/")}`;
}

/** Same reason as rowActionsCensus/pageWidthCensus: a comment quoting a link
 * is not a link, and a parent check that reads its own documentation passes
 * after the link it documents is gone. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const OWNER = { role: "OWNER", jobFunction: null };

/** (c) The top bar, each with the file that draws it and the text that file
 * must contain. */
const TOP_BAR: Record<string, { file: string; needle: string }> = {
  "/dashboard": { file: "apps/web/components/shell/TopBar.tsx", needle: 'href="/dashboard"' },
  "/jobs": { file: "apps/web/components/shell/primaryNav.ts", needle: 'JOBS_HREF = "/jobs"' },
  "/alerts": { file: "apps/web/components/shell/TopBar.tsx", needle: 'href="/alerts"' },
  // The ⌘K search box offers "Ask C Stream: <your question>" on any query
  // that reads like a question.
  "/ask": { file: "apps/web/lib/search/palette.ts", needle: "`/ask?q=" },
};

type Reached =
  | { reason: string; parents: string[]; needle: string }
  | { reason: "bare redirect()" };

/**
 * (e) Pages with no door of their own, each reached from a parent that is
 * itself reachable. `needle` is the literal the parent's code must contain;
 * every listed parent is checked.
 */
const REACHED_FROM: Record<string, Reached> = {
  "/sales/public-works": {
    reason: "The public-works market list, linked from the sales CRM's header strip.",
    parents: ["apps/web/app/(app)/sales/page.tsx"],
    needle: 'href="/sales/public-works"',
  },
  "/ai/activity": {
    reason: "The AI tasks menu's footer link, in the top bar on every page.",
    parents: ["apps/web/components/shell/TasksMenu.tsx"],
    needle: 'href="/ai/activity"',
  },
  "/ai/bids/[id]": {
    reason: "Each bid row on /bids opens its AI workspace.",
    parents: ["apps/web/app/(app)/bids/page.tsx"],
    needle: "`/ai/bids/${",
  },
  "/bids/[id]/regret": {
    reason: 'A lost bid\'s "why we lost" link on /bids.',
    parents: ["apps/web/app/(app)/bids/page.tsx"],
    needle: "/regret`",
  },
  "/contacts/[id]": {
    reason: "Each row on /contacts.",
    parents: ["apps/web/components/ContactRow.tsx"],
    needle: "`/contacts/${",
  },
  "/drawings/[revisionId]": {
    reason: "Each revision in a drawing set's row on /drawings.",
    parents: ["apps/web/components/DrawingSetRow.tsx"],
    needle: "`/drawings/${",
  },
  "/sales/[id]": {
    reason: "Each lead row on /sales (operator only).",
    parents: ["apps/web/components/SalesLeadRow.tsx", "apps/web/app/(app)/sales/page.tsx"],
    needle: "`/sales/${",
  },
  "/sales/call-list": {
    reason: "The call-list link beside today's calls on /sales (operator only).",
    parents: ["apps/web/app/(app)/sales/page.tsx"],
    needle: 'href="/sales/call-list"',
  },
  "/sales/[id]/sample-wh347": {
    reason: "The sample WH-347 link on a lead's page (operator only).",
    parents: ["apps/web/app/(app)/sales/[id]/page.tsx"],
    needle: "`/sales/${lead.id}/sample-wh347`",
  },
  "/union-compliance/remittance": {
    reason: "Each month's remittance report link on /union-compliance.",
    parents: ["apps/web/app/(app)/union-compliance/page.tsx"],
    needle: "`/union-compliance/remittance?month=",
  },
  "/settings/assistant": {
    reason: "The Assistant link on /settings.",
    parents: ["apps/web/app/(app)/settings/page.tsx"],
    needle: 'href="/settings/assistant"',
  },
  "/settings/export": {
    reason: "The Export link on /settings.",
    parents: ["apps/web/app/(app)/settings/page.tsx"],
    needle: 'href="/settings/export"',
  },
  "/settings/import": {
    reason: "The Import link on /settings (and the empty states on /vendors, /contacts, /compliance).",
    parents: ["apps/web/app/(app)/settings/page.tsx"],
    needle: 'href="/settings/import"',
  },
  "/jobs/new": {
    reason: 'The "New job" button on /jobs.',
    parents: ["apps/web/app/(app)/jobs/page.tsx"],
    needle: 'href="/jobs/new"',
  },
  "/jobs/new/[jobId]/items": {
    reason: "Step 2 of the new-job wizard, from its step bar.",
    parents: ["apps/web/components/BidWizardSteps.tsx"],
    needle: "/items`",
  },
  "/jobs/[id]/subcontract-review": {
    reason: "Review before signing, on each version in the Overview tab's Subcontract agreement section.",
    parents: ["apps/web/app/(app)/jobs/[id]/(tabs)/page.tsx"],
    needle: "/subcontract-review?version=",
  },
  "/jobs/[id]/subcontract-review/[reviewId]/summary": {
    reason: "The one-page summary link on the subcontract review.",
    parents: ["apps/web/app/(app)/jobs/[id]/subcontract-review/page.tsx"],
    needle: "/summary`",
  },
  "/jobs/[id]/subcontract-review/rider/[riderId]": {
    reason: "Print preview on the rider panel of the subcontract review.",
    parents: ["apps/web/components/SubcontractRiderPanel.tsx"],
    needle: "/subcontract-review/rider/${",
  },
  "/jobs/[id]/proposal": {
    reason: "The proposal link on the job's Estimate tab.",
    parents: ["apps/web/app/(app)/jobs/[id]/(tabs)/estimate/page.tsx"],
    needle: "/proposal`",
  },
  "/jobs/[id]/certified-payroll": {
    reason: "The certified payroll link on the job's Crew & time tab.",
    parents: ["apps/web/app/(app)/jobs/[id]/(tabs)/crew/page.tsx"],
    needle: "/certified-payroll`",
  },
  "/jobs/[id]/certified-payroll/wh-347": {
    reason: "Each week's WH-347 link on the certified payroll page.",
    parents: ["apps/web/app/(app)/jobs/[id]/certified-payroll/page.tsx"],
    needle: "/certified-payroll/wh-347?",
  },
  "/jobs/[id]/pay-applications/[invoiceId]": {
    reason: "Each pay application on the job's Billing tab.",
    parents: ["apps/web/components/PayApplications.tsx", "apps/web/components/job/PayAppSummary.tsx"],
    needle: "/pay-applications/${",
  },
  "/jobs/[id]/photo-report": {
    reason: "The printable photo report link on the job's Photos tab gallery (built by lib/photo-report.ts).",
    parents: ["apps/web/components/JobMediaGallery.tsx"],
    needle: "href={photoReportHref(",
  },
  "/jobs/[id]/das-140/[noticeId]": {
    reason: "Each DAS 140 notice on the job's Compliance tab.",
    parents: ["apps/web/components/Das140Panel.tsx"],
    needle: "/das-140/${",
  },
  "/jobs/[id]/das-142/[requestId]": {
    reason: "Each DAS 142 request on the job's Compliance tab.",
    parents: ["apps/web/components/Das142Panel.tsx"],
    needle: "/das-142/${",
  },
  // Kept so a bookmark lands somewhere; renders nothing.
  "/estimating": { reason: "bare redirect()" },
  "/jobs/new/[jobId]/review": { reason: "bare redirect()" },
};

describe("reachability census", () => {
  const walked = walkPages(SHELL_ROOT);
  const pages = new Map(walked.map((path) => [routePattern(path), path]));

  const sidebar = new Set([
    ...navGroupsFor(OWNER, { showsInternal: true }).flatMap((group) => group.items.map((item) => item.href)),
    ...NAV_FOOTER.map((item) => item.href),
  ]);
  const areaPages = new Set(["/areas/[slug]", ...AREAS.flatMap((area) => area.tools.map(toolRoute))]);
  const topBar = new Set(Object.keys(TOP_BAR));
  const jobTabs = new Set<string>(JOB_TAB_ROUTES);
  const reachable = new Set([...sidebar, ...areaPages, ...topBar, ...jobTabs]);

  it("walks a shell that exists and finds at least 70 pages in it", () => {
    expect(existsSync(SHELL_ROOT) && statSync(SHELL_ROOT).isDirectory(), `${SHELL_ROOT} does not exist`).toBe(true);
    expect(walked.length, "the walk found too few pages — this census would pass by seeing nothing").toBeGreaterThanOrEqual(70);
    expect(pages.size, "two page files map to one route pattern — routePattern() is wrong").toBe(walked.length);
  });

  /** SIZE, from a derivation that shares no code with the walk. */
  it("finds exactly the pages a second, independent scan finds", () => {
    const found = scanPages();
    expect(found.length).toBeGreaterThanOrEqual(70);
    expect([...walked].sort()).toEqual([...found].sort());
  });

  /** SCOPE: git knows what is in the tree without knowing how we walk it.
   * One-directional, so an uncommitted new page (seen by the walk) is not a
   * failure here. */
  it("sees every page git is tracking in the shell", () => {
    const tracked = execFileSync("git", ["ls-files", "--", "apps/web/app/(app)"], { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .filter((path) => path.endsWith("/page.tsx"))
      .map((path) => relative("apps/web/app/(app)", path).split(sep).join("/"));
    expect(tracked.length, "git reports no pages, so this cross-check confirms nothing").toBeGreaterThanOrEqual(70);
    expect(tracked.filter((path) => !walked.includes(path))).toEqual([]);
  });

  it("converts route-group paths to the URL pattern", () => {
    expect(routePattern("jobs/[id]/(tabs)/estimate/page.tsx")).toBe("/jobs/[id]/estimate");
    expect(routePattern("jobs/[id]/(tabs)/page.tsx")).toBe("/jobs/[id]");
    expect(routePattern("settings/page.tsx")).toBe("/settings");
  });

  it("reads non-empty sources for every bucket", () => {
    expect(sidebar.size, "the sidebar read almost nothing — navGroupsFor or NAV_FOOTER changed shape").toBeGreaterThanOrEqual(30);
    expect(areaPages.size).toBeGreaterThanOrEqual(30);
    expect(jobTabs.size).toBe(9);
  });

  it("names, for the top bar, a file that really draws each route", () => {
    for (const [route, { file, needle }] of Object.entries(TOP_BAR)) {
      const source = withoutComments(readFileSync(join(repoRoot, file), "utf8"));
      expect(source.includes(needle), `${route}: ${file} no longer contains ${needle}`).toBe(true);
    }
  });

  /** The verdict. */
  it("leaves no page without a door", () => {
    const orphans = [...pages.keys()].filter((route) => !reachable.has(route) && !(route in REACHED_FROM));
    expect(
      orphans,
      `these pages have no way in: ${orphans.join(", ")}. Add each to ONE of: the sidebar ` +
        `(NAV_ITEMS + a NAV_GROUPS group in components/navItems.tsx), an area's tools ` +
        `(AREAS in lib/areas.ts), the job tab row (JOB_TAB_ROUTES in components/job/jobTabs.ts) ` +
        `— or, for a detail page, REACHED_FROM in this file with the parent that links to it.`,
    ).toEqual([]);
  });

  it("points every door at a page that exists", () => {
    const dangling = [...reachable].filter((route) => !pages.has(route));
    expect(dangling, `these doors open onto no page.tsx: ${dangling.join(", ")}`).toEqual([]);
  });

  /** The ratchet on (e). */
  it("allow-lists only pages that exist and need it", () => {
    for (const route of Object.keys(REACHED_FROM)) {
      expect(pages.has(route), `${route} is on REACHED_FROM and no page.tsx exists for it — remove the entry`).toBe(true);
      expect(
        reachable.has(route),
        `${route} is on REACHED_FROM but is already reachable from the sidebar, an area, the top bar or the job tabs — remove the entry`,
      ).toBe(false);
    }
  });

  it("checks that every allow-list reason is still true", () => {
    for (const [route, entry] of Object.entries(REACHED_FROM)) {
      const file = pages.get(route);
      if (!file) continue; // reported by the ratchet above
      if (!("parents" in entry)) {
        const source = withoutComments(readFileSync(join(SHELL_ROOT, file), "utf8"));
        expect(source.includes("redirect("), `${route} is listed as a bare redirect() and does not call redirect(`).toBe(true);
        expect(/<[A-Za-z]/.test(source), `${route} is listed as a bare redirect() and renders JSX`).toBe(false);
        continue;
      }
      expect(entry.parents.length, `${route} names no parent`).toBeGreaterThan(0);
      for (const parent of entry.parents) {
        const path = join(repoRoot, parent);
        expect(existsSync(path), `${route}: parent ${parent} does not exist`).toBe(true);
        const source = withoutComments(readFileSync(path, "utf8"));
        expect(
          source.includes(entry.needle),
          `${route}: parent ${parent} no longer links to it (no ${entry.needle} in its code) — the reason "${entry.reason}" is stale`,
        ).toBe(true);
      }
    }
  });
});
