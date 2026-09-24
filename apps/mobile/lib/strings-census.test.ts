import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EN } from "./strings/en";
import { ES } from "./strings/es";

/**
 * The guard `lib/i18n.ts` has cited twice since the day it was written,
 * and which did not exist until now.
 *
 * That is not a footnote, it is the reason this file has the shape it
 * has. `i18n.ts` says the Spanish "is checked against it key for key by
 * strings-census.test.ts" and that the translated scope lives "in
 * `TRANSLATED` in strings-census.test.ts". Both sentences were true of
 * an intention and false of the repository — a cited check that does not
 * exist is worse than no check, because everybody downstream reads the
 * citation and stops looking. (`lib/empty-state.ts` cites a second one,
 * `offline-notes.test.ts`, which also does not exist. That one is not
 * this file's job, but it is the same defect and should be written.)
 *
 * FIVE SEPARATE QUESTIONS, because they fail in genuinely different ways
 * and a single "the translations are fine" assertion would answer none of
 * them honestly:
 *
 *   1. SHAPE      — does `es` have exactly `en`'s keys?
 *   2. PLACEHOLDER— does each translation keep the `{vars}` its English
 *                   carries? The type system cannot see this one at all,
 *                   and it is the failure that reaches a phone: a Spanish
 *                   sentence that dropped `{count}` renders a claim with
 *                   the number missing and nothing anywhere complains.
 *   3. DEAD KEYS  — is every key actually referenced by something? This
 *                   repo has already shipped five keys written for
 *                   `lib/outbox.ts` that nothing ever called, next to the
 *                   English literals they were meant to replace.
 *   4. SCOPE      — is every screen either translated or deliberately
 *                   not, with a reason? A screen added tomorrow must fail
 *                   this file until somebody classifies it.
 *   5. LITERALS   — does a screen IN scope still draw English? Half a
 *                   translated screen is worse than none: a Spanish
 *                   sentence beside an English one reads as a bug, and
 *                   the person it reads that way to cannot report it.
 *
 * Questions 1, 3 and 5 all DERIVE their input by parsing, so each asserts
 * the SIZE of what it parsed against a source that cannot drift with the
 * pattern — the scar in CLAUDE.md is that a regex matching nothing passes
 * every assertion downstream of it. Question 5 additionally asserts its
 * own SCOPE by running the same detector over a file known to be
 * untranslated and requiring it to find something: a detector that has
 * gone blind then fails loudly instead of reporting a clean sweep.
 */

const root = join(__dirname, "..");

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

const sourceFiles = [
  ...listFiles(join(root, "app")),
  ...listFiles(join(root, "components")),
  ...listFiles(join(root, "lib")),
].filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

const screens = listFiles(join(root, "app"))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => f.slice(root.length + 5))
  .sort();

/**
 * The field screens — every one fully translated, no exceptions.
 *
 * "Fully" is the whole point. A screen is in this list only when a
 * Spanish reader can do the thing the screen exists for without meeting
 * an English word that matters.
 */
const TRANSLATED = [
  "(tabs)/_layout.tsx",
  "(tabs)/index.tsx",
  "(tabs)/jobs.tsx",
  "(tabs)/settings.tsx",
  "_layout.tsx",
  "drawings/[jobId].tsx",
  "handover.tsx",
  "materials/[jobId].tsx",
  "outbox.tsx",
  "photos/[jobId].tsx",
  "punch-list/[jobId].tsx",
  "reports/[jobId].tsx",
  "safety/[jobId].tsx",
  "schedule/[jobId].tsx",
  "ticket/[jobId].tsx",
  "time/[jobId].tsx",
] as const;

/**
 * Screens deliberately left in English, each with a reason. A screen
 * missing from BOTH lists fails the scope case below — which is the
 * point: the next screen somebody adds cannot quietly be neither.
 */
const NOT_TRANSLATED: Record<string, string> = {
  "sign-in.tsx":
    "Clerk's own flow, and the person signing a phone in is the foreman setting it up, not the crew member it is handed to",
  "job/[jobId].tsx":
    "a hub of links whose labels are the screen titles in nav.*, rendered by JobSections — nothing of its own to translate",
};

/** The control for the literal detector. It must be a file that really
 * does contain untranslated user-visible English, so that a detector
 * which has stopped matching fails instead of reporting a clean sweep. */
const DETECTOR_CONTROL = "sign-in.tsx";

