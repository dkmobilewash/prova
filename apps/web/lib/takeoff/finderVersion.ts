/**
 * ── WHICH FINDER PRODUCED THE CANDIDATES IN A LABEL FILE ──
 *
 * A saved label file is a set of verdicts about runs that a particular build
 * of the finder drew. Re-run a later finder over the same sheet and the
 * candidates are NOT the same list: on 2026-10-20 Camp Bow Wow A120's saved
 * file held `21.7 ft / 3.8 in` where the finder of that afternoon produced
 * `22.6 ft / 7.7 in`, after the view picking and the splitting had changed
 * underneath it. Nothing in the file said so, and the mismatch looked like a
 * matching bug rather than two different finders.
 *
 * So every file records the build that drew its candidates. It does not stop
 * a finder changing — it is a plan-set programme and it must change — it
 * makes the change VISIBLE at the point somebody is deciding whether a row
 * still means what it says.
 *
 * ── `-dirty` IS THE LOAD-BEARING PART, NOT THE SHA ──
 *
 * Nearly all labelling here runs from a worktree with uncommitted changes, so
 * a bare SHA would be the most confident lie in the file: it names a commit
 * whose finder is not the one that ran. The suffix is what makes the value
 * honest, and a reader should treat a `-dirty` version as "unknown build near
 * this commit" rather than as an identity.
 */
export const UNKNOWN_FINDER = "unknown";

/**
 * The build that is drawing candidates right now.
 *
 * `scripts/dev-local-plans.sh` sets `TAKEOFF_FINDER_VERSION` from git. Unset
 * it reads `unknown`, which is deliberate: a deployment has no git to ask,
 * and a file honestly saying it does not know beats one carrying a SHA that
 * was lying around in the environment.
 */
export function finderVersion(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const named = env.TAKEOFF_FINDER_VERSION?.trim();
  if (named !== undefined && named !== "") return named;
  // Vercel is the only other place that knows, and only for a deployed build.
  const vercel = env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (vercel !== undefined && vercel !== "") return vercel.slice(0, 12);
  return UNKNOWN_FINDER;
}

/**
 * Whether two recorded versions are the same build, for a reader deciding
 * whether saved rows can be trusted against fresh candidates.
 *
 * `unknown` matches NOTHING, including another `unknown` — two files that
 * both failed to record a version are not thereby from the same finder, and
 * treating them as equal is how a missing value becomes a false assurance.
 * The same goes for `-dirty`: two dirty trees at one commit are two different
 * finders unless somebody checked, which nothing here can do.
 */
export function sameFinder(a: string, b: string): boolean {
  if (a === UNKNOWN_FINDER || b === UNKNOWN_FINDER) return false;
  if (a.endsWith("-dirty") || b.endsWith("-dirty")) return false;
  return a === b;
}
