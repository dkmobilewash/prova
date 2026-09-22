import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * NO PAGE DECIDES ITS OWN WIDTH.
 *
 * Measured in Chrome on the deployed app, 2026-09-21, at a content area of
 * **1272 x 632**: `/settings` ran a single 768px column down the middle of
 * it, wasted 504px of side space, and took 5.69 screens. (Screens-to-scroll
 * is page height over viewport height, so the port is quoted with it — an
 * earlier figure of "4.7 screens" for this same page was taken at an
 * unstated, shorter height and is not reproducible from this one.)
 *
 * The cause was not one bad page. **55 of the 73 route files under `app/`
 * centred and capped their own column**; among the 59 `app/(app)` pages,
 * **49 did, making 65 separate width decisions** in nine different cap
 * tokens. Each was defensible on its own page and collectively they were a
 * product using 60% of the screen. `packages/ui/src/PageShell.tsx` replaces
 * the numbers with three intents (`reading`, `working`, `split`).
 *
 * Without this file, pages drift back to ad-hoc caps inside a month: nothing
 * about `mx-auto max-w-2xl` looks wrong in a diff, and it is the single
 * easiest thing to type when a new page needs a container.
 *
 * THE OFFENCE IS SPECIFICALLY THE PAGE-CONTAINER IDIOM — a class string
 * holding both `mx-auto` and `max-w-*` — and not `max-w-*` on its own. A cap
 * on a truncating span (`max-w-[16rem]`) or a hint paragraph (`max-w-md`) is
 * a content decision inside a column and is none of this file's business.
 * `mx-auto max-w-…` is the thing that centres a column and decides how wide
 * the page is, which is the decision the shell now owns. All 72 of those in
 * the tree when this landed are the shape this census names.
 *
 * The shell itself is outside this walk by construction — `PageShell.tsx`
 * lives in `packages/ui` and emits the very class string this file fails
 * route files for. That is the right boundary, and it is the same boundary
 * the `theme-contrast.test.ts` scar was about, so it is written down in that
 * file's own header rather than left to be rediscovered.
 *
 * TWO FAILURE MODES, NOT ONE — CLAUDE.md's rule for anything that derives the
 * set it reasons about, and both are asserted below rather than assumed:
 *
 *   SIZE. A class-string regex is one line break away from matching nothing,
 *   and a census that finds no offenders passes. So every `max-w-` occurrence
 *   is counted TWICE — once as a bare literal in the source, once through the
 *   parse — and the two must be equal. `scratch-cleanup-order.test.ts` was
 *   green while silently losing an entry to exactly this (180 of 181 foreign
 *   keys, the missing one the blocker it existed to catch).
 *
 *   SCOPE. `theme-contrast.test.ts` had the right pattern and the wrong root
 *   for a month, so the one offending file in the repo was never a candidate.
 *   Nothing is ever missing from a directory you do not walk. So the file set
 *   is derived twice from independent sources — a filesystem walk, and
 *   `git ls-files` — and every tracked page must appear in the walk.
 *
 * One hole named rather than papered over: a page could move its cap into a
 * component it renders, and this census would not see it, because components
 * use `mx-auto max-w-…` legitimately for inner content. That is a deliberate
 * dodge rather than drift, and it is what review is for.
 */

const appDir = fileURLToPath(new URL("..", import.meta.url));

/** The worktree root. `git ls-files` prints paths relative to it, and so does
 * everything below, so the two derivations are comparable and the failure
 * messages name something a person can open. */
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: appDir,
  encoding: "utf8",
}).trim();

/** Next's routable entry points. `layout.tsx` is in scope with `page.tsx`
 * because a layout capping the width is the same decision made one level up —
 * `jobs/[id]/(tabs)/layout.tsx` is on the list below for exactly that. */
const ROUTE_FILES = new Set(["page.tsx", "layout.tsx"]);

/** The directory every route in this app lives under. Asserted to exist
 * below: a root that resolves to nothing removes files from this check
 * without removing them from the build. */
const ROUTE_ROOT = resolve(appDir, "app");

function walkRouteFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkRouteFiles(full, out);
    else if (ROUTE_FILES.has(name)) out.push(relative(repoRoot, full).split(sep).join("/"));
  }
  return out;
}

/** Comments stripped for the reason `rowActionsCensus.test.ts` strips them: a
 * paragraph explaining a class name is not a class name, and a scan that
 * reads its own documentation answers a question nobody asked. This file's
 * own header names `mx-auto max-w-2xl`, and would otherwise be an offender. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** One class string — quoted or backticked, never spanning a newline, so a
 * single `className` cannot swallow the one after it. */
