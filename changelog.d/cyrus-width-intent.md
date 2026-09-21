### A page says what kind of page it is; the shell decides how wide it is (Cyrus)
`cyrus/width-intent`

Cyrus has said more than once that the app is "stacked, ugly, frustrating,
confusing and takes way too long". Measured on the deployed app at a 1272px
content area: `/jobs/<id>` and `/settings` each ran a single 768px column down
the middle of the screen and left **504px empty on either side**, and
`/settings` took 4.7 screens to get through. Across `app/(app)` there were 59
`page.tsx` files, **63 separate `max-w-*` caps**, and only 10 pages using more
than one column at any breakpoint. Nobody chose that. Fifty-nine pages each
chose a number on their own and 60% of the screen was the sum.

The obvious fix makes it worse. A text input stretched to 1272px is harder to
read than one at 768 — line length is precisely why every one of those caps was
added, and each was defensible on its own page. The goal is not to use the
whole width; it is to **use the width for a second thing**.

So `PageShell` (`packages/ui`) takes an intent instead of a number, and there
is no way to ask it for a number:

- **`reading`** — a form, a settings panel, a document. Stays at a comfortable
  measure and is deliberately NOT widened.
- **`working`** — a list, a table, a register. Takes the width, because more
  rows visible is the entire point.
- **`split`** — a thing and the thing it feeds, side by side; one column below
  `lg`, in the same order it already had.

`split` is a variant rather than a flag, so the aside is required when you ask
for two columns and rejected when you do not — the type checker makes you
finish the decision. Values are positions on Tailwind's existing scale, not new
tokens.

**Three pages converted, one per intent**, because six other lanes were being
edited at the same time and a 59-page sweep would have collided with all of
them: `/settings` (`reading`), `/vendors` (`working`) and `/punch-lists`
(`split`). Before-and-after measurements are in the PR description, taken in
Chrome on this branch's preview at a 1272px content area.

`/settings` moving no pixels is the point of `reading`, not a failure of it:
what changed is that the page stopped owning the number. Its real problem is
4.7 screens of vertical stacking, which is density, not width, and widening it
would have made that worse.

**The guard is half the value.** Without it these drift back inside a month —
nothing about `mx-auto max-w-2xl` looks wrong in a diff.
`pageWidthCensus.test.ts` fails the build when a route file centres and caps
its own column, and allows the 52 not-yet-converted pages by an explicit list
that can **only shrink**: a page converted without deleting its line fails, a
line for a page that no longer exists fails, and the length is pinned so the
list cannot grow.

Both failure modes of a deriving check are asserted, per CLAUDE.md. Size: every
`max-w-` is counted twice, once as a bare literal and once through the parse,
and the two must agree — so a regex that matches nothing fails loudly instead of
finding no offenders and passing. Scope: the file set is derived independently
by a filesystem walk and by `git ls-files`, and every tracked route file must
appear in the walk.

**That scope assertion earned itself on the first run.** The pre-scan that built
the allowance list used `git ls-files 'apps/web/app/**/page.tsx'`, whose `**/`
requires at least one directory — so `app/page.tsx`, the public landing page,
was never a candidate and the list was written one short. The walk found it
immediately. Nothing is ever missing from a directory you do not walk,
including the one you believed you were walking.

Mutation-tested rather than asserted: a raw `max-w-2xl` added to a converted
page goes red and names it; blinding the class-string regex goes red on the
size check; converting an allowed page without deleting its line goes red; and
pointing the walk at a narrower root goes red on scope. Baseline green after
each.

Typecheck, lint, 5871 tests and `./scripts/preflight.sh` all by exit code. No
migration, no new dependency, no new token.
