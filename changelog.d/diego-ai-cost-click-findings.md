### Three defects a click-through found on the cost panel, one of them the number it exists to produce (Diego)
`diego/ai-cost-click-findings`

#589 shipped step 2 of the AI plan with `typecheck`, `lint`, 8,536 unit tests and
four censuses green. **Loading the page found three real defects in under ten
minutes**, which is this repo's oldest rule arriving on schedule: *real bugs here
have only ever been found by loading the page and doing the thing.* The
click-list in #589's own body is what produced them, and the browser tester's
report is the reason all three are written down rather than two.

**ONE — every feature row rendered its raw database key on a money screen.**

`AI_FEATURE_LABEL` is keyed in SCREAMING_SNAKE (`PLAN_INGESTION`) because it is a
TypeScript union and a settings column. `AskUsage.feature` stores kebab
(`plan-ingestion`) because it is a ledger string. The panel looked the label up
with the ledger's spelling, which is `undefined` for **every feature, always**,
and fell through to a `?? feature` fallback. The row read `ask · 2 calls · $0.43`.

The tester reported this as *"small inconsistency: `ask` in the cost list but
`Ask` in the usage list"* — reasonable, and it was not a casing difference. The
lookup never matched once.

**Two things of mine hid it, and both looked like care at the time.** An
`as keyof typeof` cast silenced the exact type error that would have failed the
build. And the fallback — written on purpose so an unnamed feature would not be
DROPPED from a bill — turned a total failure into something that reads as a rare
edge case. A graceful degradation is a disguise when it degrades on every row.

Two guards that already existed could not see it, and the reason is the #526
shape one step further out. `AI_FEATURE_LABEL` is a total
`Record<AiFeatureKey, string>`, so a feature with no label does not compile —
**that assertion was true and passing the whole time.** It proves the map is
COMPLETE; it cannot see a consumer indexing it with the wrong key. *Nothing is
ever missing from a map nobody can index.*

`askFeatureLabel` now derives the translation (kebab → SCREAMING_SNAKE) rather
than adding a second hand-kept list, and `askFeatureLabelCensus.test.ts` asks the
question neither old guard asked: not "does every key have a label" but **"does
every string the ledger can actually write resolve to one"**. It parses the
`AskUsageFeature` union from its own source with comments stripped (those doc
comments quote feature names in prose — the #185 shape), asserts the parsed count
equals `AI_FEATURE_KEYS.length` so a pattern matching nothing fails loudly, and
requires the fallback to fire for ZERO known features. Mutation-proven: restoring
the shipped lookup reds it naming all nine.

**TWO — the per-unit figure divided a 30-day numerator by a one-period
denominator.**

The number this whole step exists to produce. Numerator: every `AskUsage` row in
the last 30 days. Denominator: `askAllowancePeriod.findFirst({ periodStart: { gte:
from } })` — a single period. One line, two distinct failures:

  - **It fails blank.** With no period starting inside the window, `findFirst`
    returns null, every count reads 0, and every row says "no questions this
    month" while the usage block directly above shows calls in the same window.
    That is the symptom the click-through hit, and the tester flagged it
    correctly while saying they could not tell which cause it was — the page
    shows no dates.
  - **It fails LOUD on the 1st of a month.** Thirty days of spend over two days
    of usage renders a confident per-sheet figure with an "a month would be" line
    beneath it — measured at 3x in the test, up to ~15x early in a month. That is
    the figure feeding the $399 pricing decision `DECISIONS.md` has open, and
    `costPerUnit`'s own docstring calls an invented per-unit cost "the most
    confidently wrong number on the page". It was producing one, monthly.

**We got lucky in which mode fired first.** Blank is survivable; the wrong number
is the one that gets quoted.

The denominator now covers the same window: `allowanceOver` sums every period
overlapping it. A period is a UTC calendar MONTH with no end column, so the
query reaches back to `startOfUtcMonth(from)` — which has its own test, because a
filter that stopped at the window's own day would never FETCH the straddling
period and the fix would stay green while summing a list that was already short.

**THE STRADDLE IS DECLARED RATHER THAN HIDDEN.** The earliest period can begin
before `from` — a 30-day window opening 2 Oct reaches into September, whose
period began 1 Sept — and the counters are per-period, not per-day, so it
contributes 1 Sept as well. **Nothing records which day a unit was claimed on**,
so it cannot be apportioned, only stated. The denominator is therefore slightly
too large and every per-unit figure slightly too LOW. The panel says so in the
same small print as the FLOOR warning, and a test pins the DIRECTION: an
under-estimate of a cost is the survivable error, so the fix must never move the
figure the other way.

Narrowing the numerator to the period instead was considered and rejected: on the
2nd of a month it reports a cost per sheet from two days of data, which is a worse
measurement than a conservative one over thirty, and it answers a question nobody
asked — "what did it cost since Tuesday" rather than "what does a sheet cost".

**THREE — the total was correct and nobody could check it.**

The screen showed `$0.43` beside a usage block reading "1,285 tokens in, 267
out". Those tokens multiply out to about a cent. The tester's first conclusion was
that **a rate had been entered per-1,000 instead of per-million**, which would
mean every figure on a money screen was 1,000x overstated.

That hypothesis is refuted by the code — `PER_MTOK = 1_000_000` and the division
is `tokens × rate / PER_MTOK`, with the census asserting the rates. The $0.43 is
right: roughly 67,000 cache-WRITE tokens at $6.25/MTok, from Ask caching its
system prompt and tool definitions at four breakpoints. The usage block renders
`inputTokens` and `outputTokens` and **nothing else**, so two of the four token
kinds being charged for were invisible.

**That is the defect even though no number was wrong.** The screen made a correct
answer indistinguishable from a catastrophic one, and the only way to tell them
apart was to read the database — which is the definition of a cost screen that
does not work. A figure whose inputs are invisible gets distrusted when it is
right and trusted when it is wrong, and both directions are expensive.

`tokensOver` reports what the total was computed from, over the PRICED rows only
— counting unpriced rows' tokens beside a total that excludes them would
reintroduce the same mismatch — and the panel prints it.

**Two stale comments, riding along as the agreement requires.**
`AiCostPanel.tsx` said "three of the five rates are not confirmed yet", false
within hours of being written, and also described an uncomputable figure as
rendering "a dash with a reason" when the code renders `not priced`. Wrong about
its own output as well as about the rates. And `docs/ai/DECISIONS.md`'s **Open
questions** said the cost-per-sheet figure "cannot report a number: three of the
five rates are unconfirmed… until they are pasted in" — in the section whose
stated job is *"recorded so nobody re-derives them"*. A reader would have opened
`pricing.ts` to fill in rates that are already there and concluded the instrument
was half-built when it is merely unused. Both corrected with what the old
sentences said and why they would have misled, per this file's own convention.

The second one was found only because the first was grepped for rather than
fixed in place. Worth keeping: the line somebody points at is not always the
expensive instance of it.

Checked: `typecheck`, `lint`, **543 test files and 8,549 unit tests, all
passing.** Every fix mutation-proven — the shipped label lookup, the
single-period denominator, and the unpriced-token leak each red their own guard
and nothing else.
