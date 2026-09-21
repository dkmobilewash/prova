import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No hours figure reaches a screen without going through
 * `lib/render-hours.ts`.
 *
 * WHY. `TimeEntry.hours` is `Decimal(5,2)`; every total on a payroll or
 * compliance page is a floating-point SUM of many of them, and
 * `7 + 7 + 7 + 7.1 + 7.2` is `35.300000000000004`. The certified-payroll
 * page printed exactly that, to an audience who check arithmetic for a
 * living and then file the result with a government agency.
 *
 * WHY A CENSUS AND NOT FIVE FIXES. This bug had ALREADY been found and
 * fixed twice before the certified-payroll page printed it — `hoursCell`
 * on the WH-347 page and `formatLoggedHours` in `lib/wip.ts` (issue #287)
 * are both older than the defect, both correct, and neither stopped it.
 * A fix at a call site protects that call site and nothing else. Same
 * shape, and same answer, as `dateRenderCensus.test.ts` next door.
 *
 * ---------------------------------------------------------------------
 * A CHECK THAT DERIVES ITS INPUT HAS TWO FAILURE MODES, AND ONLY ONE OF
 * THEM LOOKS LIKE A FAILURE (CLAUDE.md). This file can get the answer
 * wrong, and it can be asked an empty question. So two things are pinned
 * to sources that cannot drift with the scan:
 *
 *   - ITS SCOPE, to `git ls-files`. Nothing is ever missing from a
 *     directory you do not walk — the `theme-contrast.test.ts` scar, where
 *     the pattern was fine, the size assertion was fine, and the one
 *     offending file in the repo was not under the scanned root.
 *   - ITS SIZE, to a `git grep -o` count of the formatter call sites, run
 *     by git over the raw bytes with no brace parsing and no comment
 *     stripping. If the brace scanner below silently stops matching, its
 *     formatted set collapses to nothing while git's count does not, and
 *     this file goes red with both numbers in the message. That is the
 *     `scratch-cleanup-order.test.ts` scar (180 foreign keys parsed out of
 *     181, thirteen tests green).
 *
 * ---------------------------------------------------------------------
 * WHAT THIS CENSUS CANNOT SEE, stated because an unstated blind spot is
 * how the next one of these gets trusted too far. It finds hours by the
 * NAME of the thing being rendered. An hours value under a generic name is
 * invisible to it — `splitLabel(split)` in `components/prevailingWageLabels.ts`
 * and `StandingNote`'s `done`/`required` props were both real instances of
 * this defect carrying no "hours" in the identifier, and both were found by
 * reading, not by this file. Renaming is not the fix; knowing the limit is.
 */

const WEB_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(WEB_ROOT, "../..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "dist", "coverage"]);

/** The one module every rendered hours figure must go through. */
const FORMATTER_MODULE = "lib/render-hours.ts";

/**
 * Calls that render hours acceptably.
 *
 *   - `formatHours` / `formatHoursOrNull` — the shared implementation.
 *   - `formatLoggedHours` — `lib/wip.ts`'s alias for it (issue #287's
 *     name, kept so the WIP call sites read in their own vocabulary).
 *   - `hoursCell` — each certified-payroll page's one-line local wrapper,
 *     which only decides what an EMPTY cell looks like; the rounding is
 *     `formatHoursOrNull`'s. `hasOneImplementation` below is what stops
 *     that name being used to smuggle a fourth copy of the arithmetic in.
 *   - `thresholdLabel` — deliberately a DIFFERENT format ("8.00", not
 *     "8"): it renders a rule-set threshold, which is a configured
 *     constant rather than a sum, and prints with the trailing zeroes a
 *     wage determination is written with.
 *   - `money` — that figure is dollars, not hours.
 */
const APPROVED = ["formatHoursOrNull", "formatHours", "formatLoggedHours", "hoursCell", "thresholdLabel", "money"];

/**
 * Renders that are NOT an hours number, each with the reason on record —
 * the `OPEN_PROVIDER_REASONS` shape this codebase already uses, where the
 * absence of a formatter is a decision rather than a default.
 *
 * Keyed by the file and the EXACT expression, never by line number: a line
 * number goes stale the moment anything above it moves, and an exemption
 * that silently follows the wrong line is worse than none. Change the
 * expression and the entry stops matching, which fails the orphan check
 * below and forces the decision to be made again.
 */
const NOT_AN_HOURS_NUMBER: Record<string, string> = {
  // -- a COUNT that happens to have "hours" in its name --
  "app/(app)/catalog/page.tsx\t{actuals.linesExcludedUnpricedHours}":
    "A count of catalog LINES excluded for having unpriced hours, not a quantity of hours. lib/catalog-actuals.ts: finished.length - priced.length.",
  "lib/change-order.ts\t{hours}":
    "A count of TimeEntry rows referencing the change order ('3 entries reference'), not a duration.",
  "lib/ask/handlers.ts\t{Math.round((labor.pricedHours / hours) * 100)}":
    "A percentage, already integer-rounded by Math.round.",

  // -- already a string by the time it is rendered --
  "app/(app)/catalog/page.tsx\t{entry.defaultLaborHours.toString()}":
    "Prisma Decimal(5,2) stringified. A Decimal is exact — it never carries binary float drift, so there is nothing to round.",
  "components/DelayLog.tsx\t{d.hoursLost}":
    "Already a string: the field-reports page passes String(Number(d.hoursLost)) from a Decimal column.",
  "components/TimeEntryRow.tsx\t{entry.hours}":
    "Already a string: the crew tab passes String(Number(entry.hours)) from a Decimal column.",
  "components/TimesheetSignoffs.tsx\t{row.totalHours}":
    "Already a string: the crew tab passes String(Number(signoff.totalHours)) from a Decimal column.",
  "lib/actions/changeOrders.ts\t{Number(delay.hoursLost)}":
    "Decimal(5,2) from one row, not a sum — exact, and the surrounding string is an audit note rather than a screen.",
  "lib/payroll-register-import.ts\t{hoursRaw}":
    "The raw cell text off the imported CSV, echoed back in a parse error so the user can see what they typed.",

  // -- user input echoed back, where rounding would change what they typed --
  "components/CatalogImport.tsx\t{row.laborHours ?? \"—\"}":
    "A number parsed straight from one CSV cell in the import preview. No arithmetic has touched it, and the preview's job is to show what the file says.",

  // -- the formatter definitions themselves --
  "components/prevailingWageLabels.ts\t{hours % 1 === 0 ? hours : hours.toFixed(2)}":
    "thresholdLabel's own body — the deliberate second format, see APPROVED above.",

  // -- rounded at the point the number is produced --
  "lib/alerts.ts\t{job.worstExcessHours}":
    "round2()'d at source in lib/apprentice-ratio.ts before it is ever put on the alert.",
  "lib/manpower.ts\t{m.hours}": "summarizeManpower rounds every figure it emits (lib/manpower.ts).",
  "lib/manpower.ts\t{c.hours}": "summarizeManpower rounds every figure it emits (lib/manpower.ts).",

  // -- Ask's own text, Diego's lane; each already rounded where produced --
  "lib/ask/commands/labor.ts\t{input.hours}":
    "Ask echoing back the hours the user just typed in their own message, before any arithmetic.",
  "lib/ask/commands/labor.ts\t{hours}":
    "Ask echoing back the parsed figure from the user's own message (lib/ask/numbers.ts parseHours).",
  "lib/ask/transcript.ts\t{hours}": "Ask transcript echo of a parsed user figure, not a computed total.",
};

// ------------------------------------------------------------------ scan --

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|dbtest)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** The same source files, according to git. Untracked files count: a new
 * page that has not been committed yet still renders. */
function sourceFilesByGit(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", "apps/web"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter((path) => /\.tsx?$/.test(path) && !/\.(test|dbtest)\.tsx?$/.test(path))
    .filter((path) => ![...SKIP_DIRS].some((dir) => path.includes(`/${dir}/`)));
}

/**
 * Comments blanked, strings left intact and newlines preserved so the line
 * numbers this file reports are real. Lifted deliberately from
 * `dateRenderCensus.test.ts` rather than written again — its own comment
 * records why the two-regex version of this is wrong in a way that passes
 * (`//[^\n]*` eats the second half of every "https://…" in the file).
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          out += source[i] + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** An identifier with "hours" or "hrs" anywhere in it — `totalHours`,
 * `hoursByPayType`, `hrsWorked`, or the bare `hours`. Written to match the
 * token ANYWHERE in the name rather than at the end: the first draft of
 * this file anchored it and silently missed `hoursByPayType`, which is one
 * of the five sites the census was written for. */
const HOURS_IDENT = /\b[\w$]*(?:[Hh]ours|[Hh]rs)[\w$]*\b/;

/** A single-line `{…}` with no nested brace. Covers both a JSX expression
 * container and a `${…}` template substitution, which is the same syntax
 * with a dollar in front and the same defect either way. */
const BRACE = /\{[^{}\n]*\}/g;

type Candidate = { file: string; line: number; text: string };

function candidatesIn(file: string, stripped: string): Candidate[] {
  const found: Candidate[] = [];
  for (const match of stripped.matchAll(BRACE)) {
    const body = match[0].slice(1, -1);
    // String CONTENTS are not code: the word "hours" in a sentence of prose
    // is not a value being rendered.
    const code = body.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
    if (!HOURS_IDENT.test(code)) continue;
    // `<` means the brace wraps JSX; `=>` means it is a callback body.
    if (/[<]|=>/.test(code)) continue;
    // A colon is a type annotation, an object literal or a destructure —
    // UNLESS it is the second half of a ternary, which renders a value and
    // is exactly how the certified-payroll per-day cell was written.
    if (code.includes(":") && !/\?[^?]*:/.test(code)) continue;
    // Preceded by `=` makes this a JSX ATTRIBUTE (`done={row.ojtHours}`),
    // which passes a number along rather than rendering one. The attribute
    // whose value IS rendered is a template literal, and its own `${…}`
    // substitutions are separate candidates caught on their own.
    if (stripped[match.index! - 1] === "=") continue;
    const line = stripped.slice(0, match.index!).split("\n").length;
    // An import/export specifier list names a binding; it renders nothing.
    // Checked against the line's own text rather than by parsing, which is
    // all this needs: both keywords are only ever at the start of a line in
    // this codebase's formatting.
    const lineText = stripped.split("\n")[line - 1] ?? "";
    if (/^\s*(?:import|export)\b/.test(lineText)) continue;
    found.push({
      file,
      line,
      text: `{${body.trim()}}`,
    });
  }
  return found;
}

const FILES = sourceFiles(WEB_ROOT);
const STRIPPED = new Map(FILES.map((file) => [file, stripComments(readFileSync(file, "utf8"))]));
const rel = (file: string) => relative(WEB_ROOT, file);
const CANDIDATES = FILES.flatMap((file) => candidatesIn(rel(file), STRIPPED.get(file)!));

const isFormatted = (text: string) => APPROVED.some((fn) => text.includes(`${fn}(`));
/** `{x === 1 ? "hour" : "hours"}` — a comparison choosing between two
 * string literals. It renders a WORD; no number reaches the screen. */
const isWordChoice = (text: string) =>
  /^\{[^?]*(?:===|!==|>=|<=|>|<)[^?]*\?\s*(["'])[^"']*\1\s*:\s*(["'])[^"']*\2\s*\}$/.test(text);
const isCount = (text: string) => /\.length\s*\}$/.test(text);
const key = (c: Candidate) => `${c.file}\t${c.text}`;

// ----------------------------------------------------------------- tests --

describe("the hours census sees what it reasons about", () => {
  it("walks exactly the source files git reports", () => {
    // THE SCOPE PIN. Not a count — the two SETS must be identical, so a
    // whole directory dropping out of the walk names itself.
    const byGit = sourceFilesByGit().sort();
    expect(byGit.length, "git found almost no source files — is this a checkout?").toBeGreaterThan(200);
    expect(FILES.map((file) => relative(REPO_ROOT, file)).sort()).toEqual(byGit);
  });

  it("finds hours being rendered at all", () => {
    // Vacuity floor. Every assertion below is trivially true on an empty
    // set, and an empty set is what a drifted regex produces.
    expect(CANDIDATES.length).toBeGreaterThan(40);
  });

  it("sees as many formatter call sites as git does", () => {
    // THE SIZE PIN, taken by a different tool over the raw bytes: git does
    // no brace parsing, no string stripping and no comment stripping. If
    // BRACE or HOURS_IDENT above quietly stops matching, this side keeps
    // its number and the scan's collapses.
    const names = APPROVED.filter((fn) => fn !== "money" && fn !== "thresholdLabel");
    let byGit = 0;
    try {
      const out = execFileSync(
        "git",
        [
          "grep", "--untracked", "-h", "-o", "-E",
          `\\{[^{}]*(${names.join("|")})\\(`,
          "--", "apps/web", `:!apps/web/${FORMATTER_MODULE}`, ":!*.test.ts", ":!*.test.tsx",
        ],
        { cwd: REPO_ROOT, encoding: "utf8" },
      );
      byGit = out.split("\n").filter(Boolean).length;
    } catch (error) {
      // git grep exits 1 when nothing matches, which is a finding.
      if ((error as { status?: number }).status !== 1) throw error;
    }
    const scanned = CANDIDATES.filter((c) => names.some((fn) => c.text.includes(`${fn}(`)));
    expect(byGit, "git found no hours formatter calls anywhere — has the formatter been renamed?").toBeGreaterThan(15);
    expect(
      scanned.length,
      `git counts ${byGit} hours-formatter calls in braces across apps/web and this file's scan found ` +
        `${scanned.length}. The scan is missing renders it should be checking — read BRACE and HOURS_IDENT ` +
        "before touching anything else.",
    ).toBe(byGit);
  });
});

describe("every rendered hours figure goes through lib/render-hours.ts", () => {
  it("has no bare render", () => {
    const bare = CANDIDATES.filter(
      (c) => !isFormatted(c.text) && !isWordChoice(c.text) && !isCount(c.text) && !(key(c) in NOT_AN_HOURS_NUMBER),
    );
    expect(
      bare.map((c) => `${c.file}:${c.line}  ${c.text}`),
      "These render an hours value without lib/render-hours.ts, so a floating-point sum of Decimal(5,2) " +
        "columns reaches the screen as 35.300000000000004. Wrap it in formatHours(), or — if it is not an " +
        "hours number — add it to NOT_AN_HOURS_NUMBER with the reason.",
    ).toEqual([]);
  });

  it("keeps no exemption for a render that no longer exists", () => {
    // The table cannot rot: an entry whose expression has changed or gone
    // away stops matching, and saying so is the only thing that forces the
    // decision to be made again rather than inherited.
    const live = new Set(CANDIDATES.map(key));
    const orphans = Object.keys(NOT_AN_HOURS_NUMBER).filter((entry) => !live.has(entry));
    expect(
      orphans,
      "NOT_AN_HOURS_NUMBER names renders the scan no longer finds — they moved, were reworded, or were fixed. " +
        "Take them off, or re-key them to the expression that is there now.",
    ).toEqual([]);
  });

  it("gives every exemption a written reason", () => {
    for (const [entry, reason] of Object.entries(NOT_AN_HOURS_NUMBER)) {
      expect(reason.trim().length, `${entry} is exempt with no reason recorded`).toBeGreaterThan(20);
    }
  });
});

describe("there is exactly one implementation of the hours format", () => {
  it("exports both halves from lib/render-hours.ts", () => {
    const source = readFileSync(join(WEB_ROOT, FORMATTER_MODULE), "utf8");
    expect(source).toMatch(/export function formatHours\(/);
    expect(source).toMatch(/export function formatHoursOrNull\(/);
  });

  it("has no second copy of the arithmetic anywhere else", () => {
    // The three that existed before this census: `String(Number(h.toFixed(2)))`
    // twice and `String(Math.round(h * 100) / 100)` once, all correct, all
    // in different files, with a fourth screen printing the raw float
    // between them. A copy is not a bug today and is how the next screen
    // gets one — CLAUDE.md's "a fix at a call site protects that call site".
    const COPY = /String\(\s*(?:Number\(\s*[\w$.]+\.toFixed\(2\)|Math\.round\(\s*[\w$.]+\s*\*\s*100\s*\)\s*\/\s*100)/;
    const offenders = FILES.filter(
      (file) => rel(file) !== FORMATTER_MODULE && COPY.test(STRIPPED.get(file)!),
    ).map(rel);
    expect(
      offenders,
      `these round hours for display themselves instead of calling formatHours() from ${FORMATTER_MODULE}`,
    ).toEqual([]);
  });
});
