import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe as group, expect, it } from "vitest";

/**
 * NOT "IS THE SENTENCE RIGHT" — "IS THERE A SECOND ONE".
 *
 * `indirect-costs.ts` shipped a `missingIndirectsSentence` building
 * "This estimate carries nothing for Cleanup and Dumpsters.", with three
 * passing tests, that nothing ever called. `MissingIndirects.tsx` writes the
 * sentence a person actually reads. Two copies of one piece of wording, and
 * the tested copy was the dead one — so every check in the repo was green
 * about text no user could see.
 *
 * CLAUDE.md's own lesson, arriving a third time: a completeness test proves a
 * list has every member and cannot notice a consumer that stopped reading it;
 * a census that the thing is written ONCE is the guard that survives somebody
 * helpfully inlining a copy. Both guards are needed and neither implies the
 * other.
 *
 * ── HOW THIS KEEPS ITSELF HONEST ──
 *
 *   - COMMENTS STRIPPED. `MissingIndirects.tsx`'s own docstring quotes the
 *     phrase, and so does the deletion note in `indirect-costs.ts`. #185 is
 *     the entry where a comment quoting a pattern disarmed the census written
 *     to find it, so a raw-text scan here would report two carriers forever
 *     and be switched off within a week.
 *   - THE WALK'S SIZE IS ASSERTED. A directory walk that silently returns
 *     nothing passes every assertion after it, because nothing is missing from
 *     an empty list.
 *   - IT NAMES THE FILE IT EXPECTS, rather than counting to one. A count of
 *     one would stay green if the sentence moved into a module nobody renders,
 *     which is the exact defect this file exists to stop.
 */

const appDir = resolve(new URL("..", import.meta.url).pathname);
const PHRASE = "carries nothing for";
const HOME = "components/MissingIndirects.tsx";

/** Block comments, and lines that are only a comment. Not a TS parser. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join("\n");
}

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // `e2e` is excluded deliberately: a spec asserting the sentence appears on
    // screen is a reader of the wording, not a second author of it.
    if (entry === "node_modules" || entry === ".next" || entry === "e2e") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sources(full, found);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

group("the general-conditions sentence is written in exactly one place", () => {
  const files = sources(appDir);

  it("walked a real tree, so an empty result cannot pass as a clean one", () => {
    expect(files.length, "the walk found almost no source files — fix the scope").toBeGreaterThan(200);
  });

  it("finds the wording only in the component that renders it", () => {
    const carriers = files
      .filter((file) => stripComments(readFileSync(file, "utf8")).includes(PHRASE))
      .map((file) => file.slice(appDir.length + 1));
    expect(carriers).toEqual([HOME]);
  });

  it("and that component really does still carry it", () => {
    // Anti-vacuity: if the phrase were renamed everywhere, the test above
    // would pass on an empty list of carriers. This is the half that notices.
    const home = readFileSync(join(appDir, HOME), "utf8");
    expect(stripComments(home)).toContain(PHRASE);
  });
});