/**
 * WHAT A SCREEN DRAWS THAT IS NOT IN ITS OWN FILE — and the hole this
 * census shipped with.
 *
 * The literal detector below used to walk `app/` and nothing else. So
 * `SyncStatus`, `JobContextChip`, `DateField`, `SignaturePad` and
 * `NotYourJobFunction` sat in English ON TOP of sixteen screens it was
 * calling clean: the banner at the top of every field screen, the chip
 * under it, the date chips inside every sheet, and the words directly
 * above the pad a crew member signs. Every one of them renders on a
 * screen this file had just passed.
 *
 * That is CLAUDE.md's `theme-contrast` scar exactly — *nothing is ever
 * missing from a directory you do not walk* — reproduced in a census
 * written after reading it. A size assertion cannot see it, because a
 * file outside the walk is not a small set, it is not in the set.
 *
 * So the scope is DERIVED rather than listed: follow the `@/` imports
 * out of every translated screen, transitively, and anything under
 * `components/` or `lib/` that a translated screen can reach is in
 * scope too. A component added to a field screen tomorrow is in scope
 * the moment it is imported, with nobody remembering to add it here.
 */
const SHARED_EXCLUDED: Record<string, string> = {
  "lib/screen-capabilities.ts":
    "a table of keys, not of sentences — its values are StringKeys and its own test asserts they look like keys",
  "lib/today.ts":
    "returns translation keys and the numbers to fill them; it decides which sentence is true, never how it reads",
  "lib/strings/en.ts": "the dictionary itself — it is supposed to be full of English",
  "lib/strings/es.ts": "the other dictionary — same reason, and the pair is asserted key for key above",
  "lib/i18n.ts": "the translation layer; its only literals are the two language codes",
  "lib/local-today.ts":
    "month abbreviations used to FORMAT a date, which is date formatting rather than dictionary work",
  "lib/photo-stamp.ts":
    "burned into the photo's pixels as a document for a GC, not drawn on screen — English on purpose",
};

/**
 * English that STAYS English on a screen that is otherwise translated,
 * with the reason. Every entry is a decision; anything not listed is a
 * bug, which is the point of keeping the list short and argued.
 */
const ALLOWED_ENGLISH: Record<string, Record<string, string>> = {
  "(tabs)/settings.tsx": {
    English:
      "a language is named in its own language, the way every OS does it — somebody who cannot read the current language must still find theirs",
    "Español": "the same rule, from the other side: this reads Español in an English app too",
  },
  "_layout.tsx": {
    "This build isn't finished":
      "the misconfigured-build screen, drawn before Clerk and before any crew member could be handed the phone; its body comes from lib/env.ts and is read by whoever built it",
  },
};

/** The `@/…` imports a file makes, as repo-relative paths. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of source.matchAll(/from\s+"@\/([^"]+)"/g)) {
    for (const ext of [".ts", ".tsx"]) {
      const candidate = join(root, m[1] + ext);
      if (existsSync(candidate)) {
        out.push(m[1] + ext);
        break;
      }
    }
  }
  return out;
}

/** Everything a translated screen can reach, transitively. */
function sharedFilesInScope(): string[] {
  const seen = new Set<string>();
  const queue = TRANSLATED.map((s) => join("app", s));
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const dep of importsOf(join(root, next))) queue.push(dep);
  }
  return [...seen]
    .filter((f) => f.startsWith("components/") || f.startsWith("lib/"))
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
    .sort();
}

