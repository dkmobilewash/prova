import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import config from "../tailwind.config";

/**
 * A COLOUR THAT WAS NEVER DEFINED IS NOT A CONTRAST FAILURE — IT IS NOTHING,
 * AND NOTHING IS WHAT IT RENDERS.
 *
 * `tag-emerald` is not a token in this app and never has been. Five live call
 * sites use it anyway, and three of them are ternaries whose OTHER branch is
 * `text-tag-rose-ink`, which is real. So on those screens the bad state is
 * coloured and the good state is not: red for "not acknowledged", default ink
 * for "acknowledged", which reads as *not yet rendered* rather than *fine*.
 * On `LienWaivers.tsx` both the ground and the ink vanish and the chip loses
 * its background entirely. Issue #573 tracks the five-line rename; they sit in
 * `KNOWN_UNDEFINED` below until it lands.
 *
 * WHY `theme-contrast.test.ts` CANNOT SEE THIS, which is the whole reason this
 * file is separate rather than another `it` in that one. That census walks
 * every DEFINED ink/ground pair and checks its ratio in every palette. It is
 * exhaustive over the palette and says nothing about the source. An undefined
 * token is not a pair with bad contrast — it is not a pair at all, so there is
 * no row for it to be missing from.
 *
 * That is the third member of a family CLAUDE.md already names twice. Nothing
 * is ever missing from a directory you do not walk. Nothing is ever missing
 * from a list nobody imports. And nothing is ever wrong with a colour that was
 * never defined. Each one is a check that is correct about the set it can see,
 * and blind to the set the defect is actually in.
 *
 * SO THIS CENSUS ASKS THE OTHER DIRECTION: not "is every token readable" but
 * "does every token a source file NAMES actually exist".
 */

/** The palette, read from the config rather than restated — a second copy here
 *  would be exactly the drift this file exists to catch. */
const colors = (config.theme?.extend?.colors ?? {}) as Record<string, string>;
const DEFINED = new Set(Object.keys(colors));

/**
 * Which class names are OURS to police, derived rather than listed.
 *
 * The first segment of every custom key: canvas, surface, rail, line, ink,
 * brand, link, bar, tag. None of them is a stock Tailwind colour, so a class
 * opening with one is necessarily reaching for this palette and must resolve.
 * Everything else — `text-neutral-900`, `hover:bg-yellow-500` — is stock and
 * none of this file's business; `theme-contrast.test.ts` owns the question of
 * which stock shades are legible, and it already answers it.
 *
 * Derived from the keys so that adding a namespace to the config extends this
 * census with no edit here, and REMOVING one cannot silently narrow it: the
 * size assertion below would drop.
 */
const NAMESPACES = new Set([...DEFINED].map((key) => key.split("-")[0]));

/** Utilities that take a colour. A class is policed only when one of these is
 *  immediately followed by one of our namespaces. */
const COLOR_UTILITIES = [
  "bg", "text", "border", "ring", "divide", "placeholder", "from", "to", "via",
  "decoration", "outline", "accent", "caret", "fill", "stroke", "shadow",
] as const;

/**
 * Tokens that are named in source and do not exist, kept rather than fixed.
 *
 * SEVEN invented names across 62 call sites and 20 files — and every one of
 * them is in the estimating / takeoff / bids / billing lane, which CLAUDE.md
 * routes to an issue rather than a PR. Issue #573 carries the inventory. This
 * list is what stops that issue blocking somebody else's build while still
 * refusing an eighth name, or a 63rd site.
 *
 * KEYED BY TOKEN AND COUNT rather than by file and line, which is the same
 * shape `formActionCensus`'s `KNOWN_EXCEPTIONS` uses. Sixty-two line keys
 * would rot on the first reformat and nobody would ever prune them; a count
 * per token is seven lines, it fails when the family GROWS, and it fails again
 * when a name is partly fixed — which is the moment the number has to come
 * down rather than the moment it is quietly forgotten.
 *
 * `surface-input` is the one to look at first. Thirty-nine form fields ask for
 * a background that does not exist, on a page whose canvas is #0f0f0f — so
 * those inputs have no ground of their own at all.
 */
