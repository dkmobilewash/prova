/**
 * No screen works out what DAY it is from the server's clock.
 *
 * THE DEFECT THIS EXISTS FOR. Every date in this app is stored at UTC
 * midnight and rendered in UTC, and that is right. But those stored values
 * are plain CALENDAR DAYS — the UTC midnight is only how a date with no
 * time gets into Postgres — so the day to compare one against is the day on
 * the READER'S wall calendar. `new Date().toISOString().slice(0, 10)` is
 * the SERVER'S day, and west of UTC it rolls over in the afternoon. For
 * seven hours of every day, every screen that derived its "today" that way
 * was a day ahead of the person reading it: a certification good until
 * today read EXPIRED, a message sent an hour ago read as never confirmed, a
 * bid due today read as past its date, and a foreman still on site at 5pm
 * found today already listed as a day nobody filed.
 *
 * `lib/viewerToday.ts` is the answer and has been since issue #111 — the
 * zone arrives as request data, so the day is worked out on the server and
 * hydration is unaffected (which `components/localToday.ts`, the other
 * helper, cannot promise; see its own header).
 *
 * ──────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS SHAPED THE WAY IT IS, which is the transferable part.
 *
 * It replaces a hand-written list. `app/(app)/correspondence-dates.test.ts`
 * carried a guard over exactly three pages, pinned with `toHaveLength(3)`,
 * and its own comment explained the choice: a glob that stopped matching
 * would leave the guard asserting nothing, so the files were named by hand.
 * That reasoning is half right and the half it misses is the expensive one.
 * At the moment it was written ELEVEN other pages carried the very
 * expression it bans, and the guard could not have said so, because a file
 * you did not put on the list is not a small set — it is not in the set at
 * all. It is `theme-contrast.test.ts` all over again (CLAUDE.md, 2026-09-16):
 * nothing is ever missing from a directory you do not walk.
 *
 * So the set is DERIVED, and the two things a derived check can get wrong
 * are asserted separately against sources that cannot drift with the
 * pattern:
 *
 *   SCOPE — what this file can SEE. Roots come from `apps/web/tsconfig.json`'s
 *   `include` (what the app compiles) plus the source directory of every
 *   `workspace:*` dependency in `apps/web/package.json` (what it imports).
 *   Add a package to the app and this census extends to it with no edit
 *   here; name a dependency that does not resolve and it FAILS rather than
 *   quietly scanning less.
 *
 *   SIZE — whether the walk actually walked. The file count from the
 *   recursive walk is required to equal what `git ls-files` reports for the
 *   same roots. Two independent mechanisms, so a bad filter, a wrong root
 *   or a silent `readdir` failure shows up as "walked 0 of 1171" instead of
 *   as a green run over nothing.
 *
 *   VACUITY — whether the finder can still find. A fixture that MUST match
 *   is parsed on every run, and every exempt file is required to still
 *   contain the thing it is exempt for.
 *
 * ──────────────────────────────────────────────────────────────────────
 * IT PARSES RATHER THAN GREPS, and that is also deliberate. CLAUDE.md's
 * newest scar is a guard that spelled a gap in its pattern as one literal
 * space and went green when a hand-written migration wrapped a line.
 * A regex over source has two more failure modes here: it matches the
 * expression inside a COMMENT (three files in this repo discuss it in
 * prose, including the one that fixed it) and it misses the expression
 * split across lines by a formatter. The TypeScript AST has neither —
 * comments are not nodes, and line breaks are not syntax.
 *
 * ──────────────────────────────────────────────────────────────────────
 * WHAT IT CANNOT CATCH, stated because an exemption list and a limits list
 * are the only honest parts of a census:
 *
 *   - the day taken in two steps — `const now = new Date();` then
 *     `now.toISOString().slice(0, 10)` somewhere else. That needs dataflow;
 *     this matches one expression. No instance exists today.
 *   - `serverToday()`, which is that expression behind a name. It is
 *     exempt below and deliberately so: CLAUDE.md records that its
 *     remaining callers are 30- and 60-day renewal horizons where a day
 *     either way is noise, and that moving them is "a change worth making
 *     deliberately, not a change worth making by sweep".
 *   - whether a page that no longer derives a day derives the RIGHT one.
 *     This file proves an absence. The presence is proved by rendering:
 *     `app/(app)/evening-dates.test.ts`,
 *     `app/(app)/correspondence-dates.test.ts` and
 *     `app/(app)/jobs/[id]/change-order-dates.test.ts` render fourteen
 *     screens at 17:01 in Los Angeles and read what they say.
 *   - anything a test file does. Test files are scanned for the size
 *     assertion and then excluded from the verdict; fixtures legitimately
 *     stamp a row with the current instant.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** apps/web. `process.cwd()` under this suite, but resolved from this
 * file so a runner started elsewhere cannot silently change the scope. */
