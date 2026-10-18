### Two "surprises" from #624's click-through were correct, and are now pinned (Diego)
`diego/quote-freshness-pins`

**Test-only, and deliberately no behaviour change.** A browser test of #624
reported three surprises. One was a real bug in #623 and is fixed separately
(#626). The other two were correct, and correct-but-surprising is exactly what
somebody later "fixes".

**1. A lapsed price replaces the "priced N days ago" note rather than showing
both.** The tester read the disappearance as a bug. It is the design:
`isExpired` and `isStale` are two answers to one question, and the sub's own
date outranks our 90-day rule of thumb until it lapses — at which point expiry
is the truer answer anyway. Showing both would flag one quote twice for the same
reason. Pinned by asserting a quote that is **both** four months old and past
its date reports `expired` only, and that its note does **not** carry the day
count.

**2. A price held "until today" is live at 19:50 Denver even though UTC has
rolled over.** `quoteFreshness` compares two `YYYY-MM-DD` strings and reads no
clock, so whoever supplies `today` picks the timezone — and `/bids` supplies
`viewerToday()`, the viewer's own date, which is the rule
`components/localToday.ts` states for every date a person acts on. Using the UTC
date would mark such a price dead for the last six hours of every day.

The second pin is the more useful shape: it asserts the same quote at the same
instant is **live** on `2026-10-04` and **lapsed** on `2026-10-05`. The function
is right either way; the page's choice of `today` is the decision, and the test
is what says which choice is correct — so a later "fix" to UTC fails with a
reason rather than quietly shifting a boundary on money.

Mutation-proved: reordering `quoteFreshness` to check staleness before expiry
reds both the new exclusion pin and the existing "sub's own date outranks our
rule of thumb" test.

`git diff` on `lib/bid-levelling.ts` is **empty** — only the test file changed.
569 files / 8,852 unit tests.

**What is NOT in here.** The third surprise — a quote row still reading "Price
lapsed" after Save until a reload — has **no established cause and no fix**. I
diagnosed it as a dead `SubmitButton` spinner in every `ActionForm` and that was
wrong: `components/actionForm.test.ts` had already measured it, its header says
the `useFormStatus` inference "looked like it must break `SubmitButton`" and
does not, and its test asserts `disabled` and `aria-busy` mid-flight. It passes.
I reasoned from React's docs instead of reading the test beside the component.
The observation remains the #61 shape — committed row, stale screen, reload
fixes it — which that entry says needs a timestamp against a post-action
re-render measured at 1.5–4.4s. None was recorded. Left open rather than
invented.
