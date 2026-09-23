import { execFileSync } from "node:child_process";

/**
 * The file list a census reasons about, taken from git and DEDUPED.
 *
 * The dedupe is the reason this exists. `git ls-files --cached` prints a
 * conflicted path ONCE PER MERGE STAGE — three lines for one file while
 * a merge is unresolved — so a census comparing git's list against its
 * own directory walk fails with "the walk and git disagree about which
 * files exist" when nothing is wrong except an unfinished merge. That
 * happened, on `numericInputCensus`, and a red that really means "you
 * are mid-merge" is a red nobody believes on the day it is real.
 *
 * Centralised rather than repeated so the next census gets it for free:
 * two copies of a one-line filter is how one of them silently loses it.
 * `git-files.test.ts` builds a real conflicted repository to prove both
 * halves — that git does print the duplicates, and that this removes
 * them.
 */
export function listGitFiles(args: string[], cwd: string): string[] {
  const out = execFileSync("git", ["ls-files", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return [...new Set(out.split("\n").filter(Boolean))].sort();
}

/** The same command WITHOUT the dedupe, for tests that need to show what
 * git actually emits. Nothing but a test should want this. */
export function listGitFilesRaw(args: string[], cwd: string): string[] {
  return execFileSync("git", ["ls-files", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
}
