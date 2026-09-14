### The "merged = empty `git log`" rule was wrong for squash merges (Diego)
`diego/claude-md-squash-merge-rule`

CLAUDE.md's prime directive said "Merged = `git log main..origin/<branch>`
prints nothing" and its Git rules repeated it as "empty output is the only
proof it landed." That is true for a merge commit and false for a squash
merge — which is what this repo actually does (`gh pr merge --squash`). A
squash writes the branch's changes as a new commit with a new SHA, so the
branch's original commit never becomes an ancestor of `main`, and the
command still prints it after a successful squash. It bit 2026-09-14 when
#268 squashed cleanly and the verification read "not merged" because the
old SHA was still listed.

Both spots now say the proof for a squash is the squash commit's CONTENT:
`git log --oneline origin/main` names it (PR title + `(#NNN)`) and
`git show <sha> --stat` lists the same files. The SHA changes under squash;
content is the signal.
