# Takeoff — decisions, limits, and the latest numbers

**Takeoff geometry is computed by code in `lib/takeoff/`, never by the LLM.**
Every length, thickness, area and coordinate comes from the PDF's own vector
geometry. The model is used for interpretation only — what kind of sheet this
is, what a run IS, what a label means — and no model reply in this repo carries
a coordinate, a length or an area. See `ARCHITECTURE.md`.

## The two fixture sets, and why there are two

| | `reports/takeoff-bench` | `lib/takeoff/fixtures` |
| --- | --- | --- |
| drawn by | our own generator | a different generator, outside this repo |
| wall LF ground truth | **yes**, exact, from the model that drew it | **no — not printed on any sheet** |
| scale, rooms, areas | yes | yes, where the sheet prints them |
| raster sheets | one scan variant | **three real raster sheets** |
| what it is for | grading wall footage | surviving someone else's conventions |

The second set exists because **one generator cannot surprise itself.** On
2026-10-14 the bench reported "no change" twice for work that a real drawing
proved was doing real work, and three separate defects were found only by
pointing instruments at drawings this repo did not author:

- a split-path reader bug (`pdfjs` can emit one path as two `constructPath`
  operators; the cursor reset between them and the line vanished silently);
- `-E` as a layer's existing-work status code, which no spelled-out word list
  caught;
- a classifier prompt rule that rejected every radius wall.

### Cedar Hollow is a PRACTICE plan now, not a held-out test — 2026-10-17

It was built as a held-out test: a plan and an answer key this repo had never
seen, generated outside it, kept outside it, and read only by a scorer that is
not the detector. It did exactly what it was for. On its first run it scored
−7.9% and the per-wall table pointed straight at the arcs, which is how the
curved-wall fix was found.

**That first run is the only held-out measurement it will ever give**, and
this entry exists so nobody quotes a later one as if it were. A plan used to
FIND a fix has taught the engine its own answers; every score after the first
is a practice score. The distinction is not bookkeeping — the whole value of
the first number was that nothing had been tuned toward it.

| | |
| --- | --- |
| first run, held out, before the fix | **−52.8 ft, −7.9%**, 0 phantoms |
| after the curved-wall fix | −3.9 ft, −0.6%, 0 phantoms |
| status from 2026-10-17 | practice — keep running it, stop quoting it as held out |

It stays in the guards, and that is the point of keeping it: it is now a
REGRESSION test, which is a job a seen plan does perfectly well. What it can no
longer do is tell us how the engine performs on a drawing it has not met.

The protection against reading the key still stands and should NOT be removed
just because the plan is seen — `truthWall.test.ts` refuses any file under
`lib/takeoff` that names the plan or its key, and `zzHeldout.eval.ts` reads the
DRAWING only. That guard costs nothing and is what makes the next held-out
plan a one-line setup instead of a rebuild.

**The next held-out plan should be a different building**, not this one
re-generated: the generator's conventions are now partly known, so a second
plan from it is a weaker test than the first was. Keep its PDF and key outside
the repository, the same way, and write down the first number before touching
anything.

### The rule for an answer key

**Only what a drawing PRINTS may be ground truth.** A room tag that says
`361 SF` is an answer the architect published. A wall length nobody printed is
not, and measuring it with the detector under test would be marking our own
homework. Unknown fields are `null` and the scorer skips them —
`expected.test.ts` fails the build if a key ever claims a wall length.

## Latest run — `fixtures/score.eval.ts`, 2026-10-15

```
SCALE: 14 correct of 14 scored; 3 correctly declined (the raster sheets);
       1 sheet contradicts its own title block and the dimensions were followed
WALL FOOTAGE: reported, NOT SCORED — no sheet in this set prints one
ROOMS: 122 tagged in the key; the pipeline does not yet report a room list here
```

### The scale failures

| sheet | printed | read | |
| --- | --- | --- | --- |
| ~~S01~~ | `1/4" = 1'-0"` | **`1/4" = 1'-0"`** | fixed 2026-10-15 — votes are labels, not strings |
| ~~S16~~ | `1:100` | **`1:100`** | fixed 2026-10-15 — metric dimensions |
| ~~S17~~ | `1:50` | **`1:50`** | fixed |

**S11 was reported here as the worst failure on the board and it was the KEY
that was wrong, not the pipeline.** The sheet prints `1/8" = 1'-0"` and its own
`31'-0"` dimension is 7.75 inches long on a 17-inch page — 31 feet in 7.75
inches is a quarter inch to the foot, and all six of its dimensions agree. The
title block is wrong, the app reads the dimensions, and `calibrationNotices`
already warns when a printed note and a calibration disagree. The fixture is a
planted trap and the app walks past it correctly.

The key now marks it `scaleAuthority: "dimensions-disagree"` and does not score
scale on it, because adjudicating would mean re-measuring the drawing with the
code under test. **A key that assumes a title block tells the truth will send
somebody to fix a pipeline that is right.**

**S16/S17 are fixed.** A metric sheet dimensions in bare millimetres and the
imperial pattern requires feet, so both read nothing at all. The fix is a
second reader and a second scale table, tried ONLY when the imperial pass
declines — so no sheet that already reads a scale can change, and the bench is
byte-identical. Both now find walls as well (10 runs each).

The bug that made it take two attempts is worth keeping: the vote was taught
the metric table and the line-proposing `snap` below it was not, so a sheet
agreed unanimously on `1:100` and was then refused because that name is not in
the imperial list — "the best line to set it from is **Infinity%** out". Two
call sites, one updated.

### Three sheets find a correct scale and ZERO walls — and it is NOT poché

S06, S10 and S15. The overlay shows S06's walls drawn as filled poché, which is
a convincing explanation and **is not the cause**. `stages.eval.ts` counts what
survives each filter:

| sheet | pairs found | after `wallsInTheBuilding` |
| --- | ---: | ---: |
| S02 (works) | 10 | **10** |
| S06 | 9 | **0** |
| S10 | 8 | **0** |
| S15 | 12 | **0** (biggest group 9) |

The pairer finds the walls. **`NOT_A_BOX = 10` throws them away** — these are
small residential plans whose entire building is 8 or 9 runs, and S02 scraped
through by one.

`wallsInTheBuilding` argues for ten from six real plans that "returned 38, 58,
68, 230, 295 and 453". All six are large commercial floors. The number was
measured honestly on a sample that contained no small buildings.

**Lowering it is not the fix, and the bench refused two attempts:**

| | zero-wall cases producing walls |
| --- | --- |
| `NOT_A_BOX = 10` (today) | 11 of 36 |
| `= 8` | 17 of 36 |
| `= 5` | 31 of 36 — the COVER SHEET invents 581 ft, its vicinity map's streets pairing as walls |

Footage does not separate them either: that cover sheet's 581 ft is more than
any of the three houses. What separates a guest house from a street map is that
a plan's runs **enclose rooms**. `wallRuns.ts` already traces enclosed regions
and is not wired to this decision. That is the fix, and it is real work rather
than a constant.

Until then: **a floor plan with fewer than ten wall runs returns nothing**, and
it is a measured limitation rather than an accident.

### The raster sheets

S18, S19, S20 carry **zero strokes and zero text**. They are correctly refused,
and they will stay refused until there is a raster path. They are in the set so
that the day somebody builds one, the fixtures are already there.

## How to run any of it

```
# regenerate the answer keys from what the drawings print (output is committed)
pnpm --filter @prova/web exec vitest run --config vitest.eval.config.mts \
  lib/takeoff/fixtures/extract.eval.ts

# the scorecard
pnpm --filter @prova/web exec vitest run --config vitest.eval.config.mts \
  lib/takeoff/fixtures/score.eval.ts

# the pictures — look at these after every change
pnpm --filter @prova/web exec vitest run --config vitest.eval.config.mts \
  lib/takeoff/fixtures/overlay.eval.ts

# wall footage, against the only key that has it
TAKEOFF_BENCH=1 pnpm takeoff:bench
```

Overlays are **not committed** — they are an output, they are large, and a
stale one is worse than none. Regenerate before looking.

## The one-face-one-use loss: a scored pairing, built and measured and NOT taken — 2026-10-17

55% of the bench's missed footage is attributed to "a neighbouring line
claimed one of its faces first": the pass walks faces longest-first and lets
each take the best partner still free, so a long line can reach a face before
the wall that face belongs to does.

The replacement built and measured: collect exactly the same candidate pairs
through exactly the same tests, and award them BEST-FIRST — scheduled
thickness and balanced faces first, then by how much of the shorter face runs
alongside the longer one, how alike the two faces are in length, and whether
they are drawn at the same pen weight. Deliberately NOT a maximiser: it cannot
create a pairing the greedy pass rejects, only change who wins a contested
face.

| | longest | scored |
| --- | --- | --- |
| bench walls missed | 111 | **113** |
| bench phantom footage | 3,497 ft | **3,862 ft** |
| bench worst type total | A-101/D1 32.4% | **A-102__revit/D1 100.0%** |
| 20 fixtures within 2% | 15 of 17 | **16 of 17** |
| Cedar Hollow missing | 5.07 ft | **4.73 ft** |
| Cedar Hollow net | −4.57 ft | **−4.20 ft** |
| Camp Bow Wow A102 | 2,082 ft | **1,852 ft** (−11%) |
| Camp Bow Wow A120 | 129 ft | **110 ft** (−15%) |
| runtime | 75s | 75s |

**It helps where there is a key and costs footage where there is not**, and it
adds 365 ft of phantom across the bench — spread evenly, +18 to +41 ft on
nearly every case, not one bad sheet. That is disqualifying and the criteria
said so in advance.

**THE REASON WAS MEASURABLE BEFORE THE BUILD AND IS THE PART WORTH KEEPING.**
Instrumented from inside the pairing loop: after it finishes, ask of every face
it left unused whether it would have made a wall with a face already spoken
for. Across the bench that is **1,031 stranded pairings worth 44,012 ft**,
against the **1,864 ft** actually attributed to this cause. So **96% of the
pairings a reordering could take are pairings that must NOT be taken** — and
the largest of them are 209 ft lines spanning the building at 6 inch spacing,
which are grid lines. Greed's conservatism is load-bearing, and any scheme that
frees contested faces inherits the whole of that 44,012 ft as its risk surface.

