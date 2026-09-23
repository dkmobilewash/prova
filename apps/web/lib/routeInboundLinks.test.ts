/**
 * Every page under `app/` has something that links to it.
 *
 * THE PAGE THIS WAS WRITTEN FOR: `/jobs/[id]/certified-payroll/wh-347` —
 * the federal certified-payroll form, 600 lines, well built, linking BACK up
 * to the certified-payroll sheet, and reachable from nowhere. Found by a
 * person clicking a preview, not by anything in this repo: every mention of
 * the route was a code comment, a permission-table key, a test, or a
 * `revalidatePath` — which refreshes a page and takes nobody to it. The
 * printable fringe remittance sheet, `/union-compliance/remittance`, was in
 * the same state and this census caught it on its second version. That is
 * CLAUDE.md's "written, documented, and never called" shape wearing a route,
 * and it typechecked, tested and built green throughout, because nothing
 * referenced it.
 *
 * HOW A LINK IS RECOGNISED. A route `/jobs/[id]/crew` becomes the pattern
 * `/jobs/${}/crew`, and a link is any string or template literal in the
 * app's source that STARTS with it and ends there or at `?`/`#` — so
 * `href={`/jobs/${job.id}/crew`}`, `redirect("/dashboard")` and a URL
 * builder's returned template all count. What does not count:
 *   - comments — the literals come from the TypeScript parser
 *     (lib/source-literals.ts), and a comment is not a node;
 *   - the page's own file — a page linking to itself is not a way in;
 *   - `revalidatePath`/`revalidateTag` arguments, the exact false friend
 *     the WH-347 had three of;
 *   - `lib/permissions.ts`, whose ROUTE_CAPABILITY keys name routes to
 *     gate them, not to reach them;
 *   - `lib/ask/`, whose citations exist only inside an answer to the right
 *     question (see ASK_DIR);
 *   - a dynamic segment written as `[id]` rather than `${…}` — that is a
 *     route name in prose or a table, never a URL a browser can follow.
 *
 * It is a generous definition on purpose. It cannot prove a link is VISIBLE
 * (it could sit behind a condition that is never true); it proves the app
 * contains at least one way to produce the URL, which is the thing the
 * WH-347 did not have.
 *
 * CLAUDE.md's census rules, each asserted rather than assumed:
 *   - SIZE: the route set derived from the file walk must equal a count of
 *     `page.tsx` files taken a second, independent way; the literal set
 *     must be large and must contain a known link, so a scanner returning
 *     nothing fails instead of passing everything;
 *   - SCOPE: every top-level directory of apps/web holding source is either
 *     scanned or named below with its reason, so a new `features/` folder
 *     cannot hold the only link to a page (or the only page) unseen;
 *   - COMMENTS: a fixture proves a link in a comment does not count.
 */
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appSourceFiles, fileLiterals, sourceLiterals, type SourceLiteral } from "./source-literals";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(WEB, "app");

/** Where links can live. */
const SCANNED_ROOTS = ["app", "components", "lib"] as const;
/** Top-level directories holding source that are deliberately not scanned. */
const NOT_SCANNED: Record<string, string> = {
  e2e: "browser tests navigate by typing a URL; a test visiting a page is not a way in for a person",
  test: "test-only helpers for the suite itself (an in-memory Web Storage); nothing here renders, so a route named in it would be a fixture rather than a way in",
};

/** Pages with no inbound link that are reached from OUTSIDE the app. Each
 * entry must still exist and must still have no link — a route that gains
 * one fails here until it is removed from this list, so the list cannot
 * quietly outlive its reasons. */
const REACHED_FROM_OUTSIDE: Record<string, string> = {
  "/estimating": "a redirect kept for old bookmarks and Slack links; it forwards to /dashboard?status=ESTIMATE",
  "/jobs/new/[jobId]/review":
    "the bid wizard's old step 3, removed by #413 and kept as a redirect to /jobs/[id] so an open tab or history entry does not 404; delete the page and this line together",
  "/pilot": "the public pilot page, handed to prospects as a bare link",
  "/associations/wwcca":
    "the WWCCA member page, unlinked ON PURPOSE until the association approves the use of its name; shown to its committee as a bare link. app/associations/wwcca/page.test.ts fails if anything links to it",
  "/quickbooks/disconnected": "Intuit's disconnect landing URL, registered in Intuit's developer dashboard",
  "/sign-in/[[...sign-in]]": "Clerk's sign-in route, reached by Clerk's own redirects and the middleware",
  "/sign-up/[[...sign-up]]": "Clerk's sign-up route, reached by Clerk's own redirects",
};

/** Files whose literals name routes without linking to them. */
const NOT_LINKS = new Set([join(WEB, "lib/permissions.ts")]);
const NOT_LINK_CALLS = new Set(["revalidatePath", "revalidateTag"]);
/** The Ask assistant's citations. They ARE rendered as links — but only in
 * an answer to the one question that makes the model call that tool, so a
 * page reachable only that way is a page nobody finds. That is exactly how
 * `/union-compliance/remittance` passed the first version of this census:
 * its one "link" was `{ label: "Remittance", href: … }` in an Ask handler. */
const ASK_DIR = join(WEB, "lib/ask/");

type Route = { route: string; file: string };

function routeOf(pageFile: string): string {
  const dir = relative(APP, dirname(pageFile)).split("/").filter((seg) => seg && !/^\(.*\)$/.test(seg));
  return "/" + dir.join("/");
}

function routes(): Route[] {
  return appSourceFiles(APP)
    .filter((file) => file.endsWith("/page.tsx"))
    .map((file) => ({ route: routeOf(file), file }));
}

