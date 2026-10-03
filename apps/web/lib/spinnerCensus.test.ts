import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import config from "../tailwind.config";

/**
 * EVERY IN-FLIGHT LABEL MOVES.
 *
 * Until 2026-09-30 every pending state in this app was a WORD that stopped
 * changing — `{pending ? "Saving…" : "Save"}`, a hundred and thirty times.
 * `components/Spinner.tsx`'s header states the cost: a label that sits still
 * reads as a crash, not as work in progress. The ellipsis is a promise that
 * something is happening and nothing on screen keeps it.
 *
 * Putting a spinner beside all of them was a hundred-file edit. Keeping it
 * that way is this file, because the next in-flight label somebody writes
 * will be written the way every existing one was — by copying the line above
 * it — and one that copies the pre-spinner shape would ship with nothing to
 * say so. Typecheck, lint and build are all silent about a static word.
 *
 * WHAT IS ASSERTED: every occurrence of an in-flight label in the scanned
 * sources sits inside a JSX expression that also renders a `<Spinner`. Not
 * "the file imports Spinner" — a file can import it for one button and forget
 * the other four, which is the shape half these files are (Das140Panel has
 * three, CloseoutJobCard has four). The unit is the EXPRESSION, so each
 * button is checked on its own.
 *
 * THE WORD IS NOT NEGOTIABLE, AND THIS FILE CANNOT SEE THAT. The spinner is
 * `aria-hidden`; the label is the whole of what a screen reader gets and the
 * only thing that says WHAT is happening. So a spinner that REPLACED its word
 * would pass here trivially — the label would simply not be in the set any
 * more. Nothing is ever missing from a list it was deleted from. That half is
 * a review rule, stated in Spinner.tsx, and this census is honest about not
 * being it.
 */

/* THE LABELS. Seven words, and the list is deliberately closed rather than
 * derived from a pattern like /[A-Z][a-z]+…/ — because such a pattern finds a
 * SECOND, LARGER FAMILY that this change did not touch, and a census that
 * flags a hundred and fifty sites nobody has fixed becomes an exceptions list
 * with a test attached.
 *
 * Measured 2026-09-30 so the next person does not have to: the wider family
 * is about 150 more in-flight labels on other verbs — "Deleting…" x27,
 * "Removing…" x26, "Adding…" x22, "Disconnecting…" x7 and thirty-odd more.
 * SEVENTY of them are one line: `pendingLabel` reaches exactly one render
 * site, `components/RowActions.tsx`'s armed confirm button. That one line was
 * deliberately NOT changed here, and the reason is in CLAUDE.md's "Cancel
 * inherits the delete pixel" entry — a spinner WIDENS the armed confirm, and
 * the geometry of that cluster is measured in real Chromium, not guessed. It
 * needs the measurement, not a patch.
 *
 * So: this list is the boundary of a finished piece of work, not a claim that
 * nothing else needs a spinner. Adding a word here is how the next batch gets
 * held to the same rule.
 */
const LABELS = [
  "Saving",
  "Sending",
  "Working",
  "Uploading",
  "Looking",
  "Checking",
  "Loading",
] as const;

/* THE ROOTS COME FROM TAILWIND'S `content`, for the reason
 * lib/theme-contrast.test.ts spells out at length: a census that walks its own
 * directory stayed green for a month while the one offending file sat in
 * `packages/ui`, and no size assertion can catch that, because nothing is ever
 * missing from a directory you do not walk.
 *
 * PLUS `./lib`, named here with its reason. `content` is the authoritative
 * list of files whose CLASSES reach the app, which is not the same question as
 * which files can hold a LABEL: `lib` carries no Tailwind classes so it is
 * legitimately absent from `content`, and a pending label can perfectly well
 * be a constant there — `components/landing/askDemoScript.ts` is that exact
 * shape one directory over. Both kinds of root are existence-asserted below,
 * so a glob or a path that resolves to nothing fails loudly instead of
 * quietly shrinking the scan. */
const EXTRA_ROOTS = ["./lib"] as const;

const webDir = fileURLToPath(new URL("..", import.meta.url));

