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
const CENSUS = "apps/web/lib/actionErrorBoundaryCensus.test.ts";
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

  it("can see itself, which it could not while it was uncommitted", () => {
    // A THIRD WAY FOR A SCOPE TO BE WRONG, found by this file failing CI
    // after passing locally on the same commit's content.
    //
    // `git ls-files` lists TRACKED files. While this census was being
    // written it was untracked, so it was not in its own scan — and rule A
    // below matches on source text, which means the assertion further down
    // that shared.ts still declares the class reads, to rule A, as a second
    // declaration. Locally: one declaration, green. Committed and pushed:
    // two, red.
    //
    // Nothing was wrong with the pattern or the root. The set simply grew
    // by one file at `git add` time, which is a moment no local test run
    // ever observes. So: assert membership, and keep rule A anchored to a
    // statement start so naming the class inside an expression is not a
    // declaration.
    expect(files).toContain(CENSUS);
  });
});

/* ────────────────────────────── rule A ────────────────────────────── */

describe("there is exactly one InputError class", () => {
  /** A DECLARATION begins a statement. Anchoring to line start is what
   * separates `export class InputError extends Error {}` from the same two
   * words appearing inside an expression — such as the assertion at the
   * bottom of this very file, which is why this is anchored at all. */
  const DECLARATION = /^[ \t]*(?:export[ \t]+)?(?:abstract[ \t]+)?class[ \t]+InputError\b/m;

  /** Every MENTION of the two words in code, anchored to nothing. The
   * superset, derived differently from DECLARATION on purpose. */
  const MENTION = /\bclass\s+InputError\b/;

  it("and it is the one in lib/actions/shared.ts", () => {
    const holders = files.filter((f) => DECLARATION.test(stripped.get(f)!));
    // Exact equality rather than "no offenders": a pattern that stopped
    // matching gives [] and fails here, instead of reporting a clean sweep
    // over an empty set. That is scar 1, and it is why this assertion is
    // not written as `expect(extras).toEqual([])`.
    expect(holders).toEqual([SHARED]);
  });

  it("and the unanchored superset holds nothing else that could be one", () => {
    // Scar 1, using a genuinely different derivation. MENTION cannot drift
    // with DECLARATION because it shares no anchoring with it. Two files
    // write those words in code and both are accounted for: shared.ts
    // declares the class, and this census names it in the assertion that
    // shared.ts still does. A third file appearing here is a declaration
    // somebody indented past the anchor, and it fails.
    const mentions = files.filter((f) => MENTION.test(stripped.get(f)!)).sort();
    expect(mentions).toEqual([CENSUS, SHARED].sort());
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

  /**
   * Can a shared `InputError` reach this file's catch at all?
   *
   * TWO WAYS, AND THE SECOND WAS MISSING UNTIL A MUTATION FOUND IT. The
   * first is obvious: the file calls one of the shared parsers. The second
   * is that the file RAISES the shared class itself — it imports
   * `InputError` from ./shared and constructs it, or hands it to something
   * that will, which is precisely what `unionCompliance.ts` does with
   * `numericReaders((message) => { throw new InputError(message); })`.
   *
   * With only the first test, restoring that module's private `SetupError`
   * and private catch left this rule GREEN: the file calls no shared
   * parser, so it was skipped — while its own numeric readers raised the
   * shared class straight past a catch testing the private one. The exact
   * bug, in the exact file this branch converged, invisible to the rule
   * written to forbid it.
   *
   * Importing the shared class is the honest precondition: a file that has
   * the shared `InputError` in scope and converts a DIFFERENT, locally
   * declared class has a mismatch, whatever raised it.
   *
   * `lib/field-reports-core.ts` is still correctly not flagged. Its
   * `FieldReportInputError` is deliberately shared between the web action
   * and the mobile API, and the file imports no `InputError` and calls no
   * shared parser — own vocabulary, no shared throw, no mismatch.
   */
  function canReceiveSharedInputError(src: string): boolean {
    const importsShared = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*shared["']/g)].some(
      (m) => /\bInputError\b/.test(m[1]),
    );
    return importsShared || THROWERS.some((t) => new RegExp("\\b" + t + "\\s*\\(").test(src));
  }

  it("catches the shared class, never a private one of the same shape", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f === SHARED) continue;
      const src = stripped.get(f)!;
      const mine = new Set(localClasses(src));
      if (mine.size === 0) continue;
      if (!canReceiveSharedInputError(src)) continue;
      for (const c of convertedClasses(src)) {
        if (mine.has(c)) offenders.push(`${f} converts its own ${c}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("recognises both ways a shared InputError can reach a file", () => {
    // Scar 1 for the precondition ITSELF, exercised through the real
    // function rather than a copy of half of it — a copy is how the import
    // arm could be deleted with this test still green.
    const UNION = "apps/web/lib/actions/unionCompliance.ts";
    const unionSrc = stripped.get(UNION)!;

    // The witness for the arm that was missing: this module imports the
    // shared class and raises it through its own `numericReaders` callback,
    // while calling NO shared parser. Under a parser-only precondition it
    // is skipped entirely, which is how a private catch survived here.
    expect(THROWERS.some((t) => new RegExp("\\b" + t + "\\s*\\(").test(unionSrc))).toBe(false);
    expect(canReceiveSharedInputError(unionSrc)).toBe(true);

    // And the parser arm still works, so widening it did not replace one
    // blind spot with another.
    const viaParser = files.filter(
      (f) => f !== SHARED && THROWERS.some((t) => new RegExp("\\b" + t + "\\s*\\(").test(stripped.get(f)!)),
    );
    expect(viaParser.length).toBeGreaterThan(5);
    for (const f of viaParser) expect(canReceiveSharedInputError(stripped.get(f)!)).toBe(true);

    // And it is not simply true of everything: a file with neither is not
    // a candidate, which is what keeps field-reports-core.ts unflagged.
    expect(canReceiveSharedInputError("export const x = 1;\n")).toBe(false);
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

/**
 * The shared parsers that raise `InputError`, DERIVED from shared.ts rather
 * than listed by hand.
 *
 * IT FOLLOWS THE CALLBACK, AND THAT IS NOT DEFENSIVENESS — IT IS THE STATE
 * OF THE FILE. An earlier version of this function looked for a literal
 * `throw new InputError` inside each exported parser's body. #414 landed
 * while this branch was open and moved numeric parsing into
 * `lib/numeric-input.ts`, which raises through a callback shared.ts hands
 * it:
 *
 *     const { number, optionalNumber } = numericReaders((message) => {
 *       throw new InputError(message);
 *     });
 *
 * After that, `decimalFromForm` is one line — `return number(...).value` —
 * with no `throw` anywhere in it. The literal-throw version found TWO of
 * seven, and every rule downstream would have passed over the smaller set,
 * because nothing is ever missing from a set you failed to build. That is
 * `scratch-cleanup-order`'s failure arriving through an indirection
 * instead of a line break.
 *
 * So: seed from the `numericReaders` callback, then walk exported
 * functions and aliases to a fixpoint, adding any that raise directly or
 * call something that does.
 */
function throwingParsers(): string[] {
  const src = stripComments(sources.get(SHARED)!);
  const raisers = new Set<string>();

  // Seed: names destructured from a numericReaders() whose callback raises.
  for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*numericReaders\(([\s\S]*?)\n\}\);/g)) {
    if (!/InputError/.test(m[2])) continue;
    for (const part of m[1].split(",")) {
      const name = part.split(":").pop()!.trim();
      if (name) raisers.add(name);
    }
  }
  expect(raisers.size).toBeGreaterThan(0);

  // `[<(]` rather than `\(`: enumFromForm is generic, and requiring a paren
  // straight after the name silently skipped both enum parsers.
  const FN = "export\\s+function\\s+(\\w+)\\s*[<(][\\s\\S]*?\\n\\}";
  for (let pass = 0; pass < 5; pass += 1) {
    for (const m of src.matchAll(new RegExp(FN, "g"))) {
      const raisesHere = /throw\s+new\s+InputError\b/.test(m[0]);
      const callsRaiser = [...raisers].some((r) => new RegExp("\\b" + r + "\\s*\\(").test(m[0]));
      if (raisesHere || callsRaiser) raisers.add(m[1]);
    }
    for (const m of src.matchAll(/export\s+const\s+(\w+)\s*=\s*(\w+)\s*;/g)) {
      if (raisers.has(m[2])) raisers.add(m[1]);
    }
  }

  // Only the EXPORTED ones can reach another module, which is the whole
  // question this census asks.
  return [...raisers]
    .filter((n) => new RegExp("export\\s+(?:function|const)\\s+" + n + "\\b").test(src))
    .sort();
}

const THROWERS = throwingParsers();

describe("the shared parsers that raise InputError", () => {
  it("are all seven, derived through the callback rather than typed", () => {
    // The roll-call IS the size assertion (scar 1): a derivation that
    // matched nothing gives [] and fails here, instead of making every rule
    // below vacuously true over an empty set.
    //
    // It has already earned its keep once. When #414's indirection landed
    // under this branch, the old literal-throw derivation silently dropped
    // to two names and THIS line is what went red — before rule C could
    // report a clean repo over a set five parsers short.
    //
    // Adding a raising parser to shared.ts is a deliberate act, and
    // updating this line is part of it.
    expect(THROWERS).toEqual([
      "decimalFromForm",
      "enumFromForm",
      "nullableDecimalFromForm",
      "nullablePercentFromForm",
      "numberFromForm",
      "optionalEnumFromForm",
      "optionalNumberFromForm",
    ]);
  });
});

describe("an action that promises a readable refusal has a boundary", () => {
  /**
   * KNOWN UNCONVERTED, DELIBERATELY LISTED RATHER THAN EXCLUDED BY PATTERN.
   *
   * THE LIST IS EMPTY, AND IT GOT THERE BY DOING ITS JOB.
   *
   * It held two entries when this branch opened: `billing.ts::logPayment`
   * and `jobs.ts::addCostEntry`, both live, both in the
   * estimating/job-costing/billing lane, both flagged in #prova-build under
   * the live-money exception rather than fixed from here. #414 then landed
   * and fixed both — not with a boundary, but by having each parse to a
   * RETURNED failure through `parseNumericInput` + `actionFail`, which
   * keeps the same promise a different way. Both carry a comment saying
   * exactly why. Issues #428 and #429 record the pair; they were overtaken.
   *
   * This test went RED on the rebase because two listed names no longer
   * offended. That is the ratchet working in the direction nobody
   * remembers to build: an exclusion list that is only ever added to
   * becomes the permanent state of the repo, and a stale entry is a claim
   * with an expiry date — the shape CLAUDE.md records costing four days
   * over one sentence about a Neon project.
   *
   * So it stays here, empty, as the place a new one goes: the test fails if
   * an offender appears AND if a listed one is fixed without deleting its
   * line.
   */
  const KNOWN: string[] = [];

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