**Reverted rather than carried behind an off switch.** Three tests were written
for the scored mode and **every one of seven mutations survived them** — on
scenes simple enough to write, both modes agree, so nothing pinned the
behaviour. A mode that is off, measured worse, and pinned by nothing is the
"written, documented, and never called" shape this file keeps paying for.

**What a next attempt needs, in order.** Not a better score: a way to tell the
209 ft grid line from the wall face it sits beside, BEFORE any reordering. Pen
weight was in the score and was not enough. Layer name is the obvious
candidate and the bench carries one (`A-WALL` against `A-GRID`), but the real
plans' layers are the thing `findWallsOnSheet`'s layer filter already works on,
so start by measuring what share of the 44,012 ft a layer test removes. If it
does not take most of it, the reordering is not worth attempting again.

## Could a layer test tell a grid line from a wall? Measured: barely — 2026-10-17

The entry above ends by saying a next attempt at the pairing needs a way to
tell a 209 ft grid line from a wall face BEFORE reordering anything, and names
the layer as the obvious candidate with an instruction to measure what share of
the 44,012 ft of stranded pairings it removes. That measurement, run:

### On the bench: nothing, and for a dull reason

**0 ft of 44,012 — 0%.** Every one of the 1,031 stranded pairings came back
`(none) + (none)`. Only two of the bench's sixty variants emit optional-content
groups at all, so the question could not be put on the rest. The bench cannot
answer this and should not be asked again.

### On real plan sets: one in five carries layers

| set | pages read | strokes | with a layer |
| --- | --- | --- | --- |
| 10-Alden-Green-House-Bid-Package | 4 | 211,062 | **208,420 (98.7%)** |
| 2025-03-28_ELEVEN03 PERMIT SET_ARCH | 6 | 86,996 | 0 |
| 20260424_HPL Lighthouse_Bulletin 2 | 3 | 109,341 | 0 |
| Approved_Eleven03_SP-2025-0218C | 4 | 374,984 | 0 |
| Camp Bow Wow - 100% CD_ARCH | 4 | 607,172 | 0 |

**Four of the five sheets an estimator would actually price carry no layer
information whatever.** A rule that depends on one is a rule that does not run
on Camp Bow Wow or ELEVEN03, which are the two this file quotes numbers from
all the way through.

### And on the one that has them, the names are not ours

`layerVerdict` over Alden Green's 208,420 layered strokes:
**unknown 135,484, not-wall 72,936, wall ZERO.** The names are real and
meaningful — `CDTEXT`, `CDNOTES`, `SNTEXT`, `CDHATC`, `CDSOIL`,
`CNTEXT-EROSION`, `TITLE BLOCK 30x42|g-anno-ttlb-text` — they are simply that
office's own civil-set vocabulary rather than the AIA layer names
`layerNames.ts` knows. So even where layers exist, the test never says "this
is a wall". It only ever says "this is not one", for about a third of the
sheet.

### What that settles

- **The scored-pairing retry is not worth attempting on a layer test.** It was
  conditional on the layer removing most of that 44,012 ft; it removes none of
  it on the bench and cannot be asked on four of five real sets.
- **Layer name is still worth having as ONE input among many.** A third of a
  sheet correctly marked not-wall is real signal, and it costs nothing to pass
  along. It is just not a discriminator on its own.
- **Anything depending on layers needs a path for sheets without them**, which
  is the common case, not the exception.

Measured by `realplan/zzLayers.eval.ts`; re-run it with `REAL_PLAN_DIR` set.

## The classifier experiment: synthetic-only training LOST — 2026-10-17

The cheap experiment the classifier plan called for, run before buying any
labelled sheets. Train on bench candidates alone, score against the rules on
everything the bench has never seen.

**Switch is OFF and stays off.** `WallFinderOptions.decide` is undefined by
default and nothing wires it up; the model file ships beside it unused.

### What was built

`wallFeatures.ts` turns one candidate pairing into 20 numbers.
`wallVectors.ts` grew a seam that collects EVERY pair the geometry accepts —
including the ones the greedy pass would never award — because the
alternatives are most of what there is to learn from. `zzExtract.eval.ts`
labels them from the bench's own key by geometry. scikit-learn (BSD-3, CPU,
offline) trains 120 gradient-boosted trees; `wallClassifier.ts` evaluates the
exported JSON in about twenty lines, so the product carries no runtime
dependency and nothing leaves the machine.

20,734 candidates from 7 sheet families, 10.0% positive. Leave-one-family-out
mean **AUC 0.991**.

### And it lost on every number that is defined

| | rules | classifier |
| --- | --- | --- |
| bench walls missed | 111 | 111 |
| **bench phantom footage** | 3,497 ft | **7,930 ft** |
| **bench zero-wall bar** | **PASS**, 0 of 41 | **FAIL, 5 of 41** |
| bench LF outside 2% | 17 of 60 | 18 of 60 |
| 20 fixtures within 2% | 15 of 17 | **13 of 17** |
| Cedar Hollow missing | 5.07 ft | **8.87 ft** |
| Cedar Hollow net | −0.7% | **−1.3%** |
| ELEVEN03 A4.B-Y2 | 1,571 ft | **2,307 ft (+47%)** |
| Camp Bow Wow A120 | 129 ft | **200 ft (+55%)** |
| runtime | 75s | 79s |

**AUC 0.991 and it doubles the phantom footage.** That gap is the lesson: a
per-candidate score says nothing about a sheet, because the errors are
concentrated in the long runs and a sheet is judged in feet.

### Why, exactly — two faults, both visible in the model file

**1. The dominant feature does not exist on real sheets.**
`nearestScheduledDeltaIn` — how close a pairing's thickness is to one the
sheet's wall-type schedule names — takes **196 of the tree splits and 0.52 of
the importance**. In training it ranges 0 to 2.81 inches and is **never −1**,
because every bench sheet carries a schedule. A sheet without one gives −1 for
every candidate: a value the model has never seen, below every threshold it
learned, so each tree sends it down the "this thickness is exactly a scheduled
type" branch. The out-of-distribution sentinel fails toward YES.

That is the +47% on ELEVEN03 in one sentence, and it is a design mistake
rather than a data shortage: a missing value must not be encoded as a number
on the same axis as the real ones.

**2. The one feature that encodes the real failure was never used.**
`inHatchSeries` is 1 on **23% of training rows** and the trees split on it
**zero times** — on the bench, thickness alone separates the classes, so the
model had no reason to learn hatching. On ELEVEN03 the poché is drawn at
wall-like spacing and the overlay shows the result plainly: every hatched
block filled with red. The three layer features are also unused, necessarily
— the bench carries no layers, which the measurement above had already shown.

### What this says about the plan

Not that the hybrid is wrong. It says the **bench cannot be the training set**:
it has no sheets without a schedule, no realistic poché, and no layer names,
so it cannot teach the three things that actually go wrong. The estimate of
40–60 real labelled sheets stands, and this experiment was the cheap way of
finding out that there is no shortcut round it.

Three things to change before spending that:
  - encode a missing feature as its own column, never as a sentinel number;
  - judge by sheet footage during training, not by per-candidate accuracy;
  - keep `inHatchSeries` and the layer verdicts, but get them from sheets
    where they vary.

`zzExtract.eval.ts` writes the rows and `scripts/train-wall-model.py` trains
them; both are kept because the pipeline is sound and only the training set
was wrong.

## The messy synthetic sheets, and a second classifier that lost — 2026-10-18

Fifty generated sheets in `~/Claude Folder/takeoff/synthetic-messy`, five
drafting styles of ten, carrying what the bench could not: hatching at
wall-like spacing, filled walls, stairs, grid lines, tables, counters,
furniture. Their keys attribute **every stroke to a feature with a type**,
which is what makes them trainable rather than only scoreable.

### The rules on them, before any training

| | missing | extra | net |
| --- | --- | --- | --- |
| all 50, 83,913 ft of key wall | 2,473 ft (2.9%) | **11,418 ft (13.6%)** | +8,945 |

Consistent across styles — extra runs 11.9% to 16.9% on every one. **The rules
find nearly all the wall and add an eighth again of phantom**, which is the
ideal shape for a classifier: plenty to cut, little to protect.

Looked at on the overlays, the phantom has a shape the bench never produced:
on M005 the long red verticals run **down the middle of rows of desks**, the
engine pairing the edges of two adjacent desk rows into a wall.

### A classifier trained on three styles, tested on two

ironbark and northline held out entirely — between them the worst extra (16.9%)
and the worst missing (4.9%), so the held-out half is the hard one.

| | missing | extra |
| --- | --- | --- |
| **trained-on styles** — rules | 1,444 ft (2.7%) | 6,752 ft (12.6%) |
| **trained-on styles** — model | **1,318 ft (2.5%)** | **1,689 ft (3.2%)** |
| **held-out styles** — rules | 1,029 ft (3.4%) | 4,666 ft (15.3%) |
| **held-out styles** — model | **5,061 ft (16.6%)** | 1,054 ft (3.5%) |

**On styles it has seen the model is strictly better on both numbers.** On
styles it has not, it cuts extra by three quarters and **quintuples missing**.
No threshold fixes it: at 0.2 the held-out numbers are 1,716 missing against
2,439 extra, still worse on missing than the rules.

### And on everything real, it is worse

| | rules | model |
| --- | --- | --- |
| bench walls missed | 111 | **190** |
| bench phantom footage | 3,497 ft | 2,664 ft |
| bench zero-wall bar | **PASS** | **FAIL**, 1 of 41 |
| 20 fixtures within 2% | 15 of 17 | **8 of 17** |
| Cedar Hollow missing | 5.07 ft | **9.68 ft** |
| ELEVEN03 A4.B-Y2 | 1,571 ft | **1,012 ft (−36%)** |
| Camp Bow Wow A102 | 2,082 ft | **1,664 ft (−20%)** |
| Camp Bow Wow A120 | 129 ft | **203 ft (+57%)** |

On the A4.B-Y2 overlay the envelope and the stair cores survive and **the
interior partitions are gone** — the unit demising stubs along the west edge
and most of the east column. It is rejecting the wall a drywaller would build.

