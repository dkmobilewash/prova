### The bid recap marks up what the work costs, not what it sells for (Diego)
`diego/bid-recap-cost`

**Two documents on `main` disagreed about what one column means, and a bid was
priced from the disagreement.** `lib/bid-recap.ts` opened *"A job's line items
are its DIRECT cost"* and marked up `unitPrice`. `jobs.prisma` calls that same
column the *"client-facing **sale price**"* whose null means *"$0 **revenue**"* —
and contract value, WIP, pay applications, retainage, change-order value, the
proposal, the e-sign documents and the GC portal all read it that way. **Nine
surfaces read it as revenue; one read it as cost.**

Two of the writers put a genuine price in it. A catalog entry carries
`defaultUnitPrice 2.85` and `defaultBudgetedUnitCost 1.90`, and
`catalogLineFields` puts the price in `unitPrice`. So 100 SF of board, at 15%
material markup + 10% overhead + 10% profit, was bid at **$396.58 on work
costing $190** — the $2.85 already held the margin and the recap added a second
one. Every catalog-sourced, wall-schedule and AI-drafted line was affected.

Issue #512, and Diego chose the reading the schema already stated: `unitPrice` is
the sale price, and the recap's cost is `budgetedUnitCost`. **No migration** —
both columns already existed. The same job now bids at **$264.39**.

`budgetedUnitCost` and not `currentEstimatedUnitCost`, deliberately: they are
equal at creation and the recap only runs at ESTIMATE stage, but the budgeted one
cannot move afterwards, so a recap re-opened later shows the cost it was built
from rather than a figure a PM re-forecast in the meantime.

**The fixtures are the proof of what this was.** Every one in
`bid-recap.test.ts` changed from `unitPrice: N` to `unitCost: N` and **not one
hand-derived figure moved** — 3,750, 3,996.60, the profit-on-overhead 188.43, all
of it. The arithmetic was never wrong. It was reading the wrong column.

### The rule for a line with a price and no cost, which is where the risk was

Naive option 2 would have been **worse than the bug it fixed**: such a line would
contribute $0, take no markup, and vanish from the bid in silence.

And the population is not marginal. **The bid wizard's add-a-line form collected
no cost at all** — the first-job onboarding path — so for a contractor onboarded
through it, *every* line is price-without-cost and the whole job reads $0 direct
cost. An AI-drafted line falls back to the model's price with no cost. A
QuickBooks service item routinely carries a sales price and none. A change order
ADD has two independent optional boxes.

Diego's rule: **warn loudly, still allow Apply.** Those lines are counted,
totalled at their price, kept out of the cost base, marked up at nothing, and
named on screen — the shape `uncategorised` has always used. Reported *before*
the no-cost-type warning, because missing the cost is the bigger of the two
problems and naming the smaller one first would mislead.

Explicitly **not** filled in from `unitPrice`. That fallback is the double markup
preserved for exactly the lines most likely to hit it, and it is now mutation
#2 — three tests go red.

**And no backfill.** A migration setting `budgetedUnitCost = unitPrice` was
considered and rejected: it writes a 0%-margin cost nobody typed,
indistinguishable later from one somebody meant, and it feeds phase-code variance
and WIP budget reporting. Same reasoning that kept `productionRate` unbackfilled
in #514. So a wizard-built job reads $0 and says so — you cannot mark up a cost
nobody recorded. **The bid wizard now has a "Your cost" box**, so new jobs cannot
land there.

### Two things that fell out, and one is a safety fix nobody asked for

**Applying the recap is now idempotent.** Not by adding a guard: it computes from
`budgetedUnitCost` and writes `unitPrice`, so the input is no longer the output of
the last run. Before this, a second press **compounded** — and nothing prevented
it, because `applyBidRecap` has never read `appliedAt`; the only brake was a
sentence asking the estimator not to press again. Measured rather than argued: the
test that asserted `toBeGreaterThan` came back 2.66 against 2.66, and it now pins
idempotence instead. The screen's warning about a second press became false the
moment it was true and was rewritten.

**A genuine cost-only line now carries its cost into the bid.** General
conditions and overhead have a cost and no sale price; they used to contribute
$0, because the only figure being summed was the price they do not have. They are
in the cost base now and still receive no share of the spread — which is correct
estimating practice, since general conditions are recovered through the billable
lines. Tested: $500 of GC cost on a $3,000 job spreads $3,500 across the two
billable lines.

The reverse case is what stops the destructive failure. A price-with-no-cost line
has no cost share, so a spread would pay it $0 — and writing $0 back as its unit
price would **wipe a price somebody typed**. It is excluded, and a test says so.

`spreadTotal` needed a real fix rather than a rename: for a line the spread did
not pay, what it contributes is its **price**. That read `lineExtended` before,
which then meant price and was accidentally right; under the corrected meaning
the same call would have returned that line's cost and understated what Apply
produces. Getting it right also means the gap between the bid and the real line
total shows up through the figure the panel already displays whenever the two
differ — no second warning to build.

### The type is what found the call sites

`RecapLine.unitCost` is a **required** property, nullable but not optional. That
turned every call site into a typecheck failure instead of letting one silently
keep passing price-as-cost, and it found four — the estimate page,
`applyBidRecap`, the panel, and **`lib/ask/handlers.ts`'s `bid_recap` tool in
Cyrus's lane** (announced in `#prova-build` before the push, and kept to the
select and the mapping).

Mutation 4 is the proof it was load-bearing, and the first version of it was
vacuous: making `unitCost` optional produced 0 errors, but only because all four
sites supply it. Run properly — optional **and** one site omitting it — it is 0
errors against 1 for the required version. Nothing else in the codebase would
have caught a missed site.

### Checks

| | |
| --- | --- |
| suite | **7,942 pass** (491 files) |
| tests moved | 19 — every recap fixture in the repo lacked a cost column |
| new tests | 14 |
| mutations | 4 run, **4 caught** |
| typecheck / lint | 0 errors |
| migration | none |

| | Mutation | Result |
| --- | --- | --- |
| M1 | `extendedCost` reads `unitPrice` again — the original bug | **21 red** |
| M2 | fall back to `unitPrice` when cost is null | 3 red |
| M3 | `spreadTotal` sums cost for a line the spread did not pay | 2 red |
| M4 | `unitCost` optional, one call site omitting it | 0 errors vs 1 |

`lineExtended` is now `extendedCost`, with `extendedPrice` beside it. The old
name said only "extended" and was read as cost by one file and as price by nine,
which is this whole issue in one identifier; nothing outside the module ever
imported it, so the rename cost nothing.

### Flagged, not fixed

- `setLineCostCategory` is not wrapped in `runAction`, so a Prisma failure
  reaches production as a redacted digest.
- `action-capability-guards.test.ts:1623`'s comment says `saveCompanyBidDefaults`
  is owner + `MANAGE_ESTIMATING`; it asserts `MANAGE_COMPLIANCE`.
- `exportCompletenessCensus` is model-level, so an export column list can go
  stale without failing.
- **#515 is not a prerequisite of this change, and I said it was twice in
  Slack.** Takeoff lines carry neither price nor cost, so they contributed $0
  before and contribute $0 now; this only makes them visible rather than silently
  absent.
