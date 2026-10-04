/**
 * EVERY WAY A DOCUMENT ENTERS THE TRAY HANDS THE CLASSIFIER ITS TEXT.
 *
 * WHY THIS FILE EXISTS. `lib/intake/classify.ts` has a complete
 * text-evidence path: it matches "Certificate of Liability Insurance",
 * "Request for Taxpayer Identification Number", "IN WITNESS WHEREOF",
 * "Application and Certificate for Payment" and a `Project:` job hint, and
 * quotes the fragment it matched as the reason it shows a person. It reads
 * that text from `textPreview`. Until `pdf-text.ts` was written, NOTHING IN
 * THE REPO PRODUCED IT: four references in the whole codebase, being the
 * action reading it off a FormData, the email path passing `null`, and two
 * lines inside the classifier consuming it. Every detector that needed text
 * was unreachable on every live path.
 *
 * `classify.test.ts` was green throughout — 584 lines of it — because it
 * calls `classifyDocument({ textPreview })` directly. It proves the
 * DETECTORS work and says nothing about anybody FEEDING them, which is this
 * repo's "written, documented, and never called" shape wearing a form field.
 * This census is the half that test cannot cover.
 *
 * WHAT MAKES IT WORTH GUARDING rather than just fixing once: the classifier
 * is FREE. Pure regex, no model call, no query. It is the triage layer that
 * decides which documents deserve a paid read, and a whole-document read is
 * costed in-repo at $2.25–$4.50 against a 300-page monthly allowance. A
 * silently re-broken producer does not fail anything — it just quietly
 * pushes cost back onto the paid path and returns UNKNOWN to people.
 *
 * WHAT IT ASSERTS. The defect was a BROKEN CHAIN, not a broken function, so
 * the census walks the whole chain and every link is its own failure:
 *
 *   PRODUCER — every file that calls `recordIntakeDocument` also sets
 *   `textPreview` on the FormData it passes.
 *   CARRIER — `lib/actions/intake.ts` still reads that key off the FormData
 *   and still passes it into `classifyDocument`.
 *   CONSUMER — `classify.ts` still declares the field and still reads it.
 *
 * Any one of those three can be deleted without breaking a type, and each
 * one alone silently restores the original defect.
 *
 * AND THE THREE SHAPES CLAUDE.md REQUIRES OF A CHECK THAT DERIVES ITS SET:
 *
 *   SIZE — call sites are counted a second time by a different expression
 *   (files that IMPORT the action, rather than files that call it), and the
 *   two must agree. A regex that matches nothing is the failure that looks
 *   like a pass: nothing is ever missing a `textPreview` in an empty list.
 *
 *   SCOPE — roots come from `tailwind.config.ts`'s `content` globs, not from
 *   this file's directory. "Nothing is ever missing from a directory you do
 *   not walk" cost this repo a 1.53:1 button a green census could not see.
 *   Each root is asserted to exist, so a glob resolving to nothing fails
 *   loudly instead of silently shrinking the walk.
 *
 *   COMMENTS — every structural read is on source with comments STRIPPED,
 *   and here that is load-bearing rather than hygiene: `IntakeDropZone.tsx`
 *   names `recordIntakeDocument` in THREE separate comments and calls it
 *   once. A raw-text census would count four call sites in one file and
 *   could be satisfied — or defeated — by prose. That is #185's shape.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED. The inbound EMAIL path
 * (`lib/intake/inbound.ts`) passes `textPreview: null` on purpose, because
 * extracting text from an arbitrary emailed file is "parser attack surface a
 * webhook has no business opening". That judgement is untouched and is not a
 * gap this census wants closed by accident, so the exemption is asserted to
 * still CARRY ITS REASON rather than merely to exist — an exemption whose
 * argument has been deleted is one nobody can evaluate.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../tailwind.config";

const appDir = resolve(new URL("../..", import.meta.url).pathname);

/** Comments out, so nothing in prose can satisfy or defeat a structural
 * read. The same two expressions `clerkMountGate.test.ts` uses. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Every `.ts`/`.tsx` under a root, tests excluded. */
function sources(root: string): string[] {
  const out: string[] = [];
  /* A root that is not a directory returns EMPTY rather than throwing, so the
     scope assertion below reports it by name. An exception at module scope
     collects no tests at all, which reads as "no tests" and names nothing. */
  if (!(statSync(root, { throwIfNoEntry: false })?.isDirectory() ?? false)) return out;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.|\.spec\./.test(entry.name)) out.push(full);
    }
  };
  walk(root);
  return out;
}

/* THE ROOTS COME FROM `content`, NOT FROM THIS FILE'S DIRECTORY. */
const globs = (Array.isArray(config.content) ? config.content : []) as string[];
const roots = globs.map((glob) => {
  const star = glob.indexOf("*");
  return resolve(appDir, star === -1 ? glob : glob.slice(0, star));
});