### Why, and it is one word: pen

`penMean` takes **0.721 of the importance and 125 splits**. Pen weight is a
per-office convention, so a model that has learned "a wall is drawn at this
weight" transfers to the three styles it saw and refuses walls everywhere else.
The same mechanism as the bench model's `nearestScheduledDeltaIn`, in a new
costume: the strongest feature in training was the one that does not survive
contact with another drafter.

**The pipeline fixes did work, and that is the good news.** `inHatchSeries` is
used this time (12 splits), `hasNeighbourSpacing` is used (13), and
`nearestScheduledDeltaIn` — the feature that failed catastrophically on the
bench model — is **never split on**, because most messy sheets have no
schedule and the `has…` flag let the trees ignore it rather than fail toward
yes. The missing-value fix is doing exactly what it was built for.

### What this says about the plan

Synthetic sheets can now produce the right ERRORS — desk rows, poché, tables —
which the bench never did. They cannot yet produce the right VARIETY: five
generated styles share more with each other than any of them shares with
ELEVEN03. Real labelled sheets remain the bottleneck, and the estimate of
40-60 is unchanged.

Two things to do before the next training run, both cheap:
  - **drop or cap `penMean`**, or force the model to work without it, and see
    what it finds instead. A feature that strong and that office-specific is
    worth testing the absence of.
  - **mix real sheets in.** Even five labelled real sheets in the training set
    would tell us whether the gap is variety or something deeper.

Measured by `realplan/zzMessy.eval.ts`; `MESSY_MODEL` points it at a model for
comparison. No model is committed: this one is worse than the rules on every
real guard, and a model file in the tree that nobody should load is a thing the
next person has to work out the status of.

## WHAT TWO REAL REVIEWS FOUND, AND NONE OF IT WAS IN THE ENGINE — 2026-10-19

Camp Bow Wow A101 was labelled twice, 144 candidates each time. Everything
below came out of trying to USE the result, and not one of it is a takeoff
bug. They are all bugs in the apparatus around it, which is the part nobody
had exercised.

| what | how it showed |
| --- | --- |
| "Not sure" written as a confident negative | 48 unsure runs became 483 negative rows |
| The file kept no verdicts at all | 26 minutes of work could not be re-opened |
| Zooming past Fit rendered the plan black | a canvas over the browser's cap allocates nothing |
| The plan got 268 px of a 1600 px window | two rails this component cannot see |
| The clock read 135 minutes for 24 minutes of work | it timed the tab, not the deciding |
| A duplicate pair was missed | the matcher consumed its own keeper |

### NOT SURE WAS THE WORST OF THEM, BECAUSE IT WAS SILENT

The panel filtered its verdicts to wall and not-a-wall, so an unsure run never
travelled. Its pairings then fell through `labelRows`' no-run branch, which on
a FINISHED sheet means "the reviewer saw it and did not call it a wall" — and
`reviewComplete` is true, because unsure counts as reviewed. The file recorded
them only as a count of 48 "unreviewed", so nothing on screen or in the data
said that forty-eight careful "I cannot tell"s had become confident training
negatives.

The verdict travels now, an unsure run's pairings are left out of the file
entirely, and `counts.unsure` is its own number. Two mutations, both red.

### THE FILE KEPT DERIVED ROWS AND THREW AWAY THE DECISIONS

6,030 pairing rows with features, a label and a length — no geometry, no run
list. So the first thing anyone wanted to do with the first real sheet, fix
it, was impossible: there was no way to ask which runs were the unsure ones
except to review the sheet again. `labelFile` records the verdicts as given
now, with their geometry.

### A CANVAS OVER THE CAP DOES NOT THROW, IT GOES BLACK

The viewer multiplied the page by zoom and by `devicePixelRatio` and handed
the result to the canvas. An ARCH-D sheet at 4x on a retina screen asks for
31,104 x 20,736 — 645 megapixels and about twice the longest side Safari
allows. Over the cap a canvas allocates nothing, the render writes into
nowhere, and the page is black with no error anywhere. Zooming in to inspect
a line is the commonest thing a reviewer does.

`canvasPlan.ts` clamps the backing store and leaves the CSS size exactly as
asked, so the overlay's coordinates and the scroll position do not move; the
drawing softens at extreme zoom instead of vanishing. **Its own test caught a
flaw in the first version**: a 0.25 density floor, added so a huge sheet would
"still draw something", put a 12x sheet back over the limit. A quality floor
cannot override a hardware one. Verified in a real browser at 400%: clamped to
exactly 64.0 Mpx, sharp, zero page errors.

### NO BREAKPOINT CAN SEE WHAT TWO OTHER RAILS LEFT BEHIND

Measured in the running app at 1600 px: the sheet rail took 232, the
answer-key rail 384, leaving the canvas region 690 — and the found-walls list
took 368 of that, so the plan had 268 pixels. `xl:` asks how wide the WINDOW
is, and the window was wide.

The rule is the MODE rather than a width: in answer-key mode the rail is the
working surface and the found list is a reference, so it goes under the
drawing. Canvas 268 to 648 px, measured the same way.

### A CLOCK THAT PRICES PIECEWORK HAS TO MEASURE THE WORK

A101 took about 24 minutes and the file said 135, because the sheet had been
open while other things happened. The old comment defended wall clock on the
grounds that a flattering figure would be worse than none — true, and it was
wrong by 5.6x in the expensive direction, which is the same mistake.

It sums the gaps BETWEEN decisions now and ignores any gap over six minutes.
Loading the sheet and reading the instructions are not counted, which
understates a first sheet; that is the honest direction to be wrong in.

### THE DUPLICATE RULE NEEDED TWO FIXES AND THE SECOND IS THE GENERAL ONE

One wall offered twice is a real thing: a layered partition, or a wall redrawn
on a second layer, yields more than one pairing along the same line, and
accepting both bills it twice.

**The matcher consumed its own keeper.** A candidate could belong to at most
one pair, so a 34.6 ft wall matched an 11.7 ft fragment, was consumed, and the
4.2 ft fragment inside the SAME wall was orphaned — it became the keeper of
its own little pair. Only the dropped one is consumed now.

**And direction is the wrong test for a short run.** The angular tolerance was
2 degrees; the missed fragment is 3.2 degrees off, because its endpoints
differ by a couple of inches and over four feet that is three degrees. It is a
property of the LENGTH, not of the wall. The binding test is now whether both
ENDPOINTS lie inside the band of the longer's line — the same claim a reviewer
makes by eye, and indifferent to how short the run is. Direction survives as
an 11-degree pre-filter.

8 pairs became 12 on the real sheet. The band is 1.5 ft, which is wider than
drafting jitter and narrower than the 5.2 ft gap between A101's east wall and
the line outside it — NOT a duplicate, and a test says so by name, because
calling it one would delete 65 ft of real work.

### WHAT THE REVIEW ITSELF SAYS

23 accepted, 801 ft, 120 rejected, 1 unsure, nothing left unjudged. The
accepted runs form the envelope and the west rooms; the outdoor yard, the
kennel bays and the site lines are rejected, which is the scope rule working.

**1,152 ft of runs 15 ft or longer were rejected**, and four of the twelve
longest are INSIDE the building envelope. Whether those are kennel dividers
(out of scope) or built partitions (in scope) is a judgement about the
building rather than the drawing, and it is worth about 190 ft on one sheet.

## SIX REAL LABELLED SHEETS ARE THREE BUILDINGS, AND ONE OF THEM IS 89% OF IT — 2026-10-19

A trend check, not a candidate: veto-only, the same sheet-relative features,
trained on the six sheets Diego has labelled (A101, A120, HPL p3, A4.B.1,
A4.B.2, A4.B.3) with the synthetic 150 contributing NEGATIVES ONLY.

32,410 rows, 13.6% positive. The synthetic half is CAPPED at 700 rows per
drafting style — 14,000 of the 100,816 available — because all of them against
4,394 real positives is 3.7% positive, and a model trained on that learns that
almost nothing is a wall. Stratified per style rather than taken off the top:
`ironbark` alone has 13,202 rows and would otherwise have been a third of the
synthetic half, which is a style rather than a lesson.

### It does not transfer, and the family table says why before any test does

| real family | wall rows | share of all positives |
| --- | --- | --- |
| eleven03 (3 sheets) | 3,899 | **89%** |
| cbw (2 sheets) | 431 | 10% |
| hpl (1 sheet) | 64 | 1% |

**Six sheets is not six buildings.** It is three, drawn by three offices, and
one of them carries nine positives in ten. Leave-one-family-out therefore has
nothing left to learn a wall from when ELEVEN03 is the one held back:

| held out | missing ft | extra ft |
| --- | --- | --- |
| eleven03 | **21,934** | 20 |
| cbw | 2,861 | 2,240 |
| hpl | 500 | 47 |

### On BIM it is the worst model this directory has recorded

Both halves, at the most permissive threshold swept:

| | missing | extra |
| --- | --- | --- |
| BIM-HELD-OUT, rules | 9.0% | 4.3% |
| BIM-HELD-OUT, veto @0.2 | **31.2%** | 3.2% |
| BIM-HELD-OUT, veto @0.35 | 37.4% | 3.0% |
| BIM-DEV, rules | 16.3% | 4.9% |
| BIM-DEV, veto @0.2 | **34.7%** | 1.6% |

On the held-out buildings it deletes **1,922 ft of real wall to remove 95 ft of
phantom**. The standing rule — missing must not rise more than 0.5 percentage
points — is missed by a factor of forty, so no threshold admits it and the
sweep is recorded only to show that none does.

### What this changes about the labelling plan, which is the useful part

Nothing here is a surprise about the MODEL; the 2026-10-18 entry below already
established that synthetic learns a drawing style and real learns a building
type, and that more buildings is what is needed. This run prices that
conclusion: **three buildings is not enough, and the sixth sheet of the third
building adds almost nothing.** The next sheets are worth more if they are new
BUILDINGS than if they are more levels of ELEVEN03 — and the supply of those is
the problem recorded in `sheets-to-label.md`, not here.

The model is not committed, the switch stays off, and the rows and the model
live outside the tree. Reproduce with `buildrows` against
`~/Claude Folder/takeoff/labels` and `scripts/train-wall-model.py`; the seed is
`20261019`.

