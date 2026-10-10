### The addenda line a bid form asks for, and the gap it cannot see (Diego)

`diego/addenda-line`

Step 8 of an estimator's day: *"note key drawing dates, addenda acknowledged
(e.g. 'Includes Addenda 1-3')."* Nearly every GC bid form has a box for it, and
an unacknowledged addendum is one of the handful of things that gets a bid
thrown out on a technicality rather than on price.

`BidAddendum` already records each one with `acknowledgedOn` and
`affectsPricedScope`. Nothing turned that into the sentence — and nothing ever
asked whether the set was **complete**.

#### A gap in the numbering is an addendum you never received

GCs number addenda sequentially from 1. Holding 1, 2 and 4 does not mean three
were issued; it means **four** were and nobody logged the third.

That is the expensive shape, because every other screen in the product is
perfectly happy: three addenda, all read, all acknowledged, all priced. The only
evidence is the number that is not there. `addendaOverlap` cannot see it either
— it compares the addenda you HAVE against each other, and a missing one has
nothing to overlap with.

The screen now names it: *"Addendum 3 is missing — GCs number them in sequence,
so it was issued and never logged. Ask the GC before bidding."*

#### The sentence appears only when the set is sound

No line is written over a gap, an unacknowledged addendum, or an unnumbered one.
A bid form saying *"Includes Addenda 1 through 4"* on a set missing number 3 is
worse than no line at all: it is a written claim to have read something nobody
has.

Three smaller decisions, each with a test:

- **Counting starts at 1, not at the lowest held.** A bid holding only addendum
  3 is missing 1 and 2; starting at the lowest would call that set complete —
  the same set seen from the most dangerous angle.
- **A date in the reference field is not an addendum number.** Without the
  ceiling, `Addendum 2026-01-14` reads as number 2026 and two thousand addenda
  are reported missing.
- **`Addendum A` takes no position in the sequence.** Some GCs issue them that
  way. Not an error, but the set cannot be checked for gaps and the screen says
  so rather than guessing.

#### It reports, it does not correct

There is no fetching addendum 3. The job is to say it is missing while asking
the GC is still cheap.

#### A census asked me to make a decision, and its own words settled it

`addendumWriteCensus.test.ts` failed on the new file — by design: *"a fifth
addendum file added later fails this until somebody decides whether it
belongs."* Its forbidden-field check is deliberately blunter than an assignment,
and the new module has to DECLARE `acknowledgedOn` to take a row.

The census says what to do about exactly that: *"the right response is to narrow
this pattern on purpose rather than to widen the list of exempt files."* So the
file is IN the census, and the pattern now ignores `type` and `interface`
bodies — **a field in a type is a shape, not a write.** Same move as stripping
comments, one level along.

**Proved not to disarm it**: a real assignment injected into
`addenda-acknowledgement.ts`, `addenda-overlap.ts` and `addendumRead.ts` each
still fails the census, while a type declaration alone passes.

#### Checks

- `addenda-acknowledgement.test.ts` — 19 cases. **Nine mutations, all red**:
  sequence starting at the lowest held, a gap not blocking the sentence, an
  unacknowledged addendum not blocking it, an empty bid getting a confident
  line, a date becoming a number, the number read from the end of the
  reference, priced-scope addenda not called out, missing numbers counted but
  not named, and an unnumbered addendum silently ignored.
- `bidAddendaLine.test.tsx` — a RENDER test per #665. **Five mutations, all
  red.**
- No schema change. `BidAddendum` carries no `jobId` and still does; this reads
  what is there.
