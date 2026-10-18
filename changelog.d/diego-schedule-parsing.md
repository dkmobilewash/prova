### A schedule is a table, and a table is geometry (Diego)
`diego/schedule-parsing`

The estimating audit's stage 2.3: *"extract door, window, finish and fixture
schedules from PDF tables into structured data"*. This is that, and it is the
item that unblocks the cross-check rule **dropped** from #630 — there is no
declared opening TYPE today, only width and height, so *"50 doors measured, 0
hardware sets priced"* cannot be said without reading line text, which this repo
forbids. A parsed schedule makes the type DECLARED.

## The split is the whole design

`PlanPageText.items` is a flat list of strings with x/y/width/height. A door
schedule is thirty of those per row and **no row structure at all**: pdfjs
reports `101`, `3'-0" x 7'-0"`, `HM`, `90 MIN` as four unrelated items that
happen to share a baseline.

So `lib/plan-ingest/scheduleTable.ts` recovers the grid in CODE — which strings
are on one row, where one cell ends and the next begins — because that is
arithmetic, and ARCHITECTURE.md's rule is that *the arithmetic underneath stays
deterministic code and the model only narrates what it is handed.* The model is
then asked the one question code cannot answer: which column is the mark, which
rows are headers, what is this a schedule OF. A draughtsman can head that column
`MARK`, `MK`, `NO.`, `DOOR #` or nothing, and no lookup survives that.

**The tolerances were chosen against specific strings, not picked.** `3'-0" x
7'-0"` is ONE cell; at a one-character gap tolerance it cut into three and made
every door twice as wide as it is. A row's membership is compared against the
row's FIRST item rather than the previous one, because twelve cells each
drifting two points would otherwise walk into the next row one cell at a time.

## It costs a handful of sheets, and #642 is why

The stage SKIPS any page whose newest title-block proposal does not say
`SCHEDULE` — spending nothing and succeeding, the shape `TITLE_BLOCK` uses for a
scan. Four sheets in a set of three hundred. Without the page type that landed
one PR earlier this feature is **unaffordable** rather than merely unbuilt: 300
model calls to find 4 tables, and nobody would switch it on.

The button says that number before anybody presses it, per the house rule, and
is **disabled with the reason** when it is zero — a hidden button on a set whose
title blocks found no schedule reads as a missing feature; a disabled one that
says why reads as an answer.

`looksLikeTable` is a second, free gate: a page typed SCHEDULE that holds prose
(a cover sheet whose index lists "SCHEDULES") succeeds and spends nothing.
Deliberately generous at three rows of two cells, because refusing a real
schedule is a silent gap in a bid and a wasted model call is a few cents.

## Stricter than the other readers, in one specific way

A spec finding is advice an estimator weighs. **A schedule row becomes a
COUNT**, and a count becomes a quantity. So rule 1 of the prompt says a row the
reader is unsure of is DROPPED rather than reported with low confidence: fifty
doors with a gap somebody fills by hand beats fifty-one with a stranger in it.
Two more rules follow from the same thought — `mark` is copied character for
character because it is an identity on somebody else's drawing, and `quantity`
is null unless the schedule STATES one, because a null means "count the rows"
and a 1 means "the schedule said one", and a bid built on the difference is
wrong in a way nobody can see.

`parseScheduleRows` drops a row with no mark on the way in, and
`scheduleRowsJson.ts` drops one on the way OUT of the `Json` column — a row
written by an older build is not evidence of anything, and a mark arriving
`undefined` renders as a blank line in a table rather than as a reading the app
could not use.

## Two deliberate inconsistencies, stated rather than left to be discovered

**It opens the PDF, which `TITLE_BLOCK` deliberately does not.** That stage
reads a stored text row precisely so a retry costs one model call and no 15MB
fetch, and the reason is volume: 300 pages. Here the same trade comes out the
other way — `PlanSheetText` holds the title-block REGION's words, not the
table's, and storing every page's full text to serve four of them is the
expensive half with none of the benefit.

**`rows` is `Json`, not a child table** — the call `BidSpecReading` made for its
findings. A row is a proposal: read, shown, accepted or thrown away as a set.
Nothing joins to one, nothing updates one in place, nothing orders them other
than as they appeared. A child table would buy referential integrity for rows
with no referents and cost a cascade on every re-read.

## Verification

- **15 unit tests** on the deterministic half — no model, no database, no PDF.
  Rows out of order, split cells, drifting baselines, a page of prose, an empty
  page, items with no ink.
- **12 tests** on the two malformed-row guards, in and out.
- **9 tests against a real Postgres** on the queries, because "which is the
  newest row per page" is a claim about ordering and the two ways to get it
  wrong are both invisible to a unit test: counting every proposal (so a set
  ingested twice says a four-sheet read costs eight) and showing two readings of
  one page as though they were two schedules. Both are asserted, with a page
  whose type CHANGED between runs.
- `typecheck` 5/5, `lint` 5/5, **580 files / 8,993 unit tests**, db suite
  **66 files / 653 tests** with the migration named in the log.
- Announced in `#prova-build` before the push, per rule 4.

**Three censuses refused this before it was finished, and each was right.**
`aiSurfaceCensus` would not accept the feature without a control a page renders
— *"written, documented, and never called"*. `stageReachableCensus` would not
accept a stage nothing starts, which is exactly what #551 shipped.
`exportCompletenessCensus` would not accept a new model in no export bucket. The
colour census also caught `bg-surface-card`, an undefined token whose growth is
blocked (issue #573), now `bg-canvas`.

**And a false comment fixed in passing.** `export-coverage.test.ts` claimed
titles *"carry apostrophes and dashes through HTML escaping"*. They do not — it
is a literal `toContain` and `renderToStaticMarkup` writes `&#x27;`. Every title
predating today happens to avoid an apostrophe, so the claim was never tested.
The comment now says what is true, which is worth more than my title change.

## Not in this change, deliberately

**Nothing links a schedule row to anything.** A door mark matched to a
measurement, or a row turned into a line item, is a real row in a real table and
a decision of its own — by WHAT a person types, never by inference, for the same
reason `carriedQuoteLapsed` matches a description or a cost to the cent rather
than guessing. The rows land as a proposal and stop there.

**Nothing accepts a reading yet either.** The `status`, `acceptedBy` and
`acceptedAt` columns exist and default to `PROPOSED`; no action sets them. That
is the next piece, and it is what would make a reading worth exporting — which
is why the export bucket says so in as many words rather than leaving it quietly
true.

**And the model half is unmeasured.** There is no eval for the schedule reader
yet, so whether it picks the right column off a real door schedule is unproved.
The deterministic half is proved to the character; the judgement half is not.
That is the next thing to run, and the click-list below is the cheap human
version.