const KNOWN_UNDEFINED: Record<string, { count: number; why: string }> = {
  "surface-input": { count: 39, why: "issue #573 — form fields with no ground on a near-black canvas" },
  // 16 -> 15: the duplicate-sheet-number warning in `PlanSheetReview` was
  // retokened to `bg-surface` while the drawing-index check was built beside
  // it. One row of #573 fixed in passing rather than left because it was not
  // what somebody set out to do.
  "surface-card": { count: 15, why: "issue #573 — panels with no ground" },
  "surface-muted": { count: 3, why: "issue #573" },
  "surface-sunken": { count: 1, why: "issue #573" },
  "ink-strong": { count: 1, why: "issue #573 — meant to be emphasis, renders as inherited" },
  "tag-red-ink": { count: 1, why: "issue #573 — `tag-rose-ink` is the real one" },
  "tag-amber-ground": { count: 1, why: "issue #573 — `tag-amber` is the real one" },
  "tag-emerald": { count: 1, why: "issue #573 — the chip loses its ground" },
  "tag-emerald-ink": { count: 5, why: "issue #573 — success reads unstyled while failure reads rose" },
};

const webDir = fileURLToPath(new URL("..", import.meta.url));

/**
 * Roots from Tailwind's `content`, for `theme-contrast.test.ts`'s own reason: a
 * census that walks its own directory stayed green for a month while the
 * offending file sat in `packages/ui`.
 *
 * IT REPORTS PROBLEMS, IT DOES NOT THROW, and that is not style. This runs
 * while the `describe` bodies are evaluated, so a `statSync` on a missing root
 * throws during COLLECTION — and vitest reports a collection failure as
 * "no tests", not as a red assertion naming the root. CLAUDE.md records the
 * same shape costing a session once already. "No tests" next to a green sibling
 * is the most ignorable failure there is, so the missing root is returned as
 * data and asserted inside an `it` that can name it.
 */
function scanRoots(): { roots: string[]; problems: string[] } {
  const globs = (Array.isArray(config.content) ? config.content : []) as string[];
  const problems: string[] = [];
  if (globs.length < 3) {
    problems.push(
      `tailwind.config.ts declares ${globs.length} content globs — this census ` +
        `would scan almost nothing and pass everything`,
    );
  }

  const roots: string[] = [];
  for (const glob of globs) {
    const star = glob.indexOf("*");
    const root = resolve(webDir, star === -1 ? glob : glob.slice(0, star));
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      problems.push(
        `${glob} resolves to ${root}, which is not a directory — a root that ` +
          `resolves to nothing removes files from this check without removing ` +
          `them from the app`,
      );
      continue;
    }
    roots.push(root);
  }
  return { roots, problems };
}

/**
 * Comments out, strings kept.
 *
 * Load-bearing rather than tidy, and this file proves it on itself: the header
 * above writes `tag-emerald` in prose and the exception list quotes whole token
 * names. A raw scan would report this very file as the offender. Same shape as
 * #185, where a comment quoting a census's own pattern disarmed it.
 *
 * Quotes and template literals are tracked so a `//` inside a URL or a class
 * string never eats the rest of a line.
 */
function stripComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      out += (end === -1 ? text.slice(i) : text.slice(i, end + 2)).replace(/[^\n]/g, "");
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i += 1;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\") {
          out += text[i] + (text[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += text[i];
        i += 1;
      }
      out += text[i] ?? "";
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const SKIP_FILE = (name: string) =>
  name.includes(".test.") || name.includes(".dbtest.") || name.includes(".eval.");

function sources(roots: string[]): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next" || name === "e2e" || name.startsWith("."))
        continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if ((name.endsWith(".ts") || name.endsWith(".tsx")) && !SKIP_FILE(name))
        out.push({ path: full, text: readFileSync(full, "utf8") });
    }
  };
  for (const root of roots) walk(root);
  return out;
}

/** `hover:bg-tag-rose/40` → utility `bg`, token `tag-rose`. The leading
 *  boundary refuses a match inside a longer word, so `custom-bg-ink` is not
 *  read as `bg-ink`. */
const CLASS_RE = new RegExp(
  String.raw`(?:^|[^\w-])(${COLOR_UTILITIES.join("|")})-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)`,
  "g",
);

