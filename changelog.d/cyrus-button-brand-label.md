### The shared primary button was white-on-yellow, and the census that exists to catch that was scanning the wrong directory (Cyrus)
`cyrus/button-brand-label`

`packages/ui/src/Button.tsx` shipped `bg-brand text-white
hover:bg-blue-700`. `brand` is the founder-approved yellow (#facc15), so
that is **white text at 1.53:1** — not marginal, unreadable — and the
hover still reverted the fill to the blue the re-skin replaced. Nine
pages import this button, `app/portal/[token]/page.tsx` among them, which
is the surface a general contractor sees.

`apps/web/tailwind.config.ts` says "Never put white text on this" three
lines above the token, and ~20 hand-rolled buttons across `apps/web`
already use `bg-brand … font-semibold text-neutral-900
hover:bg-yellow-500`. This one place missed the re-skin: the fill was
changed and the label, the hover and the comment above them were not. The
comment read "Primary stays blue-600", which is why nobody re-read the
line under it — a comment that describes the intended behaviour is the
most expensive kind to leave stale.

**The half worth reading is why the guard was green.**
`theme-contrast.test.ts` has a census — "puts the dark label it measured
on every brand fill in the app" — written for exactly this defect. It
resolved its scan root as `new URL("..", import.meta.url)`, i.e.
`apps/web`, and walked that tree. `packages/ui` is not in it. The one
offending file in the repo was never a candidate.

The size assertion (`found.length >= 6`) did not catch it and could not
have. That assertion guards against the PATTERN breaking — a scan that
suddenly matches nothing — and this scan matched twenty-odd class strings
happily. What was wrong was the SCOPE. **Nothing is ever missing from a
directory you do not walk**, which is a second failure mode for a check
that derives its input, alongside the empty-question one CLAUDE.md
already records.

The roots now come from Tailwind's own `content` globs, which are the
authoritative list of files whose classes reach this app: if a class is
not in one of them it does not render, and if it is, the census must see
it. Adding a workspace package to `content` extends the census with no
edit to the test. The test asserts one root per glob and that each root
exists, so a glob that resolves to nothing fails loudly instead of
quietly removing files from the check.

Mutation-tested three ways rather than argued:

| | Button | census scope | result |
| --- | --- | --- | --- |
| M1 | the real bug restored | new (from `content`) | **RED** — names `../../packages/ui/src/Button.tsx` |
| M2 | fixed | old (`appDir`) | green — no offender anywhere to find |
| M3 | the real bug restored | old (`appDir`) | **green — 20 passed** |

M3 is the one that matters: it reproduces the world as it actually
shipped, and the guard passes.

Also on this branch: `font-medium` moved off `base` and onto each
variant. Two Tailwind utilities of the same property resolve by
STYLESHEET order, not by which is written last in the class string —
measured in the built CSS, `.font-medium` at char 21611 and
`.font-semibold` at 21669. So a heavier weight appended after a lighter
one does win, and the reverse silently does not. Per-variant weights
remove the dependency on that ordering instead of relying on it.