function linkPattern(route: string): RegExp {
  if (route === "/") return /^\/(?:[?#]|$)/;
  const segs = route
    .split("/")
    .slice(1)
    .map((seg) => (seg.startsWith("[") ? "\\$\\{\\}" : seg.replace(/[.*+?^$()|\\-]/g, "\\$&")));
  return new RegExp(`^/${segs.join("/")}(?:[?#]|$)`);
}

type Located = SourceLiteral & { file: string };

function allLinkCandidates(): Located[] {
  const out: Located[] = [];
  for (const root of SCANNED_ROOTS) {
    for (const file of appSourceFiles(join(WEB, root))) {
      if (NOT_LINKS.has(file) || file.startsWith(ASK_DIR)) continue;
      for (const literal of fileLiterals(file)) {
        if (literal.kind === "jsx-text") continue;
        if (literal.call && NOT_LINK_CALLS.has(literal.call)) continue;
        out.push({ ...literal, file });
      }
    }
  }
  return out;
}

function unlinked(pages: Route[], literals: Located[]): string[] {
  return pages
    .filter(({ route, file }) => {
      const pattern = linkPattern(route);
      return !literals.some((literal) => literal.file !== file && pattern.test(literal.text));
    })
    .map(({ route }) => route);
}

/** Independent of appSourceFiles: a plain recursive count of files named
 * exactly `page.tsx`, so the two walks have to agree. */
function countPageFiles(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countPageFiles(join(dir, entry.name));
    else if (entry.name === "page.tsx") n += 1;
  }
  return n;
}

const PAGES = routes();
const LITERALS = allLinkCandidates();

describe("every page has an inbound link", () => {
  it("the route walk found every page.tsx (size, against an independent count)", () => {
    expect(PAGES.length).toBe(countPageFiles(APP));
    expect(PAGES.length).toBeGreaterThanOrEqual(60);
  });

  it("the literal scan is not empty and sees a link it must see", () => {
    expect(LITERALS.length).toBeGreaterThan(10_000);
    expect(LITERALS.some((l) => l.text === "/dashboard")).toBe(true);
  });

  it("scans every top-level source directory, or says why not (scope)", () => {
    const withSource = readdirSync(WEB, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith("."))
      .filter((entry) => appSourceFiles(join(WEB, entry.name)).length > 0)
      .map((entry) => entry.name)
      .sort();
    expect(withSource).toEqual([...SCANNED_ROOTS, ...Object.keys(NOT_SCANNED)].sort());
    for (const root of SCANNED_ROOTS) {
      expect(appSourceFiles(join(WEB, root)).length, root).toBeGreaterThan(20);
    }
  });

  it("the Form WH-347 is linked from the certified-payroll sheet, carrying its week", () => {
    const sheet = join(APP, "(app)/jobs/[id]/certified-payroll/page.tsx");
    const links = fileLiterals(sheet).map((l) => l.text);
    expect(links).toContain("/jobs/${}/certified-payroll/wh-347?weekStart=${}");
  });

  it("the fringe remittance sheet is linked from /union-compliance, carrying its month", () => {
    const page = join(APP, "(app)/union-compliance/page.tsx");
    expect(fileLiterals(page).map((l) => l.text)).toContain("/union-compliance/remittance?month=${}");
  });

  it("no page is unreachable, except the ones reached from outside the app", () => {
    expect(unlinked(PAGES, LITERALS).sort()).toEqual(Object.keys(REACHED_FROM_OUTSIDE).sort());
  });

  it("every outside-reached exemption is still a real page", () => {
    const known = new Set(PAGES.map((p) => p.route));
    for (const route of Object.keys(REACHED_FROM_OUTSIDE)) expect(known.has(route), route).toBe(true);
  });
});

describe("what counts as a link", () => {
  const page: Route = { route: "/jobs/[id]/certified-payroll/wh-347", file: "/elsewhere/page.tsx" };
  const scan = (src: string) =>
    sourceLiterals(src, "/x/Fixture.tsx")
      .filter((l) => l.kind !== "jsx-text" && !(l.call && NOT_LINK_CALLS.has(l.call)))
      .map((l) => ({ ...l, file: "/x/Fixture.tsx" }));

  it("a real href counts", () => {
    expect(unlinked([page], scan("const a = <Link href={`/jobs/${id}/certified-payroll/wh-347?weekStart=${w}`}>x</Link>;"))).toEqual([]);
  });

  it("a link written only in a comment does not", () => {
    const src = [
      "// see `/jobs/${id}/certified-payroll/wh-347`",
      "/* <Link href={`/jobs/${id}/certified-payroll/wh-347`} /> */",
      "const a = 1;",
    ].join("\n");
    expect(unlinked([page], scan(src))).toEqual([page.route]);
  });

  it("a revalidatePath does not", () => {
    expect(unlinked([page], scan("revalidatePath(`/jobs/${jobId}/certified-payroll/wh-347`);"))).toEqual([page.route]);
  });

  it("a parent route's link does not count for its child, nor the child's for the parent", () => {
    const parent: Route = { route: "/jobs/[id]/certified-payroll", file: "/elsewhere/page.tsx" };
    expect(unlinked([page], scan("const a = <Link href={`/jobs/${id}/certified-payroll?weekStart=${w}`} />;"))).toEqual([page.route]);
    expect(unlinked([parent], scan("const a = <Link href={`/jobs/${id}/certified-payroll/wh-347`} />;"))).toEqual([parent.route]);
  });

  it("the page's own file does not link to itself", () => {
    const self: Route = { route: "/jobs/[id]/certified-payroll/wh-347", file: "/x/Fixture.tsx" };
    expect(unlinked([self], scan("const a = <Link href={`/jobs/${id}/certified-payroll/wh-347`} />;"))).toEqual([self.route]);
  });
});
