/**
 * The structural half of "a deep link is never hijacked."
 *
 * lib/onboarding-gate.ts's whole safety argument rests on ONE fact:
 * `redirectToOnboardingIfUnasked` is called from exactly one page,
 * `app/(app)/dashboard/page.tsx` — the only page a fresh signup or
 * sign-in ever lands on by default. If a second page started calling it
 * (a copy-paste onto `/jobs/[id]`, say, "so brand-new owners get asked
 * there too"), a deep link to that page would start getting intercepted,
 * which is exactly the defect this feature was rebuilt to remove. Nothing
 * about the TypeScript types stops that copy-paste; this file does.
 *
 * Same shape as `formActionCensus.test.ts`: a walk of the source, checked
 * against an INDEPENDENT count from `git grep` so the walk itself cannot
 * quietly stop finding files (CLAUDE.md, "a check that derives its input
 * has two failure modes").
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const appDir = resolve(fileURLToPath(new URL("../app", import.meta.url)));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".tsx") || name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function sitesOf(needle: string): string[] {
  const found: string[] = [];
  for (const file of walk(appDir)) {
    const source = readFileSync(file, "utf8");
    if (source.includes(`${needle}(`)) found.push(relative(repoRoot, file));
  }
  return found.sort();
}

/** The same two calls, found by `git grep` over the whole repo rather than
 * this file's own walk of `apps/web/app` — an independent method, so the
 * walk cannot silently stop looking somewhere and still pass. */
function sitesOfByGit(needle: string): string[] {
  let out: string;
  try {
    out = execFileSync("git", ["grep", "--untracked", "-l", `${needle}(`, "--", "apps/web/app"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
  } catch {
    // git grep exits 1 when nothing matches — a real possibility to catch,
    // not an error to swallow, so the caller sees an empty list either way.
    return [];
  }
  return out
    .split("\n")
    .filter(Boolean)
    .sort();
}

describe("the onboarding-gate census sees the same files git does", () => {
  it("agrees with git on where redirectToOnboardingIfUnasked appears", () => {
    expect(sitesOf("redirectToOnboardingIfUnasked")).toEqual(sitesOfByGit("redirectToOnboardingIfUnasked"));
  });

  it("agrees with git on where redirectAwayFromOnboardingIfAsked appears", () => {
    expect(sitesOf("redirectAwayFromOnboardingIfAsked")).toEqual(
      sitesOfByGit("redirectAwayFromOnboardingIfAsked"),
    );
  });
});

describe("the onboarding gate has exactly one door in and one door out", () => {
  it("redirectToOnboardingIfUnasked is called from dashboard/page.tsx and nowhere else", () => {
    expect(sitesOf("redirectToOnboardingIfUnasked")).toEqual(["apps/web/app/(app)/dashboard/page.tsx"]);
  });

  it("redirectAwayFromOnboardingIfAsked is called from welcome/page.tsx and nowhere else", () => {
    expect(sitesOf("redirectAwayFromOnboardingIfAsked")).toEqual(["apps/web/app/welcome/page.tsx"]);
  });

  it("the two functions are never called from the same file — in and out are different pages", () => {
    const inSites = sitesOf("redirectToOnboardingIfUnasked");
    const outSites = sitesOf("redirectAwayFromOnboardingIfAsked");
    expect(inSites.filter((f) => outSites.includes(f))).toEqual([]);
  });
});
