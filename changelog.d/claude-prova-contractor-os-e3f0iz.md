### One changelog entry per PR, so the changelog stops causing conflicts (Diego)
`claude/prova-contractor-os-e3f0iz`

`CHANGELOG.md` is newest-first, so every PR prepended to the same first
line and every merge re-conflicted every other open PR. A PR now adds one
file to `changelog.d/` named after its branch — unique per PR, so two of
them cannot collide — and `node scripts/changelog-collect.mjs` folds them
in later, in one commit that touches nothing else.

**The cost was measured before it was fixed, on 2026-09-09.** #213's single
conflict was resolved THREE times as `main` moved under it (#211, #208, then
#212 and #215); #208's was resolved twice, once by each of two sessions
working from the same parent minutes apart; #216 sat 8 commits behind. That
is four resolutions of one class of conflict across three PRs in a day.

**The expensive part was never the conflict.** On the middle #213 attempt the
push landed and *CI never queued*, because the branch conflicted with the new
`main` by then — and a PR in that state queues nothing. That absence was
nearly read as "still running" rather than "never started", which is the
`gh pr checks` scar arriving from a direction CLAUDE.md had not written down:
the conflict does not just delay the merge, it silently removes the evidence
you would merge on.

Ordering comes from the commit that ADDED each entry (`git log
--diff-filter=A`), not from its filename or mtime, so it does not depend on
anyone remembering to date a file — a claim that would rot like every other
claim this repo has paid for. An uncommitted entry sorts newest, which is
what `--check` should show you on your own branch.

`changelog-entries.test.ts` fails the build on a malformed entry, and — the
part that matters more — on `CHANGELOG.md`'s preamble no longer mentioning
`changelog.d`. A convention nobody is told about is abandoned within a week,
so the check that keeps the instructions present is the one doing the work.
It was written before the preamble was updated and failed on exactly that,
which is how it was confirmed to be capable of failing rather than assumed.

Nothing already in `CHANGELOG.md` moved; it is still the record and still
newest-first. Only where an entry is written down before it gets there.