const placeholders = (value: string): string[] =>
  [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the two dictionaries agree", () => {
  it("parses a real dictionary, not an empty one", () => {
    // Independent of `Object.keys`: count the key literals in the raw
    // bytes. If the export is ever restructured so the import yields
    // nothing, this fails rather than passing vacuously on an empty set.
    const declared = (readFileSync(join(root, "lib/strings/en.ts"), "utf8").match(/^ {2}"[^"]+":/gm) ?? [])
      .length;
    expect(declared).toBeGreaterThan(100);
    expect(Object.keys(EN).length, "en.ts declares one count and exports another").toBe(declared);
  });

  it("gives Spanish exactly the English keys — no missing, no extra", () => {
    const en = Object.keys(EN).sort();
    const es = Object.keys(ES).sort();
    expect(es.filter((k) => !(k in EN)), "keys in es.ts that en.ts does not have").toEqual([]);
    expect(en.filter((k) => !(k in ES)), "keys in en.ts with no Spanish").toEqual([]);
  });

  /**
   * THE ONE THE TYPE SYSTEM CANNOT SEE. `ES` is typed
   * `Record<keyof typeof EN, string>`, so a missing key is a build
   * error — but every string is a valid string, and a translation that
   * drops `{count}` or renames it to `{cuenta}` type-checks perfectly
   * and renders a sentence with a hole in it.
   */
  it("keeps every placeholder the English carries, spelled the same", () => {
    const drifted: string[] = [];
    let checked = 0;
    for (const [key, english] of Object.entries(EN)) {
      const a = placeholders(english);
      const b = placeholders(ES[key as keyof typeof EN]);
      if (a.length) checked += 1;
      if (a.join(",") !== b.join(",")) drifted.push(`${key}: en{${a}} es{${b}}`);
    }
    // Vacuity guard: if nothing in the dictionary interpolates any more,
    // this case is asserting nothing and should say so rather than pass.
    expect(checked, "no key carries a placeholder — this case has stopped testing anything").toBeGreaterThan(20);
    expect(drifted, `these translations changed their placeholders: ${drifted.join(" | ")}`).toEqual([]);
  });

  it("leaves no key that nothing in the app asks for", () => {
    // Every reference is a quoted literal somewhere in source — a `t()`
    // call, a `StringKey`-typed table, an `emptyFor` argument — so the
    // raw bytes of the app are the honest index.
    //
    // THE DICTIONARIES THEMSELVES ARE EXCLUDED, and this case was
    // vacuous until they were. `en.ts` contains the line
    // `"outbox.tried.one": "Tried once — …"`, so a haystack including it
    // matches every key by definition and the search can never fail. It
    // passed clean on a tree where five keys were provably orphaned,
    // which is the whole reason the exclusion is spelled out here rather
    // than quietly filtered.
    const haystack = sourceFiles
      .filter((f) => !f.includes(join("lib", "strings")))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    // Size guard: if the walk ever stops finding the app, every key looks
    // orphaned rather than the check looking broken.
    expect(haystack.length, "scanned almost nothing — the file walk is broken").toBeGreaterThan(100_000);
    const orphans = Object.keys(EN).filter((key) => !haystack.includes(`"${key}"`));
    expect(
      orphans,
      `written, documented and never called — ${orphans.length} keys nothing references: ${orphans.join(", ")}`,
    ).toEqual([]);
  });
});

describe("the scope of the translation", () => {
  it("classifies every screen as translated or deliberately not", () => {
    const classified = new Set<string>([...TRANSLATED, ...Object.keys(NOT_TRANSLATED)]);
    const unclassified = screens.filter((s) => !classified.has(s));
    expect(
      unclassified,
      `new screens belong in TRANSLATED or NOT_TRANSLATED: ${unclassified.join(", ")}`,
    ).toEqual([]);

    const gone = [...classified].filter((s) => !screens.includes(s));
    expect(gone, `listed screens that no longer exist: ${gone.join(", ")}`).toEqual([]);
  });

  it("makes every exclusion say why", () => {
    for (const [screen, reason] of Object.entries(NOT_TRANSLATED)) {
      expect(reason.length, `${screen} needs a real reason`).toBeGreaterThan(20);
    }
  });

  it("draws every translated screen through the translation layer", () => {
    const missing = TRANSLATED.filter((s) => !readFileSync(join(root, "app", s), "utf8").includes("useT"));
    expect(missing, `in scope but never calls useT: ${missing.join(", ")}`).toEqual([]);
  });
});

/**
 * The literal detector.
 *
 * It looks only where a string REACHES A PERSON: the children of a text
 * element, and the props that are rendered as words. It is deliberately
 * narrow — a detector that flagged every string literal would be turned
 * off within a week, and a check nobody runs is worth nothing.
 */
/** The body of a text element, expressions and all — so a sentence split
 * across lines, or chosen by a ternary inside the element, is still seen.
 * The first version of this only matched single-line bare text and let
 * `{busy ? "Saving…" : "Keep on phone"}` through on a screen it had just
 * declared clean. */
const TEXT_ELEMENTS = /<(?:Text|LargeTitle|SectionHeader)(?:\s[^>]*)?>([\s\S]*?)<\/(?:Text|LargeTitle|SectionHeader)>/g;
const TEXT_PROPS =
  /\b(?:title|subtitle|label|placeholder|emptyTitle|emptyDescription|hint|accessibilityLabel|describe|confirmLabel)\s*=\s*"([^"]{3,})"/g;
/** A double-quoted literal inside a text element's expressions. */
const QUOTED = /"([^"\n]{3,})"/g;

