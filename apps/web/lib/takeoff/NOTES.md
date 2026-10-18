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
