import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WHEN THIS PROJECT IS ALLOWED TO SKIP ITS OWN BUILD.
 *
 * ── WHY THERE IS A GUARD ON A ONE-LINE SETTING ──
 *
 * `vercel.json` cannot carry a comment, the setting is one `git` invocation, and
 * **its polarity is invertible in a way that fails silently in both
 * directions.** Vercel reads the exit code: *0 means SKIP the build, non-zero
 * means BUILD.* `git diff --quiet` exits 0 when it finds NO difference. So the
 * command as written says "nothing of mine changed, don't bother" — and a `!`
 * in front of it, or a `--exit-code` swapped for `--quiet`, would mean
 * "rebuild only when nothing changed", which is close to never. Nothing would
 * fail; this project would simply stop deploying, and the next person would
 * read the live commit off the page and wonder why it was old.
 *
 * ── WHAT IT COST TO LEARN THAT THIS WAS WORTH DOING ──
 *
 * 2026-10-13: Vercel refused three successive merges to `main` with
 * "Deployment rate limited — retry in 24 hours", pointing at
 * `?upgradeToPro=build-rate-limit`. The account is Hobby with ONE concurrent
 * build, and only 17 deployments had been created in the 24 hours before the
 * refusal, all of them inside a four-and-a-half-hour window — so it is a burst
 * limit and not the daily cap it was first diagnosed as.
 *
 * Every commit to this repo was building BOTH projects, because neither
 * `vercel.json` had an `ignoreCommand`. Measured over `main`'s last 30 commits:
 * **27 of them changed nothing this project depends on**, so nine builds in ten
 * were spent rebuilding a marketing tool whose files had not moved — while the
 * product's own merges were being refused for going too fast.
 *
 * ── WHY THE PATHSPEC IS EXACTLY THESE THREE THINGS ──
 *
 * `package.json` here declares NO workspace dependency — every dependency is an
 * external package, checked rather than assumed. So nothing under `packages/`
 * can change this build's output, and the complete set is: this app's own
 * directory, the lockfile, and the root manifest (either of which can move a
 * resolved version underneath it).
 *
 * The `:/` prefix makes each path repo-relative rather than relative to the
 * working directory, because Vercel runs this from the project's root
 * directory and `.` would mean something different there. Verified by running
 * the command from both places and getting the same answer.
 *
 * ── AND IT FAILS TOWARDS BUILDING ──
 *
 * A missing `HEAD^` — a shallow clone, a first commit — makes `git diff` exit
 * **128**, which is non-zero, which means BUILD. Measured, not assumed. The
 * costly direction is skipping a build that was needed; an unnecessary build
 * costs one build.
 *
 * `apps/web` deliberately has NO such setting, and the last case here pins
 * that: `app.cstream.ai` must never sit on an older commit than `main`, which
 * is the confusion that ate an evening. A skipped build leaves the previous
 * deployment serving, and for the product that is indistinguishable from the
 * deploy failure we had just spent hours chasing.
 */

const here = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("this project skips builds it cannot be affected by", () => {
  const own = JSON.parse(here("vercel.json")) as { ignoreCommand?: string };

  it("HAS an ignore command at all", () => {
    expect(
      own.ignoreCommand,
      "without this, every commit to the monorepo rebuilds this app — 27 of main's last 30 did",
    ).toBeTruthy();
  });

  it("SKIPS on no change, which is the polarity Vercel reads", () => {
    const command = own.ignoreCommand ?? "";
    // `git diff --quiet` exits 0 for "no difference", and Vercel reads 0 as
    // "skip". Both halves have to stay true.
    expect(command).toContain("git diff --quiet");
    expect(
      command.trimStart().startsWith("!"),
      "a negated command inverts the meaning: it would rebuild only when nothing changed",
    ).toBe(false);
    expect(
      command,
      "--exit-code prints the diff and is not the quiet form this reasoning is about",
    ).not.toContain("--exit-code");
    // Against the PREVIOUS commit, which is what Vercel gives us.
    expect(command).toContain("HEAD^ HEAD");
  });

  it("names every input that can change this build, and no more", () => {
    const command = own.ignoreCommand ?? "";
    // This app's own files, plus the two manifests that can move a resolved
    // dependency version underneath it. `package.json` here declares no
    // workspace dependency, so nothing in `packages/` belongs in this list.
    for (const path of [":/apps/lien-waiver", ":/pnpm-lock.yaml", ":/package.json"]) {
      expect(command, `${path} is not in the pathspec`).toContain(path);
    }
  });

  it("uses repo-relative pathspecs, because Vercel runs this from the app directory", () => {
    const command = own.ignoreCommand ?? "";
    const pathspecs = command.slice(command.indexOf(" -- ") + 4).trim().split(/\s+/);
    // Size first: a census over an empty list forbids nothing.
    expect(pathspecs.length, "no pathspecs parsed — this census is guarding nothing").toBe(3);
    for (const spec of pathspecs) {
      expect(
        spec.startsWith(":/"),
        `${spec} is relative to the working directory, which is the app folder on Vercel, not the repo root`,
      ).toBe(true);
    }
  });

  it("leaves apps/web ALWAYS deploying, deliberately", () => {
    // The product's alias must never sit on an older commit than `main`. A
    // skipped build leaves the previous deployment serving, which reads exactly
    // like the deploy failure this whole change came out of — so the saving is
    // taken only on the project where being a commit behind costs nothing.
    const web = JSON.parse(here("../web/vercel.json")) as Record<string, unknown>;
    expect(
      "ignoreCommand" in web,
      "apps/web must keep deploying on every commit, so production can never lag main",
    ).toBe(false);
  });
});
