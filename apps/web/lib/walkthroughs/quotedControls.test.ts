import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WALKTHROUGHS } from "./index";

/**
 * A TOUR MAY NOT QUOTE A CONTROL THAT DOES NOT EXIST.
 *
 * `/jobs/new`'s tour said: *"Press Create job. It starts as an estimate,
 * and you land on the job's page to add prices."* There has never been a
 * button reading "Create job" on that form, and pressing the one that IS
 * there goes to the wizard's second screen, not to the job page. Two false
 * claims in one sentence, spotlighting the button they were wrong about.
 *
 * This reader cannot check. He is not going to open another tab and
 * compare; he is going to conclude the help is guessing and stop reading
 * it — which costs more than the tour was ever worth, because the tour is
 * the only thing in the product that explains the product.
 *
 * SO: every phrase a walkthrough puts in CURLY QUOTES is treated as a
 * quotation of something on screen, and must appear verbatim in the app's
 * own source. Curly quotes specifically — a tour writes “Add a new GC”
 * when it means the button and "a sentence or two" when it means prose, and
 * the distinction is already observed throughout these files.
 *
 * What this can and cannot prove, stated plainly because a check that
 * overstates itself is the failure mode this repo keeps paying for: it
 * proves the string is WRITTEN somewhere a user-facing file could render
 * it. It cannot prove that string reaches the screen, or that it reaches
 * THIS screen. It is a spelling check against the real spelling, and it
 * would have caught the defect above on the day it was written.
 */

const webRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The directories whose files can put text on a screen.
 *
 * Each is asserted to exist below. CLAUDE.md's newest census scar is
 * precisely this: a check with the right pattern and the wrong scope, where
 * no size assertion can help — "nothing is ever missing from a directory you
 * do not walk".
 *
 * `lib` is here because this file's FIRST run proved the point on itself.
 * With only `app` and `components` it reported /dashboard's “Needs pricing”
 * as a phantom control; the label is real and lives in
 * `lib/estimate-stage.ts`, which the walk could not see. A census that
 * reports a true sentence as a lie is the same defect as one that reports a
 * lie as true, and it costs more, because somebody edits the correct string.
 */
const SOURCE_DIRS = ["app", "components", "lib"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Comments stripped, for the reason #185 already paid for: a census that
 * reads its own documentation answers nothing. The first version of THIS
 * file failed its own mutation test on exactly that — the button label was
 * changed in `NewJobForm.tsx` and the check stayed green, because the old
 * label was still quoted in a comment explaining why it had changed.
 */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * Everything the app's own files could render, as one haystack. Built once:
 * this is well over a thousand files and the alternative is re-reading them
 * per quoted phrase.
 *
 * THE WALKTHROUGHS THEMSELVES ARE EXCLUDED, and that exclusion is the whole
 * check rather than a detail. `lib/walkthroughs/` sits inside `lib`, so
 * without this every quoted phrase matches THE TOUR THAT WROTE IT and the
 * file reports a perfect app no matter what the app says. The mutation that
 * caught it: change the button's label, leave the tour alone, and the
 * second version of this file went green. A census that can find its own
 * question in its own answer is the vacuous shape this repo keeps
 * rediscovering, and it very nearly shipped here too.
 */
const haystack = (() => {
  const walkthroughDir = join(webRoot, "lib", "walkthroughs");
  const files: string[] = [];
  for (const name of SOURCE_DIRS) {
    const dir = join(webRoot, name);
    expect(statSync(dir).isDirectory(), `${dir} is not a directory`).toBe(true);
    files.push(...sourceFiles(dir).filter((f) => !f.startsWith(walkthroughDir)));
  }
  expect(files.length, "the source walk found no files").toBeGreaterThan(200);
  expect(
    files.some((f) => f.startsWith(walkthroughDir)),
    "the walkthroughs are in the haystack, so every tour proves itself",
  ).toBe(false);
  // JSX wraps at arbitrary columns, so a label written across two lines is
  // the same label. Collapsing whitespace is what makes the comparison
  // about the words rather than about the formatter.
  return files
    .map((f) => withoutComments(readFileSync(f, "utf8")))
    .join("\n")
    .replace(/\s+/g, " ");
})();

/** Every “…” phrase in every step body, with the walkthrough it came from.
 *  Apostrophes inside a quotation are the typographic ’ and are not a
 *  closing quote; the pattern only ends on the closing double quote. */
function quotedPhrases(): { route: string; phrase: string }[] {
  const found: { route: string; phrase: string }[] = [];
  for (const walkthrough of WALKTHROUGHS) {
    for (const step of walkthrough.steps) {
      for (const match of step.body.matchAll(/“([^”]+)”/g)) {
        found.push({ route: walkthrough.route, phrase: match[1] });
      }
    }
  }
  return found;
}

/**
 * Quotations that are examples of what a PERSON would type, not of what
 * the app renders — a sample job name, a sentence to say to the assistant.
 * Listed one by one with the route they are on, so the exemption cannot
 * quietly widen: a new example has to be admitted here on purpose.
 */
const NOT_A_CONTROL = new Set([
  // /jobs/new — sample job names
  "Smith kitchen remodel",
  "Building C, level 3",
  // /dashboard, /ask — sentences to say to Ask C Stream
  "what's overdue?",
  "start a job for the Smith kitchen",
  "start a job called Smith kitchen for Jane Smith",
  // /punch-lists, /catalog, /equipment — sample rows a person types
  "touch-up paint, hallway",
  "5/8 drywall, hung and taped",
  "Genie lift #2",
]);

describe("a walkthrough may not quote a control that does not exist", () => {
  const phrases = quotedPhrases();

  it("finds quotations to check, in more than one walkthrough", () => {
    // Anti-vacuity, and the size assertion: a pattern that stopped matching
    // would report every tour in the app as accurate.
    expect(phrases.length).toBeGreaterThanOrEqual(10);
    expect(new Set(phrases.map((p) => p.route)).size).toBeGreaterThanOrEqual(3);
  });

  it("finds every quoted phrase verbatim in a file that could render it", () => {
    const missing = phrases
      .filter(({ phrase }) => !NOT_A_CONTROL.has(phrase))
      .filter(({ phrase }) => !haystack.includes(phrase.replace(/\s+/g, " ")))
      .map(({ route, phrase }) => `${route}: “${phrase}”`);

    expect(missing, "a tour quotes text that is nowhere in the app").toEqual([]);
  });

  it("holds the /jobs/new tour to the button that is actually there", () => {
    // The specific claim this file was written for, pinned so it cannot
    // regress quietly behind the general rule above.
    const step = WALKTHROUGHS.find((w) => w.route === "/jobs/new")?.steps.find(
      (s) => s.anchor === "new-job-create",
    );
    expect(step, "the /jobs/new tour lost its final step").toBeDefined();
    expect(step?.body).toContain("Start the job — add the work next");
    // And it must not promise the destination the wizard no longer goes to.
    expect(step?.body).not.toContain("job's page");
  });
});