const CLASS_STRING = /(["`])([^"`\n]*\bmax-w-[^"`\n]*)\1/g;
const MAX_W = /\bmax-w-/g;

type Scanned = {
  path: string;
  /** Class strings that centre AND cap — the page-container idiom. */
  containerCaps: string[];
  /** Every `max-w-` the parse saw, container or not. Counted for the size
   * assertion, never judged. */
  parsedOccurrences: number;
  /** Every `max-w-` in the source text, found without the class-string regex.
   * The independent number the parse is held to. */
  literalOccurrences: number;
  rendersShell: boolean;
};

function scan(): Scanned[] {
  return walkRouteFiles(ROUTE_ROOT).map((path) => {
    const source = withoutComments(readFileSync(join(repoRoot, path), "utf8"));
    const containerCaps: string[] = [];
    let parsedOccurrences = 0;
    for (const match of source.matchAll(CLASS_STRING)) {
      const classes = match[2];
      parsedOccurrences += (classes.match(MAX_W) ?? []).length;
      if (/\bmx-auto\b/.test(classes)) containerCaps.push(classes.trim());
    }
    return {
      path,
      containerCaps,
      parsedOccurrences,
      literalOccurrences: (source.match(MAX_W) ?? []).length,
      rendersShell: /<PageShell\b/.test(source),
    };
  });
}

/**
 * THE PAGES STILL DECIDING THEIR OWN WIDTH, LISTED ONE BY ONE SO THE LIST CAN
 * ONLY SHRINK.
 *
 * 55 route files carried a page-container cap when `PageShell` landed. Three
 * were converted as the proof set — one per intent — leaving these 52.
 *
 * An explicit list rather than a pattern, because a pattern that tolerates
 * "pages not yet converted" tolerates the next new page too, and the whole
 * point is that a NEW ad-hoc cap fails immediately while the existing backlog
 * is allowed to drain. Three assertions below make this a ratchet: a path
 * must still exist, and must still have a cap, so converting a page WITHOUT
 * deleting its line here is a build failure. The list cannot grow silently
 * either — `.length` is pinned to a literal.
 *
 * The follow-up sweep deletes lines from here. When it is empty, delete the
 * list and the two assertions that reference it.
 *
 * Six lanes were being edited in parallel when this shipped, which is why the
 * proof set is three pages and not fifty-nine.
 */
const UNCONVERTED_PAGES = [
  "apps/web/app/(app)/alerts/page.tsx",
  "apps/web/app/(app)/ask/page.tsx",
  "apps/web/app/(app)/backcharges/page.tsx",
  "apps/web/app/(app)/bids/page.tsx",
  "apps/web/app/(app)/cash-flow/page.tsx",
  "apps/web/app/(app)/catalog/page.tsx",
  "apps/web/app/(app)/certifications/page.tsx",
  "apps/web/app/(app)/closeout/page.tsx",
  "apps/web/app/(app)/compliance/page.tsx",
  "apps/web/app/(app)/contacts/[id]/page.tsx",
  "apps/web/app/(app)/contacts/page.tsx",
  "apps/web/app/(app)/dashboard/page.tsx",
  "apps/web/app/(app)/deployment/page.tsx",
  "apps/web/app/(app)/drawings/page.tsx",
  "apps/web/app/(app)/equipment/page.tsx",
  "apps/web/app/(app)/field-reports/page.tsx",
  "apps/web/app/(app)/intake/page.tsx",
  "apps/web/app/(app)/internal/usage/page.tsx",
  "apps/web/app/(app)/jobs/[id]/(tabs)/layout.tsx",
  "apps/web/app/(app)/jobs/[id]/certified-payroll/page.tsx",
  "apps/web/app/(app)/jobs/[id]/certified-payroll/wh-347/page.tsx",
  "apps/web/app/(app)/jobs/[id]/pay-applications/[invoiceId]/page.tsx",
  "apps/web/app/(app)/jobs/[id]/photo-report/page.tsx",
  "apps/web/app/(app)/jobs/new/[jobId]/items/page.tsx",
  "apps/web/app/(app)/jobs/new/page.tsx",
  "apps/web/app/(app)/lien-deadlines/page.tsx",
  "apps/web/app/(app)/material-orders/page.tsx",
  "apps/web/app/(app)/messages/page.tsx",
  "apps/web/app/(app)/phase-codes/page.tsx",
  "apps/web/app/(app)/photos/page.tsx",
  "apps/web/app/(app)/pipeline/page.tsx",
  "apps/web/app/(app)/prevailing-wage/page.tsx",
  "apps/web/app/(app)/rfis/page.tsx",
  "apps/web/app/(app)/safety/page.tsx",
  "apps/web/app/(app)/sales/[id]/page.tsx",
  "apps/web/app/(app)/sales/page.tsx",
  "apps/web/app/(app)/schedule/page.tsx",
  "apps/web/app/(app)/settings/assistant/page.tsx",
  "apps/web/app/(app)/settings/export/page.tsx",
  "apps/web/app/(app)/settings/import/page.tsx",
  "apps/web/app/(app)/settings/integrations/page.tsx",
  "apps/web/app/(app)/submittals/page.tsx",
  "apps/web/app/(app)/team/page.tsx",
  "apps/web/app/(app)/union-compliance/page.tsx",
  "apps/web/app/(app)/union-compliance/remittance/page.tsx",
  "apps/web/app/(app)/vendors/pricing/page.tsx",
  "apps/web/app/esign/[token]/page.tsx",
  // `apps/web/app/page.tsx` — the public marketing page — WAS here, with the
  // note that it was "being rewritten in #404 as this landed". #404 landed
  // and converted it, so the line is gone and the count below dropped by one.
  // The list only shrinks; that is the whole discipline.
  //
  // ITS OTHER HALF IS WHY THIS CENSUS WALKS THE FILESYSTEM, and that lesson
  // outlives the entry. The pre-scan that built this list used
  // `git ls-files 'apps/web/app/**/page.tsx'`, whose `**/` requires at least
  // one directory, so a route file at the ROOT of `app/` was never a
  // candidate and the list was written one short. The walk found it on the
  // first run. Nothing is ever missing from a directory you do not walk —
  // including the one you thought you were walking.
  "apps/web/app/pilot/page.tsx",
  "apps/web/app/portal/[token]/jobs/[jobId]/page.tsx",
  "apps/web/app/portal/[token]/page.tsx",
] as const;