## TRAINING ON REAL BUILDINGS: THE FEATURES ARE FIXED, THE TRANSFER IS NOT — 2026-10-18

Veto-only, sheet-relative features, trained on BIM-DEV's 22 real-building
sheets with the synthetic fifty contributing NEGATIVES ONLY — 19,118 rows of
desks, tables, hatch, poché, stairs, fixtures and counters, and not one
positive, because what a generator thinks a wall looks like is the thing that
did not transfer last time.

40,698 rows, 25.2% positive. Threshold chosen on BIM-DEV alone at the standing
rule — missing must not rise more than 0.5 percentage points — which admits
0.2 (+0.2 pp) and refuses 0.35 (+1.0 pp). 0.25 and 0.3 sit exactly on the
limit for 0.1 pp more of extra, so 0.2 it is.

### On the set it was trained on, it is the best model yet

| BIM-DEV | missing | extra |
| --- | --- | --- |
| rules | 16.3% | 4.9% |
| veto @0.2 | 16.5% | **3.1%** |

879 ft of phantom removed for 111 ft of wall. That is a genuinely good trade
and the first one any model here has offered.

### On the held-out buildings it falls over

| BIM-HELD-OUT, scored once | missing | extra | net |
| --- | --- | --- | --- |
| rules | 780 (9.0%) | 373 (4.3%) | −406 |
| veto @0.2 | 1,664 (**19.2%**) | 345 (4.0%) | −1,319 |

Missing more than doubles to buy 28 ft of phantom.

### And the guards are worse than that

| | rules | veto @0.2 |
| --- | --- | --- |
| Cedar Hollow missing | 5.07 ft (0.8%) | **219.85 ft (32.7%)** |
| 20 fixtures within 2% | 15 of 17 | **2 of 17** |
| bench walls missed | 111 | **266** |
| bench type-totals outside ±2% | 17 of 60 | **35 of 60** |
| bench phantom footage | 3,497 ft | 1,857 ft |
| bench zero-wall | PASS | **PASS** |
| ELEVEN03 A4.B-Y2 | 1,571 ft | 901 ft (**−42.6%**) |
| Camp Bow Wow A101 | 2,530 ft | 1,814 ft (−28.3%) |
| Camp Bow Wow A102 | 2,082 ft | 1,792 ft (−13.9%) |
| Camp Bow Wow A120 | 129 ft | 73 ft (−43.4%) |

Every real sheet moved more than 5% except A4.B.3. The zero-wall bar held
again, which is the veto guarantee rather than a property of this model: it
cannot add a phantom, so everything it costs it costs in missing wall.

**The A4.B-Y2 overlay says what the numbers cannot.** The envelope survives
almost intact and nearly every interior partition is gone — the rows of short
demising and bathroom walls down the left and through the middle. BIM-DEV is
two large, mostly open buildings (esplanades and the clinic are 36,683 of its
47,316 ft); a hotel floor plate is hundreds of short partitions. The model
learned which of ITS buildings' runs were walls, and short interior stubs were
mostly not.

### The features are genuinely fixed, and that is worth separating out

| model | top feature | importance |
| --- | --- | --- |
| absolute features, synthetic | penMean | 0.721 |
| sheet-relative, synthetic | penPercentile | 0.616 |
| sheet-relative, real buildings | **nearestNeighbourThicknessRatio** | **0.317** |

**No feature over 0.4 for the first time.** `nearestNeighbourThicknessRatio`
encodes "is the nearest parallel thing a similar thickness to me" — a wall's
neighbour across a room is another wall, and a hatch line's neighbour is
another hatch line, so it is a property of the drawing's structure rather than
of one office's pen. `offOrthogonalDeg` (0.213) and `penDelta` (0.154) follow,
with `penPercentile` down to 0.131 from 0.616. Eight features are never split
on, the schedule and layer ones among them.

So the feature work did what it was for. What has not been solved is that
three buildings are not enough to learn from, whoever drew them.

### Plainly: did real buildings transfer better than synthetic?

**No — and it failed in the opposite direction, which is the useful part.**

| | on its own kind | on the guards |
| --- | --- | --- |
| synthetic-trained | extra 13.6% → 5.0% | Cedar 26.3% missing, fixtures 0 of 17 |
| real-building-trained | extra 4.9% → 3.1% | Cedar 32.7% missing, fixtures 2 of 17 |

The synthetic model learned a drawing STYLE — pen weight — and refused walls
drawn by any office it had not seen. The sheet-relative features cured that.
This model learned a BUILDING TYPE — two large open-plan buildings — and
refuses the short partitions of everything else. Both are the same failure at
different levels, and the second cannot be fixed by features: it needs more
buildings, of more kinds.

Three buildings, 22 sheets, 10,271 positive rows is not a training set. It is
one office's two office blocks and a clinic. The next model wants real sheets
from several plan sets of different BUILDING TYPES — a hotel floor plate, a
house, a fit-out — which is exactly what the labelling screen is for, and why
no amount of further work on this set is worth doing first.

No model is committed. `wall-model.json` is absent by design.

## FIVE FIXES ATTEMPTED ON BIM-DEV, NONE SHIPPED — 2026-10-18

The engine is unchanged by this round. What changed is the measuring, and
that was worth more than any of the fixes would have been.

### (b) THE SCALE BAR WAS NEVER MISSING — THE HARNESS STARVED IT

`zzBim.eval.ts` passed `textItems: []`. `wallsNotTheScaleBar` needs three bare
numbers printed along the run to recognise a ruler, so with no text it could
not fire on any sheet, and 64 ft of scale bar was booked against the rule
missing it. Feeding the eval the sheet's own text — which the app's reader
returns, and which the other evals already use — removes it entirely and takes
stairs from 377 ft to 249. No engine change. **BIM-DEV extra 5.3% → 4.9%.**

The lesson is the one about starved instruments rather than about scale bars:
a rule reported as missing something should be asked whether it was given
anything to read.

### (a) WINDOW BRIDGING — built, measured, REVERTED

Bridge a gap when glazing spans it and both sides are the same line and
thickness: two lines of glazing minimum, 60% of the gap covered, inside the
wall band; doors excluded, since a swing is an arc and a leaf is one line.

| | baseline | with it |
| --- | --- | --- |
| BIM-DEV missing | 16.3% | **14.8%** |
| BIM-DEV extra | 5.3% | **6.1%** |
| bench type-totals outside ±2% | 17 of 60 | **21 of 60** |
| bench walls over 10 ft missed | 111 | **200** |
| bench zero-wall | PASS | PASS |

671 ft of real wall on BIM-DEV is not worth 89 more missed walls on the bench.
The direction is the surprise: bridging only ever JOINS, and a longer merged
run then falls foul of filters the two short ones passed, so a rule that adds
nothing ended up losing wall.

### (c) DIMENSION STRINGS — built, measured, REVERTED

A dimension line carries its measurement printed along it — `6'-8 3/8"`,
`72'-5 7/8"`, 278 of them on one clinic sheet — and a wall's centreline never
does. Geometrically the two are identical, so the text is the only
discriminator available.

It does not work on these sheets. At a band of 1.5× thickness it dropped a
144 ft facade and 12 other real runs on one sheet, 547 ft; tightened to 0.75×
capped at six inches, with three measurements required, it still cost **795 ft
of real wall to save 96 ft of phantom**. Interior dimension chains on a dense
plan genuinely run within six inches of real partition centrelines, so
position cannot separate them here.

Kept at `~/.claude/jobs/.../dimensionStrings.rejected.ts` rather than in the
repository: a rule that removes 8 ft of wall per foot of phantom should not be
one import away from being switched on.

### (d) FURRING BELOW THE FLOOR — built, measured, REVERTED, and the reason
    kills the whole approach