function scanRoots(): string[] {
  const globs = (Array.isArray(config.content) ? config.content : []) as string[];
  expect(
    globs.length,
    "tailwind.config.ts declares no `content` globs, so this census would scan " +
      "nothing and pass everything below it",
  ).toBeGreaterThanOrEqual(3);

  const fromGlobs = globs.map((glob) => {
    const star = glob.indexOf("*");
    return resolve(webDir, star === -1 ? glob : glob.slice(0, star));
  });
  expect(fromGlobs.length, "one root per content glob, or a glob is being dropped").toBe(
    globs.length,
  );

  const roots = [...fromGlobs, ...EXTRA_ROOTS.map((rel) => resolve(webDir, rel))];
  for (const root of roots) {
    expect(
      statSync(root).isDirectory(),
      `${root} does not exist, so this census cannot scan it — a root that ` +
        `resolves to nothing removes files from this check without removing ` +
        `them from the app`,
    ).toBe(true);
  }
  return roots;
}

/** Tests are not the product, and neither is the browser suite. */
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

/**
 * One pass that strips comments AND records every brace pair, string-aware.
 *
 * COMMENTS GO FIRST AND THAT IS NOT TIDINESS. This repo has the scar twice
 * over: #185, where a comment quoting a census's own pattern disarmed it, and
 * `clerkMountGate.test.ts`, where two files print the very widget they gate in
 * their own headers. This file is worse placed than either — `Spinner.tsx`,
 * `AskPanel.tsx` and `askDemoScript.ts` all QUOTE the labels below in prose,
 * so a raw-text scan would find three render sites that do not exist, and a
 * commented-out `<Spinner />` beside a live static label would read as fixed.
 *
 * Written as a tokenizer rather than the two-regex `withoutComments` helper
 * the sibling censuses use, because that helper's `//` rule is guarded only by
 * a preceding `:` (for `https://`) and this file's correctness rests on brace
 * BALANCE — one brace eaten out of a string and every enclosing expression
 * below is the wrong one. Quotes, template literals and `${}` nesting are all
 * tracked, so braces inside strings never move the depth.
 */
function parse(text: string): {
  code: string;
  pairs: { open: number; close: number }[];
  /** Braces left open when the file ended. A CONTROL on the scanner itself:
   * every one of these files compiles, so its braces balance, and a nonzero
   * count here means the tokenizer mis-read something (a regex literal, an
   * escape, a template nesting) and every enclosing expression it reported
   * after that point is suspect. Asserted per file below. */
  unbalanced: number;
} {
  const code: string[] = [];
  const pairs: { open: number; close: number }[] = [];
  const stack: number[] = [];
  /** Template-literal depths: a `}` at one of these closes a `${`, not a block. */
  const templates: number[] = [];
  let i = 0;
  /** Offset into the emitted code. Kept as a counter rather than re-joining
   * `code` at every brace: the join made this quadratic and the whole suite
   * spent forty seconds in it. */
  let out = 0;
  const push = (s: string) => {
    code.push(s);
    out += s.length;
  };

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const skipped = (end === -1 ? text.slice(i) : text.slice(i, end + 2)).replace(/[^\n]/g, "");
      push(skipped); // newlines kept so line numbers survive
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (c === '"' || c === "'") {
      push(c);
      i += 1;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\") {
          push(text[i] + (text[i + 1] ?? ""));
          i += 2;
          continue;
        }
        if (text[i] === "\n") break; // unterminated: do not run away
        push(text[i]);
        i += 1;
      }
      if (i < text.length && text[i] === c) {
        push(c);
        i += 1;
      }
      continue;
    }
    if (c === "`") {
      push(c);
      i += 1;
      while (i < text.length) {
        if (text[i] === "\\") {
          push(text[i] + (text[i + 1] ?? ""));
          i += 2;
          continue;
        }
        if (text[i] === "`") {
          push("`");
          i += 1;
          break;
        }
        if (text[i] === "$" && text[i + 1] === "{") {
          push("${");
          templates.push(stack.length);
          stack.push(out - 1);
          i += 2;
          // back into code: the outer loop handles it
          break;
        }
        push(text[i]);
        i += 1;
      }
      continue;
    }
    if (c === "{") {
      stack.push(out);
      push(c);
      i += 1;
      continue;
    }
    if (c === "}") {
      const open = stack.pop();
      push(c);
      const closedTemplate = templates.length > 0 && templates[templates.length - 1] === stack.length;
      if (open !== undefined) pairs.push({ open, close: out - 1 });
      i += 1;
      if (closedTemplate) {
        templates.pop();
        // resume the template literal that the `${` interrupted
        while (i < text.length) {
          if (text[i] === "\\") {
            push(text[i] + (text[i + 1] ?? ""));
            i += 2;
            continue;
          }
          if (text[i] === "`") {
            push("`");
            i += 1;
            break;
          }
          if (text[i] === "$" && text[i + 1] === "{") {
            push("${");
            templates.push(stack.length);
            stack.push(out - 1);
            i += 2;
            break;
          }
          push(text[i]);
          i += 1;
        }
      }
      continue;
    }
    push(c);
    i += 1;
  }
  return { code: code.join(""), pairs, unbalanced: stack.length };
}