/** A CALL, not a mention: the identifier followed by its opening paren.
 * `lib/` is outside the `content` globs, so the action's own definition is
 * never walked and needs no exclusion here. */
const CALLS = /\brecordIntakeDocument\s*\(/g;
/** The independent count: files that IMPORT the action. Shares no pattern
 * with `CALLS` — an import carries no paren. Every importer must be a
 * caller and every caller an importer, so the two sets pin each other. */
const IMPORTS = /^\s*(?:import\s*\{[^}]*\brecordIntakeDocument\b|\s*recordIntakeDocument,)/m;
/** Setting the key on a FormData, however the string is quoted. */
const SETS_PREVIEW = /\.set\(\s*["'`]textPreview["'`]/;

type Site = { file: string; calls: number; setsPreview: boolean };

const walked = roots.flatMap((root) => sources(root));

const callers: Site[] = [];
const importers: string[] = [];
for (const full of walked) {
  const stripped = stripComments(readFileSync(full, "utf8"));
  const calls = [...stripped.matchAll(CALLS)].length;
  const imports = IMPORTS.test(stripped);
  const name = full.slice(appDir.length + 1);
  if (imports) importers.push(name);
  if (calls > 0) callers.push({ file: name, calls, setsPreview: SETS_PREVIEW.test(stripped) });
}

describe("the intake classifier is fed the text it was built to read", () => {
  it("walks every directory whose files reach the app", () => {
    expect(
      roots.length,
      "tailwind.config.ts declares no `content` globs, so this census would be about nothing",
    ).toBe(globs.length);
    expect(roots.length).toBeGreaterThanOrEqual(3);
    for (const root of roots) {
      expect(
        statSync(root, { throwIfNoEntry: false })?.isDirectory() ?? false,
        `${root} is a content-glob root that does not exist — the census cannot see inside it`,
      ).toBe(true);
    }
    expect(walked.length, "walked no source files at all").toBeGreaterThan(0);
  });

  it("found call sites, counted a second way", () => {
    /* THE SIZE ASSERTION. If `CALLS` stops matching, this fails with two
       numbers rather than passing an empty list through every check below. */
    expect(
      callers.length,
      "no file calls recordIntakeDocument — either the pattern broke or nothing files a document any more",
    ).toBeGreaterThanOrEqual(1);
    expect(
      [...callers.map((c) => c.file)].sort(),
      "the files that import recordIntakeDocument and the files that call it disagree — one of the two patterns has drifted",
    ).toEqual([...importers].sort());
  });

  it("every caller sends the first page's text with it", () => {
    const bare = callers.filter((c) => !c.setsPreview).map((c) => c.file);
    expect(
      bare,
      `${bare.join(", ")} files a document without setting textPreview, so the classifier sees only its filename. ` +
        "Read the first page with `firstPageTextPreview` from lib/intake/pdf-text.ts and set it on the FormData.",
    ).toEqual([]);
  });

  it("the action still carries the key from the form to the classifier", () => {
    const action = stripComments(readFileSync(resolve(appDir, "lib/actions/intake.ts"), "utf8"));
    expect(
      /formData\.get\(\s*["'`]textPreview["'`]/.test(action),
      "lib/actions/intake.ts no longer reads textPreview off the FormData — every producer above is writing into nothing",
    ).toBe(true);
    expect(
      /textPreview\s*:/.test(action.slice(action.indexOf("classifyDocument("))),
      "lib/actions/intake.ts no longer passes textPreview into classifyDocument",
    ).toBe(true);
  });

  it("the classifier still declares and reads the field", () => {
    const classifier = stripComments(readFileSync(resolve(appDir, "lib/intake/classify.ts"), "utf8"));
    expect(
      /textPreview\??\s*:/.test(classifier),
      "classify.ts no longer takes textPreview — the chain has no consumer",
    ).toBe(true);
    expect(
      /input\.textPreview/.test(classifier),
      "classify.ts declares textPreview but never reads it, which is the defect this census exists for one level down",
    ).toBe(true);
  });

  it("the email path is still exempt for its stated reason, not by accident", () => {
    /* NOT a gap to be closed by someone tidying up. The webhook opens files
       nobody in this company chose; a drop zone opens a file a signed-in
       person picked, in their own tab. Asserting the REASON survives means
       the next person to change this has to read the argument first. */
    const inbound = readFileSync(resolve(appDir, "lib/intake/inbound.ts"), "utf8");
    expect(
      /textPreview:\s*null/.test(stripComments(inbound)),
      "lib/intake/inbound.ts no longer passes textPreview: null — if the email path now extracts text, that is a deliberate decision and this census should be updated to say so",
    ).toBe(true);
    expect(
      /parser attack surface/.test(inbound),
      "the comment explaining WHY the email path sends no text is gone, leaving an exemption nobody can evaluate",
    ).toBe(true);
  });
});
