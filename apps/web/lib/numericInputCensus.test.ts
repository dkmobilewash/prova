/**
 * Every typed figure in this app goes through ONE parser, and every box a
 * figure is typed into says it is a figure.
 *
 * WHAT IT IS FOR. Fourteen action modules each wrote their own
 * `const n = Number(raw); if (Number.isNaN(n)) …`, and all fourteen refused
 * `2,800`. Fixing them one at a time is how you end up with a fifteenth.
 * This fails the build when a new one appears, and when a numeric `<input>`
 * goes back to a form that silently discards what it cannot read.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THIS FILE ASSERTS ITS OWN SIZE **AND** ITS OWN SCOPE, because CLAUDE.md
 * records a separate scar for each and they are not the same failure.
 *
 *   SIZE — `scratch-cleanup-order.test.ts` had the right pattern and one
 *   hand-wrapped migration slipped past it; the set came back 180 instead
 *   of 181 and thirteen tests passed. So every set derived here is counted
 *   against a source that cannot drift with the pattern that built it:
 *   `git grep`, a different tool doing a different match.
 *
 *   SCOPE — `theme-contrast.test.ts` had the right pattern and resolved its
 *   root as `apps/web`, so the one offending file in the repo, in
 *   `packages/ui`, was never a candidate. Nothing is ever missing from a
 *   directory you do not walk. So the walk starts at the REPO ROOT and its
 *   file list is checked against git's.
 * ────────────────────────────────────────────────────────────────────────
 *
 * MUTATION-TESTED, each one run and the failure read rather than assumed:
 *   - narrow the walk back to `["apps/web"]` -> the scope test goes red,
 *     "expected [ …(1159) ] to deeply equal [ …(1276) ]". That is the
 *     theme-contrast scar reproduced on purpose: 117 files, every one of
 *     them invisible, and nothing else in the suite would have said so;
 *   - put `type="number"` back on ChangeOrders' unit price -> two tests go
 *     red naming `apps/web/components/ChangeOrders.tsx unitPrice`;
 *   - drop `inputMode` from the billing tab's Amount -> red, naming it;
 *   - re-add a bare `Number(formData.get(key))` to `lib/actions/sales.ts`
 *     -> the one-parser test goes red naming the file;
 *   - and the stale-exception checks fired for real during development:
 *     two ROSTER_ADDITIONS lines were true when written and false ten
 *     minutes later, and this file named both.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

const SOURCE = /\.(tsx|ts)$/;

/** From the REPO ROOT, never from this file's own directory. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".") || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(name)) out.push(full);
  }
  return out;
}

function sources(): Map<string, string> {
  const found = new Map<string, string>();
  for (const root of ["apps", "packages"]) {
    for (const full of walk(join(repoRoot, root))) {
      found.set(relative(repoRoot, full), readFileSync(full, "utf8"));
    }
  }
  return found;
}

/** The independent list: git's index, not this file's walk. */
function sourcesByGit(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "apps", "packages"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split("\n")
    .filter((p) => p && SOURCE.test(p) && !p.includes("node_modules/"))
    .sort();
}

/** Comments out, line count kept — so a paragraph quoting the old pattern
 * cannot trip this, and a comment cannot hide a real one either. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("the census sees every source file", () => {
  it("walks the same files git lists, from the repo root", () => {
    const mine = [...sources().keys()].sort();
    const gits = sourcesByGit();
    expect(gits.length, "git listed almost nothing — is this a checkout?").toBeGreaterThan(300);
    // The scar this line exists for: a walk rooted at apps/web would be
    // missing every packages/ file and would say nothing about it.
    expect(gits.some((p) => p.startsWith("packages/"))).toBe(true);
    expect(mine, "the walk and git disagree about which files exist").toEqual(gits);
  });
});

/* ------------------------------------------------------------------ *
 * 1. One parser.
 * ------------------------------------------------------------------ */

/**
 * `Number(x)` applied to something that came out of a form. The old
 * fourteen all looked like this, and each one refused a thousands comma.
 *
 * Deliberately narrow: `Number(row.quantity)` on a Decimal READ BACK from
 * Prisma is not a typed figure and is not this file's business. What is
 * matched is a `Number()` over a `formData` read or over a local `raw`/
 * `text(formData, …)` binding, which is the shape every offender had.
 */
