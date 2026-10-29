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

### Second pass, the twelve new sets (2026-10-20, later the same day)

The first pass measured two sets. Running the same chain over the twelve
new sets — twelve architects — found five things that no fixture and
neither earlier set did. Each is fixed where the measurement says it lives,
with the number before and after.

**The loop walker was directed, and a CAD export is not.** Gen BBQ A101 draws
each wall tag's diamond as four strokes: two leave the left vertex, two
arrive at the right. A walk from where one stroke ENDS to where another
STARTS never closes it, so 0 of 322 symbols on a sheet that tags every wall
held a legend code. `tagSymbols` now indexes both ends of every stroke and
walks it either way (`touches`, `Step`). Gen BBQ A101 goes 0 → 10 coded, 8
matched; STEM A-1.1 7 → 124 coded, 49 matched; E Street A2.1 15 → 19, 9
matched where there was 1; Camp Bow Wow A101 and ELEVEN03 unchanged at 23
and 14 matched.

**A legend's shape is a hint the plan can overrule, by a quarter.** SW Grand
Junction legends A1–B3 in circles and tags every wall in a square with a
leader: 30 squares and 3 circles hold its codes on A110, and required to be
circles 30 of 33 were "odd". Camp Bow Wow is the other way — 39 pentagons
lettered B and C (window marks) beside 36 diamonds (the wall tags) — so the
count alone would pick wrong there. `tagsFromSymbols` keeps the legend's
shape while it holds at least `LEGEND_SHAPE_FAIR_SHARE` (a quarter) of the
coded symbols and otherwise takes the plan's commonest, and the report says
which (`shape`, `shapeFrom`). SW 0 → 21 matched; Camp Bow Wow and STEM keep
their diamond.

**A code the legend defines is not a sheet reference, and `1` is `WALL TYPE
1`.** Central Bank defines `G4.1`, which `tagSymbols` rejects as a detail
callout; two of its four coded symbols on A100 were lost that way. Murray
Towers' legend names `WALL TYPE 1` and `WALL TYPE 2` and the plan draws a
`1` or `2` in a diamond — 0 of 631 symbols matched. `legendVocabulary`
accepts the code and the code with its label stripped, the tag keeps the
legend's full name, and a sheet-reference rejection is overridden when the
legend knows the words. Central Bank 2 → 3 matched; Murray 0 → 9 coded, 5
matched.

**A legend drawn as a block on another sheet has a heading, not a title.**
Bunkie's is on G003 (title block says SECTION VIEW), MHK's on A1.01 FIRST
FLOOR PLAN, Crosslines' on A001 under the heading `Partiton Types`, spelled
so. All three ranked below a mechanical schedule or an exterior-detail sheet
that says STUD more often, and the model was sent to M601 and A314 and came
back empty, at 4–5 cents a call. `legendPages` now takes a text CELL that is
exactly a legend heading (rank 1, needs 6 assembly lines; a pointer like
`REFER TO WALL TYPES` is not a heading and an index line has no assembly
behind it) and demotes M/P/E/FP/S/C-series sheets below every architectural
candidate. All eight sets surveyed now put the right page first; Bunkie (5
types), Crosslines (7) and MHK (4) read on the first call.