/**
 * THE PROOF SET — one page per intent, named so that the shell cannot become
 * "written, documented, and never called".
 *
 * CLAUDE.md records three live instances of that shape found in a single day,
 * every one of them green: a helper whose call site still used the value it
 * replaced, a column nothing read, 161 tests no runner referenced. A primitive
 * with passing unit tests and no call sites is the same thing wearing a nicer
 * name, so these assert the app actually renders it.
 */
const CONVERTED_PAGES = {
  "apps/web/app/(app)/settings/page.tsx": "reading",
  "apps/web/app/(app)/vendors/page.tsx": "working",
  "apps/web/app/(app)/punch-lists/page.tsx": "split",
} as const;

describe("page width census", () => {
  const scanned = scan();
  const byPath = new Map(scanned.map((file) => [file.path, file]));

  it("walks a root that exists and finds route files in it", () => {
    expect(
      existsSync(ROUTE_ROOT) && statSync(ROUTE_ROOT).isDirectory(),
      `${ROUTE_ROOT} does not exist — this census would scan nothing and pass ` +
        `everything below it`,
    ).toBe(true);
    expect(scanned.length).toBeGreaterThan(50);
  });

  /** SCOPE, from a source that cannot drift with the walk.
   *
   * `git ls-files` knows what is in the tree without knowing anything about
   * how this file iterates directories, so a walk that starts one level too
   * deep, skips a route group whose name begins with a bracket, or quietly
   * stops at a symlink fails here by name. The check is one-directional on
   * purpose: an uncommitted new page IS scanned (the walk sees it) and simply
   * is not yet in git, which must not be a test failure. */
  it("sees every route file git is tracking", () => {
    const tracked = execFileSync("git", ["ls-files", "--", "apps/web/app"], {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .split("\n")
      .filter((path) => ROUTE_FILES.has(path.slice(path.lastIndexOf("/") + 1)));

    expect(
      tracked.length,
      "git reports no route files under apps/web/app, so this cross-check " +
        "would confirm nothing about the walk",
    ).toBeGreaterThan(50);

    const missing = tracked.filter((path) => !byPath.has(path));
    expect(
      missing,
      `the walk missed ${missing.length} tracked route file(s) — a file outside ` +
        `the walk is not a small set, it is not in the set at all`,
    ).toEqual([]);
  });

  /** SIZE, from a source that cannot drift with the pattern.
   *
   * The literal count needs no regex over class strings at all, so if
   * `CLASS_STRING` stops matching — a `className` broken across lines by a
   * formatter, a new quoting style — the totals separate and this names the
   * file. Equality rather than a floor: every `max-w-` in these files today
   * sits inside a single-line quoted class string, and an occurrence the
   * parse cannot see is exactly the thing that would make the verdict below
   * meaningless. */
  it("parses every max-w- occurrence it can see in the source", () => {
    for (const file of scanned) {
      expect(
        file.parsedOccurrences,
        `${file.path}: the source contains ${file.literalOccurrences} ` +
          `max-w- occurrence(s) and the class-string parse found ` +
          `${file.parsedOccurrences}. The scanner is blind to one of them, so ` +
          `its verdict on this file means nothing.`,
      ).toBe(file.literalOccurrences);
    }
    const total = scanned.reduce((sum, file) => sum + file.literalOccurrences, 0);
    expect(
      total,
      "no route file mentions max-w- at all, which has never been true in this " +
        "repo and means the scan read nothing",
    ).toBeGreaterThan(0);
  });

  it("allows exactly the pages that have not been converted yet", () => {
    expect(
      UNCONVERTED_PAGES.length,
      "the allowance list changed size. It is allowed to SHRINK as pages move " +
        "to PageShell — delete the line. Adding a line puts a new page back on " +
        "its own width decision, which is the thing this census exists to stop.",
      // 52 at the base both branches forked from. Main took the root landing
      // page (`app/page.tsx`) off; #413 removed the bid wizard's "Review"
      // step — the page is a bare `redirect()` now and sets no width at all,
      // so it leaves the list the way the list is meant to be left. The
      // ratchet below is what caught it: a converted page left on this list
      // is a build failure, and a page that stopped existing as a page counts
      // as converted for that purpose. Both removals together: 50.
    ).toBe(50);
    expect(new Set(UNCONVERTED_PAGES).size).toBe(UNCONVERTED_PAGES.length);
  });

  /** The ratchet. A page that was converted but left on the list above would
   * otherwise sit there forever as a permanent exemption, and a renamed or
   * deleted page would leave a line nobody can act on — which is how an
   * allowance list stops being a worklist and becomes scenery. */
  it("holds nothing on the allowance list that no longer needs allowing", () => {
    for (const path of UNCONVERTED_PAGES) {
      const file = byPath.get(path);
      expect(file, `${path} is on the allowance list and no longer exists — remove the line`).toBeDefined();
      expect(
        file!.containerCaps.length,
        `${path} no longer sets its own width. Delete it from UNCONVERTED_PAGES ` +
          `and drop the count by one — the list only shrinks.`,
      ).toBeGreaterThan(0);
    }
  });

  /** The verdict. Everything above exists so that a green here means
   * something. */
  it("lets no other page set its own width", () => {
    const allowed = new Set<string>(UNCONVERTED_PAGES);
    const offenders = scanned
      .filter((file) => file.containerCaps.length > 0 && !allowed.has(file.path))
      .map((file) => `${file.path} — ${file.containerCaps.join(" | ")}`);

    expect(
      offenders,
      "these route files centre and cap their own column. A page declares what " +
        "KIND of page it is and the shell owns the pixels: import { PageShell } " +
        'from "@prova/ui" and wrap the page in <PageShell width="reading"> (a ' +
        'form or a document), "working" (a list or a table), or "split" (a thing ' +
        "and the thing it feeds).",
    ).toEqual([]);
  });

  /** The other half: the shell is imported, rendered, and reachable. A
   * primitive nothing calls typechecks, lints and tests green forever. */
  it("renders the shell on every page it converted", () => {
    for (const [path, intent] of Object.entries(CONVERTED_PAGES)) {
      const file = byPath.get(path);
      expect(file, `${path} is named as a converted page and was not scanned`).toBeDefined();
      expect(file!.rendersShell, `${path} no longer renders <PageShell>`).toBe(true);
      expect(
        file!.containerCaps,
        `${path} is back to centring and capping its own column`,
      ).toEqual([]);
      expect(
        new RegExp(`width=(["'])${intent}\\1`).test(readFileSync(join(repoRoot, path), "utf8")),
        `${path} is the proof that width="${intent}" is used by something. If the ` +
          `page legitimately changed intent, move this entry rather than deleting ` +
          `it — all three intents need a real caller.`,
      ).toBe(true);
    }
    expect(new Set(Object.values(CONVERTED_PAGES)).size, "all three intents need a caller").toBe(3);
  });

  it("exports the shell from the package the pages import", () => {
    const barrel = readFileSync(resolve(repoRoot, "packages/ui/src/index.ts"), "utf8");
    expect(barrel).toMatch(/export \{[^}]*\bPageShell\b/);
  });
});