Furring is 1.5–2.1 in and the floor is 2.4, so it is refused: 1,326 ft on
BIM-DEV. The plan was a second pairing pass below the floor, keeping only thin
runs lying against a thicker wall for most of their length — with hatch
excluded by side (inside the wall's body) and dimension rows by distance.

The rule works on fixtures and finds **nothing** on the sheets. Measured on
duplex level 1: the second pass produces 25 thin pairs and the filter keeps 0,
because those pairs sit **22 to 35 inches from the nearest parallel wall**.
They are not furring.

**Real furring shares a face with the wall it finishes**, so it is not drawn as
a separate thin pair at all — the face between them is one line, and what the
pairer sees is one wall of the combined thickness. No rule about thin pairs
beside thick walls can find a thing that is not a thin pair. That is a fact
about how walls are drawn rather than about these renderings, so the approach
is closed, not merely unsuccessful here.

### (e) STAIRS — the rule already exists and is already applied

Stair treads on the clinic sheet are 264 segments, median 3.4 ft, at a
constant pitch of about 11 in — which is a plausible wall thickness, so
adjacent treads pair as textbook walls. The discriminator for that is
"evenly spaced parallel strokes continuing a pitch", and `wallVectors.ts`
already implements it as the SERIES rule (`SERIES_REACH`,
`SERIES_PITCH_TOLERANCE`), which exists because a hatched fixture once
produced 230 phantom walls and 11,584 ft where 100 ft was drawn.

So the 249 ft of stair-blamed extra on BIM-DEV is the RESIDUE after that rule,
and loosening it to catch the rest is loosening the thing holding back the
hatch fixture. Logged and skipped, which is what the brief asked for in this
case.

### BIM-HELD-OUT, scored once — the honest number

kit-office, kit-fzk-haus, duplex-apartment. 8,660 key ft over 14 sheets.
Identical before and after, because no fix shipped.

| | missing | extra | net |
| --- | --- | --- | --- |
| with furring | 780 (9.0%) | 373 (4.3%) | −406 |
| without furring | 770 (9.0%) | 380 (4.5%) | −390 |

**The held-out set is EASIER than the dev set** — 9.0% missing against 16.3% —
and that is a property of the buildings, not of any tuning: the dev set holds
the two biggest and most glazed models (esplanades and the clinic, 36,683 of
its 47,316 ft), and the held-out set is three small, simple, mostly
unfenestrated ones. A fix measured on BIM-DEV and checked here would look
better than it is. Worth remembering before the split is read as a safety net.

## THE BIM SCORER COULD NOT SEE PARTIAL COVERAGE — 2026-10-18

Every BIM number published yesterday was too kind, and the amount is large.

`covers()` asked whether a run overlapped **half the SHORTER** of the two,
which on a long wall is half the RUN. A 5 ft run lying anywhere on an 85 ft
facade made the whole 85 ft count as found and the other 80 ft vanished. An
exterior wall broken by window after window is exactly that shape, so the
thing this set exists to measure was the one it could not see.

| BIM-DEV, rules only | old scorer | measuring FEET |
| --- | --- | --- |
| missing | 9.2% | **16.3%** |
| extra | 3.3% | **5.3%** |
| missing, no furring | 7.1% | **14.3%** |

Coverage is a union of spans along the wall now, in feet, and a wall
contributes its uncovered length; the same union taken the other way gives
the feet of run lying on no wall, so a run half on a wall and half across a
corridor is half a phantom rather than all or nothing.

**How it was caught is the part worth keeping.** A window-bridging rule was
built, measured, and reported the baseline TO THE FOOT. That looked like a
rule which changed nothing — the third time in two days something has worn
that disguise here. It had in fact bridged 353 gaps on one sheet; the score
simply could not move, because the walls it bridged were already counted as
found. A fix that moves nothing is a claim about the INSTRUMENT as much as
about the fix, and this file now has three instances: the veto that matched
by object identity, the rule in dead code behind a grouping filter, and a
scorer that rounded every partially-found wall up to whole.

`zzMessy.eval.ts` scores the same way and has not been corrected, so the
messy synthetic figures (2.9% missing, 13.6% extra) are on the OLD basis and
are not comparable to anything above.

## THE BIM SPLIT — 2026-10-18

| | buildings |
| --- | --- |
| **DEV** — fixed and measured against | medical-dental-clinic, esplanades, kit-smiley-west |
| **HELD OUT** — scored once, at the end | kit-office, kit-fzk-haus, duplex-apartment |

By BUILDING, not by sheet: two floors of one building share an office's
conventions and its renderer, so scoring on one after tuning on the other is
scoring on a sheet the work has effectively seen. `BIM_GROUP=dev|held`
selects them, and the eval asserts the group it found has as many buildings
as the list names — a held-out set quietly missing a folder is not a held-out
set.

### BIM-DEV baseline, measured in feet

47,316 key ft over 22 sheets.

| | missing | extra | net |
| --- | --- | --- | --- |
| with furring | 7,690 (16.3%) | 2,524 (5.3%) | −5,166 |
| without furring | 6,318 (14.3%) | 3,045 (6.9%) | −3,272 |

| cause of missing | ft |
| --- | --- |
| plain exterior | 3,612 |
| plain partition | 1,796 |
| furring under 3 in | 1,326 |
| runs under 3 ft | 727 |

| what the extra sits on | ft |
| --- | --- |
| dimension lines | 1,354 |
| stairs | 377 |
| room-space outlines | 282 |

## FIX (a), WINDOW BRIDGING: REVERTED — 2026-10-18

Bridge a gap when glazing spans it and both sides are the same line and the
same thickness. Two lines of glazing minimum, 60% of the gap covered, inside
the wall band; doors deliberately excluded, since a swing is an arc and a leaf
is one line.

It works on the set it was built for and **fails the bench**:

| | baseline | with the rule |
| --- | --- | --- |
| BIM-DEV missing | 16.3% | **14.8%** |
| BIM-DEV extra | 5.3% | **6.1%** |
| bench type-totals outside ±2% | 17 of 60 | **21 of 60** |
| bench walls over 10 ft missed | 111 | **200** |
| bench zero-wall bar | PASS | PASS |
| 20 fixtures printed floor | 16 of 17 | 16 of 17 |

Reverted. 671 ft of real wall recovered on BIM-DEV is not worth 89 more
missed walls on the bench — and the direction is the surprise worth recording:
bridging MERGES runs, and a longer merged run then falls foul of filters the
two short ones passed, so a rule that only ever joins things ended up losing
wall.

Two things found on the way, both kept:

**`mergeWalls` was never given the drawing.** Its fourth parameter has existed
since the door-evidence experiment with a docstring saying nothing reads it
yet; the one production call site in `wallRuns.ts` omitted it, so it defaulted
to an empty array. Any rule reading it would have fired on nothing.

**A rule placed in the spans loop is dead code for a wide gap.** Two runs
further apart than `MAX_OPENING_FEET` are never put in the same group by the
pre-filter above it, so the spans loop never sees that gap. The pre-filter
carries a comment calling itself redundant, and for a gap inside the cap it
is.

## The BIM held-out set: real buildings, exact keys — 2026-10-18

36 sheets from 6 real IFC models, 2 renderers each, with the answer key taken
from the MODEL's own centrelines rather than from anyone's reading of a
drawing. **Test only.** Training on these makes them stop measuring anything.

### The score

| | missing | extra | net |
| --- | --- | --- | --- |
| with furring (55,976 key ft) | 4,668 (**8.3%**) | 1,958 (**3.5%**) | −2,710 |
| without furring (50,498 key ft) | 3,437 (**6.5%**) | 2,289 (**4.3%**) | −1,148 |

| renderer | sheets | missing | extra |
| --- | --- | --- | --- |
| r1-section | 18 | 8.9% | 3.7% |
| r2-ifcsvg | 18 | 7.8% | 3.3% |

Per model, missing runs 0.0% (fzk-haus) to 11.6% (esplanades); extra runs 0.0%
to 10.2% (smiley-west). Two renderings of the same floor can differ by 4× —
esplanades 5.korrus is 469 ft missing on r1-section and 234 on r2-ifcsvg.

### Why wall is missed, in feet across the set

| ft | share | cause |
| --- | --- | --- |
| 1,723 | 3.1% | plain exterior wall |
| 1,218 | 2.2% | furring, under 3 in thick |
| 813 | 1.5% | plain partition |
| 725 | 1.3% | runs under 3 ft |

**The first is openings and the second is thickness, and both were measured
from the keys alone.** Walking every wall's centreline in the key's own
coordinates and asking what ink lies beside it: **exterior walls are 20.2% of
their length opening** (3,846 ft of 19,055), partitions 7.2%, furring 0.0%.
One 85 ft esplanades facade has 852 window stroke-endpoints along it against
293 wall ones — it is a glazed elevation drawn as wall stub, window, wall
stub. That is the unbridged-openings scar this file already records as
known-and-unfixed, arriving as the single largest cause on real buildings.

Furring is a separate and simpler story: it is a thin finish layer, 3,230 ft
of it, with **no openings at all**, and 38% of it is missed on thickness.

### What the extra sits on

| ft | share | sits on |
| --- | --- | --- |
| 970 | 1.7% | dimension lines |
| 306 | 0.5% | stairs |
| 128 | 0.2% | the scale bar |

A scale bar is drawn AT PLAN SCALE, so a 20 ft bar is a 20 ft pair of parallel
lines. It is a wall by every geometric test this engine applies.

### HARDER THAN THE SYNTHETIC SHEETS ON MISSING, EASIER ON EXTRA

| | missing | extra |
| --- | --- | --- |
| messy synthetic, held-out styles | 2.9% | 13.6% |
| BIM, with furring | **8.3%** | **3.5%** |

Nearly three times the missing and a quarter of the extra, and both directions
have the same cause: **a real building is mostly wall, and a synthetic sheet is
mostly furniture.** The generator's job was to clutter a plan, so its sheets
are full of desks and tables that read as wall pairs — hence 13.6% extra. Real
plans have fewer such decoys, so the phantom rate falls. But a real building
has long glazed facades, 3 in furring and hundreds of short returns, none of
which a generator thought to produce — so the missing rate triples.

**Neither set predicts the other, which is the finding.** A model picked on the
synthetic sheets is being chosen on the failure mode real buildings have least
of.

### THE READER IS NOT THE PROBLEM, AND THAT HAD TO BE CHECKED

`zzBimRead.eval.ts` counts our strokes against each key's own count: **271,371
against 264,244, or 102.7%** (we flatten curves into segments, they do not). So
a missed BIM wall is never a wall we failed to read. Worth a run of its own
because a finder that cannot pair two faces and a reader that never hands it
the faces produce the same score.

### A DIAGNOSTIC THAT FAILED ITS CONTROL, AND WAS NOT SHIPPED

A third eval classified each missed wall as not-drawn / unpaired / broken, and
reported **87% of missed footage as "no stroke along either face"**. It was
false. The control — running the same detector over walls the finder DID find
— returned "not drawn" for 70% of those too, which is impossible.

The lesson is the one this file keeps paying for, so here is the shape rather
than the fix: the first version had NO control, and its answer was confident,
specific and wrong in a way nothing downstream would have caught. What settled
it was not more detector work but two numbers from outside it — the reader
count above, and a histogram of what actually lies beside one wall in raw PDF
points, with no unit conversion in the path. The wall-role and opening-share
numbers in this entry all come from the keys directly for that reason.

The detector was deleted rather than fixed. A measurement whose control fails
is not a result to repair later; it is a thing that must not be in the
repository where somebody will read its output.

## The labelling screen, finished — 2026-10-18

Real sheets are the bottleneck and this is what makes them labellable. The core
(`labelStore`, `labelRows`, the route) shipped in `41407243`; this is the screen
and the round trip.

### What it does now

- **Save to labels** writes the verdicts AND the feature vector of every
  pairing, through `labelStore`'s gate. Inert unless `TAKEOFF_LABEL_DIR` is
  set, which is every deployment.
- **Not sure (U)** is a fourth verdict, saved and excluded. It is NOT the same
  as unreviewed: unreviewed is the commonest negative on a finished sheet (the
  hatch nobody glanced at), and unsure is a candidate somebody looked at and
  could not call. Feeding either answer to a model teaches a confidence the
  reviewer did not have.
- **Time per sheet** is recorded from when the sheet was opened. Wall clock and
  deliberately crude — it counts the reviewer making tea, and a figure that
  flattered the work would be worse than none, because it is going to price a
  job.
- **Box-select polarity is now drag = reject, shift-drag = accept.** It was the
  other way round. The common gesture is sweeping a schedule or a field of
  hatching off the sheet; accepting in bulk is rarer and riskier, because a box
  of walls usually contains something that is not one.
- **An instructions panel** carries the rules as text and the keys. The PICTURE
  guide is cropped from real plan sets, so it is client drawing content and
  does not go in this repository under any filename — it lives beside the
  labels folder and the panel says where.

### The viewer reports pairings now, and that is the load-bearing part

A reviewer judges RUNS; a model decides PAIRINGS. `onCandidate` fires after
`normaliseAcrossSheet`, so the vectors saved are the ones a model would be
scored on, and `labelRows` carries each verdict from the run back to the
pairings it was made of. Without that a saved sheet is a score, not training
data.

### THE ROUND TRIP FOUND A DEFECT ON ITS FIRST RUN, IN THE SEAM

`labelRoundTrip.test.ts` runs finder → vectors → verdicts → `labelFile` → the
file → read back → are the verdicts still on the right candidates. Every piece
of that path already had its own green test, and the pieces were written weeks
apart.

The panel spelled a rejection `not-a-wall`; `LabelVerdict` spells it
`not-wall`. **The rows would still have been right** — `labelFile` tests for
`"wall"` and treats everything else as a negative — so the training data would
have been correct and only `counts.rejected` wrong, stuck at zero. Nobody reads
those counts until the set is built, which is months later and too late to
re-label anything. TypeScript caught it the moment the two modules met in one
file, which is the whole argument for writing the seam test rather than
trusting six green unit suites.

Mutation-tested three ways, all red: the spelling, a label forced to 0, and an
emptied `featureNames`. The third SURVIVED at first — the file could record no
column names at all and nothing noticed, which later makes it uncheckable
against a model's columns. That assertion is in the test now.

### Decisions per sheet, measured

Not a time estimate — a count of how many times a reviewer presses a key.

| sheet | runs to judge | detect |
| --- | --- | --- |
| Alden A103 p19 | **2** | 2.2 s |
| Camp Bow Wow A120 p15 | 12 | 0.2 s |
| Camp Bow Wow A102 p9 | 114 | 3.4 s |
| Camp Bow Wow A101 p8 | 133 | 10.4 s |
| ELEVEN03 A4.B-Y2 p117 | 81 | 2.0 s |
| ELEVEN03 A4.B.1 p119 | 224 | 2.6 s |
| ELEVEN03 A4.B.3 p121 | 282 | 3.0 s |
| ELEVEN03 A4.B.2 p120 | **288** | 3.8 s |

**A103 is a bad sheet to time the work on**, which is worth knowing before
anyone uses it as the yardstick: two decisions is under a minute including
opening the sheet, and a dense one is 288. The spread is 140×, so a per-sheet
average is close to meaningless and the unit to plan in is DECISIONS.

No human rate is recorded here on purpose. One can only come from an estimator
doing it, and the screen now records it on every save.

### What the density filter promised and what the sheets are

Thumbnails of every nominated page, rendered and looked at
(`~/Claude Folder/takeoff/sheets-to-label-thumbs/`). Stroke density separates a
drawing from a text page and **cannot tell a floor plan from an elevation**,
which `sheets-to-label.md` said — and the size of the gap was not measured
until now:

| set | dense pages | actually floor plans | the plan wanted |
| --- | --- | --- | --- |
| ELEVEN03 | 59 | **~20** | 18 ✓ |
| Camp Bow Wow | 19 | **~4** | 10 ✗ |
| Alden Green | 20 | **~0** | 8 ✗ |
| HPL Lighthouse | 6 | **3** | 6 ✗ |

Alden Green's twenty dense pages are civil, structural and MEP — its only
architectural plan in the list, A103, is not in a dense range at all. So the 48
training sheets are nearer **27**, and ELEVEN03 would be about three quarters
of them, which is precisely the one-office failure the split exists to avoid.

Rendering them needed two fixes worth keeping: a 342 MB set cannot cross
`page.evaluate` as base64 (the renderer dies reporting "Target page, context or
browser has been closed", which names Playwright and not the memory), so the
PDF is fetched from a tiny local server — and the host page has to come off
that server too, or an `about:blank` origin makes pdf.js fail with a bare
`UnknownErrorException`.

### The guide's captions were written after looking, not before

The first pass picked crop boxes to fit captions already written, and four of
twelve showed something else — a crop captioned "grid lines" was a room plan.
Nothing could have caught it: a crop always renders, and a wrong caption on a
real drawing looks exactly like a right one. The order is fixed in the script
now: render numbered candidates, look, then caption what is in each.

## Sheet-relative features and a veto: style transfer SOLVED, reality not — 2026-10-18

The previous model put 0.721 of its importance on absolute pen width and
refused walls drawn by any office it had not seen. Two changes followed.

### 1. Nothing an office can set is a feature any more

| was | is |
| --- | --- |
| `penMean` (points) | `penPercentile` among the sheet's own strokes |
| `thicknessFt`, `thicknessInches` | `thicknessVsCommon`, `thicknessPercentile` |
| `lengthFt` | `lengthPercentile` among candidates |
| `localDensity` (count) | `densityPercentile` among candidates |
| `nearestScheduledDeltaIn` | `scheduledDeltaShare`, as a share of thickness |

Still 24 columns. `wallFeatures.test.ts` pins the property they exist for: the
same drawing at a **three times heavier pen** or **twice the scale** gives
byte-identical vectors, no raw pen width survives into them, and a thicker wall
still ranks above a thinner one on its own sheet — relative must not mean blind.

The sheet-relative columns are filled by `normaliseAcrossSheet` after every
candidate is known, because a percentile cannot be computed while the list is
still being built. Nothing may read a vector in between.

### 2. A veto-only mode, which can subtract and never add

`WallFinderOptions.veto` removes a wall the rules already chose and does
nothing else. Its worst case is the rules' own missing footage plus whatever it
wrongly removes; `decide`'s worst case is a sheet of nothing.

**Its first version compared wall objects by IDENTITY**, and every push spreads
the candidate into a new object — so it matched nothing, changed nothing, and
reported itself as harmless on all fifty sheets. A veto that never fires is
indistinguishable from a veto that is never right. It matches by pairing now,
and `wallVectors.veto.test.ts` pins that it both fires and cannot add.

### Leave one style out, five times: the transfer problem is FIXED

| mode | missing | extra | net |
| --- | --- | --- | --- |
| rules | 2,473 ft (2.9%) | 11,418 ft (13.6%) | +8,945 |
| veto @0.35 | **2,695 ft (3.2%)** | **5,165 ft (6.2%)** | +2,470 |
| veto @0.50 | 2,822 ft (3.4%) | 4,029 ft (4.8%) | +1,207 |
| veto @0.65 | 3,045 ft (3.6%) | 2,624 ft (3.1%) | −421 |
| veto @0.80 | 3,887 ft (4.6%) | 1,787 ft (2.1%) | −2,100 |

Against the previous model's **16.6% missing** on held-out styles, 3.2% is the
whole of the fix. **0.35 is the chosen threshold**: +0.3 percentage points of
missing against the rule's 0.5 limit, with margin rather than sitting on it.

### And on real drawings it is a disaster

| | rules | veto @0.35 |
| --- | --- | --- |
| Cedar Hollow missing | 5.07 ft | **176.83 ft (26.3%)** |
| 20 fixtures within 2% | 15 of 17 | **0 of 17** |
| bench walls missed | 111 | 179 |
| bench phantom footage | 3,497 ft | 1,669 ft |
| bench zero-wall bar | PASS | **PASS** |
| ELEVEN03 A4.B.3 | 2,356 ft | **1,348 ft (−43%)** |
| ELEVEN03 A4.B-Y2 | 1,571 ft | 969 ft (−38%) |
| Camp Bow Wow A102 | 2,082 ft | 1,721 ft (−17%) |

On the A4.B.3 overlay whole apartment units have lost their partitions.

**The zero-wall bar held, and that is the veto guarantee working** — it cannot
add a phantom, so the one bar the previous `decide` model broke is now safe by
construction. Everything it costs, it costs in missing wall.

### What one feature is really encoding

`penPercentile` takes **0.616 of the importance**, over the 0.4 line. It is no
longer an absolute, and the rotation proves it transfers BETWEEN SYNTHETIC
STYLES. What it encodes is "this pair is drawn heavier than most of this
sheet", and on the generator that is nearly a definition of a wall.

On a real sheet it is not. A real drawing carries dimension lines, leaders,
hatching, schedules and title-block rules at a spread of weights, and a wall
face is not reliably in the upper percentiles of that distribution. The model
learned a property of the GENERATOR rather than of walls — one level up from
the last mistake, and the same mistake.

### So the honest state

**Relative features fixed style-to-style transfer and did not fix
generator-to-reality transfer.** Fifty synthetic sheets in five styles share
more with each other than any of them shares with ELEVEN03, and no amount of
rotation inside that set can show it.

Nothing further is worth training until real labelled sheets exist. The next
model should be trained on real sheets with synthetic ones mixed in as
NEGATIVES only — the desk rows, poché and tables the generator does produce
faithfully — rather than as a source of positives.

No model is committed. `wall-model.json` is absent by design; `deciderFor`
refuses a model whose columns do not match, so a stale one cannot load.

## Where accuracy stands — 2026-10-17

Every number here is from the runs on that date. Re-run before quoting any of
it; this section is a snapshot and the rest of this file is full of entries
that were true when written.

### The twenty fixtures — someone else's conventions

**15 of 17 vector plans within 2% of key gross.** 3 walls missed across the
set, 2 extras. S11 at −3.0% and S12 at −2.3% are the two that fail. The three
raster sheets are refused rather than guessed, which is the right answer.

Total shortfall across the set is about **33 ft of 4,121** — under 1%.

### The bench — our own generator, with wall-LF ground truth

| bar | state |
| --- | --- |
| no wall over 10 ft missed | ❌ 111 walls over 27 of 60 cases |
| in-scope LF within 2% per type | ❌ 17 of 60 type-totals outside |
| zero-wall sheets: no phantom LF | ✅ 0 of 41 unflagged |

**Where the missed footage goes, grouped.** 5,595 ft is attributed across 91
loss lines, but 2,210 ft of that is `A-101__scan` — a raster sheet with no
vector strokes, refused honestly. Of the remaining **3,385 ft**:

| feet | share | cause |
| --- | --- | --- |
| 1,864 | 55% | a neighbouring line claimed one of its faces first (`one-face-one-use`, longest first, first match wins) |
| 1,096 | 32% | read as hatching rather than wall (the series test) |
| 371 | 11% | only one face reached the reader, or the faces came back under the 2.4 in thickness floor |
| 54 | 2% | curves with no straight faces, faces of unequal length, pieces under the 2 ft input floor |

### Cedar Hollow — the held-out plan, now a practice one

    missing   5.07 ft   0.8%
    extra     0.50 ft   0.1%   (0.00 phantom + 0.50 over-count)
    net      -4.57 ft  -0.7%

21 of 21 walls found, no run matching no key wall. Its first held-out run,
before any of this work, was −7.9%.

### The real plans — totals only, and that is the point

No answer keys exist for these, so **missing and extra are undefined** and only
a total can be quoted. That is a real limit of this instrument, not an
omission: a total cannot tell a phantom from a recovery.

| sheet | ft | runs |
| --- | --- | --- |
| ELEVEN03 A4.B-Y2 (p117) | 1,571 | 81 |
| ELEVEN03 A4.B.1 (p119) | 2,424 | 224 |
| ELEVEN03 A4.B.2 (p120) | 2,517 | 288 |
| ELEVEN03 A4.B.3 (p121) | 2,356 | 282 |
| Camp Bow Wow A101 (p8) | 2,530 | 133 |
| Camp Bow Wow A102 (p9) | 2,082 | 114 |
| Camp Bow Wow A120 (p15) | 129 | 12 |
| Alden Green A103 (p19) | 29 | 2 |
| Eleven03 A2.20 (p9) | not measured — no scale |

### Open, and why each is parked

- **A doorway the corridor guard refuses** — 3.50 ft on Cedar Hollow, one gap
  on the whole sheet. A door-evidence rule was built and reverted; the entry
  above has the numbers and the flaw.
- **The 8,000-piece curve cap** — A102 gets no curved walls. Waiting on an
  A102 answer key, because the phantoms this file records all landed on
  hatched fill and nothing could grade the result.
- **The bench's `one-face-one-use` loss** — the largest single cause above and
  untouched. It is a greedy pairing: faces are claimed longest-first and the
  first match wins, so a neighbouring line can take a face its own wall needed.
- **`A-401`'s two scales on one page** — the scale is read 2x wrong, which is
  why that sheet is the worst place on the bench to spend any tolerance.

## Every score is THREE numbers, not one — the standard from 2026-10-17

    missing — key wall nothing found, or found short
    extra   — wall found that is not there: phantoms, and the same wall twice
    net     — extra minus missing, the number everyone quotes

**A net total hides its own composition, and this sheet proved it the
expensive way.** Cedar Hollow read **-0.6%** while it was 12 ft short of real
wall and 8 ft over on a double count — two defects pointing opposite ways,
summing to something that looked nearly perfect. Fixing the double count moved
the headline to **-1.7%** and the takeoff got BETTER. No net number can say
that, and anyone optimising against one would have reverted the fix.

For a subcontractor the two errors are not even the same KIND of wrong. Missing
wall is a bid that loses money. Extra wall is a bid that loses the job. They
net to zero on a scorecard and never in a business.

So a report that quotes one number is incomplete, and the net is the least
informative of the three. The scorer prints all three; the bench already keeps
them apart (`missedOver10` and `walls.phantom.lf`) and should keep doing so.

### Door evidence in a bounded gap — TRIED, REVERTED, and the numbers are the point — 2026-10-17

The corridor guard refuses exactly one gap on Cedar Hollow and that gap is a
DOORWAY with its swing drawn in it, costing 3.50 ft. The obvious fix is to ask
a refused gap whether a door is drawn in it, and the obvious test is the one
the shape suggests: a swing is hinged at a JAMB, on the wall's own line, and
its radius is the LEAF, which is the width of the opening. Both are measurable
against the gap itself rather than against a chosen tolerance.

**It worked on Cedar Hollow and it was a disaster on the bench.**

| | Cedar Hollow | bench walls missed |
| --- | --- | --- |
| before | missing 5.07 ft, net −0.7% | 111 |
| with door evidence | **missing 1.57 ft, net −0.2%** — W4 exact at 36.00 | **271** |

Instrumented rather than guessed at: of **1,087 bounded gaps on the bench, it
bridged 651 — sixty per cent.** The commonest width it bridged was **6.4 ft,
253 times**, which is the bench's own corridor. It was not a discriminator, it
was a rubber stamp, and it drew wall across corridors at scale.

**The flaw, stated so the next attempt does not repeat it:** the test took the
MEDIAN distance from a jamb over every flattened-arc piece near the gap. On a
drawing with doors everywhere — which is every drawing — a crowd of unrelated
swings supplies whatever radius is asked for. Nothing required the pieces to
be ONE arc: contiguous in angle about that hinge, sweeping the quarter-turn a
door sweeps, and belonging to no other opening. "An arc at about the right
distance" is satisfied by noise; "this arc, hinged here, sweeping this far" is
not, and only the second is worth building.

**And the unit tests passed throughout — 42 of 42, including the corridor
case.** They call `mergeWalls(walls, feetPerUnit)` with no strokes, so the
evidence path never ran in any of them. A corridor test that cannot reach the
code deciding corridors is the vacuous green this directory exists to end, and
the bench was the only instrument that saw anything. Any future attempt must
first give those tests strokes, so the corridor case can fail.

`openingEvidence.ts` is NOT committed. It is kept out of the tree rather than
left unwired, because dead code that looks like a feature is worse than none —
the reasoning above is what was worth keeping.

## Known and NOT being fixed — 2026-10-17

Three things measured on Cedar Hollow and left alone on purpose. Written down
so the next person does not re-derive them, and so nobody "fixes" the first one
without reading why it is conservative.

### Openings on straight walls that nothing bridges — 11.2 ft of 11.99

| wall | short by | refused by |
| --- | --- | --- |
| W6 | 7.68 ft | **the collinearity gate**, by a tenth of an inch |
| W4 | 3.50 ft | the corridor guard |
| W1, W3, W14, W16 | 0.80 ft total | ends stopping 0.2-0.3 ft short of a corner |

**THIS ENTRY FIRST BLAMED THE CORRIDOR GUARD FOR ALL OF IT, AND THAT WAS WRONG
FOR THE LARGER HALF.** It read: *"`mergeWalls` bridges a gap only when
`gapIsCrossing` says something bounds it... That guard is doing exactly what it
was written to do here."* Plausible, and never checked. Measured instead, by
logging every gap decision on this sheet: **150 gaps bridged and exactly ONE
refused by the corridor guard** — W4's, at (117.9, 43.6-47.1).

W6's two gaps never reach that guard. They are stopped a gate earlier, by the
collinearity test that a gap-bridge has to pass:

    across 1.60 in   allowed 1.50 in   gap 4.00 ft   walls 18.2 + 11.0 ft
    across 1.60 in   allowed 1.50 in   gap 3.76 ft   walls 18.2 + 10.0 ft

`SAME_LINE_FEET` is 0.5 ft and a GAP bridge is allowed a QUARTER of it, so the
two pieces of W6 must agree to within an inch and a half. They agree to within
1.60 inches. **Seven and a half feet of wall is lost to a tenth of an inch.**

Two other pairs on the same wall are 3.96 in apart, which is the same wall
measured from a different face — so loosening the tolerance far enough to
catch those would start merging a wall with its own neighbour.

Not fixed here because it is a tolerance with a scar on each side and the sweep
has not been run. What makes it tractable is that the number is now known: any
proposal has to say what happens at 1.6 inches AND at 3.96, and the bench's
zero-wall bar is what would catch a sweep that went too far.

The corridor guard, for W4's 3.50 ft, is a different and harder problem — see
the plan below. It bridges on width alone nowhere: that once drew wall straight
across a 5'-7" corridor, 39 ft of wall nobody can build.

### A straight run on top of a curved one — 7.8 ft counted twice

**W7 reads +7.78 ft, and it is not a scoring artefact.** This was first written
up as the scorer handing W7 a piece of W6, on the strength of a 7.80 ft run
lying 53 degrees off W7's chord. It is not: the two runs OVERLAP.

      7.80 ft         spans 0.1-4.7 of 46.0 ft
     55.13 ft curved  spans 0.1-46.0 of 46.0 ft
     OVERLAP 4.7 ft

The 53 degrees is what a short chord across the START of a 117-degree arc
looks like against that arc's overall chord — so the angle that made it look
like somebody else's wall is exactly what a piece of this one would show.
`notDuplicateCoverage` does not catch it because one run is curved and the
other straight.

Not fixed because it is a new finding rather than the job in hand, and because
it partly CANCELS the shortfall above: the sheet reads -0.6% from -11.98 ft of
missing wall and +7.78 ft of double count. Fixing one without the other moves
the headline number the wrong way, which is worth knowing before anyone starts.

### The 8,000-piece cap on the curve pass

`MAX_CURVE_PIECES` switches the curve pass off above 8,000 short pieces, so
Camp Bow Wow's A102 — about 127,000 — gets no curved walls at all. Measured
cost of lifting it, on hatch-shaped input:

| pieces | time |
| --- | --- |
| 1,000 | 41 ms |
| 2,000 | 128 ms |
| 4,000 | 345 ms |
| 8,000 | 1,392 ms |

Quadratic, so A102 extrapolates to minutes. A uniform grid over piece
endpoints would make it roughly linear — but this file already records that
**two attempts to index that scan made it slower**, so a third needs to beat
the current code at 8,000 before going further.

The blocker is not speed. Lifting the cap means running the curve pass over
127,000 hatch strokes on a sheet with no answer key, and the phantoms this very
session put on hatched fill are what that would be risking. **Waiting on an
A102 key**, which is the only instrument that would make the result readable.

## Known limitations, in the order they cost the most

1. **A floor plan under ten wall runs returns nothing.** 3 of 15 vector
   fixtures. Needs an enclosure test, not a lower constant — see above.
2. **A scan's lines are found; its WORDS are not.** `rasterStrokes.ts` renders
   a scanned page and returns ordinary `StrokeSegment`s, so everything
   downstream works on it unchanged. Graded against the vector drawings the
   scans were made from — S18 of S02, S19 of S08, S20 of S13, each named in its
   own title block, so the answer key is free and is not an opinion:

   | | wall footage, raster vs the same drawing's vectors |
   | --- | --- |
   | S19 / S08 | 347 ft of 406 — **85%** |
   | S20 / S13 | 505 ft of 555 — **91%** |
   | S18 / S02 | not graded: the vector original declines a scale under the eval's own call |

   **Its WORDS are read now too** (`rasterText.ts`, `sheetText.eval.ts`). A
   model reads one rendered TILE at a time and returns the lettering and where
   it sits; every length and quantity is still measured from geometry, so no
   number anybody is billed from comes out of a model. Measured against the
   same vector originals: **101 of 101 printed strings read exactly, 98%
   placed within the 30 points the dimension pairing allows.** Both scans then
   read their OWN printed scale correctly, and one came out at 91% of the
   drawing's footage end to end with nothing borrowed.

   **It has to be Opus, and the measured reason is not the one first written
   down.** The argument for it was that a misread dimension sets the scale —
   weak, because the vote needs three labels to agree and outvotes a misread.
   Priced against the same bar:

   | | Opus 5 | Haiku 4.5 |
   | --- | --- | --- |
   | strings read exactly | 101/101 | 89/101 (88%) |
   | **placed within 30pt** | **99 (98%)** | **16 (16%)** |

   Haiku can mostly READ the lettering and cannot say WHERE it is, and
   placement is the half that decides anything: a label 30 points from its
   line pairs with nothing. So this is bought for COORDINATES, not characters.
   The prompt was only ever tuned against Opus, which is the honest bound on
   that comparison.

   **Tiles are JPEG, not PNG**, and that is not cosmetic: a speckled tile is
   1.20 MB as PNG against 0.54 MB as JPEG, and the PNG was over a Server
   Action's body limit — so the feature worked on clean sheets and failed on
   real scans until #803. Re-measured on JPEG, the figures above are
   unchanged.

   Two bounds worth knowing. The detector is **axis-aligned only**, and reports
   `diagonalInk` so a sheet whose walls it cannot see is distinguishable from a
   sheet with no walls. And the three scanned fixtures are CLEAN rasterisations
   — light speckle on S19, no skew — so none of this is evidence about a
   photocopied fax. A real image-only page from a real permit set was rendered
   and compared while writing it, and is clean in the same way.
3. **Rooms are not scored here.** The pipeline does not surface a room list from
   the entry point the scorer uses, so 122 tagged rooms sit unused.
4. **The wall classifier must not run unasked** — graded 2026-10-15: it drops
   3 real walls per sheet to catch 1 phantom, and caught 3 of 12 on a sheet
   where every candidate was a phantom. It stays a button a person presses.


## Known phantoms on Camp Bow Wow A120, kept as examples — 2026-10-17

A120 is retired as the first answer key: it is mostly interior elevations, and
its one plan is a two-restroom enlargement too small to grade a detector on.
What it still gets wrong is recorded here rather than fixed, because these are
the next two shapes worth a rule and both are visible on one small drawing.

The sheet now measures 121 ft over 11 runs, the enlarged plan only. Of those:

| | what it is | why it survives today |
| --- | --- | --- |
| runs through the middle of BOTH restrooms, across the fixtures | the toilet partitions and the fixtures themselves — a WC and a lavatory drawn in plan present two parallel edges at a partition-ish spacing | nothing distinguishes a fixture outline from a wall face by shape, and `wallsNotIsolatedStubs` cannot reach them because they touch the real walls at both ends |
| a run along the TOP DIMENSION LINE | a dimension string runs parallel to the wall it measures, offset by a round distance, and its extension ticks give it the company a face needs | `inAHatchSeries` is written for exactly this and its own note explains why it cannot fire here: it needs TWO neighbours at a whole number of steps, and a dimension line has one |

Neither is a hatch, so `drawnCoverage` does not see them: both are drawn end to
end along their own length, which is the one thing that rule asks about. That
is the correct behaviour of that rule and the reason these need their own.

**What a fix would have to separate**, so the next attempt starts narrower than
"phantoms on A120":

  - a FIXTURE is a closed outline — a WC, a lavatory and a partition pilaster
    all close on themselves within a few feet. A wall face does not close.
    `rooms.ts` already finds closed regions; nothing asks whether a candidate's
    faces belong to one.
  - a DIMENSION LINE carries TEXT along it, at its midpoint, reading as a
    length — and the drawing prints that number. `dimensionLabels.ts` already
    reads those for the scale vote, and their positions are never compared
    against the runs the pairer returns.

Both are measurements nobody has taken yet. Neither is guessed at here.

## Plan-text reading — tags, legend, door schedule (2026-10-20)

Three readers, each measured on Camp Bow Wow A101 (p8, legend A130 p16,
schedule A601 p26) and ELEVEN03 A4.B.1 (p119, wall schedule A0.003B p9).
Nothing here is customer-facing and nothing writes.

| | before | after |
| --- | --- | --- |
| CBW wall tags matched to a run | 7 | **16** runs (23 symbols, every one by its leader) |
| CBW footage with a type | 189 ft | **333 ft** of 2,542 |
| ELEVEN03 wall tags matched | **0** (all 19 rejected as callouts) | **10** runs, 525 ft of 2,424 |
| CBW door rows placed, marks in a symbol | 11 of 30 | **29 of 30** (11 by a detected gap, 18 by their mark) |
| legends read on the 12 new sets | — | 8 of 9 tried, 5–15 cents each |

### What the drawings actually do, which no fixture had

- **A tag is drawn three times.** Camp Bow Wow's diamond, a second diamond
  a hair inside it, and an axis-aligned masking box around both — on the
  legend sheet the box is INSIDE the bigger diamond. So "keep the largest"
  and "keep the smallest" are each wrong on one sheet; a named non-square
  shape beats a square (`tagSymbols.ts`, the dedupe).
- **The leader ends on a vertex and is drawn first.** A walk that begins on
  the stem goes round the diamond and comes back with nowhere to go; the
  diamond's strokes were spent and only the box was left. The walk now
  backtracks out of dead ends and keeps the closed cycle inside an open
  path. On A101 that was 21 of 46 tags.
- **A split box is a wall tag, not only a callout.** ELEVEN03 writes `MC`
  over `1 HR`. The halves are kept apart as `parts`, and a half that is a
  SHEET REFERENCE is what makes a callout. `WT-12` had also read as a sheet
  reference; the pattern now needs three digits or a dot.
- **A text item's `y` is its BASELINE.** `planPdf` reports the text origin,
  so the lettering's centre is `y - height/2`, not `+`. Read the other way,
  `MC` computed as sitting below its own divider and the halves never
  separated on a real sheet while the fixture passed. Any code taking
  `item.y + item.height / 2` as a centre is a line too low.
- **The legend learns the shape only from symbols holding its codes.** A130
  numbers its notes in boxes; without the codes the boxes outvoted the five
  diamonds and the plan's diamonds were "odd shape".
- **Door marks are found; the gaps are not.** Every one of the 30 scheduled
  marks is printed in a pill on A101, and for 17 the nearest opening
  `openingsInWalls` found was 8–37 ft away. That is the gap detector's
  ceiling, not the join's, and is left for the finder's lane. The join now
  places a scheduled mark on the nearest run within 2.5 ft when no gap
  claims it, reported as `placedBy: "mark"` so a reviewer can tell a
  deduction that rests on geometry from one that rests on lettering. Room
  numbers share the series (`102` the door, `102` the room), so one door per
  mark and the printing nearest a wall. Door 114's pill sits farther than
  that from its wall and stays unplaced. The door mark's SHAPE is reported
  and not filtered on: every mark is printed twice, pill and box, and "the
  shape most marks are drawn in" flipped between them with the count —
  29 rows on one run, 24 on the next, same drawing. Geometry picks.
- **ELEVEN03 has two legends.** p96 is TAG / UL# / RATING and proposes
  nothing, correctly. p9 (`A0.003B WALL SCHEDULE`) describes the same codes
  in words, and the chain completes on it: `ME` → 1-5/8in C-shape studs and
  track. `WS` is 8in block and stops at coverage, also correctly.
- **A partition schedule as a table** — Central Bank's `STUD SIZE | 3 5/8"`,
  `INSULATION THICKNESS | -` — reads through labelled cells now, and a
  `-` value row is dropped before any word is read out of it: the word
  INSULATION in that row had proposed batts for all ten types.

### How to run it

```
REAL_PLAN_DIR=… LEGEND_CACHE=… npx vitest run --config vitest.eval.config.mts \
  lib/takeoff/realplan/zzTagReport.eval.ts     # every legend-coded symbol and why it did or did not land
  lib/takeoff/realplan/zzChain2.eval.ts        # tag -> legend -> components -> quantities
  lib/takeoff/realplan/zzDoorReport.eval.ts    # each schedule row's fate on the plan
  lib/takeoff/realplan/zzDoorJoin2.eval.ts     # the join, symbol marks against loose text
  lib/takeoff/realplan/zzLegendRead.eval.ts    # find the legend, read it once, cache it
# ELEVEN03: CHAIN_SET="2025-03-28_ELEVEN03 PERMIT SET_ARCH.pdf" CHAIN_LEGEND=9 CHAIN_PLAN=119 CHAIN_FPU=288.04
```

Legend reads are cached under `LEGEND_CACHE` per file, page and prompt
version; the app side (`readWallLegend`) has no cache of its own yet because
caching there is a table, which is a schema change.

### Still open

- Six CBW diamonds sit 4–7 ft from any run after their leader; three more
  fail the clear margin. Not looked at.
- MHK's wall types are a box on the floor-plan sheet (A1.01) and rank
  below two notes sheets; two reads found nothing and the eval stops at two.
- `wallTypeTags` (text-matched tags) and the eval's loose door marks still
  take `y + height/2` as a centre.