const WEB_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const REPO_ROOT = resolve(WEB_ROOT, "..", "..");

/* ------------------------------------------------------------- scope */

/** The roots this census walks, derived rather than listed.
 *
 * `apps/web` itself comes from its tsconfig `include` — every glob there
 * is rooted at the package, so the package IS the root. The rest are the
 * workspace packages the app declares as dependencies: code that reaches
 * a page through an import is code that can decide what day it is. */
function scanRoots(): { roots: string[]; workspaceDeps: string[] } {
  // Read for the assertion below rather than for the walk: every include
  // glob has to live under the package, or "the package is the root"
  // stops being true and this whole derivation is wrong.
  const packageJson = JSON.parse(readFileSync(join(WEB_ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const workspaceDeps = Object.entries(declared)
    .filter(([, spec]) => spec.startsWith("workspace:"))
    .map(([name]) => name)
    .sort();

  // name -> directory, read off the packages themselves. A dependency that
  // does not resolve is a failure, not a root that silently goes missing.
  const byName = new Map<string, string>();
  const packagesDir = join(REPO_ROOT, "packages");
  for (const entry of readdirSync(packagesDir)) {
    const manifest = join(packagesDir, entry, "package.json");
    if (!existsSync(manifest)) continue;
    byName.set((JSON.parse(readFileSync(manifest, "utf8")) as { name: string }).name, join(packagesDir, entry));
  }

  const roots = [WEB_ROOT, ...workspaceDeps.map((name) => byName.get(name) ?? `<unresolved:${name}>`)];
  return { roots, workspaceDeps };
}

const { roots, workspaceDeps } = scanRoots();

const SOURCE_EXTENSIONS = [".ts", ".tsx"];
/** Never source, never tracked, and enormous. */
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "dist", ".git"]);

function walk(root: string): string[] {
  const found: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(join(dir, entry.name));
      } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        found.push(join(dir, entry.name));
      }
    }
  }
  return found.sort();
}

/** The same question asked of git, which knows nothing about the walk
 * above. Untracked build output is not source, so the two agree only when
 * the walk is actually walking. */
