/**
 * One `InputError`, one boundary, and no action that promises a readable
 * refusal and then throws past it.
 *
 * WHAT WENT WRONG. `lib/actions/company.ts` declared its own
 * `class InputError` and its own `runAction` that caught only THAT class,
 * while the parsers it called in `lib/actions/shared.ts` threw shared.ts's
 * class of the same name. Two classes, one name, `instanceof` false between
 * them — so the refusal escaped, and production redacts a thrown Server
 * Action message to a digest. A brand-new owner clicked Save on `/welcome`
 * with nothing answered and got "Application error … Digest: 446730191" on
 * the first screen of the product. #407 fixed that one module. Sixteen more
 * files held the same private class, and `unionCompliance.ts` held the same
 * arrangement under the name `SetupError`.
 *
 * ── WHAT THIS FILE REASONS ABOUT, AND WHAT IT THEREFORE CANNOT CATCH ──
 *
 * It reasons about three things, all of them SOURCE TEXT:
 *
 *   A. every declaration of `class InputError` in the repository;
 *   B. every `catch` that converts an error to a returned failure by
 *      testing `instanceof` against a class declared in the same file;
 *   C. every exported function whose declared return type promises a
 *      legible refusal and which calls a shared parser that throws
 *      `InputError`, without that call being inside a `runAction`.
 *
 * It CANNOT catch: a throw from a helper in ANOTHER module that the action
 * calls (only same-file helpers are followed); an action that receives an
 * `InputError` through a callback it was handed; anything dynamic. Rule C
 * is a source scan over one directory and says so below.
 *
 * ── THE THREE SCARS THIS FILE IS BUILT AGAINST ──
 *
 * 1. A CENSUS CAN HAVE THE RIGHT PATTERN AND NOTHING TO FIND
 *    (`scratch-cleanup-order.test.ts`, 2026-09-09): a regex matching
 *    nothing passes every downstream assertion, because nothing is ever
 *    missing from an empty list. So every set below is SIZE-ASSERTED
 *    against a count derived a different way — a literal string count that
 *    cannot drift with the pattern that parses it.
 *
 * 2. A CENSUS CAN HAVE THE RIGHT PATTERN AND THE WRONG SCOPE
 *    (`theme-contrast.test.ts`, 2026-09-16): its scan root was `apps/web`,
 *    and the one offending file in the repo was in `packages/ui`, so it was
 *    never a candidate. Nothing is ever missing from a directory you do not
 *    walk. So rules A and B take their file list from `git ls-files` over
 *    the WHOLE REPOSITORY, and assert that list is non-empty and that every
 *    path in it exists. A narrowed scope fails loudly rather than quietly
 *    finding less.
 *
 * 3. A CENSUS CAN ASK ABOUT FILES WHEN THE DEFECT LIVES IN EXPRESSIONS
 *    (2026-09-21, this branch). Deriving the defect set by
 *    `grep -rl "class InputError"` returns sixteen files — and of those
 *    sixteen, exactly ONE called a shared parser at all. Meanwhile
 *    `compliance.ts` had the live bug on `/settings`, `billing.ts` has it
 *    in `logPayment` and `jobs.ts` has it in `addCostEntry`, and NONE of
 *    those three declares a local class, so no file-level grep for the name
 *    could ever see them. Counting files found the traps; counting
 *    BOUNDARIES found the bugs. That is why rule C exists and why it is the
 *    rule that carries a roll-call.
 *
 * Comments never count toward any rule. A comment quoting the pattern it
 * explains disarmed a census in this repo once (#185), so every scan runs
 * on comment-stripped source.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const SHARED = "apps/web/lib/actions/shared.ts";
const actionsDir = "apps/web/lib/actions";

/** Every tracked TypeScript file in the repository.
 *
 * `git ls-files` rather than a directory walk, so the scope cannot drift
 * with this file: a new workspace package is in scope the day it is
 * committed, with no edit here. This is scar 2's fix.
 */
function trackedTypeScriptFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "*.ts", "*.tsx"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

const files = trackedTypeScriptFiles();
const sources = new Map<string, string>();
for (const f of files) sources.set(f, readFileSync(join(repoRoot, f), "utf8"));

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const stripped = new Map<string, string>();
for (const [f, s] of sources) stripped.set(f, stripComments(s));

/** Walks from `open` (the index of a `{`) to its matching `}`. */
function blockEnd(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return source.length;
}

describe("the scan can see what it claims to see", () => {
  it("walks every tracked TypeScript file in the repository", () => {
    // Scar 2. An empty or shrunken list is the failure mode that looks
    // like success, so it is asserted before anything is concluded from it.
    expect(files.length).toBeGreaterThan(500);
    for (const f of files) expect(existsSync(join(repoRoot, f))).toBe(true);
  });

  it("includes the workspace packages, not just apps/web", () => {
    // The exact shape of theme-contrast.test.ts's miss: a root that stops
    // at apps/web cannot see packages/ui at all.
    expect(files.some((f) => f.startsWith("packages/"))).toBe(true);
    expect(files.some((f) => f.startsWith("apps/web/"))).toBe(true);
    expect(files).toContain(SHARED);
  });
});