type Hit = {
  /** Path relative to the repo's apps/web, for a readable failure. */
  path: string;
  label: string;
  /** The source line the label sits on, trimmed — the exceptions key. */
  line: string;
  lineNo: number;
  /** The innermost `{…}` the label sits in, or null if it sits in none. */
  expression: string | null;
};

function hits(): {
  all: Hit[];
  independent: number;
  files: number;
  hitFiles: number;
  unbalanced: string[];
} {
  const roots = scanRoots();
  const files = sources(roots);
  const all: Hit[] = [];
  let independent = 0;
  const hitFiles = new Set<string>();

  const unbalanced: string[] = [];
  for (const { path, text } of files) {
    const { code, pairs, unbalanced: left } = parse(text);

    /* THE SIZE ASSERTION'S HALF, and it shares no logic with the brace
     * scanner on purpose. `split` is not a regex and knows nothing about
     * expressions: if the pair-matching below breaks and finds fewer labels,
     * these two numbers stop agreeing and the test names the gap instead of
     * quietly reasoning about a smaller set. A deriving check has two failure
     * modes and only one of them looks like failure (CLAUDE.md). */
    for (const label of LABELS) independent += code.split(`${label}…`).length - 1;

    const lines = code.split("\n");
    const lineStarts: number[] = [];
    let at = 0;
    for (const l of lines) {
      lineStarts.push(at);
      at += l.length + 1;
    }
    const lineNoAt = (offset: number) => {
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (lineStarts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };

    for (const label of LABELS) {
      const needle = `${label}…`;
      let from = 0;
      for (;;) {
        const found = code.indexOf(needle, from);
        if (found === -1) break;
        from = found + needle.length;
        if (!hitFiles.has(path)) {
          hitFiles.add(path);
          /* The scanner's own control, and it is deliberately asked only of
           * the files this census REASONS about. Every file here compiles, so
           * its braces balance; if this scanner disagrees it has mis-read
           * something and the enclosing expressions it reports for this file
           * are the wrong ones. A control that fails is the instruction to fix
           * the harness, not a result to read (CLAUDE.md).
           *
           * Scoped to hit-files because the tokenizer does not tell a REGEX
           * literal from a division sign, and three label-free files in lib/
           * write `/[",\n\r]/` — a quote inside a regex, which it reads as an
           * opening string. Widening the control to all 900 files would fail
           * on those three forever and on any unrelated PR that adds a fourth.
           * Narrowed, it fires exactly when the misreading could change an
           * answer: if a regex like that ever lands in a file carrying an
           * in-flight label, this goes red and the tokenizer needs the case. */
          if (left !== 0) unbalanced.push(`${relative(webDir, path)} (${left} unclosed)`);
        }
        const enclosing = pairs
          .filter((p) => p.open < found && p.close > found)
          .sort((a, b) => b.open - a.open)[0];
        const lineNo = lineNoAt(found);
        all.push({
          path: relative(webDir, path).split("\\").join("/"),
          label,
          line: lines[lineNo].trim(),
          lineNo: lineNo + 1,
          expression: enclosing ? code.slice(enclosing.open, enclosing.close + 1) : null,
        });
      }
    }
  }
  return { all, independent, files: files.length, hitFiles: hitFiles.size, unbalanced };
}

/**
 * Labels that legitimately render with no spinner beside them, with the reason
 * each one is here. Keyed by path and the label's own source line, so the key
 * stops matching the moment the line is rewritten — which is the point.
 *
 * Pruned by a test below. An exceptions list nobody prunes becomes permanent.
 */
const KNOWN_WITHOUT_SPINNER: Record<string, string> = {
  'components/landing/askDemoScript.ts | asking: "Looking…",':
    "Not an in-flight state. This module is the SCRIPT for the landing page's " +
    "twenty-second Ask demo — data, not JSX, so there is no expression for a " +
    "spinner to sit in. The words are held equal to the product's own by " +
    "askDemoScript.test.ts, which is why they are here at all. Whether the " +
    "DEMO should draw a spinner too (AskDemo.tsx:299 renders this one) is a " +
    "separate call about a sales page, and the scene already carries its own " +
    "motion — the typing caret and the tap ripples.",
  'components/landing/askDemoScript.ts | working: "Working…",':
    "Same module, same reason. Rendered at AskDemo.tsx:178 as the demo card's " +
    "pending primary button.",
  'components/landing/askDemoScript.ts | savingRfi: "Saving…",':
    "Same module, same reason. Rendered at AskDemo.tsx:220 as the demo's " +
    "redraw of RfiForm's Save.",
};

const key = (hit: Hit) => `${hit.path} | ${hit.line}`;

/** Computed once: both describes below read the same scan. */
let scan: ReturnType<typeof hits> | null = null;
const census = () => (scan ??= hits());

describe("every in-flight label has a spinner beside it", () => {
  const { all, independent, files, hitFiles, unbalanced } = census();

  it("scanned the app, and found the labels in it", () => {
    /* SCOPE first, then SIZE. A scan that walks nothing and a pattern that
     * matches nothing both pass every assertion after this one: nothing is
     * ever spinner-less in an empty set. */
    expect(files, "almost no files were scanned — the roots are wrong").toBeGreaterThanOrEqual(
      500,
    );
    expect(
      hitFiles,
      "in-flight labels were found in almost no files — either the label list " +
        "stopped matching, or the walk stopped reaching components/",
    ).toBeGreaterThanOrEqual(90);

    /* See the note at the call site: the braces must balance in every file
     * this census draws a conclusion about. */
    expect(
      unbalanced,
      "The brace scanner lost its balance in these files, so the enclosing " +
        "expression it reported for each label in them is not trustworthy. Fix " +
        "the tokenizer in `parse` — most likely it has met a regex literal " +
        "containing a quote or a brace.",
    ).toEqual([]);

    /* A FLOOR, not an equality: adding a button that says "Saving…" must not
     * fail a test about spinners. But a parse that collapses fails here. */
    expect(all.length, "the label scan collapsed").toBeGreaterThanOrEqual(120);

    /* And the two independent counts must agree exactly. `independent` is a
     * `split` over the same stripped source; `all` came out of the brace
     * scanner. They count the same occurrences by different means. */
    expect(
      all.length,
      `the labels counted by split (${independent}) and the labels the brace ` +
        `scanner placed (${all.length}) disagree — the scanner is losing ` +
        `occurrences, so the check below is reasoning about a shrunken set`,
    ).toBe(independent);
  });

  it("placed every label inside a JSX expression", () => {
    const homeless = all
      .filter((h) => h.expression === null)
      .filter((h) => !(key(h) in KNOWN_WITHOUT_SPINNER))
      .map((h) => `${h.path}:${h.lineNo} — ${h.line}`);
    expect(
      homeless,
      "These in-flight labels sit in no `{…}` at all, so this census cannot " +
        "say whether a spinner is beside them. Either they are not JSX (add " +
        "them to KNOWN_WITHOUT_SPINNER with a reason) or the brace scanner " +
        "lost its balance.",
    ).toEqual([]);
  });

  it("renders a Spinner in the same expression as every label", () => {
    const naked = all
      .filter((h) => !(key(h) in KNOWN_WITHOUT_SPINNER))
      .filter((h) => !(h.expression ?? "").includes("<Spinner"))
      .map((h) => `${h.path}:${h.lineNo} — ${h.line}`);

    expect(
      naked,
      "These in-flight labels are a word that stops changing, which reads as " +
        "a crash rather than as work in progress. Wrap the label with the " +
        "spinner — KEEP THE WORD, the spinner is aria-hidden and the word is " +
        "all a screen reader gets:\n\n" +
        '  {pending ? (\n' +
        '    <span className="inline-flex items-center gap-1.5">\n' +
        "      <Spinner />\n" +
        "      Saving…\n" +
        "    </span>\n" +
        '  ) : (\n' +
        '    "Save"\n' +
        "  )}\n",
    ).toEqual([]);
  });
});

describe("the spinner-less exceptions are still exceptions", () => {
  const { all } = census();

  it("lists nothing that has since grown a spinner, or moved", () => {
    const stillNaked = new Set(
      all
        .filter((h) => !(h.expression ?? "").includes("<Spinner"))
        .map((h) => key(h)),
    );
    expect(
      Object.keys(KNOWN_WITHOUT_SPINNER).filter((k) => !stillNaked.has(k)),
      "An exception list nobody prunes becomes permanent. These entries no " +
        "longer name a spinner-less label — either the site was fixed, or its " +
        "line was rewritten and the key no longer matches anything. Delete " +
        "them from KNOWN_WITHOUT_SPINNER, or re-key them.",
    ).toEqual([]);
  });
});

/**
 * AN EXCEPTION WITHOUT A CEILING IS A REPEAL.
 *
 * `SubmitButton` renders the spinner for all 48 of its call sites, which is
 * why it was the one edit worth more than the other ninety-eight: those
 * buttons had no in-flight word AT ALL — they greyed out and said nothing, so
 * there was no label for the census above to find and no way for a user to
 * tell a submitting form from a dead one.
 *
 * Exactly one caller opts out: `RowActions`'s armed confirm button. The reason
 * is geometry and it is not negotiable from a container — a spinner WIDENS the
 * confirm, and CLAUDE.md's "Cancel inherits the delete pixel" entry measured
 * that cluster in real Chromium across three axes, the third being a confirm
 * drifting under the delete's vacated pixel precisely because the armed pair
 * stopped covering the same span. `ConfirmDelete`'s own header states the
 * invariant: once armed, it renders exactly the DOM it rendered before. No
 * test in this repo can see layout (happy-dom returns zeros from
 * `getBoundingClientRect`), so the honest move is to leave that one button
 * alone and pin the count here.
 *
 * A second `spinner={false}` therefore fails the build. Not because two would
 * be wrong on principle — because the next one will be somebody quietening a
 * spinner they found visually noisy, and that is the opposite of why this prop
 * exists.
 *
 * NOTE WHAT THIS BLOCK RELIES ON: `parse()` strips comments, and the comment
 * at the opt-out site QUOTES `spinner={false}` in its own prose. A raw-text
 * scan would count two and pass an assertion of "exactly one" against the
 * wrong two. That is the #185 shape, and this census was already built for it.
 */
describe("SubmitButton's spinner opt-out", () => {
  const scanned = sources(scanRoots());

  it("is used exactly once, and only on the armed confirm button", () => {
    const sites = scanned.flatMap(({ path, text }) =>
      [...parse(text).code.matchAll(/spinner=\{false\}/g)].map(() =>
        relative(webDir, path).split("\\").join("/"),
      ),
    );
    expect(
      sites,
      "`spinner={false}` suppresses the only indication that a form is in " +
        "flight, and it exists for one measured geometry reason on one button. " +
        "If a new caller needs it, the armed-cluster measurement is what " +
        "justifies it — add the site here with that evidence, or take the " +
        "spinner.",
    ).toEqual(["components/RowActions.tsx"]);
  });

  it("still renders a spinner for every caller that does not opt out", () => {
    const button = scanned.find((f) => f.path.endsWith("components/SubmitButton.tsx"));
    /* SCOPE control: if the walk stopped reaching this file, both assertions
     * below would be about nothing. Nothing is ever missing from a file you
     * do not read. */
    expect(button, "SubmitButton.tsx was not scanned, so this block is vacuous").toBeDefined();

    const { code } = parse(button!.text);
    expect(
      code,
      "SubmitButton no longer gates a spinner on its own `pending` — 48 create " +
        "buttons just went back to greying out silently, and the census above " +
        "cannot see it because those buttons carry no in-flight word to find",
    ).toMatch(/pending\s*&&\s*spinner\s*\?/);
    expect(code, "SubmitButton renders no Spinner at all").toContain("<Spinner");
  });
});
