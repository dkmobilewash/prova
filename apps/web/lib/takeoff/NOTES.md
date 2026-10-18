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
