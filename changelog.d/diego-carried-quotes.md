### The winning quote was read, judged, and then retyped (Diego)
`diego/carried-quotes`

Bid levelling worked. An estimator could record what each sub quoted, see the
exclusions side by side, and decide who was actually comparable. Then they
retyped the winning number into a line item by hand — on the most expensive
lines in the bid, from a screen that already held the figure. That is the
re-entry `ARCHITECTURE.md` calls *"the single biggest source of error, wasted
time, and mistrust in this workflow, and the reason this product exists."*

Three things had to change, and the order matters because each one unblocked
the next.

**1. The decision had nowhere to live.** `bid-levelling.ts` refuses to name a
winner, on purpose and correctly: *"THE POINT OF LEVELLING IS NOT 'WHO IS
CHEAPEST'. IT IS 'ARE THEY EVEN BIDDING THE SAME THING'."* No scoring, no
weighting, no adjusted price. "Lowest" is an artefact of a sort, recomputed on
every render and never stored, because it is not an answer.

None of that changed. What was missing is the ESTIMATOR'S answer —
`BidQuote.carriedAt`, a date rather than a boolean for the reason `declinedAt`
beside it gives. Nothing infers it, nothing defaults to the low bid, and marking
a quote carried is not a claim it was the best one. One per package, cleared and
set in a transaction, so the screen can never show two answers to one question.

**2. A quote had no job to reach.** A `BidQuote` hangs off a `BidInvitation`,
which carries no line items; the estimate lives on a `Job`; and the two could
only be linked once the bid was **WON** — which is after every decision a quote
informs. So `linkBidToJob` dropped that gate, and `BidInvitation.wonJobId` now
means "the same piece of work" rather than "the job this became".

**3. And that change had a trap in it, which is the part worth reading.**
`bid-outcome-query.ts` filtered on `wonJobId: { not: null }` with **no status
check** — it inferred won-ness from the link existing, which was true only
because nothing could be linked before it was won. Left alone, every bid still
being estimated, and every bid eventually LOST, would have walked into the
bid-versus-actual comparison as though it had been won. That is the one figure
whose whole job is to teach an estimator, and `bid-outcome.ts` opens by refusing
to produce *"a real-looking number that will be remembered and repeated."* It
filters on `status: "WON"` now, which is what it always meant.

Two sibling call sites were checked and deliberately left alone: the link
picker's "already claimed" lookup wants **any** link (a job claimed by a losing
bid is still claimed), and the takeoff-currency banner wants linkage too — it
gets strictly more useful, since an addendum on the bid you are estimating is
exactly when a measurement wants re-checking.

**The line it writes is shaped by what a quote actually is.** `BidQuote.amount`
is a lump sum with no unit and no quantity — what one sub said one package
costs. So: quantity 1, the amount as the cost, `costCategory: SUBCONTRACTOR`,
and **no unit price**. Spreading it across units would invent a breakdown the
sub never gave, the rule `catalog-quote-price.ts` states for the neighbouring
case. The category is set rather than left null because it is not a guess — a
price from a subcontractor is subcontractor cost, and this is the one place in
the estimate where the category is known from its source.

**Carrying and spending stay two acts.** Recording what you carried is free,
costs nothing if the bid is lost, and is worth having either way — *"we carried
Alpha at $48,000 and lost at $512,000"* is the only way to learn anything
afterwards. Putting the money on a line is a separate press, because a carried
quote is an assumption and a line item cost is a figure somebody will be held
to. Neither action is available to Ask: an assistant marking a quote carried
would be making precisely the call `bid-levelling.ts` declines to make, and one
putting it on the estimate would land the biggest cost line on a bid without
anybody having read what it excludes.

The column name `wonJobId` is now slightly wrong and is **deliberately left
alone**. A rename is a drop and an add as far as the running build is concerned,
and CLAUDE.md's #378 scar is exactly that — the migration lands in seconds while
Vercel is still building the commit that stops reading the old name. It wants
its own expand-then-contract pair rather than a ride along a feature.

Migration `20261004140000_add_bid_quote_carried`, one nullable column, no
backfill — and deliberately not backfilled from the cheapest quote, which would
write the opinion `bid-levelling.ts` refuses onto historical rows as though
somebody had decided it.

565 test files, 8,799 unit tests, and the 63-file/632-test db suite run locally
against the new migration. Four censuses caught the registrations this owed —
the export column census, the Ask command census, and `reachable.test.ts` twice,
which correctly refused to let two Server Actions exist with no UI calling them.
