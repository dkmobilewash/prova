### A page says what kind of page it is; the shell decides how wide it is (Cyrus)
`cyrus/width-intent`

Cyrus has said more than once that the app is "stacked, ugly, frustrating,
confusing and takes way too long". Measured in Chrome on the deployed app at a
content area of **1272 x 632** — the port inside the rail and the metric bar —
`/settings` ran a single 768px column down the middle of it, left **504px
empty at the sides**, and took **5.69 screens** to get through.

**Any screens-to-scroll figure needs the viewport height it was taken at, or
it means nothing.** It is page height over viewport height. An earlier pass
reported this same page as "4.7 screens" with no height stated; it was a
shorter port, and neither number can be derived from the other. Every figure
below carries its port, and that is the transferable part of this entry.

Nobody chose the width. Across the 73 route files under `app/`, **55 centred
and capped their own column**; among the 59 `app/(app)` pages, **49 did,
making 65 separate width decisions** in nine different cap tokens —
`max-w-2xl` (672px) through `max-w-6xl`, plus `max-w-md`, `max-w-xl`,
`max-w-none` and `max-w-[5in]`. Each was defensible on its own page. 60% of
the screen was the sum.

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
them. Measured in Chrome at a 1272x632 content area, on the live app for the
before and with the shipped values applied to the same live pages for the
after — same data, same viewport, so the only variable is the change:

| | container | wasted side | screens to scroll (port 1272x632) |
| --- | --- | --- | --- |
| `/punch-lists` `split` | 768 -> **1272** | 504 -> **0** | 1.93 -> **1.12** |
| `/vendors` `working` | 768 -> **1272** | 504 -> **0** | 1.18 -> 1.16 |
| `/settings` `reading` | 768 -> 768 | 504 | 5.69 -> 5.69 |

The split column pair is 320px + 872px, and `/punch-lists` loses 514px of
height because the add-form stops sitting on top of the list. At 375px it is
one column with the form above the list — the order it already had — and no
horizontal overflow.

Said plainly: `/vendors` barely moves on screens-to-scroll because that
company's vendor list is EMPTY, so there are no rows to reflow. The width is
real; the row count is not there to show it.

`/settings` moving no pixels is the point of `reading`, not a failure of it:
what changed is that the page stopped owning the number. Its real problem is
5.69 screens of vertical stacking, which is density, not width — and widening
it would have made that worse, measured rather than asserted: the body text
runs **101 characters per line at 768px and 172 at the full width**. Past
about 90 the eye loses the start of the next line. That is the whole reason
`reading` exists and refuses to widen.

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

**One boundary stated rather than discovered later.** `PageShell.tsx` lives in
`packages/ui` and emits the exact class string the census fails route files
for — legal, because the census walks `apps/web/app` and the shell is not a
route file. That is the correct boundary AND the one the `theme-contrast`
scar was about: that census scanned `apps/web` for a month while the single
offending file sat in `packages/ui`, outside the walk. Nothing is wrong here
today; what is true is that a width mistake made inside `PageShell.tsx` is the
one mistake this guard cannot see, which is why its values are argued from
measurements in its own header rather than from taste. Worth adding that
`packages/ui` appears in neither WORK-SPLIT.md nor CLAUDE.md's list of shared
files, and nine pages import from it — it is shared, and should be edited
surgically.

Typecheck, lint, the full suite (5910 tests) and `./scripts/preflight.sh`, all
by exit code. No migration, no new dependency, no new token.
