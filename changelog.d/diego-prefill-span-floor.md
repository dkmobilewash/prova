### The app suggested a dimension and then refused it (Diego)
`diego/prefill-span-floor`

A click-through of #660 on production found four defects. The first one broke the
feature outright, and I had written the analysis that should have prevented it.

## It offered a line it would not accept

On a real sheet the prefill proposed `5' - 9 1/4"`. Pressing **Use this
dimension** put the line on the drawing, filled the box — and the form
immediately refused it:

> That line is too short to set a scale from — a small slip in either end would
> move every quantity on the sheet. Pick a longer dimension and click each end
> of it.

**Set the scale** stayed disabled. The estimator could not finish. That line is
0.0344 of the page width and `MIN_CALIBRATION_SPAN` is 0.05.

I analysed that floor at length in #655 and solved it only for the printed-scale
path, where the line is the sheet's full width. The dimensions path kept
proposing whatever the vote liked best, and nothing checked whether the app
would honour it.

**AND THE FLOOR CANNOT BE RELAXED FOR THE AUTOMATIC PATH, which is why the fix
is the other way round.** It is enforced in two places, and the second is the
one that matters: `calibrationNotices` refuses the save, and `feetPerPageWidth`
returns null — which runs on **every later page load**. A line stored under the
floor would leave the sheet permanently unmeasurable long after the save
succeeded. Lowering it for machine-derived lines needs provenance stored on
`TakeoffScaleCalibration` itself, and that is a bigger change than this defect
justifies.

So: a line the app will not save is not a candidate. A sheet whose dimensions are
all too short now declines, saying what it found and what to do with it —

> This sheet reads 1/8" = 1'-0" from 6 printed dimensions, but every one of them
> is too short a line to set a scale from. Click along a long dimension and the
> readback should say 1/8" = 1'-0".

Short dimensions still VOTE — a short dimension is evidence of the scale — and
only the PROPOSAL is restricted. A mutation moving that filter above the vote
reds.

## And it corrects a number this changelog already published

#660 claimed 9 sheets to 24. **The honest figure is 9 to 20.** Four of those 24
were offering lines the app would refuse — the very bug above — and
`scaleAudit.ts` was not applying the product's floor, so it counted them. It
does now, which is why the bid set's `noTitleScale` drops from 8 to 4.

The first real sheet this feature was ever built from, `SCHD-VA-A102`, now
declines: its best line is 0.049 of the page against a 0.05 floor, and it prints
no scale, so nothing falls back. It was in the working column and should not have
been.

## Two call sites, and no parameter can fix that

The ingest stage and the audit each passed their own page width. Two mutations
survived: setting either to zero evaporated the floor with every test green. The
audit's is the worse one — **an audit that does not apply the product's floor
reports coverage an estimator cannot reach**, which is this repo's most
expensive recurring shape.

A parameter cannot fix two call sites. `readSheetScale(page, segments, labels)`
takes the width FROM THE PAGE, so there is nothing to pass and nothing to
forget, and it is now the only caller of `scaleFromDimensions` in the app. The
mutation reds.

## The other three from the same click-through

**The provenance vanished the moment you accepted it.** Once set, a scale read
off the title block looked exactly like one matched against five printed
dimensions — *"the toolbar doesn't show which way the scale was set."* It now
writes into `TakeoffScaleCalibration.note`, which the schema already describes
as *"the one thing here that records WHY this scale is the right one"*: `From the
1/4" = 1'-0" printed on this sheet. Nothing measurable on the sheet confirmed
it.` If a bid is questioned later, that is the sentence nobody could
reconstruct. Still editable — it is the estimator's own note.

**"its 2 printed dimensions did not agree on a scale" was the wrong word.** Two
dimensions cannot agree on anything; three are needed before a scale is taken
seriously. Saying they disagreed sends somebody looking for a contradiction that
is not there — and on the sheet that reported it, one of the two measured
correctly. Now: *only 2 printed dimensions could be read, too few to confirm a
scale from.*

**The draft line was invisible, and the report was right where my explanation was
wrong.** I guessed the reported `0.002` might be SVG user units. It is not:
every stroked line in the viewer carries `vectorEffect="non-scaling-stroke"`,
which makes the width a count of DEVICE PIXELS — so `strokeWidth={0.002}` asked
for two thousandths of one. The end dots are plain circles in the viewBox's own
units, so they rendered while the line between them did not, which is exactly
what was observed. The pairing was incoherent under either reading: if the vector
effect applies the line is invisible, and if it did not apply the effect was
pointless. Now 2px. **This was never specific to the prefill** — the same
renderer draws every hand-clicked draft and every posted measurement, so it was
always this thin, and nothing here could have caught it because the screen suite
renders in happy-dom, which does no layout.

## Checks

Five mutations, all red: the usable-line check removed (the shipped bug,
restored exactly) · the filter moved above the vote · the shared reader dropping
the page width · the decline no longer naming the scale or saying what to do ·
the error cap bypassed.

Four gates: **9,257 unit tests, 678 db tests** on a throwaway Postgres,
typecheck, lint. No schema change. Nothing from the four real drawings is in the
repo.

**What the click-through verified and this does not change:** the decisive check
passed. On the sheet whose scale came from the title block alone, tracing its
printed `3'-4"` dimension measured **3.3 ft**. Believing the printed scale
measures correctly, which was the risk the whole path was approved under.
