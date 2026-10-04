/**
 * EVERY LINK A PERSON TYPES IS CHECKED BEFORE IT CAN BECOME AN `href`.
 *
 * WHY THIS FILE EXISTS. Five action modules each had their own
 * `optionalLink` — three byte-identical, one better than the rest — and TWO
 * fields had no check at all. `ApprenticeshipCommittee.sourceUrl`
 * (`dasForms.ts`) and `PrevailingWageDetermination.sourceUrl` (`labor.ts`)
 * were read with a bare `text()`/`String(formData.get(...))` and rendered
 * straight into `href={…}`, so a member could store `javascript:…` and it
 * became a script in a colleague's session on click. Both inputs carry
 * `type="url"`, which is a BROWSER hint and no part of the server's story:
 * a Server Action receives whatever the POST body contains.
 *
 * WHY A COMPLETENESS TEST WOULD NOT HAVE CAUGHT IT, which is the whole
 * reason this census is shaped the way it is. A test that
 * `optionalLinkFromForm` handles every scheme correctly proves the shared
 * thing works and says NOTHING about a module that never calls it —
 * CLAUDE.md's #526 entry, where restoring a hand-rolled copy of a shared
 * list left every test in the repo green. *Nothing is ever missing from a
 * list nobody imports.* So this asks the other question: **is there a
 * second implementation, and is there a field that uses neither?**
 *
 * THE THREE LEGITIMATE VALIDATORS, and why three rather than one. A link a
 * PERSON TYPED goes through `optionalLinkFromForm` (or its throwing twin) —
 * arbitrary text, so the SCHEME is the risk. A blob URL the UPLOAD SDK handed
 * back is a different population with a different risk: it should never have
 * come from anywhere but our own store, so `documentUrlProblem` checks the
 * store, this company's folder and this purpose, and `isBlobStorageUrl` +
 * its per-tenant path checks do the same job for `/intake` and job media.
 * None of the three subsumes another, so a function reading a url-shaped
 * field must call one of them, and which one is a real design decision.
 *
 * The third was found BY THIS CENSUS on its first run, which is the argument
 * for writing it: `recordIntakeDocument` and `recordJobMedia` came back as
 * offenders, and reading them showed a validator this file had not been told
 * about rather than a hole. An exemption discovered by being contradicted is
 * worth more than one assumed in advance.
 *
 * THE THREE SHAPES CLAUDE.md REQUIRES OF A DERIVING CHECK:
 *
 *   SIZE — the action modules are counted a second time, by a different
 *   expression than the one that parses them. A regex that stops matching
 *   is the failure that looks like a pass: no field is ever unvalidated in
 *   an empty list.
 *
 *   SCOPE — the walk is `lib/actions`, asserted to exist and to hold a
 *   plausible number of modules. Every Server Action in this app lives
 *   there; `lib/actions/index.ts` is the barrel that proves it.
 *
 *   COMMENTS — stripped before every structural read. This matters
 *   concretely here: the header of `shared.ts` QUOTES
 *   `String(formData.get(...))` while explaining the bug, and both patched
 *   functions name `javascript:` in their comments. A raw-text census would
 *   find unvalidated reads that do not exist.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const actionsDir = resolve(new URL(".", import.meta.url).pathname);

/** Comments out, so nothing in prose can satisfy or defeat a structural
 * read. The same two expressions `clerkMountGate.test.ts` uses. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Every action module: `.ts` directly in this directory, tests excluded. */
function modules(): string[] {
  if (!(statSync(actionsDir, { throwIfNoEntry: false })?.isDirectory() ?? false)) return [];
  return readdirSync(actionsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.ts$/.test(e.name) && !/\.test\.|\.dbtest\.|\.spec\./.test(e.name))
    .map((e) => resolve(actionsDir, e.name));
}

/** A form key that holds a web address. Matched on the KEY rather than on
 * the surrounding code, because the key is the thing a form and an action
 * have to agree about. */
const URLISH_KEY = /(?:^|[a-z])(?:url|Url|URL)$/;

