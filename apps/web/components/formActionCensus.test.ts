/**
 * No client form hands its submit to React's `action` prop.
 *
 * WHY THE PROP IS THE BUG, NOT ANY PARTICULAR USE OF IT. In React 19 a
 * `<form action={fn}>` (and a `<button formAction={fn}>`) goes through
 * `startHostTransition` in react-dom-client, which calls `requestFormReset`
 * UNCONDITIONALLY and only then runs the action. The reset does not wait to
 * hear whether the save worked. So every action in this app that returns
 * `{ ok: false, error }` — which CLAUDE.md makes the house style, because
 * production redacts a thrown message — renders its sentence next to a form
 * that has already been put back to its defaults. The person is told what
 * was wrong with choices that are no longer on screen.
 *
 * It shipped on the crew schedule (#304; "already on that job that day"
 * over a job picker that had snapped back to the first job), was designed
 * out of the lien-deadline and pre-bid forms in review, and was then found
 * by this file in four more that had carried it for weeks. The fix is always
 * the same: `onSubmit` + `preventDefault()` + `new FormData(currentTarget)`,
 * and reset only on success — `LogTimeEntryForm.tsx` is the reference.
 *
 * SCOPE: client components only ("use client"). A server component's
 * `<form action={serverAction}>` has no client state to lose and no returned
 * result to render — its failure path is a throw and the error boundary —
 * so it is not what this file is about. The scan still reads EVERY client
 * module in the workspace, not just `components/`, and it proves that: the
 * set of files it treats as client components must equal the set `git grep`
 * finds by a different method, so a walk that skips a directory, or a
 * directive check that stops matching, fails here rather than passing on an
 * empty question (CLAUDE.md, "a check that DERIVES its input has two
 * failure modes").
 *
 * COMMENTS ARE STRIPPED FIRST, both ways round. Half the files that were
 * fixed carry a paragraph quoting the old `<form action={…}>` — those must
 * not trip it. And a comment must not be able to hide a real one either:
 * the fixtures at the bottom check both.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

/**
 * Sites allowed to keep a form `action`, per file, with how many and why.
 * The count matters: an exception covers the forms that were reviewed, not
 * a second one added to the same file later.
 */
const KNOWN_EXCEPTIONS: Record<string, { sites: number; reason: string }> = {
  /* THE THREE #311 ENTRIES ARE GONE, AND THEIR ABSENCE IS NOW ASSERTED
     rather than merely true — see "the three #311 files carry no exception"
     at the bottom of this file.

     `QuickBooksMapping.tsx`, `JobDetailsForm.tsx` and
     `CompanyProfileForm.tsx` each sat here as a KNOWN BUG pointing at issue
     #311, because all three were in Diego's lane. They were converted to
     `onSubmit` + `preventDefault` on 2026-09-25 while triaging his unowned
     issues, so the exceptions are paid off rather than reworded — the same
     treatment `CatalogImport.tsx` got below.

     Removing an exception is what re-arms this census over the file, and
     that is the test for the fix: put `action={…}` back on any of the three
     and the offender list above goes red naming it. Verified by doing
     exactly that on all three before this line was written. */
  "apps/web/components/RowActions.tsx": {
    sites: 1,
    reason:
      "the armed confirm-delete form holds no fields at all — a button and nothing else — so " +
      "the reset has nothing to wipe",
  },
  "apps/web/components/ComplianceDocumentRow.tsx": {
    sites: 1,
    reason: "the Mark received form is a single button with no fields; the reset has nothing to wipe",
  },
  /* CatalogImport.tsx was here, and its reason was true about the RESET and
     wrong about the file. "The pasted price list lives in a textarea OUTSIDE
     the form, so a reset loses nothing" — correct, and beside the point: the
     action it posted to threw every refusal it had, including "only the
     account owner can import a price list" at an estimator who can legitimately
     reach `/catalog`. A thrown Server Action message is redacted in production
     and renders the error boundary, and the boundary UNMOUNTS the component
     the textarea's state lives in. The paste went, for a reason this prop
     does not cause and this census does not scan for.
     Converted 2026-09-21 to `<ActionForm>` — #414's component, which is this
     file's prescribed shape with the error rendering attached — so the
     exception is paid off rather than reworded. */
};

