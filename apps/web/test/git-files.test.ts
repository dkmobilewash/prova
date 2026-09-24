import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The conflicted index, built rather than imagined.
 *
 * This is the test that was missing when the dedupe shipped: exercising
 * it needs a repository stopped mid-merge, which the repo running the
 * suite cannot be. So the test makes one — a throwaway repo in the OS
 * temp directory, two branches that edit the same line, and a merge left
 * unresolved on purpose.
 *
 * It asserts BOTH halves, and the first is the one that keeps the second
 * honest: git really does print a conflicted path once per stage. If a
 * future git stops doing that, this case fails loudly and says the
 * dedupe has become unnecessary, rather than quietly passing and leaving
 * a filter nobody can explain.
 */

let repo: string;

/** Identity passed per command: a CI runner has no global git config,
 * and a commit without one fails. */
const IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=Test"];

function git(...args: string[]): string {
  return execFileSync("git", [...IDENTITY, ...args], { cwd: repo, encoding: "utf8" });
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "prova-lsfiles-"));
  git("init", "-q", "-b", "main");
  mkdirSync(join(repo, "apps"));
  writeFileSync(join(repo, "apps", "a.ts"), "export const x = 1;\n");
  writeFileSync(join(repo, "apps", "untouched.ts"), "export const y = 2;\n");
  git("add", "apps/a.ts", "apps/untouched.ts");
  git("commit", "-qm", "base");

  git("checkout", "-qb", "other");
  writeFileSync(join(repo, "apps", "a.ts"), "export const x = 3;\n");
  git("commit", "-qam", "theirs");

  git("checkout", "-q", "main");
  writeFileSync(join(repo, "apps", "a.ts"), "export const x = 2;\n");
  git("commit", "-qam", "ours");

  // Left unresolved on purpose — this is the state under test.
  try {
    git("merge", "other");
  } catch {
    /* the conflict IS the fixture */
  }
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("listing files from a repository stopped mid-merge", () => {
  it("is genuinely mid-merge — the fixture holds a conflict", async () => {
    const { listGitFilesRaw } = await import("./git-files");
    const unmerged = listGitFilesRaw(["-u"], repo);
    expect(unmerged.length, "no conflict — the fixture stopped working").toBeGreaterThan(0);
  });

  it("git prints a conflicted path ONCE PER STAGE, which is the whole hazard", async () => {
    const { listGitFilesRaw } = await import("./git-files");
    const raw = listGitFilesRaw(["--cached", "--", "apps"], repo);
    const conflicted = raw.filter((p) => p === "apps/a.ts");
    // Three: the base, ours, theirs. If git ever stops doing this, the
    // dedupe below is dead weight and this line says so.
    expect(conflicted.length).toBe(3);
  });

  it("the helper returns each path once, so a walk can be compared with it", async () => {
    const { listGitFiles } = await import("./git-files");
    const listed = listGitFiles(["--cached", "--", "apps"], repo);
    expect(listed).toEqual(["apps/a.ts", "apps/untouched.ts"]);
  });

  it("leaves an ordinary repository alone — no merge, nothing to dedupe", async () => {
    const { listGitFiles, listGitFilesRaw } = await import("./git-files");
    // The same call after the merge is resolved: git stops emitting
    // stages, and the helper's answer does not change. A dedupe that
    // altered a clean listing would be hiding something instead.
    writeFileSync(join(repo, "apps", "a.ts"), "export const x = 4;\n");
    git("add", "apps/a.ts");
    git("commit", "-qm", "resolved");

    const raw = listGitFilesRaw(["--cached", "--", "apps"], repo);
    expect(raw.filter((p) => p === "apps/a.ts").length).toBe(1);
    expect(listGitFiles(["--cached", "--", "apps"], repo)).toEqual([...raw].sort());
  });
});
