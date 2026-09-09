# `changelog.d/` — one entry per PR, so the changelog stops causing conflicts

`CHANGELOG.md` is newest-first. Everybody prepends to the same first line,
so every merge re-conflicts every other open PR — and a conflicted PR
**never queues CI at all**, which reads exactly like a passing one.

On 2026-09-09 that cost four resolutions of the same conflict across three
PRs, one CI run that never started and was nearly read as "still running",
and one merge race that the API reported as success. None of it was
anybody's mistake; it is what a single shared first line does when three
agents work at once.

So a PR no longer edits `CHANGELOG.md`. It adds **one file here**.

## Writing an entry

Name the file after your branch, which is unique per PR and therefore
cannot collide:

    changelog.d/claude-prova-contractor-os-e3f0iz.md

**Only uniqueness actually matters**, and the branch name is just the
convenient way to get it. If you are REUSING a branch that already has a
pending entry — an agent branch restarted from `main` after its last PR
merged — that name is taken, and a second PR would overwrite the first
entry rather than collide loudly. Name it after the PR instead:

    changelog.d/219-our-blob-store-only.md

Found on the first reuse, one PR after this directory shipped.

The content is exactly the block that used to go at the top of
`CHANGELOG.md` — same voice, same shape:

    ### What actually changed, in plain English (Diego)
    `claude/prova-contractor-os-e3f0iz`

    Why it mattered, what was wrong before, and the specific check that
    proves it. Not which functions moved — `git log` covers that.

The first non-blank line MUST be a `### ` heading. `changelog-entries.test.ts`
fails the build otherwise, so a malformed entry is caught in CI rather than
at collect time.

## Collecting them

    pnpm changelog:check     # what would be folded in, writes nothing
    pnpm changelog:collect   # fold them in

Collect prepends every entry to `CHANGELOG.md` newest-first and deletes the
files it consumed. Order comes from the commit that ADDED each file, not
from its name or its mtime, so it does not depend on anyone remembering to
date it. Uncommitted entries sort newest, which is what you want when you
run `--check` on your own branch.

Run it whenever the directory has built up — it is one commit that touches
`CHANGELOG.md` and nothing else, so it conflicts with nothing.

## What did not change

`CHANGELOG.md` is still the record and still newest-first. Everything
already in it stays where it is. This only changes where an entry is
written down before it gets there.
