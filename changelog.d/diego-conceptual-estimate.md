### Conceptual estimating: what similar work ran at, before there is anything to measure (Diego)
`diego/conceptual-estimate`

Somebody hears about a 40,000 SF office TI. There are no drawings, no takeoff
and no line items, and they have to decide within the day whether to chase it.
`BidPursuit.estimatedValue` takes a number typed in from nothing — *"a rough
value for our scope, when somebody has one"* — and the app offered no help
producing it.

**This is the most dangerous number this product could produce**, and the whole
design is about that. A dollars-per-square-foot figure looks exactly like a
measured one, is arithmetically trivial, and is wrong in ways nobody can see.
Print "$62,400" beside three real line-item totals and within a week somebody
has sent it to a GC.

So four rules, each of which is a test:

1. **A range, never a point.** Low, median and high. An estimator reading
   "$38–$71/SF" knows what they have; one reading "$54/SF" does not.
2. **The sample size is always returned**, and below `MINIMUM_SAMPLE` (3) there
   is no range at all — just the reason. Two finished jobs cannot describe a
   market, and a rate derived from one is that one job wearing a disguise. The
   floor is deliberately low: a specialty sub may finish a dozen jobs a year, so
   ten would mean the feature never works.
3. **It comes from this company's own finished work** — `contractValue` and
   `actualCostToDate` through the same `calculateJobWip` the WIP schedule uses,
   never a typed rate and never a published index. COMPLETE jobs only, for
   `bid-outcome.ts`'s reason: percent-complete is an inference, status is a
   person's statement.
4. **Nothing is written anywhere.** There is no "use this figure" button, the
   area typed into the calculator is not saved, and a person types the value
   themselves. A button writing into `estimatedValue` would make the pipeline
   total — which sums that column — part guess and part quote, with nothing on
   screen saying which rows were which.

Sell **and** cost are both shown, because the gap between them is the margin
those jobs actually carried.

`Job.grossAreaSqFt` is the only project-level square-foot figure in the schema,
and its comment says so at length: every other SF here is per-line-item
(`JobLineItem.unit`, `WallComponentBasis.FACE_SQFT`,
`TakeoffMeasurementKind.AREA`). It is not a takeoff quantity, and multiplying it
by a unit price would produce a number that means nothing. A job with no area
recorded simply does not contribute — the alternative is guessing an area and
polluting every future conceptual estimate with the guess.

**Two guards changed the shape of this, both worth recording.**

`pipelineQueryCensus.test.ts` failed the first version, which loaded the
benchmark in `/pipeline`'s render path. That census exists because saving on
that page re-renders the route from the root, and this read touches every
finished job's line items, cost entries, invoices and time entries — far too
much to spend on every save for a calculator most people never open. It is
fetched on demand now, when somebody opens it.

`action-capability-guards.test.ts` then failed the on-demand action for being
**looser** than the page it sits behind: it asked only for `VIEW_JOB_COSTS`
while `/pipeline` withholds on `MANAGE_ESTIMATING`, so it answered people who
cannot open that page at all. It requires both now — estimating because of where
it lives, job costs because of what the figures are.

Three mutations, all caught: drop the sample floor to 1 (3 red), let unfinished
jobs into the benchmark (2 red), and strip the "not an estimate, not a price"
hedge from the sentence (1 red).

One refactor rides along: `lib/job-wip-rows.ts` holds the job → WIP mapping that
`bid-outcome-query.ts` had already duplicated once from `loadWipSchedule`. That
file explains why the arithmetic must never fork — *"'what the job cost' would
mean one thing on the WIP schedule and another beside the bid, and there would
be no way to tell which was right"* — and a third copy is where a mapping starts
to drift. The query *shape* still differs per caller and should: one starts from
bids, one from jobs.

Migration is additive: one nullable column.