function tracked(root: string): string[] {
  const out = execFileSync(
    "git",
    ["-C", REPO_ROOT, "ls-files", "--cached", "--", `${relative(REPO_ROOT, root)}/`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return out
    .split("\n")
    .filter((line) => SOURCE_EXTENSIONS.some((ext) => line.endsWith(ext)))
    .map((line) => join(REPO_ROOT, line))
    .sort();
}

/* ------------------------------------------------------------ finder */

type DaySite = {
  file: string;
  line: number;
  /** The first argument of the `.slice()` applied to the ISO string, when
   * there is one. `0` means a calendar prefix — a DAY or a MONTH. */
  sliceStart: number | null;
  text: string;
};

/** Is this node the expression `new Date()` — no arguments, so "right
 * now"? `new Date(someValue)` is a stored date and is not this defect. */
function isBareNewDate(node: ts.Node): boolean {
  return (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "Date" &&
    (node.arguments === undefined || node.arguments.length === 0)
  );
}

/**
 * Every `new Date().toISOString()` in one file, with the slice applied to
 * it. Comments are not nodes and line breaks are not syntax, so neither
 * can hide a site or invent one.
 */
export function daySites(source: string, fileName = "input.tsx"): DaySite[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites: DaySite[] = [];

  const visit = (node: ts.Node): void => {
    // `<something>.toISOString()` where <something> is `new Date()`.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "toISOString" &&
      isBareNewDate(node.expression.expression)
    ) {
      // What is done with the ISO string decides whether this is a
      // calendar day at all. `.slice(0, 10)` is a day, `.slice(0, 7)` a
      // month; `.slice(11, 16)` is a clock time, which is a different
      // question and not this defect.
      let sliceStart: number | null = null;
      const parent = node.parent;
      if (
        parent !== undefined &&
        ts.isPropertyAccessExpression(parent) &&
        parent.name.text === "slice" &&
        parent.parent !== undefined &&
        ts.isCallExpression(parent.parent)
      ) {
        const first = parent.parent.arguments[0];
        if (first !== undefined && ts.isNumericLiteral(first)) sliceStart = Number(first.text);
      }
      sites.push({
        file: fileName,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        sliceStart,
        text: node.getText(sourceFile),
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return sites;
}

/** A calendar prefix of an ISO string: `slice(0, …)`. Anything else read
 * off the clock is a timestamp or a time of day, not a day. */
const isCalendarDay = (site: DaySite) => site.sliceStart === 0;

/* ------------------------------------------- the same defect, as a Date */

/**
 * The second shape, and the one a search for the string above misses
 * entirely: a bare `new Date()` handed to a function that compares it
 * against a stored UTC-midnight date.
 *
 * `daysPastDueFor(dueDate, asOf)` floors `asOf - dueDate` into whole days.
 * With `asOf` an INSTANT the answer depends on the time of day — 0 in the
 * morning, 1 after the UTC day rolls — which is how an $85,000 invoice due
 * today appeared on the dashboard's Overdue tile at 17:01 Pacific. There is
 * no `.toISOString()` anywhere in that bug, so it is invisible to
 * everything above.
 *
 * Named functions rather than a shape, because the argument has to MEAN a
 * calendar day for this to be wrong: plenty of code passes `new Date()`
 * somewhere entirely reasonable. `isOverdue` is deliberately not on this
 * list — four unrelated modules export that name and they do not all take
 * a day.
 */
const DAY_COMPARING_CALLS = new Set([
  "daysPastDueFor",
  "calculateArAgingInvoice",
  "calculateCashFlowForecast",
  "loadTodayDashboard",
]);

export function instantAsDaySites(source: string, fileName = "input.tsx"): DaySite[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites: DaySite[] = [];
  // `const now = new Date()` then `daysPastDueFor(due, now)` is the form
  // this actually takes in the wild, so one step of local dataflow is
  // worth having: every `const <name> = new Date()` in the file is
  // remembered, and an argument naming one counts.
  const clockBindings = new Set<string>();

  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isBareNewDate(node.initializer)) {
      clockBindings.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : null;
      if (callee !== null && DAY_COMPARING_CALLS.has(callee)) {
        for (const arg of node.arguments) {
          const fromClock = isBareNewDate(arg) || (ts.isIdentifier(arg) && clockBindings.has(arg.text));
          if (!fromClock) continue;
          sites.push({
            file: fileName,
            line: sourceFile.getLineAndCharacterOfPosition(arg.getStart(sourceFile)).line + 1,
            sliceStart: null,
            text: `${callee}(… ${arg.getText(sourceFile)})`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

/**
 * KNOWN REMAINING, and listed rather than fixed.
 *
 * `lib/ask/handlers.ts` has this defect three times — the RFI tool, the
 * outstanding-invoices tool and the cash-flow forecast tool all build
 * `const now = new Date()` and hand it to `daysPastDueFor`. It is the same
 * wrong answer as the dashboard's, reached through the Ask box, whose own
 * first suggested prompt on /dashboard is "What's overdue and who do I
 * chase first?".
 *
 * Not fixed here because the Ask tools are Diego's lane and CLAUDE.md's
 * working agreement is explicit: a bug in the other person's lane becomes a
 * GitHub issue assigned to them, not a PR. The file already imports
 * `viewerToday`, so the fix is small — it is ownership, not difficulty.
 *
 * This list can only shrink. A new entry means somebody added the defect
 * and wrote themselves a pass for it.
 */
const KNOWN_REMAINING = ["apps/web/lib/ask/handlers.ts"];

const isTestFile = (path: string) =>
  /\.(test|dbtest|eval)\.tsx?$/.test(path) || path.includes(`${sep}e2e${sep}`);

/* --------------------------------------------------------- exemptions */

/**
 * The only files allowed to work a calendar day out of the process clock,
 * each with the reason it is not the defect above. Kept deliberately short:
 * an exemption list is the one part of a census that rots the way the
 * hand-written list it replaced did, so each entry is asserted to still
 * exist AND to still contain a calendar-day site. An exemption that stopped
 * being needed fails this file rather than sitting here.
 */
const EXEMPT: { path: string; why: string }[] = [
  {
    path: "apps/web/lib/serverToday.ts",
    why:
      "The UTC day BEHIND A NAME, and its own header carries the argument. " +
      "CLAUDE.md records that its remaining callers are 30- and 60-day renewal " +
      "horizons where a day either way is the noise that comment describes, and " +
      "that moving them is a deliberate change rather than a sweep.",
  },
  {
    path: "apps/web/app/api/calendar/[token]/route.ts",
    why:
      "An .ics feed polled by Google Calendar and Outlook on their own schedule. " +
      "There is no viewer: no cookie, no browser, and the geo-IP header describes " +
      "a datacentre. viewerToday() would resolve to UTC here anyway, so calling it " +
      "would claim a reader this request does not have.",
  },
  {
    path: "apps/web/app/api/v1/jobs/[id]/schedule/route.ts",
    why:
      "A machine-to-machine API whose caller may pass ?today=YYYY-MM-DD, which " +
      "is the right seam for an integration in another zone. The UTC fallback " +
      "applies only when the caller did not say, and an API client is not a person " +
      "reading a screen.",
  },
];

const exemptPaths = new Set(EXEMPT.map((e) => e.path));

/* -------------------------------------------------------------- scan */

type Scanned = { path: string; sites: DaySite[]; instantSites: DaySite[] };

const scanned: Scanned[] = [];
const walked: string[] = [];
for (const root of roots) {
  const files = walk(root);
  walked.push(...files);
  for (const file of files) {
    const path = relative(REPO_ROOT, file).split(sep).join("/");
    const source = readFileSync(file, "utf8");
    scanned.push({ path, sites: daySites(source, path), instantSites: instantAsDaySites(source, path) });
  }
}

const instantViolations = scanned
  .filter((f) => !isTestFile(f.path) && !KNOWN_REMAINING.includes(f.path))
  .flatMap((f) => f.instantSites.map((s) => `${f.path}:${s.line}  ${s.text}`))
  .sort();

const calendarSites = scanned.flatMap((f) =>
  f.sites.filter(isCalendarDay).map((site) => ({ ...site, path: f.path })),
);
const productionCalendarSites = calendarSites.filter((s) => !isTestFile(s.path));
const violations = productionCalendarSites.filter((s) => !exemptPaths.has(s.path));

describe("scope — what this census can see", () => {
  it("walks apps/web and every workspace package it depends on", () => {
    expect(workspaceDeps).toEqual(["@prova/db", "@prova/integrations", "@prova/ui"]);
    // One root per workspace dependency, plus the app itself. Adding a
    // package to apps/web extends the census with no edit to this file;
    // this is the assertion that says so out loud.
    expect(roots).toHaveLength(workspaceDeps.length + 1);
    for (const root of roots) {
      expect(root.startsWith("<unresolved:"), `unresolved workspace dependency: ${root}`).toBe(false);
      expect(existsSync(root), `scan root does not exist: ${root}`).toBe(true);
      expect(statSync(root).isDirectory()).toBe(true);
    }
  });

  it("every tsconfig include glob is inside the package, so the package is the root", () => {
    const tsconfig = JSON.parse(readFileSync(join(WEB_ROOT, "tsconfig.json"), "utf8")) as {
      include: string[];
    };
    expect(tsconfig.include.length).toBeGreaterThan(0);
    for (const glob of tsconfig.include) {
      expect(glob.startsWith("/"), `absolute include glob: ${glob}`).toBe(false);
      expect(glob.startsWith(".."), `include glob escapes the package: ${glob}`).toBe(false);
    }
  });
});

describe("size — whether the walk actually walked", () => {
  it("walked every source file git has tracked under the same roots", () => {
    const fromGit = roots.flatMap(tracked).sort();
    const walkedSet = new Set(walked);
    // Independent mechanisms: a recursive readdir checked against git's
    // index, which knows nothing about the walk. A wrong root, a broken
    // extension filter or a swallowed readdir error names the files it
    // missed, rather than letting the scan below pass over nothing.
    //
    // ONE-DIRECTIONAL on purpose. A file git has and the walk does not is
    // the failure. A file the walk has and git does not is just work in
    // progress — it is scanned too, which is what you want, and making
    // that red would put this test in the noise every time somebody adds
    // a file.
    const missed = fromGit.filter((file) => !walkedSet.has(file));
    expect(missed, "tracked source files the walk did not reach").toEqual([]);
    expect(fromGit.length).toBeGreaterThan(500);
    expect(walked.length).toBeGreaterThanOrEqual(fromGit.length);
  });

  it("parsed every file it walked", () => {
    expect(scanned).toHaveLength(walked.length);
  });
});

describe("vacuity — whether the finder can still find", () => {
  it("matches the expression this file exists to ban", () => {
    const sites = daySites('const today = new Date().toISOString().slice(0, 10);');
    expect(sites).toHaveLength(1);
    expect(sites[0].sliceStart).toBe(0);
  });

  it("matches it across a line break, which a regex over source would not", () => {
    const sites = daySites('const today = new Date()\n  .toISOString()\n  .slice(\n    0,\n    10,\n  );');
    expect(sites).toHaveLength(1);
    expect(sites[0].sliceStart).toBe(0);
  });

  it("is not fooled by the expression written in a comment", () => {
    // Three files in this repo discuss this expression in prose, including
    // the one that fixed it. A grep counts all three as offenders.
    expect(daySites('// was: new Date().toISOString().slice(0, 10)\nconst x = 1;')).toHaveLength(0);
    expect(daySites('/** `new Date().toISOString()` was the bug. */\nconst x = 1;')).toHaveLength(0);
  });

  it("leaves a date that came from a record alone", () => {
    expect(daySites('const d = new Date(row.dueAt).toISOString().slice(0, 10);')).toHaveLength(0);
    expect(daySites('const d = new Date(`${iso}T00:00:00.000Z`).toISOString();')).toHaveLength(0);
  });

  it("matches the instant-as-a-day form, direct and one binding away", () => {
    expect(instantAsDaySites("const n = daysPastDueFor(due, new Date());")).toHaveLength(1);
    expect(instantAsDaySites("const now = new Date();\nconst n = daysPastDueFor(due, now);")).toHaveLength(1);
    // A day the caller worked out properly is not this defect.
    expect(instantAsDaySites("const n = daysPastDueFor(due, await viewerAsOf());")).toHaveLength(0);
    expect(instantAsDaySites("const n = daysPastDueFor(due, asOf);")).toHaveLength(0);
    // Neither is `new Date()` somewhere it belongs.
    expect(instantAsDaySites("const n = formatInstant(new Date());")).toHaveLength(0);
  });

  it("found the sites that are known to be there", () => {
    // The floor is the exemptions: if the scan returns fewer calendar
    // sites than there are exempt files, it stopped working and every
    // "no violations" assertion below is vacuous.
    expect(productionCalendarSites.length).toBeGreaterThanOrEqual(EXEMPT.length);
  });
});

describe("exemptions — each one still load-bearing", () => {
  it.each(EXEMPT.map((e) => e.path))("%s exists and still derives a calendar day", (path) => {
    expect(existsSync(join(REPO_ROOT, path)), `exempt file is gone: ${path}`).toBe(true);
    const sites = productionCalendarSites.filter((s) => s.path === path);
    expect(sites.length, `exemption no longer needed — delete it: ${path}`).toBeGreaterThan(0);
  });

  it("stays short", () => {
    // Not a round number: three is what the app needs, and a fourth should
    // be an argument somebody has to make rather than a line they add.
    expect(EXEMPT).toHaveLength(3);
  });
});

describe("the verdict", () => {
  it("no screen works out what day it is from the server's clock", () => {
    const named = violations.map((v) => `${v.path}:${v.line}  ${v.text}`).sort();
    expect(named).toEqual([]);
  });

  it("nothing hands the current instant to a function that wants a day", () => {
    expect(instantViolations).toEqual([]);
  });

  it("the one file still doing it is the one named as still doing it", () => {
    // Anti-vacuity for the check above, and the reason this list is worth
    // having: if `instantAsDaySites` stopped finding anything, the
    // assertion above would pass on an empty set and nobody would know.
    // This requires the known offender to still be found.
    const found = scanned.filter((f) => f.instantSites.length > 0).map((f) => f.path);
    for (const path of KNOWN_REMAINING) {
      expect(found, `known-remaining file no longer matches — delete the entry: ${path}`).toContain(path);
    }
    expect(KNOWN_REMAINING).toHaveLength(1);
  });

  it("records the clock reads that are NOT a calendar day, so they cannot grow quietly", () => {
    // `.slice(11, 16)` is a time of day, not a date, so it is outside this
    // file's rule — and it is its own defect, since a QuickBooks
    // reconciliation stamped "checked at 00:04" for a contractor who ran
    // it at 5pm. Recorded rather than fixed here: it is one line in an
    // integrations component, it changes no stored value, and it is not
    // what this PR is about. Listed by name so the next person finds it.
    const other = scanned
      .filter((f) => !isTestFile(f.path))
      .flatMap((f) => f.sites.filter((s) => !isCalendarDay(s)).map((s) => `${f.path}:${s.line}`))
      .sort();
    expect(other).toEqual(["apps/web/components/QuickBooksReconcile.tsx:59"]);
  });
});
