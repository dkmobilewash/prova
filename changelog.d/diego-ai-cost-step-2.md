### Step 2 of the AI plan: what a model call costs, and what one unit of work costs (Diego)
`diego/ai-cost-step-2`

Two other sections of `docs/ai/DECISIONS.md` referred to step 2 for five days
while there was no step 2. Step 0 said *"Nothing prices that column today; the
cost work coming next will"*; step 1 said *"1,500 is a figure, not a
measurement. Whether it is sustainable depends on measured cost per sheet, which
step 2 produces."* An audit on 2026-10-01 found nothing in the repo computed a
dollar cost for any model call. **A reference to work that does not exist reads
exactly like a reference to work that does**, which is why it survived.

**A BILLED UNIT WAS COUNTED AND THEN THROWN AWAY, and that is the whole reason
this was blocked.** `AskUsageTotals.webSearches` has carried the per-search
count since lead search shipped, with a comment on the field saying *"each one
bills on top of tokens, which is why it is counted apart from them"* — and
`recordAskUsage` never put it in the insert. So the two features that use web
search, `lead-search` and `bid-research`, were exactly the two whose cost could
not be worked out. `AskUsage.webSearches` exists now; `usage.test.ts` asserts the
insert carries it, because the field existed and the value existed and the write
did not.

Rows before today read 0. Correct for the seven features that never search, a
FLOOR for the two that do: the API reported the real number at the time and
nothing wrote it down, so it is not recoverable. Any total spanning 2026-10-02
says it is a floor rather than presenting itself as complete.

**Rates are dated and a cost is never stored.** CLAUDE.md's rule — a stored
figure can disagree with what it was derived from. A cost is tokens times a
rate, so it is computed at read time against the rate in force ON THE ROW'S OWN
DAY. Each model carries a list of rates with a `from` date, so a price change
prepends an entry and every historical figure stays true; one mutable rate would
silently restate last quarter's bill.

**AN UNKNOWN COST IS A RESULT, NEVER A ZERO.** Only two of the five rates were
recorded anywhere in this repo when this started — Opus 5 at $5/$25 per MTok and
Haiku 4.5 at $1/$5, in DECISIONS.md. `pricing.ts` does not invent a rate: the
entire output of that module is a dollar figure somebody multiplies out to decide
whether an allowance is sustainable, and a confident wrong price is the one kind
of error nobody re-checks. An unset rate is `null`, not 0, because a zero
multiplies out to "this call was free" — indistinguishable from a cheap call and
the one reading that stops anybody asking. `costOf` returns a discriminated
result so every caller has to render the unknown case.

It needs only the rates a row actually USED, which matters more than it sounds:
requiring all five would make every row read unknown until the last one was
filled, and the per-unit figures this exists for would stay unavailable for no
reason.

**THE GATE WAS RED AND IS NOW SATISFIED.** `pricingCensus.test.ts` fails while
any rate a live feature needs is unset and names which, and two of its nine
assertions were red by design for exactly that reason. All five rates are now
recorded, read off the official pricing page on 2026-10-02:

| | input | output | cache read | cache write (5m) |
| --- | --- | --- | --- | --- |
| Opus 5 | $5 | $25 | $0.50 | $6.25 |
| Haiku 4.5 | $1 | $5 | $0.10 | $1.25 |

plus web search at **$10 per 1,000 searches**. Nothing was weakened to go green,
which is the only thing that would have made the red worthless — the two tests
keep their `GATE:` titles because a model routed somewhere unpriced next month
fails them the same way. Every rate carries a `source` string saying where the
figure came from and the day it was read, so a number cannot arrive anonymously
and cannot be checked against an invoice later without one.