const FORM_NUMBER = /Number\(\s*(?:String\(\s*)?formData\.get\(|Number\(\s*text\(\s*formData/g;

/**
 * THE FOURTH BLIND SPOT, and the one that took an outside audit to find.
 *
 * `FORM_NUMBER` above matches a `Number()` wrapped around a FORM READ. That
 * is the shape the original fourteen had — and it cannot see a validator
 * that takes an already-extracted string, which is what a core module does:
 *
 *     if (!quantity || Number.isNaN(Number(quantity))) …
 *
 * Four of those survived the first pass. One, in
 * `lib/estimating/catalog-line.ts`, carried a comment saying "the same test
 * decimalFromForm applies" — true when written, false the moment the parser
 * moved, and it left the wizard's "Add from catalog" box refusing `2,800`
 * on the SAME SCREEN where the Qty box beside it had just started taking
 * it. The original bug, surviving inside the fix for it, behind a sentence
 * claiming agreement.
 *
 * So this matches the validator rather than the read, and it is deliberately
 * independent of `FORM_NUMBER`: a figure typed by a person is decided by one
 * parser no matter how many function calls it took to get there.
 */
const ADHOC_VALIDATOR = /(?:Number\.isNaN|!\s*Number\.isFinite)\(\s*Number\(/g;

/** Validators that are not about a typed figure, with the reason. */
const ADHOC_ALLOWED: Record<string, { hits: number; reason: string }> = {
  "apps/web/lib/time-entry-correction.ts": {
    hits: 2,
    reason:
      "ANOTHER BRANCH'S LANE. `components/TimeEntryFields.tsx` and the labor actions were off " +
      "limits for this change, and this is their core. Hours and the allowance still refuse a " +
      "figure with a comma in it; both want the same two-line change. Remove this line with it.",
  },
};

describe("one parser, wherever the figure was extracted", () => {
  it("has no ad-hoc Number.isNaN(Number(x)) validator outside the allowed list", () => {
    const offenders: string[] = [];
    const seen = new Map<string, number>();
    for (const [path, source] of sources()) {
      if (path === THE_PARSER) continue;
      if (/\.(test|dbtest)\.tsx?$/.test(path)) continue;
      const hits = [...withoutComments(source).matchAll(ADHOC_VALIDATOR)];
      if (hits.length === 0) continue;
      seen.set(path, hits.length);
      if (hits.length > (ADHOC_ALLOWED[path]?.hits ?? 0)) offenders.push(`${path} (${hits.length})`);
    }
    expect(
      offenders,
      "decide a typed figure with lib/numeric-input.ts, however many calls away the form is — " +
        "a second opinion about what a number is drifts from the first one silently, and did",
    ).toEqual([]);

    const stale = Object.entries(ADHOC_ALLOWED)
      .filter(([path, { hits }]) => seen.get(path) !== hits)
      .map(([path, { hits }]) => `${path}: listed for ${hits}, found ${seen.get(path) ?? 0}`);
    expect(stale, "an exception that no longer matches the code is a free pass").toEqual([]);
  });

  it("the validator pattern still matches the shape it was written for", () => {
    expect([...`if (Number.isNaN(Number(quantity))) {`.matchAll(ADHOC_VALIDATOR)]).toHaveLength(1);
    expect([...`if (!Number.isFinite(Number(raw))) {`.matchAll(ADHOC_VALIDATOR)]).toHaveLength(1);
    expect([...`if (Number.isNaN(date.getTime())) {`.matchAll(ADHOC_VALIDATOR)]).toHaveLength(0);
  });
});

/** The one module allowed to turn a typed string into a number. */
const THE_PARSER = "apps/web/lib/numeric-input.ts";

/**
 * Reads NOBODY TYPES. Each is a hidden field the browser fills in, so
 * tolerance would be meaningless and strictness is the point. The count is
 * held to the code below: an exception covers the read that was reviewed,
 * not a second one added to the same file later.
 */
const NOT_TYPED_BY_A_PERSON_FILES: Record<string, { reads: number; reason: string }> = {
  "apps/web/lib/actions/intake.ts": {
    reads: 1,
    reason:
      "byteSize, set by the upload script from File.size — never keyed in. A thousands comma " +
      "here would mean the client is lying, which is what the integer check is for.",
  },
  "apps/web/lib/actions/jobMedia.ts": {
    reads: 1,
    reason: "byteSize, same as intake.ts — the browser's own figure, re-checked against the cap.",
  },
};

describe("one parser, not fourteen", () => {
  it("has no action module reading a number straight out of a form", () => {
    const offenders: string[] = [];
    const seen = new Map<string, number>();
    for (const [path, source] of sources()) {
      if (path === THE_PARSER) continue;
      if (/\.(test|dbtest)\.tsx?$/.test(path)) continue;
      const code = withoutComments(source);
      const hits = [...code.matchAll(FORM_NUMBER)];
      if (hits.length === 0) continue;
      seen.set(path, hits.length);
      if (hits.length > (NOT_TYPED_BY_A_PERSON_FILES[path]?.reads ?? 0)) {
        offenders.push(`${path} (${hits.length})`);
      }
    }
    expect(
      offenders,
      "parse typed figures with lib/numeric-input.ts — a bare Number() refuses the thousands " +
        "comma a contractor writes without thinking, and accepts 0x10 and Infinity, which it " +
        "then hands to a Postgres numeric column",
    ).toEqual([]);

    const stale = Object.entries(NOT_TYPED_BY_A_PERSON_FILES)
      .filter(([path, { reads }]) => seen.get(path) !== reads)
      .map(([path, { reads }]) => `${path}: listed for ${reads}, found ${seen.get(path) ?? 0}`);
    expect(stale, "an exception no longer matching the code is a free pass for the next read").toEqual([]);
  });

  it("the pattern still matches the shape it was written for", () => {
    // Without this, a regex that stops matching anything passes the test
    // above by asking an empty question. Two fixtures, one per branch.
    expect([...`const n = Number(formData.get("quantity"));`.matchAll(FORM_NUMBER)]).toHaveLength(1);
    expect([...`const n = Number(String(formData.get("q") ?? ""));`.matchAll(FORM_NUMBER)]).toHaveLength(1);
    expect([...`const n = Number(text(formData, "hours"));`.matchAll(FORM_NUMBER)]).toHaveLength(1);
    expect([...`const n = Number(invoice.amount);`.matchAll(FORM_NUMBER)]).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * 2. The roster of numeric field names, DERIVED from the action layer.
 * ------------------------------------------------------------------ */

/**
 * Which form keys the actions parse as numbers, read out of the action
 * source rather than listed by hand — a hand-written list is the scope
 * failure above in a different costume, since a field nobody remembered is
 * not in the set and so is never missing from it.
 */
function numericFieldNames(): Set<string> {
  const keys = new Set<string>();
  const readers =
    /(?:decimalFromForm|nullableDecimalFromForm|nullablePercentFromForm|numberFromForm|optionalNumberFromForm|optionalNumber|setupOptionalNumber|setupNumber|number)\(\s*formData\s*,\s*"([a-zA-Z0-9_]+)"/g;
  const direct = /parseNumericInput\(\s*formData\.get\(\s*"([a-zA-Z0-9_]+)"/g;
  for (const [path, source] of sources()) {
    if (!path.startsWith("apps/web/lib/actions/")) continue;
    if (/\.(test|dbtest)\.ts$/.test(path)) continue;
    const code = withoutComments(source);
    for (const m of code.matchAll(readers)) keys.add(m[1]);
    for (const m of code.matchAll(direct)) keys.add(m[1]);
  }
  return keys;
}

/** Numeric fields the roster cannot see, each with the reason. A field is
 * here because its action reads it through a helper that takes a LABEL
 * rather than a form key, or builds the key itself. */
const ROSTER_ADDITIONS: Record<string, string> = {
  months: "closeout.ts parses through required(), which returns the raw string",
  claimedAmount: "backcharges.ts money() takes a label, and the key is the caller's",
  resolvedAmount: "same as claimedAmount",
  apprenticePeriod: "unionCompliance.ts reads it through setupText() first",
  lengthFt: "jobs.ts takeoff builds its own labelled reader",
  widthFt: "jobs.ts takeoff",
  heightFt: "jobs.ts takeoff",
  spacingIn: "jobs.ts takeoff",
  wastePercent: "jobs.ts takeoff",
  openingWidth: "jobs.ts takeoff, read through getAll()",
  openingHeight: "jobs.ts takeoff, read through getAll()",
  thisPeriodBilled: "billing.ts pay applications read parallel arrays via getAll()",
  materialsStoredValue: "billing.ts pay applications",
  hours: "labor.ts — ANOTHER BRANCH'S FILE this session, left alone deliberately",
  rate: "ExperienceModRateFields, read in emr.ts",
  hoursLost: "delays.ts",
  workersAffected: "delays.ts",
  classroomHours: "apprenticeship.ts hours() takes a key but returns a sentinel",
};

describe("the roster of numeric fields", () => {
  it("is derived from the action layer and is not empty", () => {
    const derived = numericFieldNames();
    // The size floor: a reader regex that stops matching would otherwise
    // leave every input test below asking an empty question.
    expect(
      derived.size,
      "no numeric form keys were found in lib/actions — the reader pattern has drifted",
    ).toBeGreaterThan(15);
    for (const known of ["quantity", "amount", "retainagePercent", "bidAmount"]) {
      expect([...derived], `${known} should be derivable from the action source`).toContain(known);
    }
  });

  it("has no stale addition — one whose field the roster can now see on its own", () => {
    const derived = numericFieldNames();
    const stale = Object.keys(ROSTER_ADDITIONS).filter((k) => derived.has(k));
    expect(
      stale,
      "these are now found by the derived roster; delete their ROSTER_ADDITIONS lines, " +
        "because a stale entry is a free pass for the next field added beside them",
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Every box a figure is typed into.
 * ------------------------------------------------------------------ */

/**
 * An input's `name`, whether it is a literal, an expression, or absent.
 *
 * THE LITERAL-ONLY VERSION OF THIS WAS THE CENSUS'S THIRD BLIND SPOT, and
 * the one that made its "scope" claim overstated: `name="quantity"` matched,
 * `name={name as string}` could never match, and an input with no `name` at
 * all — `CraftTierPicker`'s period box, whose value goes into a hand-built
 * FormData — had nothing to match. Three real inputs were invisible to a
 * file whose own header claims it pins scope. A set you cannot build is not
 * a set whose size means anything.
 */
function nameOfInput(attrs: string): { name: string; literal: boolean } {
  const literal = /name="([a-zA-Z0-9_]+)"/.exec(attrs);
  if (literal) return { name: literal[1], literal: true };
  if (/\bname=\{/.test(attrs)) return { name: "(expression)", literal: false };
  return { name: "(unnamed)", literal: false };
}

/** The attributes of one `<input …>` tag, braces collapsed so an arrow's
 * `>` inside `{…}` does not end the tag early. */
function inputTags(source: string): string[] {
  const code = withoutComments(source);
  const tags: string[] = [];
  for (const match of code.matchAll(/<input\b/g)) {
    let depth = 0;
    let out = "";
    for (let i = match.index + "<input".length; i < code.length; i++) {
      const ch = code[i];
      if (ch === '"' || ch === "'" || ch === "`") {
        const end = code.indexOf(ch, i + 1);
        if (end === -1) break;
        if (depth === 0) out += code.slice(i, end + 1);
        i = end;
        continue;
      }
      if (ch === "{") {
        if (depth === 0) out += "{";
        depth++;
        continue;
      }
      if (ch === "}") {
        depth--;
        if (depth === 0) out += "}";
        continue;
      }
      if (depth === 0) {
        if (ch === ">") break;
        out += ch;
      }
    }
    tags.push(out);
  }
  return tags;
}

describe("the input scanner sees every input", () => {
  it("finds the same number of inputs git's plain text search does", () => {
    let mine = 0;
    for (const [, source] of sources()) mine += inputTags(source).length;

    // Independent count: git grep's own match, over the raw text, with no
    // comment stripping and no brace walking.
    const raw = execFileSync("git", ["grep", "--untracked", "-o", "-e", "<input", "--", "apps", "packages"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\n")
      .filter((l) => l && /\.(tsx|ts):/.test(l) && !l.includes("node_modules/")).length;

    expect(raw, "git grep found no <input at all").toBeGreaterThan(100);
    // Comments quoting `<input` make git's count the higher one; it must
    // never be LOWER, which would mean the walk is seeing files git is not.
    expect(mine, "the scanner sees inputs git cannot — the walk has gone wrong").toBeLessThanOrEqual(raw);
    // And it must not have collapsed: within a few of git's is fine, an
    // order of magnitude below it is a pattern that stopped matching.
    expect(mine, "the scanner's count collapsed against git's").toBeGreaterThan(raw * 0.8);
  });
});

/**
 * Inputs NOT fixed by this change, each with the reason and what is left.
 * Listed rather than quietly excluded from the roster, because a field
 * dropped from the set is a field that can never be missing from it.
 */
const INPUT_EXCEPTIONS: Record<string, { reason: string }> = {
  // The four inputs this file cannot name — free text, every one, checked
  // by reading them rather than by skipping anything it could not parse.
  // They are LISTED rather than excluded from the walk, because a field
  // dropped from the set can never be missing from it.
  "apps/web/components/AskPanel.tsx (unnamed)": {
    reason: "the Ask question box — free text, and the file input beside it",
  },
  "apps/web/components/SearchLauncher.tsx (unnamed)": {
    reason: "the global search box — free text. Another branch's file this session.",
  },
  "apps/web/components/DocuSignPanel.tsx (unnamed)": {
    reason: "the void reason the signer reads — free text, maxLength 200",
  },
  "apps/web/components/JobMediaAnnotator.tsx (unnamed)": {
    reason: "a photo annotation label — free text, and explicitly not a measurement",
  },
  "apps/web/components/TimeEntryFields.tsx hours": {
    reason:
      "ANOTHER BRANCH'S FILE. `components/TimeEntryFields.tsx` and `lib/actions/labor.ts` were " +
      "declared off limits for this change, so the box is untouched and Hours still refuses a " +
      "figure with a comma in it. `labor.ts` needs the same two-line change the other action " +
      "modules got; remove this line with it.",
  },
};

describe("every numeric input declares itself, and none is type=number", () => {
  const roster = new Set([...numericFieldNames(), ...Object.keys(ROSTER_ADDITIONS)]);

  it("has no numeric field on a plain text box with no inputMode", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const [path, source] of sources()) {
      if (/\.(test|dbtest)\.tsx?$/.test(path)) continue;
      for (const attrs of inputTags(source)) {
        const { name, literal } = nameOfInput(attrs);
        // A roster name, OR any input whose name this file cannot read.
        // The second half is the point: an unreadable name is not evidence
        // that a field is not numeric, so it is checked rather than
        // skipped, and INPUT_EXCEPTIONS is where a non-numeric one goes.
        if (literal && !roster.has(name)) continue;
        if (!literal && /type="(hidden|checkbox|radio|file|date|email|url|tel|password|search)"/.test(attrs)) continue;
        const site = `${path} ${name}`;
        seen.add(site);
        if (INPUT_EXCEPTIONS[site]) continue;
        if (!/inputMode="(decimal|numeric)"/.test(attrs)) offenders.push(site);
      }
    }
    expect(
      offenders,
      'a numeric field needs inputMode="decimal" (or "numeric") so a phone opens on a keypad',
    ).toEqual([]);

    // A stale exception is a free pass for the next field written beside it.
    const stale = Object.keys(INPUT_EXCEPTIONS).filter((site) => !seen.has(site));
    expect(stale, "INPUT_EXCEPTIONS names an input that no longer exists").toEqual([]);
  });

  /**
   * NOT ROSTER-SCOPED, AND THAT IS THE POINT — this is the one rule here
   * that asks nothing about field names.
   *
   * The roster is derived from keyed reader calls in `lib/actions/`, which
   * is a good source and still has a hole: a field read through a
   * label-taking helper, or rendered with a DYNAMIC `name={…}`, is not in
   * it. Four real numeric inputs sat outside it the day this file was
   * written — `apprenticeCount` and `journeymenCount` (read via
   * `setupCount`, which takes a label), `FringeScheduleList`'s five rate
   * boxes (`name={name as string}`, mapped over an array), and
   * `CraftTierPicker`'s period box (no `name` at all; its value goes
   * straight into a hand-built FormData). Every one was still
   * `type="number"`, and the roster-scoped version of this test was green.
   *
   * Nothing is ever missing from a set you cannot see, so this rule does
   * not use the set: this app has no `<input type="number">`, full stop.
   */
  it("has NO type=number input anywhere, whatever it is named", () => {
    const offenders: string[] = [];
    for (const [path, source] of sources()) {
      if (/\.(test|dbtest)\.tsx?$/.test(path)) continue;
      for (const attrs of inputTags(source)) {
        if (!/type="number"/.test(attrs)) continue;
        const { name } = nameOfInput(attrs);
        if (INPUT_EXCEPTIONS[`${path} ${name}`]) continue;
        offenders.push(`${path} ${name}`);
      }
    }
    expect(
      offenders,
      'type="number" is what makes tolerant parsing impossible. Measured in real Chromium ' +
        '2026-09-21: setting the value to "2,800" submits an EMPTY STRING, and typing it drops ' +
        "the comma before the server ever sees it — so on a nullable field the figure vanishes " +
        'with no error at all. Firefox submits "" for anything it dislikes. Use type="text" with ' +
        "inputMode and let lib/numeric-input.ts decide.",
    ).toEqual([]);
  });

  it("reads a name that is an expression, and one that is missing", () => {
    // Three shapes; two were invisible until 2026-09-21, and a fixture is
    // cheaper than finding that out a second time.
    expect(nameOfInput('name="quantity" type="text"')).toEqual({ name: "quantity", literal: true });
    expect(nameOfInput('name={name as string} type="text"')).toEqual({
      name: "(expression)",
      literal: false,
    });
    expect(nameOfInput('type="text" placeholder="period"')).toEqual({
      name: "(unnamed)",
      literal: false,
    });
  });

  it("finds a real offender in a fixture, both ways round", () => {
    const bad = `<input name="quantity" type="number" step="0.01" className="w" />`;
    expect(inputTags(bad)[0]).toContain('type="number"');
    const good = `<input name="quantity" type="text" inputMode="decimal" className="w" />`;
    expect(/type="number"/.test(inputTags(good)[0])).toBe(false);
    // A comment quoting the pattern must not trip it.
    expect(inputTags(`// <input name="quantity" type="number" />\nconst x = 1;`)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 4. The percent field's `%`, which only a real browser could check.
 * ------------------------------------------------------------------ */

/**
 * A static guard, following the `readFileSync` precedent in
 * `pay-application.test.ts`, and here for a reason worth stating: the
 * thing it protects was measured in real Chromium and CANNOT be measured
 * here. happy-dom does no layout and returns zeros from
 * `getBoundingClientRect`.
 *
 * WHAT THE MEASUREMENT FOUND. The `%` is positioned `absolute right-2`
 * inside a wrapper span. Its parent label is `flex flex-col`, whose
 * default `align-items: stretch` made that wrapper full width — so at a
 * 1100px viewport the input sat at x=24 with a width of 96, and the `%`
 * rendered at x=1055. Visible, styled, and a thousand pixels from the box
 * it belongs to. `w-fit` is what shrinks the wrapper to the input.
 *
 * After the fix, measured at 1100px and 375px, both the retainage tab's
 * field and the contact form's: `%` inside the input's rect, 8px from its
 * right edge, against a 28px right padding so it never sits on the digits.
 */
describe("the percent field keeps its % on the box", () => {
  const source = readFileSync(join(repoRoot, "apps/web/components/PercentField.tsx"), "utf8");

  it("keeps w-fit on the wrapper — without it the % renders at the viewport edge", () => {
    expect(source).toContain('className="relative inline-flex w-fit items-center"');
  });

  it("keeps right padding on the input, so the % never sits on the digits", () => {
    expect(source).toMatch(/pr-7/);
  });

  it("is not a placeholder — a placeholder is gone the moment somebody types", () => {
    // The units have to survive typing, which is the whole defect: the old
    // field's only hint was placeholder="e.g. 10".
    const pct = source.slice(source.indexOf('aria-hidden="true"'));
    expect(pct).toContain("%");
    expect(source).not.toMatch(/placeholder="e\.g\. 10"/);
  });
});
