### `main` has been red since #261, and three PRs merged on top of it (Cyrus)
`cyrus/main-is-red`

Not a claim from a diff. `gh run list --branch main --workflow ci.yml`
returns **failure** for `5db5a77` (#261), `7331790` (#265's predecessor),
`2ab8592` (#264) and `00b1972` (#265). The last green commit on `main` is
`b3e23e4`. Reproduced locally on a clean worktree at `00b1972` before
anything here was changed.

Three breaks, one cause. #261 made `describe` a **required** prop on
`ConfirmDelete`/`ConfirmDeleteButton`, and #262 renamed `navGroupsFor`'s
`showsSalesCrm` option to `showsInternal`. Every PR after them was green
against its own base, and CI never ran on a single commit where both
halves existed. That is this repo's "the check is the SHA, never the
colour" scar arriving from the far side: nothing was lying, every check
answered honestly about a tree that no longer exists.

  1. **`TimeEntryRow.tsx` (#260)** has a `ConfirmDelete` with no
     `describe`. This is the one `main`'s own CI log names, and the only
     failure it reports — `Test` runs before `Lint` and `Typecheck`, so
     the other two were masked behind it.

     Fixed with the prop that component's own comment argues for without
     naming. The author deliberately passed no `hint`, and gave the
     reason: `hint` renders as an extra flex item inside a `shrink-0`
     cluster, so a sentence widens the row instead of wrapping in it, and
     they had no browser to measure that at 375px. `describe` is not that
     — it wraps the delete button in a `<Hint>`, which is
     `display: contents` on the wrapper and `position: fixed` on the
     tooltip. No box, nothing in that cluster measured differently. The
     objection is real and does not apply to this prop.

  2. **`JobDetailsForm.tsx` (#265)** omits `describe` as well — a
     typecheck error, invisible while the Test step fails first.

  3. **`hintCensus.test.ts` (#261) calls #262's renamed option**, passing
     `{ showsSalesCrm: true }` to a parameter typed `{ showsInternal?:
     boolean }`. A typecheck error, and the interesting one: vitest does
     not typecheck, so at runtime the option was simply **inert**. The
     test named "describes every nav group, **including the one appended
     separately**" was the only check on the Internal group, and it was
     the one group it never saw — `navGroupsFor` returned six groups, not
     seven, every time it ran.

     Mutation-proved rather than argued, because a check that derives its
     own input is exactly what this repo has been bitten by: blank the
     Internal group's `description` and, with the old spelling, the test
     **passes**; with the fix it fails naming `Internal`. (The first
     attempt at that mutation silently failed to apply and both arms went
     green — which is the same failure in miniature, and is why the
     result above is stated with the mutation shown to have landed.)

Nothing else changed. Three files, three lines of substance, chosen so
that this lands on `main` without waiting for anything larger — a red
`main` is inherited by every branch cut from it, and Diego is back
Tuesday.

Verified on this branch: typecheck 4/4, lint 4/4, test 168 files /
2787 tests, build ✓.
