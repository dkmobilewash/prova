/**
 * ── WHICH DIRECTORIES A FILESYSTEM-WALKING CENSUS MUST NOT READ ──
 *
 * Six censuses each carried their own copy of this list, every copy spelling
 * the build directory as exactly `.next`. Then a second server was given its
 * own build directory, `.next-chrome`, and `hoursRenderCensus` failed with
 * 1,601 files walked against the 1,440 git reports — 161 compiled bundles it
 * had started reasoning about.
 *
 * Gitignoring the directory does NOT fix this, and CLAUDE.md says so in as
 * many words: an ignore rule is invisible to a walk. `.next-smoke` is both
 * ignored AND deleted on exit for that reason; a long-running server's build
 * directory cannot be deleted, so the walk has to know about it.
 *
 * Only one of the six censuses FAILED. The other five kept walking and would
 * have folded compiled output into what they reasoned about — the "wrong
 * scope" shape, where nothing is ever missing from a directory you should not
 * have walked but did. That is why this is one list rather than six, and why
 * the build-directory rule is a PREFIX: the next server wanting its own
 * output directory should not be able to break a census by existing.
 */
// The UNION of what the six copies named: they had drifted apart too, some
// listing `.git` and some `coverage`, so each census was walking a directory
// another had already decided to skip.
const NEVER_WALK = new Set(["node_modules", ".turbo", "dist", "coverage", ".git"]);

/** True when a directory entry's contents must not be read. */
export function skipDir(entry: string): boolean {
  return NEVER_WALK.has(entry) || entry === ".next" || entry.startsWith(".next-");
}

/** True when a path lies inside one of those directories. */
export function skipPath(path: string): boolean {
  return path.split("/").some((part) => part !== "" && skipDir(part));
}
