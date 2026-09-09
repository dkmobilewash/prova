/**
 * `changelog.d/` entries are well-formed, and the convention is still written
 * down where people read it.
 *
 * The directory exists so a PR stops editing the one line every other PR
 * edits. That only works while two things hold, and neither is self-evident
 * from the code: entries have to be shaped so `changelog-collect.mjs` can
 * fold them in, and CHANGELOG.md's own preamble has to keep pointing here.
 * The second is the one that rots — a convention nobody is told about is
 * abandoned within a week, and this repo has the scars to prove it.
 *
 * What this CANNOT see, said plainly so nobody trusts it further: whether an
 * entry is TRUE, whether it describes the PR it ships with, or whether
 * anybody ran collect. It checks shape and it checks that the instructions
 * still exist. That is all.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const entriesDir = join(repoRoot, "changelog.d");

function entryNames(): string[] {
  return readdirSync(entriesDir).filter((n) => n !== "README.md");
}

describe("changelog.d entries", () => {
  it("contains only .md files besides its README", () => {
    const strays = entryNames().filter((n) => !n.endsWith(".md"));
    expect(
      strays,
      `changelog.d holds ${strays.join(", ")}. Entries are markdown; collect ignores everything else, so a stray file is an entry that will never be published.`,
    ).toEqual([]);
  });

  it("starts every entry with a ### heading, because collect refuses otherwise", () => {
    const bad: string[] = [];
    for (const name of entryNames().filter((n) => n.endsWith(".md"))) {
      const first = readFileSync(join(entriesDir, name), "utf8")
        .split("\n")
        .find((l) => l.trim() !== "");
      if (!first?.startsWith("### ")) bad.push(`${name} (starts with ${JSON.stringify(first ?? "")})`);
    }
    expect(
      bad,
      `These entries would stop \`node scripts/changelog-collect.mjs\` dead: ${bad.join("; ")}. The first non-blank line must be a "### " heading.`,
    ).toEqual([]);
  });

  it("has no unresolved conflict markers in any entry", () => {
    const bad = entryNames()
      .filter((n) => n.endsWith(".md"))
      .filter((n) => /^(<{7}|={7}|>{7})/m.test(readFileSync(join(entriesDir, n), "utf8")));
    expect(
      bad,
      `Conflict markers left in ${bad.join(", ")}. One file per PR exists precisely so this cannot happen; if it did, two PRs picked the same filename.`,
    ).toEqual([]);
  });

  it("keeps CHANGELOG.md's preamble pointing at changelog.d", () => {
    // The mechanism is worthless if the file everyone opens still tells them
    // to edit it directly. This is the check that stops the convention dying
    // quietly rather than loudly.
    const preamble = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8").split("\n---\n")[0];
    expect(
      preamble,
      "CHANGELOG.md's preamble no longer mentions changelog.d, so nothing tells the next author where entries go.",
    ).toContain("changelog.d");
  });
});
