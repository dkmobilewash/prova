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
recorded anywhere in this repo — Opus 5 at $5/$25 per MTok and Haiku 4.5 at
$1/$5, in DECISIONS.md. `pricing.ts` does not invent the other three: the entire
output of that module is a dollar figure somebody multiplies out to decide
whether an allowance is sustainable, and a confident wrong price is the one kind
of error nobody re-checks. An unset rate is `null`, not 0, because a zero
multiplies out to "this call was free" — indistinguishable from a cheap call and
the one reading that stops anybody asking. `costOf` returns a discriminated
result so every caller has to render the unknown case.

It needs only the rates a row actually USED, which matters more than it sounds:
requiring all five would make every row read unknown until the last one was
filled, and the per-unit figures this exists for would stay unavailable for no
reason.

**THIS PR SHIPS WITH A RED BUILD, ON PURPOSE.** `pricingCensus.test.ts` fails
while any rate a live feature needs is unset, and names which:

    STEP 2 IS GATED ON THESE RATES.
      - claude-opus-5: cache read, cache write
      - claude-haiku-4-5: cache read, cache write
    ...plus WEB_SEARCH_PER_1K

So the PR cannot merge until the real numbers are pasted in from the Anthropic
console. `main` never goes red — the gate sits on the change rather than on the
branch everybody shares, which is the shape that makes a forcing function
survivable. Once the rates are in it becomes an ordinary census: a model routed
somewhere unpriced, a rate with no provenance, or a history that is not
newest-first fails it from then on. Every rate carries a `source` saying where
the figure came from and the day it was read, so a number cannot arrive
anonymously and cannot be checked against an invoice later without one.

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

Checked: `typecheck`, `lint`, and the full unit suite — **8,533 passing, with the
two pricing gates red by design and nothing else.**
