### A correct field sitting under somebody else's sentence

The size field for "only the big ones" was rendered **after** the whole options
loop, which put it beneath the **last** radio — *"yes, every opening comes off"*
— while the number it sets only ever applies to `LARGE_ONLY`. A click-through
read it exactly that way: *"a user could easily think 'Big means 32 sq ft' is
part of the 'Yes' answer."*

**Nothing was mis-wired, which is why every test passed.** The name, the parse,
the save, the threshold and the quantity were all correct and all asserted. It
was a layout fact on the setting that decides how much board a sub charges for,
and **no test in this repo can see layout** — the screen suite renders in
happy-dom, which does no layout at all and returns zeros from
`getBoundingClientRect`.

The field renders inside the loop now, conditional on that option's own value,
so it appears directly under the answer it belongs to. Pinned by the one
structural thing source can carry — the conditional sits between the loop's
opening and its close — and mutation-tested three ways: the field leaving the
loop, rendering under every option, and attached to the wrong answer.

### A module about tolerant numbers that wrote its own numbers intolerantly

`lib/numeric-input.ts` exists because a contractor types `2,800` and every
parser in the app refused it. Its own refusals were printing **`10000`** — the
one notation it was built to stop insisting on. From the same click-through:
*"the error message writes 10000 without a comma, which is slightly odd next to
a field that now accepts 2,800."*

Bounds are formatted `en-US` now, matching the thousands separator the module
accepts, so it is the same convention in both directions rather than a locale
decision. No bound under 1,000 moves, which is every pre-existing caller — the
retainage message is still `between 0% and 100%`, and that test is the
regression guard for it.

### The 503, recorded again and still unattributed

Four saves in that click-through: two returned **200**, two returned **503**, and
**all four persisted** — confirmed by reload each time. The refusal path (a
rejected `0`) returned 200 and refused correctly.

What is established: it is **not our code throwing** — Vercel reports zero
runtime errors across two separate windows — and it is **not the action's own
request**, because the action resolved `ok` (the form checks `result.ok` before
saying "Saved.", pinned by a test) and the data landed every time. The remaining
candidate is the `router.refresh()` that follows a successful save, whose failure
is invisible to the user because the form already shows what they typed.

What is **not** established is the cause. The MCP's runtime logs carry no status
codes, so they cannot identify the request; the Vercel CLI, which reads request
logs that do, is not installed here. Closing this needs somebody with the
dashboard's request log for `POST /settings` in that window. Recorded rather
than guessed at, for the second time.