**THE CACHE-WRITE RATE IS THE ONE THAT CAN BE WRONG QUIETLY,** and it is recorded
with the reason rather than just the number. Anthropic publishes two — a 5-minute
TTL and a 1-hour TTL — and for Opus 5 they are $6.25 and $10 per MTok, a 60%
difference on the same token. The 5-minute figure is correct here because
`ask.ts:54` sends `cache_control: { type: "ephemeral" }` with no `ttl` across all
four of its breakpoints, and that is the 5-minute default. If anybody adds
`ttl: "1h"`, these rates understate the bill and nothing in the repo will say so:
there is no per-row record of which TTL a cache write used. Written into the
`source` strings and `pricing.ts`'s header so the next person reads the
dependency rather than the number.

**THREE COST TESTS CHANGED SHAPE WHEN THE RATES ARRIVED, AND THEY WERE NOT
DELETED.** `cost.test.ts` was written against the gap: it reached the "a rate
this row needs is missing" branch through the real table, because a row with
cached tokens genuinely could not be priced. Filling all five in made that branch
unreachable from `RATES` and the three tests went red — not a regression, the
fixture they leaned on stopped existing. Deleting them would have been the #185
shape, a guard disarmed by the code getting better. They reach the branch two
ways now that survive a complete table: an injected rate lookup returning a
half-filled rate, and a model id that is not in the table at all. Mutation-proven
— `missing.length > 0` → `> 99` reds the injected-lookup test and nothing else,
so it is the sole guard on that branch and it is live.

**The denominator comes from the allowance ledger, not from a row count.**
`planSheetsUsed`, `addendumPagesUsed`, `pagesUsed` and `questionsUsed` already
existed on `AskAllowancePeriod`. Counting `AskUsage` rows would divide by the
wrong thing for three of the four — a plan-sheet row happens to be one sheet,
but one document read is one row and many pages, so a per-page figure taken from
rows would be the per-CALL figure wearing the wrong label. `*Used` includes the
failures, which is right for a cost: the claim increments it before the call and
`markAskAllowanceFailure` adds to `failed*` without taking anything back,
because a call that died halfway was still billed.

**On screen** (`/settings/assistant`, under the existing usage section): what the
month cost by feature, how many calls could NOT be priced and why, and cost per
unit of work with what a full month at the allowance ceiling would come to.
That last column is the figure the open question wants — whether 1,500 plan
sheets and 600 addendum pages a month are sustainable.

**What this step does not decide:** whether a plan set sits inside the $399 plan
or is metered. That is Diego's call and always was; this makes it answerable
rather than answering it. Both allowance figures stay figures rather than
measurements until a real month has run through a complete rate table.

Migration `20261002200000_add_ask_usage_web_searches`, additive with a default,
announced in `#prova-build` before the push. Written by hand rather than through
`migrate diff`: the `--from-migrations` form needs a shadow database, which is
the one thing CLAUDE.md forbids after it dropped `ep-icy-hat`.

**THE RECONCILIATION AGAINST A REAL BILL DOES NOT FULLY CLOSE, AND THAT IS
RECORDED RATHER THAN ROUNDED.** Diego's console figures for the last 30 days —
2,385,121 tokens in, 43,035 out, 26 web searches, **$21.53 actually billed** —
multiply out against the rates above to about **$13.26** if every token were
uncached Opus input. **$8.27 is unexplained.** About 1.3M tokens of cache WRITE
at $6.25/MTok would account for it and is the leading candidate, since a cache
write bills at 1.25× input and the console's "tokens in" does not separate it;
16.5M cache reads would also arithmetically fit and is implausible at this
volume. Not closed, and deliberately not presented as closed.

What the attempt did establish, which is worth more than the gap: **the console
is a SUPERSET of what `AskUsage` holds.** An eval run passes no usage reporter,
so it bills Anthropic and writes no ledger row — 12 of the 26 searches were my
own eval runs during this work. So a console total will always exceed the app's
own total, by an amount that is not a defect and is not recoverable, and the
screen's figures are the app's spend rather than the account's. `DECISIONS.md`
carries the arithmetic and both candidates.

Checked: `typecheck`, `lint`, and the full unit suite — **all green, with all
nine pricing-census assertions passing on real rates.**