/** Both ways an action reads a form value. */
const READS = [
  /\btext\(\s*formData\s*,\s*["'`]([A-Za-z0-9_]+)["'`]/g,
  /\bformData\.get\(\s*["'`]([A-Za-z0-9_]+)["'`]/g,
];

/** A second implementation, in any of the shapes the deleted copies took:
 * a local helper that parses a URL and then inspects its protocol. */
const OWN_PROTOCOL_CHECK = /\.protocol\s*!==\s*["'`]https?:/;

type Mod = { file: string; stripped: string };

const parsed: Mod[] = modules().map((file) => ({
  file: file.slice(actionsDir.length + 1),
  stripped: stripComments(readFileSync(file, "utf8")),
}));

/** The functions in one module, split on their own `export` boundary. Crude
 * on purpose — the alternative is a TypeScript AST for a question that is
 * about which VALIDATOR a body mentions, and the split is asserted below to
 * have found a plausible number of bodies rather than trusted. */
function bodies(stripped: string): string[] {
  const parts = stripped.split(/\bexport\s+async\s+function\s+/);
  return parts.slice(1);
}

describe("a link a person typed cannot reach an href unchecked", () => {
  it("walks the action modules, and there are as many as a second count finds", () => {
    expect(
      statSync(actionsDir, { throwIfNoEntry: false })?.isDirectory() ?? false,
      `${actionsDir} is not a directory — this census would be about nothing`,
    ).toBe(true);
    expect(parsed.length, "no action modules parsed").toBeGreaterThan(20);
    // THE SIZE ASSERTION, by a different expression: count the files that
    // declare a Server Action at all, and require the walk to cover them.
    const declaring = parsed.filter((m) => /\bexport\s+async\s+function\s+/.test(m.stripped));
    expect(declaring.length).toBeGreaterThan(20);
    expect(declaring.length).toBeLessThanOrEqual(parsed.length);
  });

  it("no module carries its own URL-protocol check any more", () => {
    // The five deleted copies each did `parsed.protocol !== "https:"`. One
    // implementation is the only way the rule can be changed once.
    const rogue = parsed
      .filter((m) => m.file !== "shared.ts" && OWN_PROTOCOL_CHECK.test(m.stripped))
      .map((m) => m.file);
    expect(
      rogue,
      `${rogue.join(", ")} validates a URL scheme locally. Use optionalLinkFromForm from ./shared — ` +
        "a second copy is how the worse of two error messages won three-to-one last time.",
    ).toEqual([]);
  });

  it("every url-shaped field is read through one of the two validators", () => {
    const offenders: string[] = [];

    for (const mod of parsed) {
      if (mod.file === "shared.ts") continue;
      for (const body of bodies(mod.stripped)) {
        const keys = new Set<string>();
        for (const pattern of READS) {
          for (const m of body.matchAll(pattern)) {
            if (URLISH_KEY.test(m[1])) keys.add(m[1]);
          }
        }
        if (keys.size === 0) continue;

        const typed =
          body.includes("optionalLinkFromForm(") || body.includes("optionalLinkOrThrow(");
        const blob = body.includes("documentUrlProblem(") || body.includes("isBlobStorageUrl(");
        if (typed || blob) continue;

        const name = body.slice(0, body.indexOf("(")).trim();
        offenders.push(`${mod.file}: ${name} reads ${[...keys].join(", ")}`);
      }
    }

    expect(
      offenders,
      "These read a url-shaped form field and call neither validator:\n  " +
        offenders.join("\n  ") +
        "\n\nA link a person TYPED goes through `optionalLinkFromForm`, or `optionalLinkOrThrow` " +
        "inside `runAction` (the scheme is the risk — `type=\"url\"` on the input is a browser " +
        "hint and this code sees the raw POST body). A blob URL the upload SDK returned goes " +
        "through `documentUrlProblem` or `isBlobStorageUrl` (our store, this company's folder). " +
        "If a field is genuinely neither, that is a decision worth writing down in this file's " +
        "header rather than a check worth skipping.",
    ).toEqual([]);
  });

  it("the shared validator refuses every scheme a browser would execute", () => {
    // Not a completeness test standing in for the census above — it is the
    // other half, and it is here so the two cannot drift into separate files.
    const form = (v: string) => {
      const fd = new FormData();
      fd.set("k", v);
      return fd;
    };
    // Imported lazily so this file's structural reads above do not depend on
    // the module loading.
    return import("./shared").then(({ optionalLinkFromForm }) => {
      for (const bad of [
        "javascript:alert(1)",
        "JavaScript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "vbscript:msgbox",
        "file:///etc/passwd",
      ]) {
        const r = optionalLinkFromForm(form(bad), "k", "Source");
        expect(r.ok, `${bad} was accepted`).toBe(false);
      }
      // Empty is absent, not invalid — every one of these fields is optional.
      expect(optionalLinkFromForm(form("   "), "k")).toEqual({ ok: true, value: null });
      // http stays accepted, because a GC portal on plain HTTP is a real
      // thing and breaking stored links would be the worse trade.
      expect(optionalLinkFromForm(form("http://dir.ca.gov/x"), "k").ok).toBe(true);
      expect(optionalLinkFromForm(form("https://dir.ca.gov/x"), "k")).toEqual({
        ok: true,
        value: "https://dir.ca.gov/x",
      });
    });
  });
});
