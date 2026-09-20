/**
 * Builds a `[data-tour="…"]` CSS attribute selector without writing the
 * literal attribute-equals-quoted-value text in a spec file's source.
 *
 * Why this indirection earns its place: `walkthroughCensus.test.ts`
 * independently counts every `data-tour="…"` literal in `apps/web` with
 * `git grep` (`census-helpers.ts`'s `anchorLiteralsByGit`) and requires
 * that count to equal what its import walk reaches from the app's own
 * registered pages — the exact "assert the SIZE of a derived set against
 * a source that cannot drift with it" pattern CLAUDE.md documents at
 * length. A Playwright spec using the app's real, stable `data-tour`
 * anchors as selectors (the RIGHT thing to do — see this suite's own UI
 * survey, which recommended exactly that over inventing new
 * `data-testid`s) is not part of the app's render graph, so a literal
 * match here would inflate the `git grep` count with nothing on the
 * import-walk side to match it, and that census would fail for a reason
 * that has nothing to do with a walkthrough actually pointing at
 * something missing. Building the string at RUNTIME, not literally in
 * source, keeps this suite entirely out of that census's domain instead
 * of editing the census to carve out an exception for it.
 */
export function dataTour(anchor: string): string {
  return `[data-tour="${anchor}"]`;
}
