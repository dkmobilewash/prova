#!/usr/bin/env node
/**
 * Folds `changelog.d/*.md` into CHANGELOG.md, newest first, and deletes the
 * entries it consumed.
 *
 * WHY THE ORDER COMES FROM GIT AND NOT FROM THE FILENAME. A date in the name
 * is a claim the author has to remember to keep true, and this repo has paid
 * repeatedly for claims that rot. The commit that ADDED a file cannot be
 * wrong about when it was added. An entry with no such commit yet — still
 * uncommitted on your branch — sorts newest, which is what you want when you
 * run --check before pushing.
 *
 * It refuses rather than guesses: an entry whose first non-blank line is not
 * a `### ` heading stops the run and nothing is written. That is the same
 * shape the test enforces, so a malformed entry is caught in CI first and
 * this is the backstop.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const entriesDir = join(repoRoot, "changelog.d");
const changelogPath = join(repoRoot, "CHANGELOG.md");

const checkOnly = process.argv.includes("--check");

/** Everything in changelog.d except its own README. */
function entryFiles() {
  return readdirSync(entriesDir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort();
}

/**
 * ISO date of the commit that ADDED this file, or null when it has never
 * been committed. `--diff-filter=A` is what makes it the ADD rather than the
 * latest touch: a later edit must not reorder an entry.
 */
function addedAt(name) {
  try {
    const out = execFileSync(
      "git",
      ["log", "--diff-filter=A", "--follow", "--format=%aI", "--", join("changelog.d", name)],
      // stderr ignored: a repo with no commits yet writes a fatal line we
      // already handle by returning null, and it must not leak into output.
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const lines = out.split("\n").filter(Boolean);
    return lines.length ? lines[lines.length - 1] : null;
  } catch {
    return null;
  }
}

function readEntry(name) {
  const body = readFileSync(join(entriesDir, name), "utf8").replace(/\s+$/, "");
  const firstLine = body.split("\n").find((l) => l.trim() !== "");
  if (!firstLine || !firstLine.startsWith("### ")) {
    throw new Error(
      `changelog.d/${name}: first non-blank line must be a "### " heading, got ${JSON.stringify(
        firstLine ?? "",
      )}. Nothing was written.`,
    );
  }
  return { name, body, addedAt: addedAt(name) };
}

function main() {
  const names = entryFiles();
  if (names.length === 0) {
    console.log("changelog.d is empty — nothing to collect.");
    return;
  }

  const entries = names.map(readEntry).sort((a, b) => {
    // Uncommitted (null) sorts newest. Otherwise newest ISO date first; the
    // filename breaks ties so the result is deterministic for entries added by
    // the same commit.
    if (a.addedAt === b.addedAt) return a.name.localeCompare(b.name);
    if (a.addedAt === null) return -1;
    if (b.addedAt === null) return 1;
    return b.addedAt.localeCompare(a.addedAt);
  });

  console.log(`${entries.length} entr${entries.length === 1 ? "y" : "ies"}, newest first:`);
  for (const e of entries) {
    console.log(`  ${e.addedAt ?? "uncommitted"}  ${e.name}`);
    console.log(`      ${e.body.split("\n").find((l) => l.trim() !== "")}`);
  }

  if (checkOnly) {
    console.log("\n--check: CHANGELOG.md not written, no entries removed.");
    return;
  }

  const changelog = readFileSync(changelogPath, "utf8");
  // The preamble ends at the first horizontal rule; entries live after it.
  const marker = "\n---\n";
  const at = changelog.indexOf(marker);
  if (at === -1) {
    throw new Error("CHANGELOG.md has no `---` after its preamble; refusing to guess where entries start.");
  }
  const insertAt = at + marker.length;

  const block = entries.map((e) => e.body).join("\n\n") + "\n";
  const updated = changelog.slice(0, insertAt) + "\n" + block + changelog.slice(insertAt);
  writeFileSync(changelogPath, updated);
  for (const e of entries) unlinkSync(join(entriesDir, e.name));

  console.log(`\nCHANGELOG.md updated; ${entries.length} file(s) removed from changelog.d.`);
  console.log("Commit CHANGELOG.md and the deletions together.");
}

try {
  main();
} catch (err) {
  // A stack trace buries the one line that says what to fix, and Cyrus
  // runs this. Print the message, not the trace.
  console.error(`\nchangelog-collect refused:\n  ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
