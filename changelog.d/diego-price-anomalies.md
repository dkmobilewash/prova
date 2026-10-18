### The typed decimal, caught before the bid goes out (Diego)
`diego/price-anomalies`

The estimating audit's stage 5.1b asks to *"flag statistical anomalies — unit
prices or labor rates that deviate significantly from historical averages"*.

**Most of the machinery already existed and is better than I expected.**
`lib/catalog-actuals.ts` computes, per catalog entry: the actual unit cost from
FINISHED jobs only, the sample size, three separately-reported exclusions
(unfinished job, unpriced hours, possibly double-counted labor), a 15% threshold
and a two-line minimum — *"one job that went badly is not evidence the template
is wrong"*.

**What was missing is the question an estimator actually has.**
`catalogActuals` asks "is my catalog stale?" and lives on `/catalog`. Nobody had
ever asked "is THIS line, on the bid I am about to send, an outlier against what
this work has cost us?" — `grep` for `actualUnitCost` under `lib/estimating` and
the job pages returned nothing. `JobLineItem.sourceCatalogEntryId` exists and is
indexed, so a live line could always reach its own history; nothing did.

No migration, no schema change, no AI.

## The error worth catching is not a 20% drift

It is the typed decimal. `$2.85/SF` entered as `$28.50`, or as `$0.285`. It
survives review because the line looks plausible on its own and the total merely
looks big — and it is the most expensive keystroke in estimating: ten times high
loses the job, ten times low wins it and loses money.

| check | fires on | the sentence says |
| --- | --- | --- |
| `TYPED_WRONG` | cost **or** price ≥10× or ≤1/10 of history | "check what you typed — that is a moved decimal point more often than a price" |
| `UNIT_MISMATCH` | the line's unit ≠ its catalog entry's unit | "priced per LF, but this work has always been measured per SF" |
| `COST_DRIFT` | cost ≥15% off, inside an order of magnitude | "19% above the $2.85 this work has cost across 14 finished jobs" |

**`TYPED_WRONG` is its own kind rather than the top of a sorted list**, because
the action differs: a 20% variance means look at your pricing, a 10× variance
means you hit the wrong key. One list ordered by magnitude would make the
expensive one read like the cheap one.

**The factor is 10, not 5.** A genuinely hard job can plausibly cost two or three
times the usual — high work off scaffold, an occupied site, night shift — and
flagging those as typos is the cry-wolf failure. Ten is a moved decimal
essentially every time, and there is a test pinning that three times the usual
reads as DRIFT rather than as a typo.

## Drift looks at cost. Only typos look at price

Comparing a line's COST to history is checking a fact. Comparing its PRICE is
second-guessing a margin call somebody made on purpose — a hard job, a GC who
pays late, a schedule nobody wants. So `COST_DRIFT` never reads `unitPrice`, and
there is a test that a line costed correctly and priced high produces **nothing**.

A decimal slip in a price is still a typo, though, so `TYPED_WRONG` reads both.
That boundary is the product decision, and it is Diego's call.

**`UNIT_MISMATCH` needs no arithmetic and no inference at all** — both units are
declared columns. It catches the error that makes a number *plausible but
wrong*: priced per square foot against a quantity measured in linear feet reads
fine and is out by the height of the wall.

## Every sentence carries the sample, and the panel states its blind spot

`TYPED_WRONG` is deliberately **not** gated on `CATALOG_MIN_SAMPLE` while drift
is: a tenfold difference from even one costed job is worth a look, because the
claim is "you typed this wrong" and a decimal point does not become more or less
moved with a bigger sample.

And the coverage line is not a footnote: *"6 lines were checked against what
that work has cost you. 14 lines have no history to check against — nothing on
them has been looked at."* Most lines are hand-typed and carry no catalog entry.
Matching those by DESCRIPTION was offered and declined — it is the text-matching
this repo refuses for `costCategory`, the takeoff recipes and the cross-checks,
and a renamed line reads as a different one. `bid-responsiveness.ts`'s posture:
a clean result must not read as "all twenty lines are fine".

## It reuses the history rather than re-deriving it

"What has this work cost us" is already answered carefully in
`catalog-actuals.ts`, and `/catalog` shows that answer. A second computation
here would be a second authority, and the day the two disagreed each screen
would be telling an estimator something true about a different number. So
`price-anomalies-query.ts` is a join and nothing else — including the same
`cache`d fringe-schedule and employer-burden loaders, because a second copy of
those would price the same hours differently.

## Verification

- **26 unit tests**, **mutation-proved both directions**: never-a-typo reds 7,
  always-drift reds 7 including every silence case. The arithmetic is asserted
  on real figures — `$2.85 → $28.50` is a typo, `$2.85 → $3.40` is 19% drift,
  `$2.85 → $3.10` is silent at 8.8%, and a zero history does not divide.
- **9 tests against a real Postgres**, because the join is the half that can be
  wrong while every unit test passes: **a line's history is not on its own
  job**. Scope that query to this job and the check compares the bid to itself,
  which always looks clean. The fixture carries a COMPLETE job with real cost
  rows, since `catalogActuals` counts finished jobs only — and there is a case
  proving an IN_PROGRESS job contributes no history and leaves the line reading
  as unchecked rather than as fine.
- Tenancy has a control on the control: another company gets nothing, and the
  same rows read correctly as their own company.
- `typecheck` 5/5, `lint` 5/5, **583 files / 9,054 unit tests**, db suite
  **68 files / 673 tests**.
- No Slack announcement: no schema change, no migration.

## What this deliberately does not do

- **No market data, ever.** The comparison is this company's own history. "Other
  subs charge more than this" is a claim about data this app does not have and
  should never pretend to.
- **No verdict.** There is no "your bid looks right", for
  `bid-responsiveness.ts`'s reason: it cannot see what it has no rule for.
- **No labor-rate anomaly here.** `labor-productivity.ts` already back-checks an
  achieved production rate against the estimate at the same 15% threshold.
  Wiring it into this panel would duplicate a surface that exists; it is worth
  doing and worth doing on its own.
- **It is gated on the ESTIMATE stage**, like the cross-checks beside it: after
  award a mis-priced line is a change order rather than something to fix before
  sending, and the page is read-only anyway.