interface Hit {
  path: string;
  lineNo: number;
  line: string;
  token: string;
}

function census() {
  const { roots, problems } = scanRoots();
  const files = sources(roots);
  const all: Hit[] = [];
  let policed = 0;

  for (const { path, text } of files) {
    const code = stripComments(text);
    const lines = code.split("\n");
    for (let n = 0; n < lines.length; n += 1) {
      for (const m of lines[n].matchAll(CLASS_RE)) {
        const token = m[2];
        if (!NAMESPACES.has(token.split("-")[0])) continue;
        policed += 1;
        if (DEFINED.has(token)) continue;
        all.push({
          path: relative(webDir, path).split("\\").join("/"),
          lineNo: n + 1,
          line: lines[n].trim(),
          token,
        });
      }
    }
  }
  return { files: files.length, all, policed, problems };
}

describe("every colour token a source file names actually exists", () => {
  const { files, all, policed, problems } = census();

  it("scanned the app, and found our tokens in it", () => {
    /* Named first, because every count below is about whatever survived it. */
    expect(problems, "this census could not scan what it is supposed to scan").toEqual([]);

    /* SCOPE, then SIZE. A walk over nothing and a pattern that matches nothing
     * both pass every assertion after this one: no class is ever undefined in
     * an empty set. */
    /* 453 at the time of writing. The floor is a collapse detector, not a
     * census of the app: it must sit below the real number and far above
     * zero. `spinnerCensus` scans ~912 because it adds `./lib`; these roots
     * are the Tailwind `content` globs alone, which is the right scope here —
     * a class name only matters where Tailwind would compile it. */
    expect(files, "almost no files were scanned — the roots are wrong").toBeGreaterThanOrEqual(400);
    expect(
      NAMESPACES.size,
      "the palette yielded almost no namespaces, so nothing would be policed",
    ).toBeGreaterThanOrEqual(5);
    expect(
      policed,
      "almost no palette classes were found — either the utility list stopped " +
        "matching or the walk stopped reaching components/",
    ).toBeGreaterThanOrEqual(400);
  });

  it("names no token the Tailwind config does not define", () => {
    const counts = new Map<string, number>();
    for (const h of all) counts.set(h.token, (counts.get(h.token) ?? 0) + 1);

    const unexpected = all
      .filter((h) => !(h.token in KNOWN_UNDEFINED))
      .map((h) => `${h.path}:${h.lineNo} — ${h.token} — ${h.line}`);
    expect(
      unexpected,
      "These classes reach for this app's palette and name something that is " +
        "not in it. Tailwind emits NOTHING for an undefined class, so they " +
        "render with no colour at all — and where the other branch of the same " +
        "ternary IS defined, the screen ends up colouring only the bad state.\n\n" +
        `Defined tokens: ${[...DEFINED].sort().join(", ")}\n`,
    ).toEqual([]);

    /* And the family must not GROW. A new call site for a name already on the
     * list is still a new unstyled element. */
    const grown = [...counts.entries()]
      .filter(([token, n]) => token in KNOWN_UNDEFINED && n > KNOWN_UNDEFINED[token].count)
      .map(([token, n]) => `${token}: ${n} sites now, ${KNOWN_UNDEFINED[token].count} recorded`);
    expect(grown, "an undefined token gained new call sites").toEqual([]);
  });
});

describe("the undefined-token exceptions are still exceptions", () => {
  const { all } = census();

  it("lists nothing that has since been defined or fixed", () => {
    const counts = new Map<string, number>();
    for (const h of all) counts.set(h.token, (counts.get(h.token) ?? 0) + 1);

    const stale = Object.entries(KNOWN_UNDEFINED)
      .filter(([token, { count }]) => (counts.get(token) ?? 0) < count)
      .map(([token, { count }]) => `${token}: ${counts.get(token) ?? 0} sites now, ${count} recorded`);

    expect(
      stale,
      "An exception list nobody prunes becomes permanent. These tokens have " +
        "FEWER call sites than recorded — some were fixed, or the token was " +
        "added to the config. Bring the number down, or delete the entry. A " +
        "count that is allowed to stay too high is an allowance for " +
        "reintroducing what was just removed.",
    ).toEqual([]);
  });
});