/* ────────────────────────────── rule A ────────────────────────────── */

describe("there is exactly one InputError class", () => {
  const DECL = /\bclass\s+InputError\b/g;

  it("and it is the one in lib/actions/shared.ts", () => {
    const holders = files.filter((f) => DECL.test(stripped.get(f)!) && (DECL.lastIndex = 0) === 0);
    expect(holders).toEqual([SHARED]);
  });

  it("counts declarations independently of the pattern that finds them", () => {
    // Scar 1. `class InputError` as a literal string, counted over the raw
    // sources, must equal what the regex found over the stripped ones —
    // minus whatever sits in prose. A pattern that silently stopped
    // matching would make the first number 0 and fail here rather than
    // reporting a clean sweep.
    const parsed = files.flatMap((f) => (stripped.get(f)!.match(/\bclass\s+InputError\b/g) ?? []));
    expect(parsed.length).toBe(1);

    const inCode = files.filter((f) => /\bclass\s+InputError\b/.test(stripped.get(f)!));
    expect(inCode.length).toBe(parsed.length);
  });
});

/* ────────────────────────────── rule B ────────────────────────────── */

describe("no file converts errors by testing a class it declared itself", () => {
  /** Classes declared in this file. */
  function localClasses(source: string): string[] {
    return [...source.matchAll(/\bclass\s+(\w+)\s+extends\s+Error\b/g)].map((m) => m[1]);
  }

  /** Identifiers used as `err instanceof X` inside a block that returns a
   * failure — i.e. an action boundary, whatever it is named. `runSetup` in
   * unionCompliance.ts was one of these and no grep for `runAction` or for
   * `InputError` would have found it. */
  function convertedClasses(source: string): string[] {
    const found: string[] = [];
    for (const m of source.matchAll(/catch\s*\(\s*\w+\s*\)\s*\{/g)) {
      const open = source.indexOf("{", m.index!);
      const body = source.slice(open, blockEnd(source, open) + 1);
      if (!/\b(fail|actionFail)\s*\(|\bok:\s*false\b/.test(body)) continue;
      for (const i of body.matchAll(/instanceof\s+(\w+)/g)) found.push(i[1]);
    }
    return found;
  }

  it("catches the shared class, never a private one of the same shape", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f === SHARED) continue;
      const src = stripped.get(f)!;
      const mine = new Set(localClasses(src));
      if (mine.size === 0) continue;
      // Only a file that can RECEIVE a shared InputError is at risk: the
      // defect is a shared throw meeting a private catch. A module with its
      // own vocabulary and no shared parser (lib/field-reports-core.ts and
      // its FieldReportInputError, shared deliberately between the web
      // action and the mobile API) is not this bug and is not flagged.
      if (!THROWERS.some((t) => new RegExp("\\b" + t + "\\s*\\(").test(src))) continue;
      for (const c of convertedClasses(src)) {
        if (mine.has(c)) offenders.push(`${f} converts its own ${c}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("finds the catch blocks it is reasoning about", () => {
    // Scar 1 again, for rule B's own parser: if `convertedClasses` stopped
    // matching, the rule above would pass by finding nothing. The repo
    // demonstrably contains converting catches, so zero means broken.
    const total = files.reduce((n, f) => n + convertedClasses(stripped.get(f)!).length, 0);
    expect(total).toBeGreaterThanOrEqual(10);
  });
});

/* ────────────────────────────── rule C ────────────────────────────── */

/** The shared parsers that throw `InputError`, DERIVED from shared.ts
 * rather than listed by hand — so adding a fifth extends this census with
 * no edit here, and renaming one cannot leave a stale name behind. */
function throwingParsers(): string[] {
  const src = stripComments(sources.get(SHARED)!);
  const names: string[] = [];
  for (const m of src.matchAll(/export\s+function\s+(\w+)[\s\S]*?\n\}/g)) {
    if (/throw\s+new\s+InputError\b/.test(m[0])) names.push(m[1]);
  }
  return names.sort();
}

const THROWERS = throwingParsers();

describe("the shared parsers that throw", () => {
  it("are the four form parsers, and the list is derived not typed", () => {
    // The roll-call is the size assertion (scar 1): a regex that matched
    // nothing would give [] and fail here, rather than making every rule
    // below vacuously true. Adding a throwing parser to shared.ts is a
    // deliberate act and updating this line is part of it.
    expect(THROWERS).toEqual([
      "decimalFromForm",
      "enumFromForm",
      "nullableDecimalFromForm",
      "optionalEnumFromForm",
    ]);
  });
});

describe("an action that promises a readable refusal has a boundary", () => {
  /**
   * KNOWN UNCONVERTED, DELIBERATELY LISTED RATHER THAN EXCLUDED BY PATTERN.
   *
   * Both are in the estimating/job-costing/billing lane (WORK-SPLIT.md) and
   * both are live: a thousands comma in either field is a digest today.
   * They are Diego's to take, flagged in #prova-build on 2026-09-21 under
   * the live-money exception rather than fixed from this branch.
   *
   * This list is a RATCHET, not an allowlist. The test fails if a new
   * offender appears AND if one of these is fixed without deleting its line
   * — so the list cannot quietly become the permanent state of the repo,
   * which is the failure mode of every exclusion that is only ever added to.
   */
  const KNOWN = [
    "apps/web/lib/actions/billing.ts::logPayment",
    "apps/web/lib/actions/jobs.ts::addCostEntry",
  ];

  /** Same contract test as ownerRefusalCensus.test.ts, and for the same
   * reason: matching the type NAME missed two actions that spell the
   * contract inline with a payload. */
  function promisesLegibleRefusal(signature: string): boolean {
    return /ActionResult/.test(signature) || /ok:\s*false[\s\S]*error/.test(signature);
  }

  function offenders(): string[] {
    const out: string[] = [];
    const actionFiles = files.filter((f) => f.startsWith(actionsDir + "/") && f.endsWith(".ts"));
    expect(actionFiles.length).toBeGreaterThan(20);

    for (const f of actionFiles) {
      const src = stripped.get(f)!;

      // Same-file helpers that reach a thrower, so a parser called one hop
      // away is still attributed to the action that calls the helper. This
      // is what makes compliance.ts's licenceFieldsFromForm visible.
      const helpers = new Set<string>();
      for (let pass = 0; pass < 3; pass += 1) {
        for (const m of src.matchAll(/(?:^|\n)(?:async\s+)?function\s+(\w+)[\s\S]*?\n\}/g)) {
          const reaches = [...THROWERS, ...helpers].some((t) =>
            new RegExp("\\b" + t + "\\s*\\(").test(m[0].slice(m[0].indexOf("(")))
          );
          if (reaches) helpers.add(m[1]);
        }
      }
      const reachers = [...THROWERS, ...helpers];

      for (const m of src.matchAll(/export\s+async\s+function\s+(\w+)/g)) {
        const open = src.indexOf("{", m.index!);
        if (open < 0) continue;
        const signature = src.slice(m.index!, open);
        if (!promisesLegibleRefusal(signature)) continue;
        const body = src.slice(open, blockEnd(src, open) + 1);
        if (/\brunAction\s*\(|\brunSetup\s*\(/.test(body)) continue;
        if (reachers.some((t) => new RegExp("\\b" + t + "\\s*\\(").test(body))) {
          out.push(`${f}::${m[1]}`);
        }
      }
    }
    return out.sort();
  }

  it("or is on the list of the ones that do not, with nothing added", () => {
    expect(offenders()).toEqual([...KNOWN].sort());
  });

  it("attributes every thrower call site it can see", () => {
    // Scar 1 for rule C. The number of literal thrower calls across the
    // action modules, counted without the function parser, must be
    // non-trivial — a `reachers` list that stopped matching would report
    // no offenders and look like a clean repo.
    const calls = files
      .filter((f) => f.startsWith(actionsDir + "/") && f !== SHARED)
      .reduce(
        (n, f) =>
          n + THROWERS.reduce((m, t) => m + (stripped.get(f)!.match(new RegExp("\\b" + t + "\\s*\\(", "g")) ?? []).length, 0),
        0,
      );
    expect(calls).toBeGreaterThan(20);
  });
});

/* ───────────────────────── the convention itself ───────────────────── */

describe("shared.ts keeps documenting the pair", () => {
  it("still explains why InputError and runAction live together", () => {
    // A convention nobody is told about is abandoned within a week —
    // changelog-entries.test.ts makes the same argument about CHANGELOG.md's
    // preamble. If this paragraph goes, the next module writes its own class
    // for perfectly sensible reasons.
    const src = sources.get(SHARED)!;
    expect(src).toMatch(/export class InputError extends Error/);
    expect(src).toMatch(/export async function runAction/);
    expect(src).toMatch(/redact/i);
  });

  it("names the parsers that deliberately still throw a bare Error", () => {
    // The sweep stopped on purpose at the form parsers; the ownership and
    // state guards below them still throw. Somebody has to be able to tell
    // "left alone" from "missed", and this is where that is written down.
    const src = sources.get(SHARED)!;
    expect(src).toMatch(/assertOwner/);
    expect(src).toMatch(/ownerRefusalCensus/);
  });
});