/** Prose, rather than a token, an icon name, a path or a format string. */
function looksLikeProse(s: string): boolean {
  const text = s.trim();
  if (!/[A-Za-z]{3}/.test(text)) return false;
  if (text.startsWith("@/") || text.startsWith("./") || text.includes("://")) return false;
  // Leftover code, not words. The brace scan below does not understand
  // strings, so a brace inside a template literal desynchronises it and
  // hands back a fragment of source. None of these can appear in a
  // sentence a person reads, so rejecting them costs no coverage and
  // keeps the failure message legible.
  if (/\$\{|[`{}]|=>|\?\?|&&|\|\|/.test(text)) return false;
  // An identifier-ish token: one word, no space, camel or kebab or dotted.
  if (!text.includes(" ") && /^[A-Za-z][A-Za-z0-9._-]*$/.test(text) && !/^[A-Z][a-z]{3,}$/.test(text))
    return false;
  return true;
}

/**
 * Remove `{...}` expressions, counting nesting.
 *
 * A non-greedy regex cannot do this and quietly produced garbage: on a
 * nested expression it stopped at the first `}` and handed the rest of
 * the JSX back as if it were prose, so the failure message listed things
 * like `) : t("reports.weather", )}` as untranslated text. A check whose
 * OUTPUT is unreadable gets ignored, which is the same end as a check
 * that never ran.
 */
function withoutExpressions(body: string): string {
  let depth = 0;
  let out = "";
  for (const ch of body) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
    else continue;
    if (depth > 0 || ch === "}") out += "";
  }
  return out.replace(/\s+/g, " ").trim();
}

/** The `{...}` expressions on their own, for the literals inside them. */
function expressionsOf(body: string): string {
  let depth = 0;
  let out = "";
  for (const ch of body) {
    if (ch === "{") {
      depth += 1;
      if (depth === 1) continue;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        out += "\n";
        continue;
      }
    }
    if (depth > 0) out += ch;
  }
  return out;
}

function englishLiterals(source: string): string[] {
  // Comments are prose by nature and are not rendered.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const found = new Set<string>();
  for (const m of code.matchAll(TEXT_ELEMENTS)) {
    const bare = withoutExpressions(m[1]);
    if (bare) found.add(bare);
    // …and any literal the expressions choose between.
    for (const q of expressionsOf(m[1]).matchAll(QUOTED)) found.add(q[1].trim());
  }
  for (const m of code.matchAll(TEXT_PROPS)) found.add(m[1].trim());
  return [...found].filter(looksLikeProse);
}

describe("no translated screen still draws English", () => {
  /**
   * THE SCOPE ASSERTION, and the case that keeps the rest of this
   * describe honest. If the detector's patterns ever stop matching —
   * a JSX style change, a component rename — every case below passes
   * with nothing to find. So it is pointed at a file that is KNOWN to
   * be untranslated and required to come back with something.
   */
  it("can still see an English literal when there is one", () => {
    const found = englishLiterals(readFileSync(join(root, "app", DETECTOR_CONTROL), "utf8"));
    expect(
      found.length,
      `the detector found nothing in ${DETECTOR_CONTROL}, which is untranslated — it has gone blind, and every case below it is now vacuous`,
    ).toBeGreaterThan(0);
  });

  it.each(TRANSLATED)("%s", (screen) => {
    const allowed = ALLOWED_ENGLISH[screen] ?? {};
    for (const reason of Object.values(allowed)) {
      expect(reason.length, `${screen}: an allowed English string needs a real reason`).toBeGreaterThan(20);
    }
    const found = englishLiterals(readFileSync(join(root, "app", screen), "utf8")).filter(
      (s) => !(s in allowed),
    );
    expect(found, `untranslated text on a screen in scope: ${found.join(" | ")}`).toEqual([]);
  });
});

/**
 * The other half of the scope, and the one this file shipped without.
 * See SHARED_EXCLUDED above for why it is derived from the import graph
 * rather than listed by hand.
 */
describe("what those screens draw from components and lib", () => {
  const shared = sharedFilesInScope();

  it("reaches a real set of shared files, not an empty one", () => {
    // If the import walk breaks, every case below passes with nothing to
    // check — which is the failure this whole describe exists to end.
    expect(shared.length, "the import walk found almost nothing").toBeGreaterThan(15);
    expect(shared, "SyncStatus renders on every field screen").toContain("components/SyncStatus.tsx");
  });

  it("makes every exclusion say why", () => {
    for (const [file, reason] of Object.entries(SHARED_EXCLUDED)) {
      expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(20);
      expect(existsSync(join(root, file)), `${file} is excluded but does not exist`).toBe(true);
    }
  });

  it("leaves no English on anything a translated screen renders", () => {
    const offenders: string[] = [];
    for (const file of shared) {
      if (file in SHARED_EXCLUDED) continue;
      const found = englishLiterals(readFileSync(join(root, file), "utf8"));
      if (found.length) offenders.push(`${file}: ${found.join(" | ")}`);
    }
    expect(offenders, `English inside a shared file: ${offenders.join(" ;; ")}`).toEqual([]);
  });
});