const SOURCE = /\.(tsx|ts|jsx|js|mjs)$/;

/** Every source file in the workspace, walked from the repo root rather than
 * from this file's directory — so no package can fall outside the scan. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".") || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(name)) out.push(full);
  }
  return out;
}

/**
 * Comments out, LINE COUNT KEPT — a block comment becomes its own newlines,
 * so a reported line number still points at the real line. The `[^:]` guard
 * keeps `https://` in a string from being read as a comment.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** A module is a client component when its FIRST statement is the
 * directive — after any header comment, which is where this repo puts one. */
function isClientModule(source: string): boolean {
  return /^\s*["']use client["']/.test(withoutComments(source));
}

/**
 * The attribute text of the JSX opening tag starting at `from`, with the
 * CONTENTS of every `{…}` removed — so `onSubmit={() => run({ action })}`
 * cannot read as an `action=` attribute, and an arrow's `>` inside a brace
 * does not end the tag early.
 */
function openingTagAttributes(code: string, from: number): string {
  let depth = 0;
  let out = "";
  for (let i = from; i < code.length; i++) {
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
  return out;
}

/** Line numbers of every form-action site in one module's source. */
function formActionSites(source: string): number[] {
  const code = withoutComments(source);
  const lineOf = (index: number) => code.slice(0, index).split("\n").length;
  const sites: number[] = [];
  for (const match of code.matchAll(/<form\b/g)) {
    const attrs = openingTagAttributes(code, match.index + "<form".length);
    if (/(^|\s)action=\{/.test(attrs)) sites.push(lineOf(match.index));
  }
  for (const match of code.matchAll(/(^|\s)formAction=\{/g)) sites.push(lineOf(match.index));
  return sites.sort((a, b) => a - b);
}

function clientModules(): Map<string, string> {
  const found = new Map<string, string>();
  for (const root of ["apps", "packages"]) {
    for (const full of walk(join(repoRoot, root))) {
      const source = readFileSync(full, "utf8");
      if (isClientModule(source)) found.set(relative(repoRoot, full), source);
    }
  }
  return found;
}

/** The independent count: git's index, not this file's walk, and a plain
 * line-start match rather than the comment-stripping directive check. */
function clientModulesByGit(): string[] {
  const out = execFileSync(
    "git",
    ["grep", "--untracked", "-l", "-E", `^["']use client["']`, "--", "apps", "packages"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter((path) => path && SOURCE.test(path) && !path.includes("node_modules/"))
    .sort();
}

describe("the census sees every client component", () => {
  it("finds the same client modules as git does, by a different method", () => {
    const mine = [...clientModules().keys()].sort();
    const gits = clientModulesByGit();
    // Floor first: two empty lists are equal.
    expect(gits.length, "git grep found almost no client modules — is this a checkout?").toBeGreaterThan(100);
    expect(mine, "the walk and the directive check disagree with git about which files are client components").toEqual(gits);
  });
});

describe("no client form submits through `action`", () => {
  it("has no form-action site outside the known exceptions", () => {
    const offenders: string[] = [];
    const seen = new Map<string, number>();
    for (const [path, source] of clientModules()) {
      const sites = formActionSites(source);
      if (sites.length === 0) continue;
      seen.set(path, sites.length);
      const allowed = KNOWN_EXCEPTIONS[path]?.sites ?? 0;
      if (sites.length > allowed) offenders.push(`${path}:${sites.join(",")}`);
    }
    expect(
      offenders,
      "a client <form action={…}> (or formAction) resets the form BEFORE the action runs in " +
        "React 19, so a returned refusal arrives over emptied fields. Use onSubmit + " +
        "preventDefault + new FormData(event.currentTarget), and reset only on success — " +
        "see components/LogTimeEntryForm.tsx",
    ).toEqual([]);

    // Exceptions are held to the code too: one whose file was fixed, renamed
    // or deleted is stale, and a stale exception is a free pass for the next
    // form written in that file.
    const stale = Object.entries(KNOWN_EXCEPTIONS)
      .filter(([path, { sites }]) => seen.get(path) !== sites)
      .map(([path, { sites }]) => `${path}: listed for ${sites}, found ${seen.get(path) ?? 0}`);
    expect(stale, "KNOWN_EXCEPTIONS no longer matches the code — update or remove the line").toEqual([]);
  });

  /**
   * THE INVERSE OF THE TEST THAT USED TO BE HERE, and the swap is the point.
   *
   * This read `expect(KNOWN_EXCEPTIONS["…/QuickBooksMapping.tsx"]?.reason)
   * .toContain("#311")` — it held the exception in place so nobody could
   * quietly drop the line and leave the bug. Now that the three files are
   * fixed, that assertion would be the thing keeping a stale free pass
   * alive, so it is replaced by one that fails if any of them comes BACK.
   *
   * Without this, re-adding an exception for one of the three is a two-line
   * change that makes the census green over a re-broken form, and the only
   * record that it was ever fixed is a merged PR nobody re-reads.
   *
   * These paths are named as a literal on purpose: they are three specific
   * files a specific issue was about, not a derived set, so there is no set
   * whose size could silently shrink here.
   */
  it("the three #311 files carry no exception, so the census is armed over them", () => {
    const fixedByIssue311 = [
      "apps/web/components/QuickBooksMapping.tsx",
      "apps/web/components/JobDetailsForm.tsx",
      "apps/web/components/CompanyProfileForm.tsx",
    ];
    // The paths must still exist, or this passes by naming nothing — the
    // "empty question" failure mode this file's header is built around.
    const missing = fixedByIssue311.filter((path) => !existsSync(join(repoRoot, path)));
    expect(missing, `renamed or deleted, so this assertion covers nothing: ${missing.join(", ")}`).toEqual([]);

    const regressed = fixedByIssue311.filter((path) => path in KNOWN_EXCEPTIONS);
    expect(
      regressed,
      "#311 fixed these by converting them to onSubmit. An exception here is a free pass for " +
        `the bug coming back: ${regressed.join(", ")}`,
    ).toEqual([]);
  });
});

describe("the scanner itself", () => {
  it("finds a real form action, arrow and all, across lines", () => {
    const source = `"use client";
export function F() {
  return (
    <form
      className="x"
      action={(formData) => save(a > b, formData)}
    >
      <input name="n" />
    </form>
  );
}`;
    expect(formActionSites(source)).toEqual([4]);
  });

  it("finds a bare function reference and a formAction on a button", () => {
    expect(formActionSites(`<form action={handleCreate} className="a">`)).toEqual([1]);
    expect(formActionSites(`<form>\n<button formAction={save}>Go</button></form>`)).toEqual([2]);
  });

  it("is not tripped by a comment quoting the pattern", () => {
    const source = `"use client";
// This was <form action={(formData) => save(formData)}> and it reset on failure.
/* Also once <form action={handleCreate}>. */
export function F() {
  return <form onSubmit={(e) => e.preventDefault()}>{/* <form action={x}> */}</form>;
}`;
    expect(formActionSites(source)).toEqual([]);
  });

  it("is not DISARMED by a comment either", () => {
    // An unbalanced brace or an early '>' in a comment must not swallow the
    // real tag after it.
    const source = `"use client";
// careful: { and > and <form in prose
/* } */
export function F() {
  return <form action={save}>x</form>;
}`;
    expect(formActionSites(source)).toEqual([5]);
  });

  it("does not read an `action` key inside a handler as the attribute", () => {
    expect(formActionSites(`<form onSubmit={() => run({ action: x, "action={": 1 })}>`)).toEqual([]);
    expect(formActionSites(`<form data-note="action={x}" onSubmit={go}>`)).toEqual([]);
  });

  it("treats a directive below a header comment as a client module, and prose as not", () => {
    expect(isClientModule(`/**\n * header\n */\n"use client";\nexport {};`)).toBe(true);
    expect(isClientModule(`// "use client" is not needed here\nexport {};`)).toBe(false);
    expect(isClientModule(`export const x = "use client";`)).toBe(false);
  });
});