**A column-wrapped legend splits `3 5/8" 20 GA. MTL.` from `STUD`.** NG Green
Bay's types sit in a narrow column beside its dimension plan, and no line
holds both the size and the word; the reader proposed board and nothing
else for eight of ten types. Murray spells it `20 GAUGE METAL STUDS` and
also says `BOTTOM TRACK FASTENED AT 24" O.C.`, which flagged every type for
two spacings. `readPartitionAssembly` now reads a type's free text as one
string (a table's `LABEL | VALUE` rows are kept apart — joined, Central
Bank's `WALL THICKNESS | 4 7/8"` reads as a stud), accepts gauge with or
without parentheses, refuses a "stud" under 1-1/2in (a board thickness that
drifted in front of the word), and takes the spacing stated in the same
breath as the studs over any other. Over the 108 cached types: 16 changed,
all gained a stud or lost a false flag, none regressed. NG Green Bay 8 of 10
types now carry studs, track, board and batts.

**Where each set's wall tags actually are**, because two of the twelve put
them somewhere the chosen sheet is not: NG Green Bay tags walls on A3.2 (the
critical dimension plan, p10, which also carries the legend) and not on A3.1;
Gen BBQ on A101 (p26), not the dimensioned plan A100 (p25). On p10 the
legend's own symbols sit beside their detail drawings, which the finder sees
as runs, so a share of its 31 "matched" are the legend labelling itself —
the one case this pass reports rather than fixes.

**Still open**: Bunkie prints `P08` as bare text with a leader and no closed
symbol around it that the text centre falls inside (0 coded of 244); MHK's
A1.01 shows `1`–`4` only in grid-edge circles 9–17 ft from any run; STEM's 48
odd-shape squares are room tags that happen to hold `K1`; the six Camp Bow
Wow diamonds too far from a run and its seven without a clear margin are as
they were.

**Doors, eleven schedules read live** (`zzDoorJoin2`, 5–23 cents each, cached
beside the legends). Rows read → rows placed, symbol marks first and loose
text as the control: Gen BBQ A101 16 → 16 (1 by a detected gap, 13 by their
mark), SLN A-101A 6 → 6, SW A110 5 → 5 (the schedule is a block on the plan
sheet itself; the gap detector found 0 openings there), Baker A101 18 → 15
(13 by mark), E Street A2.1 19 → 15, STEM A-1.1 45 → 31 (read at LOW
confidence; 14 unplaced), NG Green Bay A3.1 19 → 7 (12 unplaced), Central
Bank L1 50 → 3 (the schedule spans three levels and the plan is one; the
rest are 2xx and basement marks), MHK A1.01 31 → 1 (its marks are bare text
beside the door, 19 found loose, none in a symbol), Bunkie A100 11 → 0 by
symbol and 5 by loose text (`E100`-style marks, also bare), Murray p10 is
not the door schedule (the model read it as OTHER, 0 rows; the survey's
heading hit was a note). 220 rows read, 97 placed across the eleven; the
symbol path beats or equals loose text on every set where the marks are
drawn in one, and the gap detector matched 0–50% of them, which is the
finder's ceiling as before.

### Third pass: the numbers the plan asked for, and what is wired (2026-10-20, evening)

**Held-out discipline, stated before the numbers.** The second pass above
was tuned with Gen BBQ, STEM, Central Bank and SLN in hand (the undirected
walker, the quarter fair share, `G4.1`, the assembly-line tie-break each
cite one of them). Those four are the held-out sets, so for the second
pass's changes they are not a clean held-out. This pass developed on the
ten training sets only — Baker, Bunkie, Crosslines, Murray, MHK, NG Green
Bay, Camp Bow Wow, ELEVEN03, E Street, SW — and ran the four once at the
end. Nothing was adjusted on them; their table is below, apart.

**What is wired and what is eval-only.** `readWallLegend.ts` is app code
(legend finder → model read → `readPartitionAssembly` → quantity-only
proposals) and NOTHING CALLS IT yet. `tagsFromSymbols` and
`joinOpeningsToSchedule` have no caller outside `realplan/*.eval.ts`. All
three chains are measured below from the evals; none reaches the takeoff
screen until the finder's lane wires them in.

**Wall tags: share of found runs that get a type, training sets, final
code** (`zzTagReport`, `walls typed` line; a run is one finder segment, and
a drawing tags a wall once, not per segment, so the ceiling is well under
100%):

| set, plan page | runs | coded symbols | matched | runs typed |
| --- | --- | --- | --- | --- |
| NG Green Bay A3.2 p10 | 90 | 45 | 31 | 25 (28%) |
| Baker A101 p13 | 47 | 12 | 10 | 9 (19%) |
| SW A110 p5 | 110 | 33 | 21 | 16 (15%) |
| Camp Bow Wow A101 p8 | 137 | 93 | 23 | 16 (12%) |
| ELEVEN03 A4.B.1 p119 | 224 | 20 | 14 | 10 (4%) |
| E Street A2.1 p28 | 95 | 19 | 9 | 3 (3%) |
| MHK A1.01 p32 | 40 | 13 | 1 | 1 (3%) |
| Murray A2.01 p24 | 160 | 9 | 5 | 3 (2%) |
| Crosslines p10 | 263 | 8 | 2 | 2 (1%) |
| Bunkie A100 p31 | 55 | 0 | 0 | 0 |

**Spot check, 15 crops looked at** (rendered with `CROP_JSON=` from the
eval and a Swift/PDFKit script in the session scratchpad — this Mac has no
pdftoppm or PIL): 11 pair the tag with the wall the drafter meant (Baker
C8B and S6A, Camp Bow Wow A, ELEVEN03 MC and WS, E Street 2, Murray 2, NG
IW-2, SW B2, Crosslines D, MHK 4); 2 are wrong — NG IW-5's leader points
LEFT to the insulated corridor wall and the detected leader ended on the
corner where it meets the horizontal wall, which won; Camp Bow Wow B's
connector runs UP and the detector took a stroke to the left; 2 are
ambiguous — Camp Bow Wow D's leader ends on a T-junction, SW `A1 ABOVE` is
a note about a soffit and was matched to the A1 wall beside it. The one
false positive found — Murray's `3'-0"` dimension box resting on a `2`
diamond, read as one split symbol and tagged type 2 — is fixed:
`tagSymbols` rejects any symbol whose text carries a foot or inch mark as
`dimension`, and `openingMarks` inherits that. Next lever, not taken: a
leader that ends on a junction should prefer the wall it is perpendicular
to, and a typed run should hand its type to the collinear runs that
continue it; both belong with the finder.

**Legend reading, per set** (Opus 5, $5/$25 per Mtok, one call per
candidate page; the finder's misses are counted, since they were paid for):

| set | pages read | legend $ | door schedule $ | per set |
| --- | --- | --- | --- | --- |
| Baker | p24 miss, p25 | 0.109 | 0.090 | 0.20 |
| Bunkie | p45, p5 misses, p4 | 0.129 | 0.075 | 0.20 |
| Crosslines | p30, p16 misses, p2 | 0.139 | not found | 0.14 |
| Murray | p26 | 0.088 | 0.050 (p10 was a note) | 0.14 |
| MHK | p42, p25 misses, p32 | 0.137 | 0.107 | 0.24 |
| NG Green Bay | p10 | 0.072 | 0.120 | 0.19 |
| E Street | p45 | 0.094 | 0.165 | 0.26 |
| SW | p6 | 0.055 | 0.060 | 0.12 |
| ELEVEN03 | p9 (p96 read earlier, cost not logged) | 0.078 | — | — |
| Camp Bow Wow | p1 miss, p16 (earlier, cost not logged) | — | — | — |

The misses are the pre-fix finder's; with the headed-block rule and the
trade-sheet demotion every surveyed set puts the right page first, so a
fresh set costs one legend read (3–9 cents) plus one schedule read (5–17
cents). Cached reads re-run for nothing. One parser change from this pass:
NG Green Bay's IW-5 says `FRAMING @ 6" O.C.` on the drawing (its eight
sisters say 16), and a 6 in spacing would double a stud count, so a spacing
under 12 in is flagged as a dropped digit and left unread.

**Door schedule → openings, training sets** (rows read → placed by a mark
in a symbol, loose text as the control): Baker 18 → 15, E Street 19 → 15,
SW 5 → 5, NG Green Bay 19 → 7 (9 loose), Bunkie 11 → 0 (5 loose; marks are
bare text), MHK 31 → 1 (19 loose; bare text), Murray 0 (p10 is not the
schedule), Crosslines no schedule page found. Camp Bow Wow 30 → 29 from the
first pass; ELEVEN03 not joined.

**Held-out, run once with the finished code, nothing adjusted:**

| set | runs | coded | matched | runs typed | doors read → placed | $ per set |
| --- | --- | --- | --- | --- | --- | --- |
| STEM A-1.1 p21 | 181 | 124 | 49 | 35 (19%) | 45 → 31 | 0.28 |
| Gen BBQ A101 p26 | 168 | 10 | 8 | 6 (4%) | 16 → 16 | 0.17 |
| Central Bank p24 | 102 | 4 | 3 | 2 (2%) | 50 → 3 | 0.37 |
| SLN A-101A p10 | 93 | 3 | 2 | 2 (2%) | 6 → 6 | 0.18 |

Legends on all four read to studs, track and board (Central Bank 10 of 10
types, Gen BBQ 19, SLN 4, STEM 13 with two layer-count flags and U1's two
stud sizes flagged).

### Fourth pass: feet against accepted walls, propagation, bare text (2026-10-20, night)

**Held-out sets are closed for this feature.** Central Bank, Gen BBQ, SLN
and STEM were looked at during the second pass and are not opened again
for plan-text work; fresh held-out sets are to be chosen later. Everything
below is the ten training sets, and only the sheets Chrome has labelled
(`~/Claude Folder/takeoff/labels/`, verdict `wall` = an accepted wall).

**The number an estimator reads** (`zzFeetTyped`, walls = the label
file's accepted runs, tags = symbols + bare text the legend knows,
propagation = `typePropagation.ts`, default = `wallNotes`' U.N.O. read):

| sheet | accepted ft | tagged | propagated | default | untyped |
| --- | --- | --- | --- | --- | --- |
| SW A110 p5 | 353 | 318 (90%; 43 of it bare text) | 0 | 0 | 35 |
| NG Green Bay A3.2 p10 | 536 | 313 (58%) | 0 | 0 | 223 |
| Camp Bow Wow A101 p8 | 738 | 413 (56%) | 0 | 0 | 325 |
| Baker A101 p13 | 508 | 245 (48%) | 14 (3%) | 0 | 248 |
| E Street A2.1 p28 | 477 | 172 (36%) | 0 | 0 | 304 |
| ELEVEN03 A4.B.1 p119 | 1,790 | 524 (29%) | 9 | 0 | 1,257 |
| Bunkie A100 p31 | 362 | 65 (18%; all bare text) | 0 | 0 | 297 |
| Crosslines A100 p10 | 1,103 | 137 (12%) | 0 | 0 | 966 |
| ELEVEN03 A4.B.3 p121 | 1,810 | 205 (11%) | 10 | 0 | 1,595 |
| ELEVEN03 A4.B.2 p120 | 1,534 | 124 (8%) | 26 (2%) | 0 | 1,384 |
| MHK A1.01 p32 | 524 | 0 | 0 | 0 | 524 |
| NG Green Bay A3.1 p9 | 673 | 0 (tags are on A3.2) | 0 | 0 | 673 |
| Baker A100 p12 | 1,606 | 0 (no tags on the sheet) | 0 | 0 | 1,606 |

So the feet typed on a sheet that carries tags run 8–90%, and the share is
set by how much of the drawing the drafter tagged, not by the matching:
the accepted walls are already merged full-length runs, so a wall with no
tag anywhere on it stays untyped whatever propagation does.

**Propagation** (`propagateTypes`, pure: runs + run-to-code in, run-to-
{code, source} out; stops at a thickness change, a different tag, a turn,
or a fork; runs straight past a T; crosses a gap on the same line up to
`GAP_FEET`). Touching-only adds 9 ft on one sheet across all thirteen,
because the label walls already span their openings. Crossing a 12-ft gap
added 43 / 19 / 57 / 24 / 13 / 8 ft on six sheets and carried E Street's
type 2 across an 8-ft open passage into a storage partition on the same
line — a corridor is a gap too. At 7 ft (a double door) it adds 14 / 9 /
26 / 10 ft on four sheets and the E Street error is gone; the ELEVEN03
runs it adds are the corridor walls continuing past unit doors, which is
what it is for. Propagation is therefore worth a few percent on these
sheets and nothing on most of them, and that is reported rather than
tuned around. A run two tags both reach is left untyped and listed as a
conflict; none occurred.

**U.N.O. default: no training set has one.** Every page of all ten sets
was scanned for "ALL (INTERIOR|NEW) PARTITIONS/WALLS … U.N.O." and the
nearest things are dimensioning notes ("DIMENSIONS ARE TO … FACE OF STUD
… UNLESS OTHERWISE NOTED") and Baker's "ALL WALLS WILL BE TO DECK ABOVE
UNLESS OTHERWISE NOTED", which is a height, not a type. The default tier
exists in the function and in the report and is 0 ft everywhere.

**Bare text as a tag** (`bareTextTags.ts`: exactly a legend code or a
scheduled mark, not inside a found symbol, within 3 ft of a run). Walls:
Bunkie 0 → 65 ft (six `P08` and a `P09` beside their walls; three more
sit 5–6 ft off), SW +43 ft (`A1 A1 A3 A3 A2`), nothing elsewhere. MHK's
`1`–`4` are only ever its grid bubbles, 9–33 ft from any wall, so its
walls are untagged on A1.01. Doors, rows placed of rows read (symbols +
exact bare marks): Bunkie 0 → 6 of 11 (`E105A`/`E105B` are in circles the
detector had rejected as sheet references — a scheduled mark overrides
that, as a legend code does for walls — plus `E100 E101 E103 E104` bare),
MHK 1 → 6 of 31 (`119A`–`119F` bare), E Street 15 → 16 (`12.1`). A third,
DOUBTFUL tier was measured and not adopted: a scheduled mark that is only
the number in a room-name box (`OFFICE 105`) placed on the nearest run.
It would take MHK to 19 of 31 and Bunkie to 7; five crops looked at —
`115A` and `115C` land on the toilet-room door, `118` plausibly on a hall
door, `102` and `105` on a run through the room label itself. Reported in
the door eval as its own row, never counted.

**Cost per training set, model calls** (legend plus door schedule, Opus
5): Baker 0.20, Bunkie 0.20, Crosslines 0.14, Murray 0.14, MHK 0.24, NG
Green Bay 0.19, E Street 0.26, SW 0.12; ELEVEN03 0.08 for the legend
alone, Camp Bow Wow's reads predate cost logging. Nothing in this pass
made a model call.

Mutation: eight mutants over propagation (collinearity, thickness, fork,
conflict, default source) and bare text (vocabulary, distance, inside-a-
symbol), each killed, each file restored by rewriting its own bytes.

### Wiring plan — for the original session, not done here (2026-10-20, night)

Nothing in plan-text reading reaches the takeoff screen yet. Every piece
is a pure function or a cached model read with an eval, and the one place
the product already turns tags into groups is the finder, which this lane
does not edit. The plan below names the call sites; the files belong to
the finder's lane.

**The switch.** One per-company key in `lib/ai/features.ts`,
`AI_FEATURE_LABEL` — say `PLAN_TEXT_READ: "Reading wall types and door
schedules off the drawings"` — checked through `aiGate(companyId,
"PLAN_TEXT_READ")` in `detectWallsForCalibration.ts` before any of the
three steps below runs. Off, the takeoff behaves exactly as today: text-
matched tags against the company's own wall types, thickness groups for
the rest. The two model calls (legend, schedule) stay behind
`SCHEDULE_READ` as well, so a company with that off still gets the
deterministic half.

**1. Wall types on the runs — `findWallsOnSheet.ts`, the `regroup` block
(`wallTypeTags` → `tagByRun` → `wallGroups`).** Today the tags are text
items that spell a company wall type. Replace the tag list with the union
of `tagsFromSymbols(...)` (symbols whose code the SET's legend defines,
anchored at their leader) and `bareTextTags(...)` (bare codes beside a
run), both using `legendVocabulary` of the legend read for the set; keep
`wallTypeTags` for sets with no legend. Then pass `tagByRun`'s map
through `propagateTypes` before `wallGroups`, and give `GroupSource` a
fourth kind, `{ kind: "PROPAGATED"; tag; viaFeet }`, beside `TAG`,
`NOTE` and `REMAINDER`. The vocabulary arrives as a new input to
`findWallsOnSheet` (`legendCodes: string[]`), read from the cached legend
— no model call inside the finder.

What the customer sees: on `TakeoffPlanViewer.tsx` where `<ClusterTag>`
shows a group's tag, a run tagged on the drawing reads `IW-2 · tagged`, a
run that inherited it reads `IW-2 · same wall as the tag 14 ft away`
(weaker, like `NOTE` reads today), and the remainder stays `3-5/8in,
untyped — 223 ft` so the untyped share is a number on screen rather than
absorbed. Measured on the labelled training sheets: 8–90% of accepted
feet typed where the sheet carries tags, 0% where it does not.

**2. Assemblies from the legend — `readWallLegend.ts` (exists, uncalled)
→ a card on the takeoff page.** Call it once per plan set, from the
ingest that already reads sheet titles (`lib/plan-ingest`, behind
`SCHEDULE_READ`), cache the `WallLegendRead` on the plan set (a JSON
column or the existing ingest result store), and surface its
`proposals` — code, studs, track, board layers, insulation, flags — as
"The drawings define 10 wall types. Add them to your library?" Accepting
creates company `WallType` rows with `hasParts` from the proposal, which
is what step 1's groups then price through the existing estimate path.
Never a price: `readPartitionAssembly` emits quantities and flags only.
Cost: 3–9 cents per set, once.

What the customer sees: a list like `IW-2 — 6in 20 ga studs at 16in
o.c., 5/8in board each side, batts` with any flag in red (`studs at 6in
o.c. is not a framing module`), each row a checkbox, and after accepting,
the group panel's `IW-2 · 126 ft` now carries studs, track and board
lines in the recap.

**3. Doors — `mergeWalls`' `openings` on each run → `joinOpeningsToSchedule`.**
The finder already records door-sized gaps on runs. Read the door
schedule once per set with `extractScheduleRows` (behind
`SCHEDULE_READ`, cached as the evals do), take the marks from
`tagSymbols` plus `bareTextTags` with the schedule as vocabulary, and
join. Store the result beside the proposal (`WallProposal` row or a
sibling table keyed by run) as `{ mark, widthFt, from: "schedule" |
"drawn", placedBy }`.

What the customer sees: on a run with a door, `door 101A · 3'-0" from
the schedule` instead of the drawn gap width; a schedule row the plan
never placed listed under the sheet as "scheduled, not found on this
sheet: 100A 100B 101", which is the list an estimator checks by hand.
Measured: every row placed on SW and Camp Bow Wow, 15 of 18 on Baker, 16
of 19 on E Street, 6 of 11 on Bunkie, 6 of 31 on MHK.

**Order and cost.** Step 1 first — it is deterministic, has the evals,
and changes what people see most. Step 3 next, since the openings are
already there. Step 2 last, because it writes to the company's wall-type
library and wants the accept flow. Each step is one PR in the finder's
lane; this lane's files are called, not changed.

### Wired, behind `PLAN_TEXT_READ` (2026-10-20, night; off by default)

The wiring plan above is built, on this branch, inside the files the board
lent this lane for it. What changed and where:

- **The switch** is `planTextReadEnabled()` in `lib/ai/features.ts`:
  `PLAN_TEXT_READ=1` in the environment, off otherwise. Not a per-company
  `AiFeatureKey`, because that is a Postgres enum (`AiFeature`) and the
  parity census says in as many words that a key with no enum member makes
  the settings form's write invalid — so a per-company switch is a
  migration, and this task ran under a no-migrations rule.
- **`findWallsOnSheet`** takes an optional `planText: { legendCodes }`.
  Absent, the regroup block is byte-for-byte the call it was (the three
  source-shape censuses that read that call still pass). Present,
  `planTextTagByRun` builds the run-to-type map from symbols and bare text
  filtered by the legend plus today's text tags, and `propagateTypes`
  carries each along its wall. A propagated run's tag is its code with
  `PROPAGATED_MARK` (` ≈`) appended — `sameDesignation` strips it, so the
  group still prices as its code, and the screen reads it back as "same
  wall". A `PROPAGATED` source kind is the right design and is the enum
  value plus edits in `wallGroups.ts` and `wallProposal.ts`, listed below.
- **`detectWallsForCalibration`**, with the switch on: reads the set's
  legend once (`legendForPlan`: `legendPages` over every page's lines and
  the ingest's title blocks, `readWallLegend` behind `SCHEDULE_READ`, two
  candidates at most), hands the codes to the finder, takes the door
  schedule from `PlanScheduleProposal` where the ingest read one (a
  database READ) or reads it the same way, joins it to the sheet
  (`doorsOnSheet`: `openingsInWalls` + symbol marks + bare marks +
  `joinOpeningsToSchedule`), and writes the sheet's result. Any failure
  logs and leaves the proposals exactly as they would have been.
- **Storage** is `planTextCache.ts`: JSON under `PLAN_TEXT_CACHE_DIR`
  (default the OS temp dir), keyed `legend-<planId>`, `doors-<planId>`,
  `result-<planId>-p<page>`. Per machine, not durable, not in the
  database; the tables it stands in for are named in its header.
- **The screen**: `loadPlanText` (`lib/actions/planTextRead.ts`, a read of
  the cache after checking the plan is the company's) feeds
  `PlanTextPanel` under the found-walls list, the group row gains the
  doors placed on it, and `ClusterTag` shows a carried type's code plain
  with "same wall" beside it. Off, the action returns null before touching
  anything and the panel renders nothing.

**Proof the switch changes nothing when off.** `planTextSwitchOff.test.ts`
runs the finder as it is now, with no `planText`, and the finder as it was
at `bda8c1a0` (dropped beside it untracked as `zzBaselineFindWalls.ts`)
on every labelled sheet under `TAKEOFF_LABEL_DIR` read from
`REAL_PLAN_DIR` at the label's scale, and requires the two JSON results to
be identical. Seventeen sheets, 0.3 to 37 MB of result each, all the same;
held-out sets skipped by name. It skips without the drawings or the
baseline file, so it is not a CI guard — it is the measurement, and it is
reported here because it was run. `detectWallsForCalibration.test.ts`
holds the other half: off, the legend, the schedule and the cache are
never touched.

**What a customer sees with it on**, from the cached reads on four
training sheets through the same functions the server would call
(`switchOnDemo.tsx` in the session scratchpad; panel HTML beside it):

| sheet | typed from tags | same wall as a tag | untyped | doors placed / scheduled | legend types offered |
| --- | --- | --- | --- | --- | --- |
| Baker A101 | 280 ft | 14 ft | 568 ft | 15 / 18 (100A 100B 101 not found) | 8 |
| NG Green Bay A3.2 | 635 ft | 0 | 920 ft | 0 / 19 (its marks are on A3.1) | 10 |
| SW A110 | 334 ft | 19 ft | 1,424 ft | 5 / 5 | 7 |
| Bunkie A100 | 74 ft | 0 | 794 ft | 6 / 11 (E102 and the K-rows not on this sheet) | 5 |

On Baker the panel reads: "Where the types came from: tagged on the
drawing 280 ft · same wall as a tag 14 ft · untyped 568 ft"; "Doors from
the schedule: 111B 3'-0", 104 3'-0", … 108 6'-0"" with "Scheduled, not
found on this sheet: 100A, 100B, 101"; and "The drawings define 8 wall
types … S6A — 6in metal stud, 25 ga at 24in o.c.; 6in track, top and
bottom; 5/8in type X gypsum board, 2 layers per side [Add to your wall
types]", with S8C's contradiction flag in red. The group rows read
`11.280 in C8B · 4 runs · 179 ft · doors 105 3'-0", 106C 3'-6", 106B
3'-0" from the schedule`. The feet are the finder's own runs here, not the
reviewer's accepted walls, so they differ from the labelled-sheet table
above; the ratio does not. Nothing anywhere is a price.

**The migration this wants, not run:**

    ALTER TYPE "AiFeature" ADD VALUE 'PLAN_TEXT_READ';
    ALTER TYPE "TakeoffWallProposalSource" ADD VALUE 'PROPAGATED';
    CREATE TABLE "PlanLegendProposal" (id, planId → TakeoffPlan, pageNumber,
      codes text[], proposals jsonb, reason, confidence, model,
      promptVersion, status, createdAt);
    CREATE TABLE "TakeoffPlanTextRead" (id, planId → TakeoffPlan, pageNumber,
      calibrationId → TakeoffScaleCalibration, doors jsonb, typed jsonb,
      computedAt);

with, in code, `PLAN_TEXT_READ` in `AI_FEATURE_LABEL` and `aiGate` in place
of the env read; a `{ kind: "PROPAGATED"; tag; viaFeet }` source in
`wallGroups.ts`/`wallProposal.ts` in place of the marker; `legendForPlan`
and `doorScheduleForPlan` writing those tables instead of files; and
`loadPlanText` reading them. The legend read then belongs in the ingest as
its own stage, which is another enum value (`PlanIngestStage`) and the
reason it is called from calibration-time detection for now.

Tests added: `planTextTags`, `planTextCache`, `planTextDoors`,
`planTextView`, `planTextPanel` (render), the two detection cases, and the
switch-off comparison. Every file this lane touched beyond its own:
`findWallsOnSheet.ts` (the regroup block and one optional input),
`detectWallsForCalibration.ts`, `TakeoffPlanViewer.tsx` (imports, one
effect and memo, the group row's door line, the panel, `ClusterTag`),
`lib/ai/features.ts` (one function), `detectWallsForCalibration.test.ts` —
and, because a new Server Action is a decision four censuses make the
adder record: `lib/actions/index.ts` (the barrel export),
`lib/action-capability-guards.test.ts` (its `MODULE_IMPORTS` line, so the
guard is executed rather than assumed; the action asserts
`VIEW_JOB_COSTS` first and the census proves it refuses before any query),
and `lib/ask/commands.ts` (an exclusion with its reason: a read that only
means something with the drawing open). The clock reads the first draft
had (`readAt`, `computedAt`) were removed rather than registered with
`viewerDayCensus`; a file's mtime says when it was written.

### Pre-production review follow-ups (2026-10-22, second session, temporary ownership)

**Answer-key mode is staff-only now.** There is no staff role in this app,
so "staff" means the machine: `labellingRefusal(env)` in
`plan-ingest/labelStore.ts` is the local-plans gate (no `VERCEL`, and on a
production build `ALLOW_LOCAL_PLANS=1` + loopback `HOSTNAME`) plus an
absolute `TAKEOFF_LABEL_DIR`. `labelPath` refuses by it (as before), and now
so do the workspace page's `?key=1` switch, the "Answer key" button (not
rendered at all when the server cannot label) and both label routes, which
answer a plain 404 that names no environment variable. `answer-key-gate
.spec.ts` signs in a customer who can see job costs and asserts no button,
no panel on `?key=1`, and 404 on read and write.

**The items backfill (`20261016210000_takeoff_items`), what it does to a
customer's data — proposed, not changed.** It touches two things on existing
rows. `TakeoffPlan.updatedAt` is backfilled from `createdAt` and made NOT
NULL — harmless and required. And every UNPOSTED measurement gains an item:
one `TakeoffItem` per (job, kind, packageLabel), named from the label or
"Linear takeoff" / "Area takeoff" / "Count", coloured by a hash of the key;
posted measurements keep `itemId` NULL, so nothing that already became a
wall run or a line item is counted twice. No measurement's geometry,
length, area, scale or posted state is written. So no customer-visible
NUMBER changes — a quantity is still the sum of the same measurements under
the same grouping the package label gave — but the takeoff tab now shows
those groups as named, coloured items, and posted history under
"Unassigned". It is reversible in one statement, because the item foreign
key is `ON DELETE SET NULL`: `DELETE FROM "TakeoffItem" WHERE "id" LIKE
'tki_%'` returns every measurement to `itemId NULL` with nothing else
touched. What it is NOT is a no-op, and the migration cannot be made one
without losing its point (existing work landing inside the new model rather
than in an Unassigned pile). The proposal: keep the backfill, run it on the
demo project first and read the items panel there, and verify production
with two counts before and after — `SUM(lengthFeet) GROUP BY jobId, kind`
over unposted measurements must be identical, and `COUNT(*) WHERE postedAt
IS NOT NULL AND itemId IS NOT NULL` must be zero. Diego's call.

Verified rather than argued, on a throwaway Postgres with all 179
migrations applied and four seeded measurements (two unposted `LINEAR`
labelled "Partitions", one unposted `AREA` with no label, one posted
`LINEAR`): running the migration's two backfill statements left every
measurement's kind, label, geometry, posted date, source and cutouts
byte-identical; created exactly two items ("Partitions" LINEAR, "Area
takeoff" AREA); put both "Partitions" rows under the one item; left the
posted row's `itemId` NULL; and the one-statement reversal returned every
`itemId` to NULL with nothing else touched and no item left.

**Migration count reconciled.** `origin/main` holds 175 migrations; the
last successful `Migrate` run on production (2026-10-20, at main's tip
`fa9aa2cc`) printed "175 migrations found" and verified the database up to
date, so production equals main. The dry-run tree adds exactly six:
four on `takeoff-audit` (`takeoff_items`, `assemblies_for_items`,
`detection_into_items`, `view_scales`), one on `plan-text-library`
(`wall_legend_library`), one on `rooms-areas` (`rooms_from_walls`). The
"35" is not a count of pending migrations: `takeoff-audit` carries 38
migrations dated October, which is the count of everything since the branch
family began, most of it merged to main and applied weeks ago. Six is what
will run.

**`/Users/diego` is out of the specs**: the two real-plan specs default
their folders to the empty string and skip, and the audit note no longer
names a home directory.

### Reproductions: dimensions at exactly twice or half the printed scale (2026-10-22)

**The premise, measured first.** The ask was Topeka G-100b, "prints 1/16"
but 45 dimensions agree on exactly half". They do not. The product's own
vote on that sheet is `1/32"` × 10, `1/8"` × 5, `1/16"` × 3, out of 45
labels — a plurality for the half scale, backed by 22% of what measured,
on a code plan whose "dimensions" are mostly travel distances. Swept over
all sixteen training sets with `realplan/zzHalfSize.ts` (one printed scale,
≥3 labels, the dimension candidates measured against it): **no sheet has a
majority of its labels at a clean 2× or 0.5×**. The nearest are Topeka
G-100b (8 of 45 at 2×, 4 at 0.5×, 3 at 1×) and Fairgrounds A-101 (11 of 60
at 2×, 8 at 1× — a base-bid plan and an alternate on one sheet, which the
vote rightly calls two scales). `reducedPrint.ts` already records why
counting candidates against the printed name is dangerous; this sweep is
that warning measured again.

**What was built, and what it refuses.** `reproductionScale.ts`: when the
dimension vote has a winner and declines only afterwards (too short a line,
an off line, an engineering scale), the decline now carries the vote; the
reading takes it only when the vote is within 2% of exactly 2× or 0.5× the
ONE scale printed on the sheet, meets the vote's own minimum, and holds a
MAJORITY of every label that measured. It is read before the printed
fallback, because the printed scale is exactly the wrong answer on such a
sheet. The row stores the sheet's own width at the dimensions' scale (as
the printed fallback does), the printed name in `declaredText`, the agreeing
dimensions as evidence, and the source `DIMENSIONS_REPRODUCTION`; the
screen composes the caution from those two names at render time — "This
sheet appears to be printed at half size; scale taken from its dimensions.
The title block says 1/16" = 1'-0", but the dimensions on the sheet measure
at 1/32" = 1'-0"…" — the same amber line the sheet-width reduction uses.
Nothing is set by hand and nothing fires without the dimensions agreeing.

**It has never fired on a real drawing.** Every training sheet fails the
majority test, so the rule is proved on synthetic votes (unit tests, the
Topeka shape included as the refusal case) and the view test, and the first
real sheet it accepts is the one to look at hard. That is the honest state,
and it is why the rule is strict rather than the plurality that would have
"fixed" Topeka.

### plan-text-2: the legend read by sight, and bands by legend thickness (2026-10-21)

**Legend by sight** (`packages/integrations/src/wallLegendSight.ts`,
`lib/takeoff/legendSight.ts`, `realplan/zzLegendSight.eval.ts`). The page
is rendered at reading resolution and one crop is cut per type around its
printed code (`legendCropRects`); the model is given the page, the crops
and the page's text and asked for FIELDS — stud width, material, gauge,
spacing, board thickness, layers per face, type X, insulation, rating,
height note — each marked with whether it came from the picture. The
fields are written back as the lines a legend prints and parsed by
`readPartitionAssembly`, so the sight read cannot propose a component the
text read could not; a concrete or masonry wall gets board only. Node
cannot rasterise a PDF here (`planPdf.ts`), so the eval renders through a
Swift/PDFKit script; the product would render in the browser, as the
scanned-sheet tiles already do, or add `@napi-rs/canvas`.

Measured on the training sets, a type counting as FULLY read when stud,
board and layers are all known:

| set | types | text read full | sight read full | cost |
| --- | --- | --- | --- | --- |
| Baker A601 p25 | 8 | 2 | 2 | $0.19 |
| Bunkie G003 p4 | 5 | 3 | 3 | $0.14 |
| Crosslines A001 p2 | 7 | 6 | 6 | $0.16 |
| Murray, MHK, NG Green Bay, E Street, SW, Camp Bow Wow, ELEVEN03 | — | — | NOT RUN | — |

The seven unread sets failed on `credit balance is too low` from the API
on the fourth call; their crops are rendered and their contact sheets wait
on credits (`~/Claude Folder/takeoff/shots/legend-sight/`).

**What the three that ran show, and the crop lesson.** The first Baker
run, with a 3.5in crop centred on the code, reported 8 of 8 fully read —
and it had read the stud width out of the code's letters (S6 → 6in),
because the crop cut the notes off mid-word and showed no section. With
the crop widened to the right the model correctly reports the stud width
as NOT STATED for S6B, S8B, S6C and S8C ("2x STEEL FRAMING, SEE
STRUCTURAL"), and the count went back to 2 of 8. That is the honest
number: those four types' studs are not on the legend. What sight did add
to all four is the board — one layer of 5/8in type X per side, one-sided
on S6C, one and two faces on S8C — where the text read had "no assembly",
and it flagged C8A/C8B as concrete. The section DRAWING for each Baker
type sits further right still, past the 5in crop; a wider crop (or the
whole detail band) is the next thing to try, at 19 cents.

**Bands by legend thickness** (`lib/takeoff/legendBands.ts`, pure, five
tests): runs within `NOISE_IN` (3/8in) of one legend type's nominal width
(stud + both faces' board) become one band named for it; two types within
reach make an AMBIGUOUS band; the tags the runs carry are kept and a band
holding two different tags is reported. Measured on nine training plan
sheets against the finder's groups:

| sheet | finder groups | bands | bands with conflicting tags |
| --- | --- | --- | --- |
| Baker A101 | 15 | 15 | 1 (an 8-5/8in band tagged S6A, S8C and S8B) |
| Bunkie A100 | 12 | 13 | 0 (two AMBIGUOUS, P06/P07 and EXT/P08 share a width) |
| Crosslines A100 | 16 | 18 | 1 |
| NG Green Bay A3.2 | 15 | 19 | 4 |
| SW A110 | 22 | 15 | 4 |
| E Street A2.1 | 16 | 14 | 1 (no legend widths known) |
| Camp Bow Wow A101 | 16 | 19 | 2 |
| MHK A1.01 | 10 | 13 | 0 |
| Murray A2.01 | 16 | 13 | 0 |

**It does not work, and the reason is worth more than the function.** The
measured thickness of a drawn wall does not sit near its legend's nominal
width: Camp Bow Wow's B and C are 4-7/8in nominal and the runs tagged B
and C measure 6-5/8 and 7-3/8in; Baker's one band that matched a type
(S6A at 8-1/2) held runs tagged three different types; NG Green Bay's
5-7/8in band carries eight different tags. Drafters draw partitions at a
generic width and the finder measures what is drawn. So "thickness agrees
with one legend type" is not a merge rule on these sets — it would merge
walls of different types and split walls of one — and the count stays
where it was. Fewer, truer groups have to come from the tags, propagation
along the wall, and the walls' own connectivity, not from thickness
against the legend; the function stays, tested, as the measurement that
says so.

### Legend by sight, prompt v3, all ten training sets (2026-10-21)

Credits restored; the run cost $1.87 for ten sets (10 to 28 cents each).
Two prompt versions were spent getting here, each from a contact-sheet
check: v2 taught the model that a TAG KEY on the sheet states a size
(Baker's `S6` is a 6in steel stud by its own key); v3 told it that a UL or
GA number states nothing by itself, that a crop shows neighbours whose
notes are not this type's, that a code may sit under its detail, and that
"EACH SIDE" means equal layers. The crop is now 1in left, 4in right, 3.5in
above and 4.5in below the code, because NG Green Bay prints the code
under the section and the v2 crop showed the model the next type instead.

| set | types | text full | sight full | sight added (fields, over all types) | sight differs from text | cost |
| --- | --- | --- | --- | --- | --- | --- |
| Baker A601 | 8 | 2 | 8 | stud (tag key) ×6, board ×4, layers ×1, rating ×4, height ×4 | — | $0.23 |
| Bunkie G003 | 5 | 3 | 3 | rating ×4, height ×3; P08/EXT are 8in CMU (masonry, board only) | — | $0.17 |
| Crosslines A001 | 7 | 6 | 6 | insulation ×4, height ×7, F's stud | — | $0.19 |
| Murray | 2 | 2 | 2 | rating, height | — | $0.14 |
| MHK A1.01 | 4 | 2 | 2 | rating ×4, height ×4; type 3 is 8in CMU | — | $0.12 |
| NG Green Bay A3.2 | 10 | 8 | 8 | IW-9 is CMU | IW-6 layers 1 → 2 on the mech-room face (sight is right) | $0.23 |
| E Street A9.1 | 4 | 0 | 1 | height; see the code note below | insulation wording | $0.17 |
| SW A111 | 7 | 0 | 7 | board, layers ×7, spacing ×4 — all from ONE sheet note (see below) | — | $0.18 |
| Camp Bow Wow A130 | 5 | 3 | 5 | D and E's studs, heights | D spacing 48 → 16 (text took the bracing; sight is right) | $0.15 |
| ELEVEN03 A4.B.1 | 13 | 0 | 5 | board ×10, studs ×5, spacing ×3, insulation ×2, rating | MA spacing 16 → 24, MB1 board 1/2 → 5/8, WD rating 1 → 2 HR (sight right on all three) | $0.28 |

**Spot checks against the crops, stated plainly.** Baker: S6B (6in stud
by the key, one layer 5/8 type X per side), S8C (one layer inside, two
outside, flagged) and C8B (concrete core, 5/8 board one side, R-22
forms) all match their crops. NG Green Bay: IW-6 reads two layers on the
mech-room face and one opposite, which is what the crop says and the text
read had wrong; IW-8 reads 5/8 each side and 6in 20 ga at 16, matching;
IW-9 reads 8in CMU, matching. Crosslines C matches its crop (1/2in type X
each side, 2-1/2in stud at 16, blankets — the text read had missed the
blankets). ELEVEN03's studs and board come from the printed WALL SCHEDULE
bullets on the same page ("1-5/8X C-SHAPED METAL STUDS AT 24" O.C."), which
the text read had not associated with the types; the crops themselves show
only tag, thumbnail, UL number and rating, and the model says so.

**Two it got wrong or cannot be trusted.** E Street's plan tags are the
DETAIL numbers (2, 3, 8, 4 on A9.1) and the text read used those as codes;
the sight read used the titles ("WALL TYPE 1 – NON-RATED"), and the
eval's code matching then paired detail 2 with WALL TYPE 2 instead of
WALL TYPE 1. Its row above is misaligned and its "1 of 4" means nothing
until the sight read returns the detail number as the code. SW's 0 → 7 is
not seven legends read: the partition types on A111 state only a stud
size and whether there are batts, and the board, layers and 16in spacing
all come from one note on the stud-size chart ("ALL STUDS ARE ASSUMED TO
HAVE 5/8in GYP BD ON BOTH FACES"); the model named the note, and the
flag should too before anyone bids off it.

**What this is worth.** Where a legend is drawn as details with notes,
sight reads what the text read could not associate (Baker's four tag
types, Camp Bow Wow's D and E, ELEVEN03's schedule bullets, Crosslines'
insulation) and corrects the text read where a note is ambiguous (Camp
Bow Wow's 48in bracing, NG's two-layer face). Where the legend is a table
of words, the two agree. Cost is 10 to 28 cents per set, once, cached.
Contact sheets with every crop beside both readings:
`~/Claude Folder/takeoff/shots/legend-sight/<set>-p<page>.html`.

### Toward plan-text v1: four fixes and the v4 run (2026-10-21)

Fixes, each from a contact-sheet finding on a training set:

- **Detail numbers are codes.** E Street tags walls with the number of the
  DETAIL that draws the type (`2` on A9.1), not the title's number; prompt
  v4 records the detail number as the code and the title as the name. Its
  four types now pair with the text read's codes.
- **A sheet-wide note is flagged.** A field filled from a note that applies
  to every type on the sheet (SW's "all studs assumed to have 5/8in gyp bd on
  both faces") is named in `fromSheetNote`, and the assembly carries "came
  from a general note on the sheet, not this type's own words — check
  before bidding". All seven SW types now show it.
- **Optional is not counted.** Anything the drawing marks optional,
  alternate, "or", "where indicated" goes in `optional`, verbatim, and is
  flagged rather than added: Crosslines' optional blankets, Camp Bow Wow's
  "cementitious backer in lieu of gypsum" at wet walls, NG Green Bay's
  "where at an exterior wall, provide full cavity batt".
- **Crop placement.** A code is printed in more places than its legend
  cell — Crosslines' `A` is a partition type, a column line and an entry in
  the electrical symbol legend — and "the printing with the most text near
  it" chose the symbol legend. A printing inside a closed symbol now wins,
  then one with assembly words beside it, and text density only breaks
  ties; a code's labelled printing (`WALL TYPE 1`) counts as the code.
  Measured as crops holding at least two assembly words, over the ten sets'
  65 types: **40 of 65 before, 54 of 65 after**. The eleven still missing are
  MHK's four (its legend is a table on the plan sheet whose row headings
  the text layer does not print as one item), ELEVEN03's six thumbnail rows
  (the crop IS on the row; the row has no assembly words), and one SW
  detail bubble that shares its number with a type.

**The v4 run** stopped at the ninth set on `credit balance is too low`
(request `req_011CgEnkXMxVZgYmUPEL8Zap`); eight of ten are read under v4,
ELEVEN03 and MHK are not. $1.68 spent on the eight.

| set | types | text full | sight full | notable | cost |
| --- | --- | --- | --- | --- | --- |
| Baker | 8 | 2 | 8 | studs by the tag key; concrete walls board-only | $0.24 |
| Bunkie | 5 | 3 | 4 | EXT gained 6in stud + board; P08 masonry | $0.15 |
| Crosslines | 7 | 6 | 6 | optional blankets flagged, no longer counted | $0.21 |
| Murray | 2 | 2 | 2 | — | $0.15 |
| NG Green Bay | 10 | 8 | 8 | IW-6 two layers one face; IW-5's 6in o.c. flagged; exterior-wall note flagged optional | $0.24 |
| E Street | 4 | 0 | 1 | codes now the detail numbers; three are furring on existing masonry | $0.18 |
| SW | 7 | 0 | 7 | every type flagged "from a general note" | $0.21 |
| Camp Bow Wow | 5 | 3 | 5 | D's 16in spacing over the text's 48in; backer board flagged optional | $0.18 |
| MHK | 4 | 2 | 2 | type 1 one-sided; type 3 is 8in CMU | $0.13 |
| ELEVEN03 | 13 | 0 | 5 | studs, board and spacing from the sheet's own schedule bullets; MB1/MB2 optional sound insulation flagged, not counted; WD 2 HR | $0.29 |

Ten of ten under v4, $2.10 in all. **Frozen as `plan-text-v1`** (the tag on
this commit); the held-out run below is on this code and nothing is
changed after it. `heldoutRun.tsx` in the
session scratchpad is ready and was smoke-tested on Baker (it reproduces
the labelled sheet's numbers: 280 tagged, 14 carried, 568 untyped, 15 of
18 doors) and makes no model call where the caches exist.

### The honest test: plan-text v1 on Lodi, Missouri Pavilion, Nall — once (2026-10-21)

Run on `plan-text-v1` (`d9d9f37f`) with the scratch runner `heldoutRun.tsx`
(legend page by `legendPages`, legend read by text then by sight, door
schedule by heading, floor plans by title, scale by the sheet's own
dimensions or printed scale — never by hand, per the board). Nothing in
the method was changed after; two harness-only interventions are named
below because they are part of the result. Contact sheets:
`~/Claude Folder/takeoff/shots/legend-sight-heldout/<set>-p<page>.html`.

| set | legend | types full: text → sight | plan sheet | wall ft tagged / carried / untyped | doors placed of scheduled | cost |
| --- | --- | --- | --- | --- | --- | --- |
| Lodi Memorial Library | A601 p11 | 6 → 6 of 6 | A101 (1/8in by dimensions, 11 agree) | 117 / 0 / 1,200 of 1,317 | 0 of 5 | $0.28 |
| | | | A102 mezzanine (printed 1/8in) | 0 / 0 / 1,665 | 0 of 5 | |
| Missouri Pavilion | A-300 p12 | 0 → 2 of 2 | A-100 (1/4in by dimensions, 6 agree) | 23 / 0 / 791 of 814 | 2 of 2 | $0.30 |
| Nall Wealth | A0 cover p1 | 0 → 11 of 13 | A2 construction plan: NO SCALE (two scales on the sheet) | — | 15 scheduled, none placeable | $0.49 |

Checked against the crops: on Lodi the TEXT read had K06 and N21's
studs swapped (8in and 3-5/8in); the sight read has them the right way
round, and the crops show it. Missouri's two types are full-height
sections on A-300 with no partition block, found by the headed-block
rule, and read right by sight. Nall's partition types are on the COVER
sheet, found by the content-only rule; SF-1 and SF-2 are storefront
types the sight read left out.

**Harness interventions, both named because the title rule is part of
what was tested:** the floor-plan-by-title rule found Lodi's two plans
and nothing on Missouri (A-100's title line reads "FLOOR PLAN … COLUMN
PLAN DETAIL" and the word DETAIL excluded it) or Nall (its plan is titled
"Construction Plans"; the rule picked the demolition plan and a details
sheet instead). The measurement was then run on the pages the earlier
text-only inventory had named, with the same frozen code. And the runner
first ran without the app's `.env`, made no model call, and was re-run;
no held-out page was read twice by a model.

**Failures, for v2, in the order they cost the most:**

1. **Plan-page selection.** Title words alone miss "Construction Plans"
   and exclude a floor plan whose title line also carries a detail's name.
   Use the sheet number series and the page's own geometry (runs found,
   room names) with the title, not instead of it.
2. **Per-view scales.** Nall A2 carries a 3/16in plan and a 1in detail;
   the product's `sheetScale` VIEWS path handles that and the runner does
   not, so the set's walls have no feet. The chain needs the per-view
   calibration before a sheet like this measures at all.
3. **Door marks far from any run.** Lodi's five marks are all in symbols
   and all 2 to 31 ft from a found run; the finder returned 51 runs on a
   sheet with far more wall. Where the finder is thin the join has nothing
   to place on; the join should also accept a mark inside a door swing arc
   or a jamb gap it can see itself.
4. **Text read misattribution.** Lodi's text read put N21's 8in stud on
   K06 and vice versa; sight was right. Where the two reads disagree on a
   printed size, prefer the one whose crop shows it, and say so.
5. **Legend codes the plan does not spell the same way.** Missouri's
   legend says P1 and P2; its plan's commonest symbol code is `1`
   (seventeen printings). `legendVocabulary` strips WALL TYPE and TYPE
   but not a letter prefix, so 23 ft typed of 814 is partly a vocabulary
   gap — and partly `1` being something else. To be measured, not assumed.
6. **Low typed share even where tags pair.** Lodi A101 has K-coded
   hexagons on the plan and the legend's codes match them, yet 117 of
   1,317 ft typed: the tag report will say whether it is reach, margin or
   missing runs.
7. **Storefront and non-partition types** (Nall SF-1, SF-2) come back
   unread; they should come back as "not a partition" rather than silence.

Nothing above was fixed. Model cost for the three sets, $1.07, all
cached.

### plan-text v2, first pass (2026-10-21): failures 3–7, and two left to the finder's lane

Rebased onto `diego/takeoff-audit` at `2304c5ca`, which holds the wiring
merge (`94ceec79`); clean, full suite green after one census asked for an
app-side caller of the new sight integration (below). The tag
`plan-text-v1` stays on the pre-rebase commit `d9d9f37f`, which is the
exact code the held-out test ran.

**Not worked on here, on purpose: v2 failures 1 and 2** — plan-page
selection and per-view scales. The original session is building view
detection, which answers both (which drawing on a sheet is the plan, and
at what scale each drawing sits). Nothing in this lane should guess at
either in the meantime; the held-out runner's title rule and its single-
scale path are left as they were and are the measurement that view
detection will be judged against.

**3. Door marks far from any run.** A scheduled mark drawn in a SYMBOL
(a door tag) may now place on a run up to `MARK_SYMBOL_REACH_FEET` (4.5
ft) away when that run is clearly the nearest — the next run at least
twice as far, `TAG_CLEAR_MARGIN`'s rule — while loose text keeps the 2.5
ft rule. Measured on the training sets with the cached schedules:

| set | placed before | placed after |
| --- | --- | --- |
| NG Green Bay A3.1 | 7 of 19 | 8 of 19 |
| Baker, E Street, SW, Bunkie, MHK | 15, 17, 5, 6, 6 | unchanged |

One door. NG's remaining marks sit 2.9 to 7.2 ft from a run with ANOTHER
run inside the margin — its plan is dense — so the margin, which is what
stops a wrong wall, is what stops them. The rule is kept because it is
the honest one; the gain is small and reported as such. Lodi's five marks
(2 to 31 ft from any of 51 runs) are a finder problem this cannot reach.

**4. The read whose crop shows the size wins.** `legendMerge.ts`:
`mergeLegendReads(text, sight)` lets the sight read win a field it
states, fills a field it left null from the text read, and flags every
disagreement with both values ("the words say studSpacingIn 48 and the
drawing shows 16 — the drawing was kept; check it"). The rule follows the
record: every printed-size disagreement seen on thirteen sets went the
drawing's way, and the text read's failure was always attribution.
`readWallLegendBySight` in `readWallLegend.ts` is the app-side, gated
entry (`SCHEDULE_READ`) that takes the rendered page and crops and returns
the merged types — the product's door into sight reading, and what the
feature-gate census asked for. Rendering stays the caller's job (browser
tiles, as the scanned-sheet read does), because Node here cannot.

**5. Legend codes the plan spells differently.** `prefixlessVocabulary`
maps `P1`, `P2` to `1`, `2` when every legend code shares one letter
prefix, and `planTextTagByRun` uses it ONLY when no symbol on the plan
holds a code as the legend spells it, reporting `shortForm: true` when it
did. On every training set the plans spell the legend's codes in full, so
the fallback never fires there and changes nothing; it was written for a
held-out set and has not been shown to help on one. The report flag is
the measurement.

**6. Why a wall stayed untyped.** `untypedWhy.ts` gives each untyped run
one reason — no tag nearby (20 ft), tag too far (past the 4 ft reach), no
clear margin (a tag within reach but another run inside twice its
distance), code not in legend (the nearest symbol says something the
legend does not define) — with feet by reason, and lists the orphan tags:
legend codes with no run within reach, which are the finder's gaps rather
than the reader's. The first version asked "what is the nearest symbol"
and answered "code not in legend" for most feet on every sheet, because
door marks and room tags outnumber wall tags; it now asks about LEGEND
tags first (in the sheet's own tag shape), and only with none in sight
does a short code sitting on the run count as a code the legend lacks.
`zzTagReport` prints it. On the training sheets, the finder's runs:

| sheet | untyped ft | tag too far | no clear margin | no tag nearby | code not in legend | orphan tags |
| --- | --- | --- | --- | --- | --- | --- |
| Baker A101 | 582 | 230 | 42 | 216 | 95 | 0 |
| NG Green Bay A3.2 | 920 | 465 | 356 | 98 | 0 | 6 |
| SW A110 | 1,608 | 483 | 196 | 198 | 731 | 2 |
| Camp Bow Wow A101 | 2,209 | 589 | 203 | 846 | 571 | 6 |
| ELEVEN03 A4.B.1 | 1,899 | 1,149 | 157 | 522 | 71 | 3 |
| E Street A2.1 | 894 | 685 | 143 | 58 | 7 | 8 |
| MHK A1.01 | 958 | 593 | 53 | 185 | 128 | 9 |
| Murray A2.01 | 2,149 | 472 | 0 | 804 | 873 | 3 |
| Crosslines A100 | 3,008 | 653 | 151 | 1,432 | 772 | 0 |
| Bunkie A100 | 868 | 0 | 0 | 304 | 564 | 0 |

What it says, read across the sheets: "tag too far" is the largest single
reason on six of ten — a legend tag is within 20 ft of the run but past
the 4 ft reach, which is a run the tag may well mean and the pairing rule
will not risk; "no tag nearby" is the drafter's doing and is where a
U.N.O. note would act if any of these sets had one; "code not in legend"
is Bunkie's `P08` bare text (no symbol, so not a tag here), SW's detail
bubbles and Murray's keynotes; and the orphan tags are the finder's
misses. The next lever is therefore the reach, measured against the
crops, and it is a lever the propagation along the wall already pulls
part way.

**7. Storefront and curtain wall.** Prompt v5 gave a legend entry that is
a storefront, curtain wall, glazing, railing or door a `notAPartition`
word; `assemblyFromSight` returns no components and one flag ("not a
partition — the legend calls this a storefront") so it is seen and never
proposed. The ten-set re-run under v5 was the check that nothing else
moved, and something did: SW went from 7 of 7 to 0 of 7, because its
crops land on detail bubbles that share the types' numbers and the model
called A1 a "stud size chart" and B1 a "door jamb detail" — it classified
the CROP, not the legend entry. Version 6 says in as many words that
`notAPartition` is about what the legend entry is and a crop that shows
something else is to be ignored. Under v6:

| set | text full | v4 | v5 | v6 | cost (v6) |
| --- | --- | --- | --- | --- | --- |
| Baker | 2 of 8 | 8 | 8 | 8 | $0.24 |
| Bunkie | 3 of 5 | 4 | 4 | 4 | $0.15 |
| Crosslines | 6 of 7 | 6 | 6 | 6 | $0.21 |
| Murray | 2 of 2 | 2 | 2 | 2 | $0.15 |
| MHK | 2 of 4 | 2 | 2 (type 4, a DIRTT removable wall, named not a partition) | 2 | $0.13 |
| NG Green Bay | 8 of 10 | 8 | 8 (XW-1, an existing exterior wall, named not a partition) | 8, same | $0.25 |
| E Street | 0 of 4 | 1 | 0 | 1 | $0.18 |
| SW | 0 of 7 | 7 | **0** | 7 | $0.22 |
| Camp Bow Wow | 3 of 5 | 5 | 5 | 5 | $0.17 |
| ELEVEN03 | 0 of 13 | 5 | 5 | not run: the API credit ran out on the tenth call | — |

So v6 reads what v4 read, and names the two non-partitions the training
sets do have (MHK's DIRTT wall, NG's existing exterior wall) where v4
returned them as empty assemblies. $1.90 for the nine under v6; the two
passes together, with the v5 misstep, $3.80. ELEVEN03's v6 read is one
call, 30 cents, when credits exist.

**What "Add these wall types to your library" needs before a customer
sees it** — listed, nothing run:

1. **The per-company switch.** `PLAN_TEXT_READ` is an environment flag.
   The customer-facing form is a key in `AI_FEATURE_LABEL` and the enum
   member behind it: `ALTER TYPE "AiFeature" ADD VALUE 'PLAN_TEXT_READ';`
   then `aiGate(companyId, "PLAN_TEXT_READ")` in place of the env read, and
   the toggle appears on Settings → Assistant with the others.
2. **Storing the reads.** Two tables, both additive:
   `PlanLegendProposal` (planId, pageNumber, legendRead jsonb — the text
   read, sightRead jsonb nullable, merged jsonb, model, promptVersions,
   status PROPOSED/ACCEPTED/DISMISSED, acceptedByUserId, createdAt) as a
   sibling of `PlanScheduleProposal`; and `TakeoffPlanTextRead` (planId,
   pageNumber, calibrationId, doors jsonb, typed jsonb, computedAt) in
   place of the file cache. Plus `ALTER TYPE "TakeoffWallProposalSource"
   ADD VALUE 'PROPAGATED'` so a carried type is a source kind and not a
   marker in the tag text. The legend read then runs in the ingest as its
   own stage (`PlanIngestStage` gains `WALL_LEGEND`), which is where a
   once-per-set read belongs, and the browser renders the legend page and
   crops for the sight read the way it renders scanned-sheet tiles.
3. **The review screen.** One page per plan set, not a card under the
   found walls: each legend type with its crop beside the merged reading,
   every flag in red (one-sided, from a general note, optional, not a
   partition, the words say X and the drawing shows Y), the fields
   editable, and an Add button per type that creates the `WallType` and
   its components through the existing actions — code, name, sides, stud
   spacing, and the quantity components (studs, track, board, insulation)
   as `WallTypeComponent` rows with their basis, never a price. A type
   already in the library shows as such with a "compare" link. Accepting
   writes `status = ACCEPTED` on the proposal so the card stops asking.
4. **Two guards.** The census that every model-calling function has a
   gated app caller already covers the sight read; the e2e journey needs
   a step that opens the review screen with a seeded legend proposal and
   adds one type, so the screen's existence is proved by a browser and not
   by a render test.

### "Add these wall types to your library" (2026-10-21): built, off by default

What the launch checklist above asked for, built on `diego/plan-text-library`
off `diego/plan-text-2`. The shape, and the three decisions worth reading
before changing it:

**The switch is an opt-in, which this product had not had before.** Every
other AI feature is on unless a company turns it off, because nobody should
have to opt in to a feature before it works. This one writes proposals a
person is asked to review, so it is OFF until the owner ticks it:
`OPT_IN_FEATURES` in `lib/ai/features.ts`, stored as
`CompanyAiSettings.optedInFeatures`, refused by `aiFeatureRefusal` in a
sentence that says where the switch is. The settings form shows it with
"new — off until you turn it on"; the ingest panel shows the sentence in
place of the button when it is off, so the control is discoverable. The
environment flag `PLAN_TEXT_READ=1` is gone. A feature leaves the opt-in set
when it has earned the default, and the stored list then does nothing.

**The ingest reads the words; the browser reads the drawing.** Stage
`WALL_LEGEND` (`lib/plan-ingest/wallLegend.ts`) runs one task per page and
spends a model call only where `legendPages` ranks the page 0–2 on its own
text — a titled legend, a headed block, or a dozen assembly lines — so a
sixty-page set costs one or two reads. It stores the text read, the merged
view (`storedLegendTypes`, sight null) and the crop rectangle per type
(`legendCropRects`, from the page's text and symbols) in
`PlanLegendProposal`. The sight read cannot run there — Node has no
rasteriser — so the review screen's "Check these against the drawing"
renders the page (≤2000px, ≤100dpi) and each crop (200dpi) with pdf.js, the
same scales the eval validated, and posts them to `readLegendBySight`, which
re-merges and stores. `detectWallsForCalibration` reads the ingest's legend
FIRST (`legendFromProposal`), so the finder and the person look at the same
legend; what it works out otherwise is kept in `TakeoffPlanTextRead`.

**Add rebuilds the parts from the fields, not from the stored read.** The
review screen's inputs are what `addWallTypeFromLegend` hands to
`assemblyFromSight`, so an edited spacing changes the stud rule and an
edited layer count changes the board. It creates the `WallType` (code,
name, thickness from the fields or the nominal, spacing, two sides, the
legend's lines in `notes`) with its components (`WallTypeComponent`:
description, basis, factor, waste, roundUp) and nothing else — no catalog
entry, no cost category, no production rate. "In your library" is derived
from the company's codes at render time, never stored; `status`/`acceptedBy`
record who took the legend in, which is not derivable.

**Not done, and why.** `PROPAGATED` as a `TakeoffWallProposalSource`:
`wallProposal.ts` narrows the enum to three members in `ProposalRow`, so the
value alone fails typecheck in `workspaceLoad.ts`. It belongs with the
finder's wiring (wallGroups.ts/wallProposal.ts), in that lane, with its own
three-line migration; the marker in the tag text stays until then.

**Proved by.** `wall-legend-library.spec.ts` in a real browser against a
throwaway database: seeds a legend as a stored proposal, follows the
takeoff tab's link, counts one row per type with a rendered crop each,
edits a name, presses Add, reads the `WallType` and its components back
with no price, and sees the row refuse a second Add. The committed fixture
(`e2e/fixtures/wall-legend.json`) is INVENTED — made-up codes, words and
numbers, one one-sided type, one words-versus-drawing disagreement — so no
client's legend is in the repository. The same spec runs against a real
legend when `LEGEND_FIXTURE` names a stored read built OUTSIDE the repo by
`zzLegendFixture.eval.ts` (which refuses a path inside it) and
`REAL_PLAN_DIR` holds the drawing; that run also checks the first crop is a
drawing by its dark pixels, and is where the Baker screenshots come from.

**Crop placement slides (2026-10-21).** The crop was a fixed 3.5 in above
the code and 4.5 in below, the Crosslines shape — a section drawn above a
boxed letter. Baker draws the code box ABOVE its section and the rated-
assembly notes, so the fixed split took in the unrelated roof detail above
and cut the type's own drawing at the bottom. `legendCropRects` now scores
every half-inch split from 0.5 in above the code to 0.5 in below it by the
assembly words it holds and keeps the best, the old split as the tie-break
and the crop's size unchanged. On Baker's eight: the three rated types went
from 3.5 in above to 0.5 in (the box at the top, the section and its notes
below); the B and C rows, which have no drawing of their own, now start at
their column's section so the variant line is read under the section it
varies; C8B did not move. Rendered and looked at, not inferred. The migration applied to a scratch Postgres and
`migrate status` named it; `migrate diff` against the schema reports only the
two pre-existing `ProposalClause.updatedAt` defaults.

### View detection: a drawing's title is big and ruled, and placement follows the caption (2026-10-22)

**Where it started.** Step 1 (2026-10-21) measured that `sheetViews` is
scale-limited: a view needs a caption AND a printed scale under it, and
most sheets print one scale, so the detector found one view on sixteen of
eighteen training sheets. The replacement signal measured there — lettering
at >= 1.4x the sheet's median text height WITH a rule drawn under it — is
what `viewTitles.ts` now reads, with one refinement the first sweep forced:
the rule must be about the title's own length (at most 3x its width), or
dense line work under a big room name scores as a rule, which is the
"needle that cannot fail" the step-1 note warned about.

**Three things the first measurement taught, each an afternoon.**

1. *Most big ruled titles are not drawings.* "WALL LEGEND", "KEY NOTES",
   "GENERAL NOTES", "WALL TYPES", "DOOR SCHEDULE", an architect's address.
   Treated as views they took regions off the plan beside them: 6,661 ft of
   key wall lost against 5,263 ft of junk removed. So a title whose words
   name notes, a legend, a schedule or a table is a TEXT BLOCK: found so its
   region is kept out of every drawing, measured by nobody, and never joined
   to a neighbour or given one. A title that names nothing recognisable is
   dropped unless a scale is printed under it.
2. *A caption sits BELOW its drawing.* `viewsInRegions` shares a region
   between captions at their MIDPOINT, and Crosslines A100 stacks three
   plans captioned at y 0.27, 0.56 and 0.85 — the midpoint cuts put the top
   half of each lower plan in the drawing above it, 1,014 ft of key lost on
   that sheet. `placeDrawings` cuts just below each caption on y and just
   left of it on x instead. The viewer still calls `viewsInRegions`, so the
   app carries that defect today; the measured fix is in this file and not
   yet wired.
3. *A sheet whose only found views are headings is a single-drawing
   sheet.* Branching on `views.length` sent Bunkie A100 (two legend
   headings, no caption) down the multi-view path, which measured nothing.
   `drawingCount` is what to branch on.

**Measured on the app's list** (`realplan/zzViewDetection.eval.ts`, 18
training sheets, 12 buildings, leave-one-building-out over the size ratio,
`scoreSheet` against each sheet's accepted + traced key; junk removed =
the fall in EXTRA feet, real lost = the rise in MISSING feet):

| treatment against | junk removed | real lost |
| --- | --- | --- |
| the VIEWER's pipeline (captions placed by `viewsInRegions`) | 622 ft | **0 ft** |
| `detectForSheet` as shipped (no placement at all) | 3,562 ft | 1,397 ft |

Every fold picked 1.4, and 1.4 through 2.0 give identical numbers; 1.25
loses 4,319 ft. The 1,397 ft "lost" against the as-shipped function is not
the title detection: 1,014 ft is Crosslines, where the two plans are
DIFFERENT FLOORS and `primaryView` keeps one (the product rule written for
enlarged duplicates, applied to a 1st-floor plan beside a typical-floor
plan), and 382 ft is HPL p3, whose entire key sits in the FINISH plan — a
copy of the same floor the product deliberately leaves unmeasured. Both are
the app's behaviour today, reproduced faithfully. Where the treatment ADDS
junk against the app: Murray A101 (+134 ft — the keynote tables at the
bottom-left have small headings and join the plan's region) and Camp Bow
Wow A120 (+28 ft).

**Two things found on the way that belong to the original's lane.**
`detectForSheet` never calls `viewsInRegions` and the viewer does
(`TakeoffPlanViewer.tsx` ~2299), which is the Murray 160-vs-32 gap the log
has carried since 2026-10-21: the app clips captioned views to regions and
the extraction does not. And wiring this work in is three lines in that
function: `sheetDrawings` for `sheetViews` + `viewsInRegions`, `drawingCount`
for `views.length`, and `textBlockBoxes` subtracted from the single-drawing
branch's regions — the eval composes exactly that and nothing else.

Crops of every sheet's detected views, outlined on the page (solid =
measured, dashed = not), are in `shots/views/<set>-<sheet>/` outside git.
No AI was used on titles: `takeoffRank`'s vocabulary plus the text-block
words classified every title the training sheets print.

### Every floor keeps its walls; a floor drawn twice keeps one (2026-10-22)

**The rule that lost two floors.** `primaryView` keeps ONE view's
detection, for a product rule that is right about what it was written for:
an enlarged plan is the same construction drawn larger, a finish plan over a
partition plan is the same walls twice, and summing them bids a bathroom
twice. Crosslines A100 is a 1st-floor plan, a 2nd-9th typical-floor plan
and a penthouse plan on one sheet, and the rule kept the typical floor:
1,014 ft of key wall, every run a wall the reviewer accepted, gone.

**The two cases are told apart by the LEVEL the title names.**
`planLevel` reads "1st", "2nd - 9th", "LEVEL 1", "MAIN LEVEL", "PENTHOUSE",
and a named level beside a number is part of the name — "LEVEL 2 -
MEZZANINE" is not level 2, and Supreme Court A111 draws both with the
mezzanine the bigger drawing, so a level-blind rule kept the mezzanine and
dropped 76 ft of the level-2 key. `keptPlanViews` keeps one view per level
named, falling to `primaryView` only among views naming the same level or
none ("DIMENSION PLAN - WAREHOUSE" beside "FLOOR PLAN - WAREHOUSE" is one
warehouse), and never adds an enlarged plan to a floor. `mergeViewWalls`
makes one detection of the kept views, each already measured at its own
scale by `wallsPerView`. "Penthouse Floor (P2)" has no PLAN in it and
`takeoffRank` has no opinion; `viewClass` now calls a level-named FLOOR
title a floor plan.

**Placement had to learn the same convention twice more.** A caption sits
below and to the left of its drawing, so a caption is DISQUALIFIED from a
piece wholly below it or wholly left of it (the cell under "Penthouse Roof"
holds the right end of the floor plans beneath, and plain distance gave it
to the penthouse); and a block's heading sits ABOVE its words, so a shared
region is cut just above each heading and the piece that starts at a
heading goes to that block — only that piece, because a heading at the top
of a column claiming every cell beneath it took the plan's right end on NG
A3.2. The right-strip title-block rule is gone: it dropped Crosslines'
penthouse plans, which are drawn exactly there; the title block's title is
told apart as a REPEAT of a caption's.

**Measured** (`realplan/zzViewDetection.eval.ts`; 23 training sheets, 17
buildings now, five label files having arrived during the day; LOBO over
the size ratio, every fold 1.4):

| treatment against | junk removed | real lost |
| --- | --- | --- |
| the viewer's pipeline | 53 ft | 7 ft |
| `detectForSheet` as shipped | 3,321 ft | 389 ft |

The 389 ft is 382 ft of HPL p3, whose whole key is in the finish plan the
product leaves unmeasured, and 7 ft of one run on Bunkie A104. Crosslines:
1,014 ft lost → 0. Supreme Court: 76 → 0. Against the app the two
multi-floor sheets ADD extra feet (Crosslines +216, Supreme Court +424)
and that is largely not junk: the key on each was reviewed from the APP's
list, so a candidate in a floor the app never showed was never judged and
scores as extra whatever it is. Supreme Court's key is seven accepted walls
from eleven candidates and no traces. Elsewhere junk falls (NG A3.2 −511,
Baker A101 −242, Murray +134 from keynote tables with small headings).

Wiring, still the original's: `detectForSheet` takes `keptPlanViews` +
`mergeViewWalls` in place of `picked.primary.found`, beside the three lines
already named. `KEEP_PRIMARY_ONLY=1` on the eval reproduces the app.

### One pipeline: the viewer calls `detectForSheet`, and the proof that it does (2026-10-22)

**The wiring.** `detectForSheet` now runs the view detection measured in the
two entries above — `sheetDrawings` (titles ∪ captions, text blocks out),
`drawingCount` for the branch, text blocks subtracted from a single-drawing
sheet's regions, `keptPlanViews` + `mergeViewWalls` for a sheet with several
floors — and returns what the viewer shows: the kept views, the others, the
left-out. `TakeoffPlanViewer`'s inline copy of the detection is gone;
`onFindWalls` makes one call. The answer-key `onCandidate` hook travels
through `detectForSheet` to every finder call, whichever branch the sheet
takes, so answer-key mode still collects pairings on multi-view sheets.

**App = eval, proved in a browser rather than asserted.**
`e2e/specs/takeoff-app-equals-eval.spec.ts` drives the real app on the real
sheets on a throwaway stack — serves each PDF through the route stub, sets
the scale by two clicks, finds the walls, and writes what the panel drew
and what the finder saw to `APP_EQ_OUT`; `realplan/zzAppEquals.eval.ts`
computes the same list in Node and holds the two side by side.

| sheet | app | eval | at ft/page width |
| --- | --- | --- | --- |
| Murray A101 | 80 | 80 | 288.01 |
| Crosslines A100 | 258 | 258 | 286.86 |
| Baker A101 | 33 | 33 | 288.01 |
| Baker A100 | 82 | 82 | 288.01 |

**It took five browser runs to get there, and the fifth found a defect in
the finder.** The first comparison differed by 1 to 14 on every sheet. The
Node side was brought to the viewer's inputs one at a time, each checked by
a digest the app writes to the plan port in answer-key mode
(`data-takeoff-detect`): the scale the app STORED rather than the one
intended (the clicks snap — Crosslines came out at 286.86, not 288); the
finder's own filtered segments handed to the triage rather than the raw
strokes; the sheet itself included in the template sample; blank text items
dropped. After all of that every input matched — segments identical in
value AND order, text, sample, page size, scale — and every stage count
matched except `duplicateDropped`, and the walls still differed.

The cause is `wallVectors.ts`'s "classifier seam": with ANY hook set
(`onCandidate`, `decide`, `veto`) the pairing pass COLLECTS every candidate
before it awards, and that changes which pairs win. Answer-key mode sets
`onCandidate`, so the list a reviewer labels is the collecting path, and a
customer's find — no hook — is the other one:

| sheet | with the hook (answer-key, what was labelled) | without (a customer's find) |
| --- | --- | --- |
| Murray A101 | 80 | 81 |
| Crosslines A100 | 258 | **244** |
| Baker A101 | 33 | 35 |
| Baker A100 | 82 | 83 |

Pass the hook in Node and the four sheets match exactly. This is
finder-lane code and is not changed here. What it means for everyone else:
every training label and every held-out key was taken on the collecting
path, and `zzKeyScore`/`zzTriage`, which pass no hook, score the OTHER
path — so a score "on the app's list" has been on a list a customer does
not quite see. The finder is also ORDER-sensitive in Node on identical
inputs (Baker A101: 35 walls as read, 27 reversed, 30 sorted by x; the grid
stage swings by a thousand), which is the same seam from the other side.

**LOBO on the wired pipeline** (23 training sheets, 17 buildings; NOW =
`detectForSheet`, BEFORE = the viewer's old inline pipeline): junk removed
53 ft, real lost 7 ft, real gained 1,641 ft. Every fold picked 1.4.

### A hook only observes, and the strokes' order is information (2026-10-22)

**Fix 1, shipped: the answer-key list is the customer list.** In
`wallsFromStrokes` the collecting loop (any of `onCandidate`, `decide`,
`veto` set) skipped the `used` test so every pairing reached the hook — and
then ran the award bookkeeping on faces already spent, so a face in one
wall was handed a second partner. The award now skips a used face exactly
as the non-collecting loop does, after the hook has seen the pairing.
`finderDeterminism.test.ts` pins it on three seeded invented drawings
(searched first: on the old finder every one of 400 seeds differed with a
hook set); it failed 6 of 6 hook cases before the fix and passes after.
Against the training keys the labelled list moves to the customer list:
missing 2,388 → 2,454 ft, extra 12,393 → 12,284 ft — the labelled list had
been 66 ft better on missing and 109 ft worse on extra than what a customer
saw. On the real sheets the two arms now agree exactly (Crosslines A100,
Murray A101, both Baker sheets: hook = no hook, `zzFinderArms.eval.ts`).

**Fix 2, shipped at the faces and measured not to be shippable at the
door.** `oneFacePerLine` now sorts its strokes into reading order before it
builds faces, so the face stage and the pairing above it are order-
independent — the same test holds `wallsFromStrokes` to that under reversal
and three shuffles, 6 of 6 red before and green after. Cost against the
keys: +52 ft missing, +113 ft extra over 23 sheets.

Sorting at the finder's DOOR instead — the one-line change that makes the
whole finder order-independent — was measured on four orders and every one
is far worse than the order the PDF stores:

| strokes in | missing ft | extra ft | arms differ |
| --- | --- | --- | --- |
| the PDF's order (before) | 2,454 | 12,284 | 23 of 23 |
| door sort, reading order | 4,824 | 15,648 | 0 |
| door sort, column order | 4,699 | 16,280 | 0 |
| door sort, by length | 4,500 | 16,506 | 0 |
| door sort, by angle | 3,524 | 16,705 | 0 |
| **faces sorted, door as stored (shipped)** | **2,506** | **12,397** | 22 of 23 |

The sequence is information upstream of the faces: `gridBubbles.ts` walks a
bubble through the first unwalked piece at each endpoint, and
`curvedWalls.ts` assembles an arc from "a run of pieces", greedily and on
purpose. Sort the strokes and bubbles and arcs come apart, which is the
missing-feet column. So full order independence is a change in those two
stages — continue a chain by geometry rather than by sequence — and it is
their owner's. Until then the finder is deterministic for a given FILE (the
app and Node read identical sequences, proved by digest) and not for a
given drawing: reversed strokes still cost 2,400 ft of key.

**Label files need nothing.** `labelCollect.ts` rebuilds training rows from
the VERDICTS against whatever finder is running, by geometric matching; the
saved `rows` are already treated as stale. One consequence worth knowing: a
verdict given on a candidate only the old hook path produced now stands as
a key wall with no candidate under it, which scores as missing rather than
vanishing — that is the +66 ft.

### Finder determinism, finished as far as it honestly goes (2026-10-22)

**Is the whole finder order-independent? No, and the stage that is not is
named.** Hooks observe only (fixed above). Faces and pairing are built in
reading order (fixed above). The arc assembler now continues a chain by
geometry — least turn at the joint, nearest chain across an opening — and
that is FREE against the training keys (2,506 / 12,392 with it, 2,506 /
12,397 without). The whole-finder shuffled test holds `findWallsOnSheet` to
the same walls under reversal and three shuffles on a sheet with arcs.

The grid-bubble walker is still first-wins in file order, on purpose. A
walker that continues by geometry was built, and a sort at the finder's
door was tried, and each was switched on and off independently with the
baseline as its own control (`zzFinderArms.eval.ts`, missing / extra ft over
the 23 training sheets, every arm):

| configuration | missing | extra | arms differ |
| --- | --- | --- | --- |
| control: old walkers, door as stored | 2,506 | 12,397 | 22 of 23 |
| old walkers, door sorted | 4,824 | 15,648 | 0 |
| new bubble walker alone | 5,057 | 15,256 | 4 of 23 |
| new arc assembler alone | 2,506 | 12,392 | 22 of 23 |
| both new, door sorted | 5,016 | 15,245 | 0 |

**The step is the bubble stage and the why is its acceptance, not its
walk.** It accepts any closed round chain from 0.06in across as a column
bubble — a floor its own comment calls fitted to one generator — and never
asks for the grid line that defines one; then `linesIntoBubbles` drops
every line ending within TWO radii of it. What an order-independent walk
additionally completes are symbol and outlined-glyph loops (Baker A101: 71
loops as read, 88 by geometry, 111 reversed; Murray drops 34,863 of 104,000
lines), and each one takes wall faces with it. File order masks the defect
by consuming most such loops into longer chains that fail roundness.

Six drop rules were measured to see whether the defect could be fixed in
place: requiring a grid line of 1, 2 or 4 in to enter a bubble, dropping
only lines over 2 in, tightening the reach to one radius, and a size split
where a loop under 0.25in clears only strokes under 0.5, 1 or 2 in. Every
one lowers missing feet (to 1,654 at best) and raises extra feet to between
15,800 and 22,900, because the tiny loops' indiscriminate dropping is also
the finder's only filter for outlined text and symbols, which have no text
items for `wallsNotLettering` to see. So the bubble stage needs splitting
into what it actually does — a grid-bubble detector that requires an
entering line, and a symbol/outlined-glyph filter that is its own stage —
before its walk can be made honest without bidding 2,000 ft of wall short.
That is the finder owner's change; the arms eval measures it.

### A `2X` with no size is still a framed wall (2026-10-22)

`readPartitionAssembly` flagged a `2X` stud line with no nominal size and
proposed nothing for the framing, so four training types (E Street 2, 3
and 8; ELEVEN03 WA) went out as board only. A stud COUNT and the plates
need only the spacing, so both are proposed now — "2X wood stud, size NOT
stated on the drawing", at the stated spacing where there is one, and "2X
plates, bottom and double top" at three per foot — with the flag kept. The
width is still not guessed. `assemblyFromSight` writes the same `2X WOOD
STUDS` line for a wood type whose width the model could not read, so the
sight path proposes the same. Sized lumber now reads "wood stud" with
plates rather than "metal stud" with track, which it had said for years.

Two things seen on the way and left as they are. E Street 8's only stated
spacing is its resilient channels', and the one-spacing rule assigns it to
the studs; a channel spacing is a plausible stud spacing, so the number is
not wrong, but the attribution is. And ELEVEN03's WB–WD read as 1-5/8in
WOOD studs — 1-5/8in is a metal C-shape, and the sight read's "wood" for
the W types is what the plates now follow; which read is right is a
question for the crop.
## Viewer speed — 2026-10-27 (third session)

**Instrument.** `scripts/viewer-bench.mts`: a Node server pacing each request
(`BENCH_LATENCY_MS`, `BENCH_MBPS`) and serving the PDF with Range, the app's
pdf.js build, a page built like the viewer's surface (overflow frame, canvas
sized by `canvasPlan`, SVG overlay with non-scaling strokes from a label file),
driven by Playwright's Chromium with a trace per scenario. `BENCH_HEADED=1`
uses the GPU. Results in `shots/viewer-speed/*.json` (outside git).

**Pan and zoom, Topeka p74, 95,455 ops, dpr 2.** Headless / headed:

| step | canvas | render | scroll (median of 8) |
| --- | --- | --- | --- |
| fit (first draw of the page) | 2700×1800 | 146 / 371 ms | — |
| 100% | 7776×5184 (40 MP) | 173 / 110 ms | — |
| 200% | 9797×6531 (64 MP, the cap) | 199 / 51 ms | 33 / 16 ms bare; 33 / 16 ms with 530 lines |
| 400% | 9797×6531 | 258 / 135 ms | — |

The first draw's extra is `HandlePostMessage` — the operator list crossing from
the worker, once per page. The real component in happy-dom with 1,562 key-mode
candidates: mount 90 ms, a focus change 20 ms, a zoom click 17 ms, twenty pointer
moves while tracing 1 ms. **The reported ~10 s per pan/zoom is not reproduced by
the viewer's own drawing on this machine**, headed or headless. Left on the
table, unmeasured: what the labelling Chrome's machine and the extension's
screenshot path do with a 64 MP (256 MB) canvas; a dev-mode build on :3010
(it is BUILT, so no); and the `?key=1` panel's 1,562 rows. The one knob if the
canvas is it: `MAX_CANVAS_AREA` in `canvasPlan.ts`.

**First load.** See `planPdfTransport.ts` for the table. Default transport at
500 ms/request: 12.1 s to the first page, 77 MB by then and the whole 114 MB
after; `disableAutoFetch` alone 12.2 s; both fetches off with 1 MB chunks 6.9 s,
13 requests, 15 MB, then idle. The sheet tree opened a second default-transport
document for thumbnails — a second full stream — now on the same transport.
Remaining floor is round trips: 13 × the hop. Fewer would need the route to
serve a linearized file or the first chunk larger; not done.

**Follow-up 1 — labelling mode at its real size (2026-10-27).** The harness's
`labeling:` scenario draws what `?key=1` draws on Topeka p74 with its saved
review: 1,562 candidate lines (decided ones at their recorded coordinates, the
rest the same lines shifted, since the label keeps coordinates only for
decisions), 38 of them rejected at 35% opacity, plus 157 traced walls as a
32 px hit line under a 4 px green one — 1,876 SVG elements. Headless / headed:
scroll 33 / 16 ms (same as bare canvas), zoom with the overlay up 85–173 /
42–59 ms painted. Nothing to fix on that path.

**Follow-up 2 — linearizing at upload (2026-10-27).** `qpdf --linearize` on a
copy of the set (10 s, +0.4 MB; `--object-streams=generate` −0.5 MB), same
harness, 500 ms per request, first page drawn:

| file | default transport | PLAN_PDF_TRANSPORT |
| --- | --- | --- |
| as uploaded | 12.1 s, 21 requests | **6.9 s, 13 requests, 15 MB** |
| linearized (qpdf defaults) | 18.4 s, 35 requests, whole file first | 26.8 s, 53 requests, 56 MB |
| linearized, object streams regenerated | 18.5 s, 36 requests | 19.6 s, 38 requests, 41 MB |

pdf.js 4.10.38 does not use the hint tables; on the linearized file it walks
the main cross-reference region DOWNWARDS a megabyte at a time (ranges logged
in `shots/viewer-speed/ranges-*.json`: 98.6, 97.5, 94.4 … 5.2 MB) before the
first page, where the as-uploaded file needs the head, the tail and ten reads.
**Do not linearize at ingest for this viewer.** qpdf was installed with
Homebrew for this measurement and nothing in the ingest changed.

### Four sheets the sweep said lost half their walls to view detection (2026-10-28)

The original session's sweep on main after #822 listed HPL p3 1,627→416,
Bunkie A104 546→147, Camp Bow Wow A120 380→132 and Bunkie A100 views=0.
Each probed with the view stage opened up (views, kinds, regions, text
blocks, per-view feet, kept) against the key's extent. One is a defect;
three are the stage doing its job against a number that was never right.

- **HPL p3** — three captioned plans of ONE tier: a finish plan, a
  decorative lighting plan and a partition plan, side by side at 1/4".
  The partition plan is kept and measures 416 ft; the 1,627 was all three
  copies of the same walls. The 382 ft key sits entirely inside the
  LIGHTING plan (x 0.41–0.58), because the whole-sheet finder proposed
  there and the reviewer accepted there — a key-placement artefact. The
  product answer is right; the key needs re-taking on the partition plan.
- **Camp Bow Wow A120** — nine views, the enlarged plan kept at 132 ft
  with the 16 ft key inside it; the other 248 ft were eight interior
  elevations, now left out by name. Not a loss.
- **Bunkie A100** — views=0 is cosmetic: the plan's caption is not found
  on main (no drawing word reaches the caption rule — fixed separately on
  `diego/round-bubbles`), three notes headings become text blocks at 34%
  of the page (under the 40% cap), and the single-drawing path keeps
  69,462 of 70,439 strokes. Key 470 ft, missing 17. Nothing to fix here.
- **Bunkie A104 — the defect, and it is region placement.** The dimension
  plan and the floor plan are the same warehouse a gutter apart. The
  floor plan's caption is lettered under the MIDDLE of its drawing, so the
  cells left of the caption were "wholly to its left", disqualified by the
  caption-side rule, and handed across the gutter to the dimension plan:
  floor plan 147 ft, dimension plan 459 ft, and `keptPlanViews` keeps the
  floor plan. Not the Central Bank cause (its text blocks are 2–5% each
  and own only the cell under their heading) and not caption reading.

**Fix.** A piece remembers the region it was cut from, and goes to a
caption INSIDE that region before any other: the caption-side rules choose
among those, a region with no caption of its own still joins the nearest
anywhere (the S05/S07 dimension strip), and text blocks are untouched.
Bunkie A104: floor plan 147→195 ft, dimension plan 459→351, missing
27→20. Sweep of all 36 label files before/after (`zzViewSweep.eval.ts`,
rules only, product path): two lines differ — A104 as above, and Albany
A-100 (held-out, read as a delta only) missing 11→11, extra 581→338.
Totals 51,585→51,390 proposed, 6,883→6,876 missing, 17,944→17,743 extra.
Unit: two placement tests in `sheetViews.test.ts`, one the A104 shape.
No change to `detectForSheet`, where the original session is adding the
no-view-kept fallback.
### A grid bubble is drawn round, and the stage was never deleting bubbles (2026-10-27)

**The change.** `gridBubbles` accepts a closed chain as a bubble only when
every piece of it was flattened from a Bézier (`StrokeSegment.curved`), its
vertices and edge midpoints sit within 0.13 of one radius, its 4πA/P² is at
least 0.9, and it ends within 0.1 radius of where it started. The file-order
walk, the size bounds and the turn test are exactly as shipped. The shipped
test was the vertex radii alone at 0.18, which every rectangle, hexagon and
regular polygon passes.

**What the probe found first (seven training sheets, every closed chain in
the size range).** Real bubbles, where a sheet has them, are 12–16 curved
pieces with vertices within 0.09 and midpoints within 0.11 of the radius and
circularity 0.977–0.992. The straight-sided loops the shipped test accepted
are hexagonal tags, squares, 5-point open chains that reach 1.5π before they
close, and chains whose longest edge is a whole diameter. The straight-sided
loops that a purely geometric circle rule (no `curved` requirement) STILL
accepts were cropped: cooktop burners, sink basins, a flue, stool tops — all
polylines of 12–34 `lineTo`s, none a grid bubble. ELEVEN03 has no curved loop
in range at all; Topeka p74 has 4 against 343 straight ones.

**The measurement, 26 training sheets, no-hook arm, against the shipped test
re-run in the same tree as a control (it reproduced 4,391/13,014 exactly).**

| test | missing ft | extra ft | real recovered | junk added |
| --- | --- | --- | --- | --- |
| shipped (vertex radii, 0.18) | 4,391 | 13,014 | | |
| **curved pieces + radii + midpoints + circularity + closed** | 1,863 | 27,330 | +2,528 | +14,316 |
| the same without the curved requirement | 1,866 | 26,549 | +2,525 | +13,535 |
| stage off (measured 2026-10-27, round-4 notes) | 1,756 | 27,663 | +2,635 | +14,649 |

So the fix recovers 96% of the 2,600 ft the deletion was hiding, and it
costs what switching the stage off costs, because on the sheets that supply
the junk the shipped stage was not deleting grid lines — it was deleting
casework and fixtures that happened to chain into "round" loops. Per sheet:

| sheet | key ft | shipped miss/extra | real recovered | junk added |
| --- | --- | --- | --- | --- |
| Topeka p74 | 2,945 | 1,187/184 | +937 | +1,035 |
| Topeka p75 | 1,462 | 36/396 | +6 | +2,385 |
| Topeka p76 | 1,399 | 4/275 | −24 | +2,495 |
| Joplin A-101 | 1,864 | 464/1,412 | +401 | +564 |
| ELEVEN03 A4.B.1 | 1,790 | 4/512 | −38 | +1,295 |
| ELEVEN03 A4.B.2 | 1,534 | 20/810 | −18 | +2,047 |
| ELEVEN03 A4.B.3 | 1,810 | 36/415 | −21 | +1,865 |
| Camp Bow Wow A101 | 739 | 1/1,756 | −3 | +898 |
| Camp Bow Wow A120 | 16 | 0/116 | −4 | −25 |
| Crosslines A100 | 3,233 | 908/621 | +598 | +150 |
| MHK A1.01 | 945 | 356/378 | +254 | +283 |
| Murray A101 | 1,037 | 167/137 | +124 | +36 |
| NG Green Bay A3.2 | 653 | 123/497 | +121 | +9 |
| Bunkie A100 | 470 | 108/500 | +91 | +101 |
| Fairgrounds A-101 | 173 | 118/521 | +51 | +50 |
| Baker A101 | 615 | 89/32 | +47 | +6 |
| Supreme Court A111 | 211 | 41/436 | −19 | +460 |
| E Street A2.1 | 477 | 0/451 | 0 | +214 |
| NG Green Bay A3.1 | 1,009 | 154/989 | +29 | +203 |
| Baker A100 | 1,681 | 64/304 | +29 | +29 |
| HPL p3 | 382 | 382/416 | 0 | +83 |
| the other five | | | 0 | +73 |

Two sheets tell the whole story. Topeka p74 and p75 are the same building
one floor apart, drawn the same way; p74 carries 1,198 ft of traced misses
and recovers 937 of them for 1,035 of junk, p75 carries 36 ft of misses and
gains 2,385 of junk for 6. What differs is not the walls but which sheet a
reviewer traced. The junk that appears on p75, p76 and ELEVEN03 was there
all along and the shipped deletion was hiding it, at the price of the walls
on p74.

**The order-dependence halves as a side effect.** The reversed arm went from
6,609/18,011 (shipped) to 1,882/27,089, within 1% of the file-order answer,
because the bubble set is now a few dozen real circles rather than hundreds
of chains whose membership depended on which stroke the walk reached first.

**What does not ship and why.** The geometric-only variant is 800 ft less
junk for 3 ft less wall, and it keeps deleting under burners, sinks and
stools, which is the shape of the defect this fixes. The curved requirement
is the test that says what a bubble IS; the other three are the belt to it.

**What follows.** The 14,300 ft of junk is the unit-plan casework the round-4
notes name: ELEVEN03 ×3 at +5,200, Topeka p75+p76 at +4,900, Camp Bow Wow
+900, Supreme Court +460. That is a junk filter's job, not a bubble stage's,
and this change is what makes its target visible: before it, that junk was
being removed by accident, and the walls under it with it.

Branch `diego/round-bubbles` off `main`. Unit tests: five new refusals in
`gridBubbles.test.ts` (straight-pieced 12-gon, hexagon, octagon, curved
ellipse, unclosed curved chain). No e2e.

### Baker A401: thirteen captions no rule could see, and a server path that measures the sheet whole (2026-10-27)

Reported by the third session from the export eval: "A401: server finds 13
groups, viewer path (collector) finds none". Reproduced in Node on Baker
p19 with the export eval's exact inputs. **The candidate hook is not the
cause** — `detectForSheet` returns zero walls with the hook and without it.
Two defects and one divergence, in the order they fire:

1. **`sheetViews` required a caption to contain a drawing word** (PLAN,
   ELEVATION, SECTION, DETAIL …). A401 is twelve interior elevations and
   one enlarged plan captioned "RESTROOM 1 NORTH", "HALLWAY EAST",
   "ENLARGED RESTROOMS", each with `SCALE: 1/4" = 1'-0"` printed 0.5% of
   the page under it. None matched, so the sheet had no captioned view at
   all. (The title route finds lettering by SIZE; these names are 12.6 pt
   against a 9.5 pt median and do not qualify.)
2. **A title-found text block owns the whole gutter region it sits in.**
   The title route found KEYNOTE LEGEND and GENERAL NOTES, both text
   blocks; `viewRegions` cuts A401 into two margin strips and one region
   holding everything else, so each block's box was the drawing region.
   With `drawingCount` 0 the single-drawing fallback removes every region
   inside a text-block box, which left the two strips: 19 strokes of
   212,851. Zero walls, for the wrong reason.
3. **The server path never calls `detectForSheet`.** Saving a calibration
   runs `detectWallsAfterResponse` → `detectWallsForCalibration` →
   `findWallsOnSheet` on the WHOLE sheet — no views, no regions, no text
   blocks. On A401 that is 88 walls in 12 groups, 796 ft, of interior
   elevation and fixture line work on a sheet whose only plan is two
   restrooms. The whole-set WALLS stage (PR D #820) uses the same call and
   inherits the same answer. The "one pipeline" work of 2026-10-22 made
   the viewer equal the eval; it did not reach this path.

**Fixed here: (1).** A readable scale with lettering over it is a view
whatever the lettering says; what KIND it is stays with `viewClass`, and a
kind nobody recognises is measured by nobody. The guards that keep the old
trap out: a `LABEL: value` field, a bare title-block label (SCALE, DATE,
JOB …) and anything in the title-block strip at the right (`CORNER_X`) are
not names; a line with a drawing word beats a longer one without over the
same scale; one name per scale, so the drawing number beside the title is
not a second view; a word-less name over `SCALE: NTS` is still nothing.
When a joined title twins a split caption, the caption takes the title's
text. A401 now: 13 views, none measured, each listed as "the caption does
not say what kind of drawing this is — check it", zero walls for the right
reason. On the 26 training sheets the change is byte-identical to the run
before it (1,863 / 27,330, every per-sheet line equal), because no labelled
sheet captions a drawing without a drawing word. Unit tests in
`sheetViews.test.ts` cover the room-and-direction caption, the number
beside it, the three title-block shapes, the two-line name and NTS.

**Not fixed, recorded:** (2) a text block should own its lettering's
extent, not its region — on A401 it no longer matters because the
captions now place the drawings, but a sheet with one word-less caption
and a notes heading would still lose its drawing to the block; and (3) the
server path, which is a product decision about whether a calibration save
and the whole-set stage should run `detectForSheet` (views, regions, text
blocks, kept floors) instead of the raw finder. Until it does, a
calibration on an elevation sheet or a detail sheet proposes the
elevations as walls, which is what the third session saw.

### The classifier's veto does not take the casework the round-bubble test uncovers (2026-10-27)

Asked before building a unit-plan junk filter: does the trained classifier,
vetoing at 0.3, already remove the 14,300 ft of junk that deleting only
genuinely round loops (`23af9453`) makes visible? Measured leave-one-
building-out on the 26 training sheets with `zzLoboVeto.eval.ts`: rows
built through `detectForSheet` (the product path, not the raw finder
`zzTrainRows` collects from), one gradient-boosted model per left-out
building trained on every other building's real rows plus the synthetic
rows (HPL has no labelled candidates, so no rows, and is scored with the
all-rows model — every row of that is already "every other building"),
then every sheet scored with and without the veto. Shipped rows: 19,347
real + 130,457 synthetic; round rows: 20,017 + 142,331. The shipped-rules
arm reproduced the arms eval's 4,391 / 13,014 exactly.

| arm | missing ft | extra ft |
| --- | --- | --- |
| shipped bubbles, rules | 4,391 | 13,014 |
| shipped bubbles + veto 0.3 (LOBO) | 4,973 | 11,852 |
| round bubbles, rules | 1,863 | 27,330 |
| round bubbles + veto 0.3 (LOBO) | 2,200 | 25,181 |

**The veto removes 2,149 ft of the 14,316 ft the round test adds, and
costs 337 ft of real wall doing it.** Round + veto against shipped + veto:
real recovered 2,773 ft, junk added 13,329 ft. Per sheet, the four arms
(missing/extra) and the round-plus-veto against shipped-plus-veto trade:

| sheet | shipped rules | shipped+veto | round rules | round+veto | real / junk |
| --- | --- | --- | --- | --- | --- |
| Topeka p74 | 1,187/184 | 1,263/131 | 250/1,219 | 319/1,065 | +944 / +934 |
| Topeka p75 | 36/396 | 73/366 | 30/2,781 | 49/2,577 | +24 / +2,211 |
| Topeka p76 | 4/275 | 25/265 | 28/2,770 | 37/2,597 | −12 / +2,332 |
| Joplin A-101 | 464/1,412 | 501/1,284 | 63/1,976 | 67/1,747 | +434 / +463 |
| ELEVEN03 A4.B.1 | 4/512 | 30/438 | 42/1,807 | 74/1,705 | −44 / +1,267 |
| ELEVEN03 A4.B.2 | 20/810 | 17/819 | 38/2,857 | 48/2,783 | −31 / +1,964 |
| ELEVEN03 A4.B.3 | 36/415 | 117/352 | 57/2,280 | 95/2,096 | +22 / +1,744 |
| Camp Bow Wow A101 | 1/1,756 | 6/1,651 | 4/2,654 | 10/2,500 | −4 / +849 |
| Camp Bow Wow A120 | 0/116 | 0/116 | 4/91 | 11/83 | −11 / −33 |
| Crosslines A100 | 908/621 | 980/492 | 310/771 | 325/636 | +655 / +144 |
| MHK A1.01 | 356/378 | 362/252 | 102/661 | 115/527 | +247 / +275 |
| Murray A101 | 167/137 | 171/123 | 43/173 | 46/161 | +125 / +38 |
| NG Green Bay A3.2 | 123/497 | 126/492 | 2/506 | 5/453 | +121 / −39 |
| Bunkie A100 | 108/500 | 112/301 | 17/601 | 42/405 | +70 / +104 |
| Supreme Court A111 | 41/436 | 128/445 | 60/896 | 71/848 | +57 / +403 |
| Baker A101 | 89/32 | 128/27 | 42/38 | 52/30 | +76 / +3 |
| Baker A100 | 64/304 | 125/284 | 35/333 | 84/322 | +41 / +38 |

On Topeka p75 and p76 the veto takes about 200 ft of 2,200–2,300 ft of new
junk each; on ELEVEN03 100–180 of 1,300–2,000. The model was trained on
rows whose negatives include Chrome's "not a wall" verdicts on those
sheets, and it still passes the casework, which says the feature vector
does not separate a cabinet run from a partition — both are two parallel
lines a scheduled thickness apart. A junk filter that reasons about what
the lines enclose (a closed rectangle of counter depth, a fixture symbol
inside, a dimension string) is a different instrument, and it is still
needed. The veto at 0.3 is also not free on shipped: 582 ft more missing
for 1,162 ft less extra.

Branch `diego/round-bubbles`; `zzLoboVeto.eval.ts` is the reusable
instrument (`LOBO_ROWS_OUT` to build rows, `LOBO_MODEL_DIR` + `LOBO_CUT` to
score; per-fold models from a 25-line sklearn script, same parameters as
`train-wall-model.py`). The held-out sets are refused by `heldOutReason`.

### A unit-plan junk filter, and why the junk it was built for is not there (2026-10-27)

Brief: the round-bubble test (`23af9453`) adds 2,773 ft of real wall and
13,329 ft of "junk" against shipped + veto; the model does not take the
junk; build a casework filter (geometry and context, not thickness) and
measure round + filter + veto against shipped + veto.

**First, what the 13,329 ft is.** Every offered candidate on the 26
sheets was scored against the key (accepted + traced), against the
reviewer's "not a wall" runs, and against "unsure", for both bubble tests.
The shipped finder's 13,014 ft of extra is 9,363 ft of reviewer-rejected
runs. The round test adds 14,317 ft of extra, of which **−82 ft overlaps a
rejection and 14,394 ft overlaps NO verdict at all** — candidates the
shipped finder deleted the faces of before pairing, so no reviewer ever
saw them. Cropped on Topeka p75 and ELEVEN03 A4.B.2, the biggest of them
are corridor and exterior walls under hexagon window tags, the same walls
the tracer traced on p74. The accepted-only keys on p75, p76, ELEVEN03,
Camp Bow Wow, E Street, HPL, SW and McAllen cannot tell those from junk.

On the 14 sheets WITH traces, where extra means junk, the round test's
unlabelled extra is 4,237 ft: 2,125 ft in runs of 20 ft and more (dashed
overhead lines on Joplin, magenta area-boundary lines on MHK, a balcony
edge paired with a wall face and window sill lines on Supreme Court, a
layout line a foot off a partition on p74, a title stamp on Joplin, and
some walls the tracer did not trace), 940 ft in 10–20 ft runs, 1,172 ft
under 10 ft. Casework-shaped junk is a quarter of the measurable junk at
most. Topeka p74 is the proxy for p75/p76: there the new candidates split
47% real / 53% extra against a complete key.

**The filter** (`unitPlanJunk.ts`, not wired): a pair is set aside when
both faces are dashed (many pieces, low cover), when a short run's faces
are capped at both ends (a drawn box), or when a short run reaches no
other candidate (a thing inside a room). Every constant physical.

| arm, 26 sheets | missing ft | extra ft |
| --- | --- | --- |
| shipped + veto 0.3 (LOBO) | 4,973 | 11,852 |
| round + veto | 2,200 | 25,181 |
| round + filter v1 | 5,059 | 22,227 |
| round + veto + filter v1 | 5,179 | 20,912 |

v1 against shipped + veto: real −206 ft, junk +9,060 ft — it removes
3,700 ft of key wall (1,760 on traced sheets) for 1,631 ft of rejected
junk and 3,472 ft unlabelled. The closed-box rule takes wall segments
between two door jambs (605 ft on p74 alone); the dashed rule takes walls
drawn as existing (all 207 ft of Alden A103's key). v2 (box only at ≥ 11 in
depth, dashed at 6 pieces / 60% cover) removes 332 ft of key, 564 ft of
rejected junk and 708 ft unlabelled across all 26 sheets — too little to
move any sheet, because the pairer's 13 in ceiling already keeps base
cabinets and vanities out and 12 in uppers and shelves pair for about
300 ft in total. Per sheet, v2's removals (real / rejected / unlabelled):
Topeka p74 15/11/14, p75 29/2/54, p76 16/0/54; ELEVEN03 162/152/274
across three sheets; Joplin 22/0/27; Camp Bow Wow 11/93/97.

**Conclusion.** There is no junk filter to build against this number. The
round-bubble test's cost is unmeasured, not measured-bad: 14,400 ft of
candidates no reviewer has judged, on sheets whose keys were taken from
the shipped list. What measures it is a review pass over the round-bubble
candidate list on Topeka p75/p76, ELEVEN03 and Camp Bow Wow (and tracing
where it misses), after which the veto, the filter and the shape test can
all be scored on the same footing as p74. Until then p74 is the evidence:
+937 real, +1,035 unlabelled, of which the reviewer traced nothing.

### Round 5: the new candidates judged, and round-bubbles against the shipping rule (2026-10-28)

Chrome reviewed the candidates the round-bubble test uncovers (Topeka p74
134 accepted / 46 rejected, p75 161/75, p76 177/66, ELEVEN03 66/50,
126/56, 118/40, Crosslines 125/64, Joplin 43/23, MHK 19/11; Camp Bow Wow
A101 14/104), and the original session trimmed the traces an accepted
candidate now covers (p74 −165 ft, MHK −8, Crosslines −348). Each label
stores a trace twice, in `traced[]` and as a `traced` verdict;
`keyFromLabels` reads the verdicts only, so a trace counts once.

Re-measured on the new labels, LOBO fold models retrained per arm (shipped
rows 21,510 real + 130,457 synthetic; round 33,039 + 142,331), veto 0.3,
26 training sheets:

| arm | rules miss / extra | veto 0.3 miss / extra |
| --- | --- | --- |
| shipped | 13,637 / 12,606 | 14,274 / 11,506 |
| round-bubbles | 1,566 / 16,844 | 2,257 / 15,091 |
| round-bubbles + splitFacePass | 1,566 / 16,940 | 2,257 / 15,174 |

The shipped finder's missing feet went from 4,391 to 13,637 on the same
sheets: that is round 5's acceptances entering the key, walls the shipped
finder never offered. **Round-bubbles with the classifier on: real
+12,017 ft, junk +3,585 ft, 3.4 ft per ft — passes the 3× rule.**
Per sheet (veto arm, real recovered / junk added): Topeka p76 +2,054 /
+247, p75 +1,927 / +352, p74 +1,767 / +160, ELEVEN03 A4.B.3 +1,539 / +98,
A4.B.2 +1,394 / +280, A4.B.1 +755 / +369, Joplin +871 / +42, Crosslines
+770 / −27, MHK +263 / +255, NG Green Bay A3.2 +124 / −76, Murray +121 /
+38, Baker A101 +64 / −3; Camp Bow Wow A101 +219 / +685, Supreme Court
+57 / +408, E Street +3 / +206, NG Green Bay A3.1 +29 / +191, HPL 0 / +85,
SW 0 / +95 (−11 real), McAllen −23 / +60.

**Four buildings are worse by more than 100 ft net, and three of them
were not in round 5:** E Street (−203), Supreme Court (−351) and SW
(−106) have accepted-only keys and no reviewer has seen their new
candidates, which on every sheet that WAS reviewed came back 60–80% real.
Their "junk" is the unlabelled kind. Camp Bow Wow A101 (−443) was
reviewed and is junk: see below.

**splitFacePass adds nothing on top of round-bubbles**: missing identical
(2,257), extra +83 ft. The walls it recovered on main — Crosslines'
demising wall, Bunkie's twice-drawn face — are proposed by the pairer
once the grid stage stops deleting faces around them, and round 5
accepted them. The pass is left on `diego/recall-never-paired` and is not
in this PR.

**Camp Bow Wow A101, and why no narrow fix.** The sheet is a dog-boarding
floor plan at 1/8": 113 kennel enclosures ("kennels as selected, owner
provided; G.C. to install") in rows of 4×4 and 4×6 ft, indoor play-yard
fencing, outdoor runs with 8 ft fence, concrete curbs and trench drains —
all drawn as two parallel lines a wall thickness apart, in regular rows.
The shipped bubble stage hid most of them by accident through the kennel
tags. Two signatures were measured across the training sheets as a
possible narrow filter: "a face drawn as a regular dash pattern" covers
187 of Camp Bow Wow's 2,378 rejected ft and removes real walls elsewhere
(Alden A103's existing walls are dashed, 199 ft; Joplin 284 ft mixed), and
"one of a regular parallel series at a ≤ 6 ft pitch" catches 122 ft there
while flagging 1,403 ft of real wall on the unit plans, whose units repeat
at exactly that kind of pitch. What separates a kennel panel from a
partition on this sheet is the note that says who furnishes it, not its
geometry. The classifier does see these pairs; on this sheet the LOBO
veto removed 55 ft of the 740.

### Camp Bow Wow A101: context where geometry failed, and how far it reaches (2026-10-28)

Geometry could not separate the kennel panels, runs, fences and curbs from
partitions (round 5 above). Two context signals were measured on every
offered candidate of the 26 training sheets, each candidate scored by what
it overlaps — key, reviewer-rejected, unlabelled:

**Words near the candidate.** For each of the words a kennel plan prints —
KENNEL, RUN, FENCE, CHAIN LINK, GATE, PLAY YARD, BOARDING, CURB, TRENCH
DRAIN, PANEL, LATCH, SHELVING, BY OWNER, OWNER PROVIDED, NIC, RACK — the
footage within 10, 15, 20 and 30 ft of it. At 10 ft, PLAY YARD (0 key /
246 rejected), RUN (0 / 153), CHAIN LINK (0 / 142), GATE (0 / 142), CURB
(0 / 45), SHELVING (0 / 65) and TRENCH DRAIN flag rejected footage and no
key wall on any sheet. KENNEL does not: it is written beside the room's
real walls as often as beside the panels (281 key / 107 rejected at
10 ft), and so are BOARDING (455 / 181 at 20 ft) and FENCE (152 / 174).
At 15 ft even the clean words reach Camp Bow Wow's real room walls
(365 ft). So the rule is the clean words at 10 ft, as a union: 529 ft of
rejected footage flagged — Camp Bow Wow 322, Joplin 142, SW 65 — and 0 ft
of key, on 20 candidates across three sheets.

**Repetition inside one room.** Membership in a regular parallel series
(≥ 3 others of comparable length at multiples of one pitch ≤ 6 ft, see
round 5) catches 122 ft of Camp Bow Wow's rejected footage and flags
1,403 ft of real wall on the unit plans, whose units repeat at exactly
that pitch. Not used.

**Shipped as a set-aside, not a drop:** `offeredCandidates` takes the
sheet's text (optional — a caller without it offers as before; the viewer
and the LOBO eval pass it) and sets a paired wall aside with the kind
`site-equipment` and the word and its distance, so a reviewer who
disagrees still sees it. Measured LOBO, veto 0.3, 26 sheets, on top of
round-bubbles: extra −503 ft, missing unchanged on every sheet — Camp Bow
Wow A101 2,293 → 1,997, Joplin 1,340 → 1,198, SW 1,687 → 1,622. Camp Bow
Wow keeps 1,997 ft of extra: the rule reaches the runs, yards, curbs and
drains that are labelled, which is 13% of what the sheet draws like a
wall and is not one. The kennel grid itself carries numbers, not words,
and its perimeter is the room. A vocabulary read off one building and
measured on twenty-six; the words are the drafter's, the reach is the one
measurement set, and both are stated beside the rule.

### The veto's cut, retrained on every label including round 5, with round-bubbles in (2026-10-28)

Fold models retrained per building on the round-bubble finder's rows from
all labels (33,039 real + 142,331 synthetic), LOBO, 26 training sheets,
each cut's veto against its own rules arm. HPL p3 had been re-keyed after
the round-5 run (its 382 ft of lighting-plan key cleared), so these rows
are 382 ft lower in missing than the round-5 table; E Street's key grew
from 477 to 620 ft between the 0.5 and 0.6 runs (Chrome's round 6), which
is why the 0.6 rules arm differs by 11 / −142.

| cut | rules miss / extra | veto miss / extra | real lost | junk removed | removed per lost | buildings losing > 100 ft |
| --- | --- | --- | --- | --- | --- | --- |
| 0.2 | 1,184 / 16,844 | 1,574 / 15,744 | 390 | 1,100 | 2.8 | Topeka 216 |
| 0.3 | 1,184 / 16,844 | 1,875 / 15,091 | 691 | 1,753 | 2.5 | Topeka 282, ELEVEN03 150 |
| 0.4 | 1,184 / 16,844 | 2,307 / 14,303 | 1,123 | 2,541 | 2.3 | Topeka 345, ELEVEN03 343 |
| 0.5 | 1,184 / 16,844 | 2,681 / 13,171 | 1,497 | 3,673 | 2.5 | six buildings, Topeka 414 |
| 0.6 | 1,195 / 16,702 | 3,654 / 11,626 | 2,459 | 5,076 | 2.1 | seven buildings, Topeka 828 |

**Read against the board's rule — 3 ft of junk removed per foot of real
wall lost — no cut passes, and the ratio falls as the cut rises.** Before
round-bubbles the veto at 0.3 on the shipped finder removed 1,162 ft for
582 lost, 2.0 per foot, so the classifier is better on the new finder
than on the old one at every cut, and still short of 3. The loss sits on
the unit plans at every cut: Topeka p74 loses 116 ft at 0.2 for 35 ft
removed, p75 61 for 62 — a fold that has never seen a unit plan vetoes
the unit plan's walls. That is leave-one-building-out's honest cost, and a
lower bound on the production model, which is trained on every building.

**Recommendation: 0.2 if a veto runs at all.** It is the cut closest to
the rule (2.8), the only one with a single building over the 100 ft line,
and it keeps the walls round-bubbles recovered: 390 ft lost against
12,017 gained. 0.3, the cut chosen on 2026-10-21 against the shipped
finder, is no longer the best point on the new finder's curve. Whether a
veto that does not meet the rule should run is Diego's call; its removal
is a product setting, not a code change, and the setting is measured
here either way.

### Recall on the round-5 and round-6 labels, round-bubbles in: what is left and what it is worth (2026-10-28)

`zzMissKinds.eval.ts` (the database-free version from `diego/miss-round4`,
now on this branch) over the 14 traced training sheets, labels as of
11:11 today. Traced misses fell from 5,768 ft to 2,775 ft.

| stage | ft | share |
| --- | --- | --- |
| proposed after all (a current candidate lies over the trace) | 1,821 | 66% |
| merged into a neighbour | 317 | 11% |
| never paired | 267 | 10% |
| set aside by triage, all in-a-hatch | 214 | 8% |
| paired, not awarded | 61 | 2% |
| lost to the post-pairing filters | 95 | 3% |

By style: two faces, ordinary pen 2,273 ft (82%), short closet wall 465
(17%); the "dense area" kind is 95% of everything, which is to say the
styles no longer separate anything and the stage is the useful axis.

**The 1,821 ft "proposed after all" is mostly a labelling gap, not a
loss.** Each of those traces was matched to the candidate over it and that
candidate to the reviewer's verdicts: 1,005 ft lie on the same line as a
candidate covering ≥ 80% of the trace that has NO verdict within 1 ft of
it (843 ft with no verdict anywhere near) — on Murray 552, NG Green Bay
227, Bunkie 95, Baker 92, Fairgrounds 39, none of which was in round 5 or
6. These are walls round-bubbles now proposes over old traces nobody has
judged; trimming them the way the round-5 sheets were trimmed, after a
review, is what makes this table honest. 171 ft sit under a candidate the
reviewer REJECTED (the finder drew the wall wrong — thickness or extent —
and the reviewer traced instead), 122 ft under a parallel accepted wall
within 2.5 ft (a double wall or a band artefact).

**The real finder losses are 954 ft, in three causes:**

1. **Pairs refused on partial faces — about 300 ft.** Merged 243 ft and
   never-paired 53 ft of "pair refused at N in": the faces are there and
   kept, and the pair test refuses them on overlap or overhang. Crosslines
   112 (the exterior wall traced across a window run: the window's frame
   lines at 15.6 ft against the wall band's 4.5 ft pieces), Topeka 84,
   Baker 41, NG Green Bay 26. The split-face pass that answered the
   Crosslines demising wall on main was measured on these labels on top
   of round-bubbles: 0 ft real, +83 ft junk. What is left needs a bridge
   across a window run, which has not been built or measured; the ceiling
   is 300 ft.
2. **In-a-hatch set-aside — 214 ft.** Supreme Court 98 (two 38 ft walls
   drawn as a grey-filled band with thin edge lines), Fairgrounds 33,
   Crosslines 24, MHK 15, Bunkie 13, Joplin 12, Baker 10. The hatch pitch
   rule was measured in round 4 at +29 ft real for +6,944 ft junk on the
   customer path, and offering everything in-a-hatch at +626 / +69,000; no
   rule meeting the board's 3-to-1 is known. The third session's
   contour-face reader for grey fills (scanned-plans branch) is the one
   instrument that reads this style, and it is a different pipeline.
3. **Walls outside the kept plan region — about 140 ft.** NG McAllen A3.2
   118 (two 39 ft walls at x 0.613, every one of their 248 faces outside
   `planBoxes`: the single-drawing path's `drawingRegions` kept the
   busiest region and dropped the strip they are in, which held under a
   tenth of its strokes), Crosslines 16, Murray 8. Same family as Bunkie
   A104 on `diego/view-losses` (region placement), different rule: the
   share-of-busiest threshold. A fix is one line and must be swept for
   collateral (a dimension strip or legend re-admitted is the risk); it
   was not built here because at 140 ft it is not the biggest cause and
   the sweep is a separate run.

None of the three carries a fix that meets the rule today, so nothing
ships from this pass. Crops: McAllen's two walls are a storefront-style
wall of a thick line and a grey double line with mullion rectangles;
Crosslines' is the window run under a dash-dot overhang; Supreme Court's
is the filled band.


## Whole-set takeoff — 2026-10-27 (third session, `diego/whole-set-takeoff`)

**Shape.** `WALLS` is a plan-ingest STAGE (`lib/plan-ingest/walls.ts`): the
runner's claim column, the browser pump and the cron safety net are reused
unchanged; the per-sheet work is `detectWallsForCalibration`, untouched finder.
`startPlanIngest(planId, "WALLS")` makes a task per sheet that has a scale, is
not called a non-plan by its title block, and has no walls for its current scale
— so progress is "12 of 18" and never "12 of 100". Each finished task writes a
`note`; the summary (`wholeSetSummary`) is derived from proposals, tasks and
sheets at read time. Behind `Company.wholeSetTakeoffOn`, OFF.

**Cost and time.** No model. One sheet's detection per advance call (the call's
5 s budget is checked before each claim; detection may run to its own 45 s
cap), and each call reads the plan file from storage once — that read was 7.7 s
on a 52-sheet set in production (`detectWallsForCalibration`'s header), so on a
100-page set the whole-set run costs (eligible sheets) × (file read + finder),
not 100 ×. Baker: 4 eligible of 65, 22 s of finder time, longest sheet 17 s
(`shots/whole-set/`, outside git).

**Eligibility is the title block's verdict, not the viewer's.** The viewer also
reads the drawings' captions (`sheetViews`) before deciding; the planner uses
`takeoffSheetVerdict` on sheet number and title only, because that is free at
press time. On Baker that lets G002 (a code sheet drawn at 1/4") through and the
finder reports 15 groups on it. A sheet the inventory never named counts as
eligible: unknown is not "not a plan".

**What was not built.** Per-view scales (a sheet with two drawings at two
scales) are not consulted; the sheet's current calibration is. A "nothing
found" sheet is eligible again on the next press — pressing again is asking
again. The run does not open the PDF once for all sheets (each task reads it),
which is the ceiling to raise if the storage read dominates on big sets.

**E2E to run when Clerk is quiet.** Settings: the switch saves and the takeoff
page shows the panel only when on. Takeoff with Baker scaled: press, watch
`whole-set-progress` reach "N of N sheets — done", summary rows carry
`data-status="walls"` for the floor plans, open one and see its groups without a
press of Find walls.

### McAllen A3.2's east wall: a heading's claim ends where its words do (2026-10-28)

The recall pass above listed it as cause 3, "walls outside the kept plan region", and
blamed `drawingRegions`' share-of-busiest rule. Wrong stage: the probe showed
`viewRegions` returned only two regions (x 0..0.703 and the title column), both kept as
drawing, and the plan's `boxes` were `[0,0.031]`, `[0.031,0.51]` and a sliver at the
right — nothing from x 0.51 to 0.703. That column was a TEXT-BLOCK box: WALL & PARTITION
NOTES / DIMENSION PLAN NOTES sit at y 0.028 at the top of the plan's region, no other
caption line crosses x 0.51..0.703, so #823's "only that piece" rule — the piece under
a heading is the heading's — gave it the piece from y 0 to 0.667. 14% of it is notes.

Fix in `placeDrawings`: a heading's claim ends at the last word reachable from it without
a gap over `NOTES_END_GAP` (0.03 page-width units, about an inch on ARCH D), plus
`CAPTION_MARGIN`; the remainder rejoins the shared pieces and is placed as a drawing
piece. McAllen's block now ends at y 0.234 and the plan's boxes reach x 0.703.

36-sheet sweep (`zzViewSweep`, current labels): only McAllen changed — missing 274 → 141,
extra 80 → 119 (133 real for 39 junk, 3.4×). The 39 ft of junk is on McAllen itself and
was not looked at: at 3.4× it meets the board's rule, and the strip it comes from is the
one that held the wall.

### "Pairs refused on partial faces" is not a product-path cause, and the grid-label rule that replaced it fails on top of #824 (2026-10-28)

The recall pass two entries up named "pairs refused on partial faces, ~300 ft" the
biggest real loss. It was measured by `zzMissKinds`, which runs `findWallsOnSheet` on
the RAW page — no view restriction, no triage — and against main's finder. Replayed on
the product path (`detectForSheet` → `offeredCandidates` → `scoreSheet`, the sweep's
own instruments) over the same 645 ft of unpaired traces, 539 ft is still missing and
no shape reaches 100 ft:

| what the replay found, product path, main's finder | ft |
| --- | --- |
| strokes removed before pairing — every one by the grid-bubble filter | 140 |
| pair refused: overlap (an opening traced as wall: Joplin's hall, E Street's door) | 99 |
| pair refused: overhang (filled bands, staggered jamb pieces) | 96 |
| a pair formed in the real pass and the greedy pass discarded it (Baker's W4 window run, Topeka, Crosslines) | 66 |
| fewer than two faces (a wall drawn as one thick stroke: McAllen's IW-7) | 40 |
| no pair at wall thickness / too short / outside the plan boxes | 90 |

The window-run shape the entry imagined — a run between two found walls with window
lines inside — is 15 ft. Crops in the session scratchpad (`crops-miss/m0-m9`).

**The 140 ft was the one clean shape, and it was the grid filter.** `gridBubbles`'
shape test on main admits every closed round thing of plausible size — Supreme Court
A111 has 272 of them and ONE holds a grid label, Topeka p74 347 and 115 — and
`linesIntoBubbles` drops every stroke ending within two radii of any of them: 46,243 of
Supreme Court's 67,368 strokes, 29,200 of Topeka's 78,254 to the label-less circles
alone. McAllen's east wall lost 130 strokes to two detail callouts beside it.

So a rule was built: a bubble is a grid bubble only if exactly one short label (A, 12,
A.1) sits inside its circle; with no words on the sheet, the shape test stands alone.
Measured on main + the region fix, 36 sheets: training real +12,006 ft / junk +3,551,
3.4 to 1 — which is, to within 11 ft, the gain #824's round-bubble shape test gets
from main. Two fixes for one loss, from opposite ends.

**On top of #824 it is a wash and does not ship.** #824's round-bubble test already
removes the blank circles; what it leaves are the two-word detail callouts (Supreme
Court 22 of 23 bubbles, Camp Bow Wow 13, Topeka/E Street/MHK three each). Removing
those too: training real +105 / junk +119 (0.9×), held-out +65 / +262; NG Green Bay
A3.1 −98 missing, Murray −21, but E Street +86 extra, STEM +253 extra, and Supreme
Court 26 ft MORE missing. The rule is twenty lines (`labelledBubbles(bubbles, words)`
filtering `gridBubbles`' output in `findWallsOnSheet`) and is not in the tree;
re-measure it only if #824's test changes.

What is left for the unpaired residual on #824's finder is small and mixed: the
greedy pass discarding a window run's pair when a longer neighbour claims the face
(~66 ft, Baker W4 the clearest: pairs at 3.7 in and 2.6 in formed over 1.6–8.7 ft and
the found walls stop at 0 and start at 13.2), and styles the pair test cannot read (one
thick stroke, filled bands). Neither has a measured fix.

### Junk on the product path, by kind, and the one rule that priced out (2026-10-29)

`zzJunkKinds.eval.ts`, #824's finder (`ec8b3677`), training sheets, confirmed junk only
(offered footage on a `not-wall` verdict and on no real wall). Offered 54,119 ft; on a
real wall 38,742; confirmed junk 12,434; on an `unsure` verdict 1,319; unlabelled 1,601.

| kind (a heuristic, checked by crops) | ft | runs |
| --- | --- | --- |
| other: a plausible wall the key rejected | 4,770 | 303 |
| stacked dimension strings (feet-and-inches text between the faces) | 1,941 | 107 |
| a second candidate along a real wall | 1,931 | 188 |
| furniture / fixtures | 910 | 288 |
| grid lines | 735 | 8 |
| repeated unit-plan shape | 656 | 81 |
| kennel / fence / run grid (after #824's site-equipment rule) | 416 | 18 |
| casework / counters / shelves | 412 | 67 |
| hatch lines | 309 | 98 |
| text or tag boxes | 283 | 43 |

The crops of the biggest runs said what the kinds could not: SW A110's two 100 ft
dimension strings 12 in apart with "99'-9 7/8"" between them, MHK's the same, ELEVEN03's
vertical ones; Joplin's two 100-ft SINGLES are dimension lines; Supreme Court's 70 ft at
3.5 in is a baseboard radiator; Joplin's 45 ft at 5 in is the double rule of the GENERAL
PLAN NOTES box; and across "other" and "duplicate" alike, a DASHED line paired with a
solid one or another dashed one — a canopy edge, a setback, a grid line.

Rules priced on every offered candidate (junk removed per real foot lost; the board rule
reversed wants 3):

| rule | junk | real lost | ratio |
| --- | --- | --- | --- |
| dimension text between the faces | 1,488 | 4,225 | 0.4 |
| same, and nothing meets the run | 424 | 579 | 0.7 |
| a parallel overlapping neighbour, this the thinner | 1,191 | 4,044 | 0.3 |
| a run ≥ 60% of the sheet's extent that ≤ 1 wall meets | 679 | 198 | 3.4, but all 198 is Alden's one wall |
| one face dashed | 2,122 | 957 | 2.2 |
| **both faces dashed** | **590** | **33** | **18** |

Shipped: both faces dashed, as a triage set-aside (`dashedFaces.ts`). Sweep on top of
#824, 36 sheets: training extra −679 / missing +30, held-out extra −14 / missing +30
(one STEM wall); Bunkie A100 −247, NG Green Bay A3.2 −112, A3.1 −68, McAllen −45. The
"other" bucket at 4,770 ft is still the biggest thing on the table and still a question.

### The "other" junk re-sorted, the duplicates that are not, and two rules that priced out (2026-10-29)

Forty crops of the 4,770 ft "other" bucket (at most four per sheet; session scratchpad
`crops-other/`), then every "other" run re-sorted by the features the crops pointed at:

| what it is | ft | runs |
| --- | --- | --- |
| rest (still unexplained; Camp Bow Wow 764, NG Green Bay A3.1 306, ELEVEN03 238) | 2,469 | 200 |
| two long solid lines nothing meets (site edge, railing, storefront) | 651 | 15 |
| a plausible wall that partitions meet, the key rejected | 449 | 14 |
| table, schedule, notes or legend rules | 355 | 16 |
| a dashed line beside a solid one | 296 | 15 |
| sparse faces | 100 | 9 |
| dimension strings and witness lines the kind test missed | 65 | 4 |

Six of the forty crops were BLANK at the candidate's midpoint at two widths, with faces
of eight equal 4 ft pieces covering the whole run: lines the PDF carries and never
draws. Tagging every stroke with the operator that painted its path found them —
`eoClip` paths, 23% of NG Green Bay A3.1's strokes, 43% of Topeka p76's — and the
clip-path rule in `sheetStrokes` is the result (numbers in the changelog entry).

**"A second candidate along a real wall" is not the same wall twice.** Matched each of
its 1,905 ft to the nearest offered real wall within 4 ft: 1,696 ft has zero overlap
with it — the junk continues the wall's line past its end (crops `crops-dup/d1-d5`: a
notes-box rule, a dash-dot setback, a radiator run, a grey unit-plan segment the reviewer
rejected). The review tool's `duplicatePairs` (1.5 ft centrelines, 70% overlap) cannot
see those, and the 157 ft it can see it mostly keeps the wrong side of. Applied to the
product's offered candidates as a filter, its drop side is 817 ft of junk for 2,732 ft
of real wall — Joplin's 74 ft and Supreme Court's 70 ft among them. Not a filter.

Rules priced and rejected this round: dimension text between the faces 0.4 to 1; a
long run nothing meets 3.4 to 1 with all its real loss on Alden's one wall; one dashed
face 2.2 to 1 (7 to 1 with Alden out, which is tuning on a building); faces mostly
unpainted at 50% 1.3 to 1 (at 95%, 126 to 1 — the clip rule takes the whole class
instead).
